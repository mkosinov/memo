"""RED tests for src/domain/deletion.py (Task 8 of GH #207).

Single source of truth for:

* ``FK_MATRIX`` — the full §4 dependency matrix per entity model.
* ``FKDependency`` — the dataclass describing one FK relation.
* ``collect_dependencies`` — async DB counter that builds the 409 tree.
* ``has_blocking_deps`` — predicate: any blocked (allowed_actions == []) dep.
* ``validate_resolutions`` — validate the user's ``resolutions`` body.
* Exception hierarchy: ``ResolutionError`` ← ``BlockingDepsError`` /
  ``InvalidResolutionError``.

Domain-only — no HTTP, no service. The DELETE route (Task 9) and
``resolve_delete`` executor (Task 10) consume this module.

Spec:
* docs/specs/2026-08-15-delete-hard-delete-and-dependency-resolution-design.md
  §4 (FK matrix), §5 (409 response shape), §11 (facts), §14, §16
  (auto-deps ignored).
"""

from __future__ import annotations

# ruff: noqa: RUF001  -- Cyrillic text is intentional (Russian UI labels per spec §5)
import uuid as _uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import insert

from src.domain.deletion import (
    FK_MATRIX,
    BlockingDepsError,
    DependencyNode,
    FKDependency,
    InvalidResolutionError,
    ResolutionError,
    collect_dependencies,
    has_blocking_deps,
    validate_resolutions,
)
from src.models.activity import Activity
from src.models.client import Client
from src.models.location import Location
from src.models.master import Master
from src.models.material import Material
from src.models.payment import Payment
from src.models.record import Record
from src.models.service import Service
from src.models.tag import (
    Tag,
    client_tags,
    location_tags,
    master_tags,
    record_tags,
    service_tags,
)
from src.models.user import User
from src.models.visitor import Visitor

# ─── Helpers ────────────────────────────────────────────────────────────────────


def _deps_map(model: type) -> dict[str, FKDependency]:
    return {dep.entity: dep for dep in FK_MATRIX.get(model, [])}


async def _add_user(db_session, master_id: str) -> str:
    user = User(phone=f"+7999{_uuid.uuid4().hex[:7]}", password_hash="x", role="admin",
                master_id=master_id)
    db_session.add(user)
    await db_session.flush()
    return user.id


async def _flush_tag(db_session, name: str) -> str:
    """Add a fresh Tag row and return its id (direct ORM insert, no relationships)."""
    tag = Tag(tag=name)
    db_session.add(tag)
    await db_session.flush()
    return tag.id


async def _link_tags(
    db_session, table, owner_col: str, owner_id: str, n: int, *,
    prefix: str,
) -> None:
    """Insert n Tag rows + join rows directly (no lazy ``.tags`` access)."""
    for _ in range(n):
        tid = await _flush_tag(db_session, f"{prefix}-{_uuid.uuid4().hex[:8]}")
        await db_session.execute(
            insert(table).values(**{owner_col: owner_id, "tag_id": tid})
        )
    await db_session.flush()


async def _add_master_tag_links(db_session, master: Master, n: int) -> None:
    await _link_tags(db_session, master_tags, "master_id", master.id, n, prefix="mtag")


async def _add_location_tag_links(db_session, location: Location, n: int) -> None:
    await _link_tags(db_session, location_tags, "location_id", location.id, n, prefix="ltag")


async def _add_service_tag_links(db_session, service: Service, n: int) -> None:
    await _link_tags(db_session, service_tags, "service_id", service.id, n, prefix="stag")


async def _add_client_tag_links(db_session, client: Client, n: int) -> None:
    await _link_tags(db_session, client_tags, "client_id", client.id, n, prefix="ctag")


async def _add_record_tag_links(db_session, record: Record, n: int) -> None:
    await _link_tags(db_session, record_tags, "record_id", record.id, n, prefix="rtag")


async def _add_payment(db_session, record: Record, amount: int = 500) -> None:
    db_session.add(Payment(record_id=record.id, amount=amount, method="cash"))
    await db_session.flush()


async def _add_activity(
    db_session, *, master: Master, service: Service, location: Location, i: int = 0,
) -> Activity:
    activity = Activity(
        master_id=master.id, service_id=service.id, location_id=location.id,
        start=datetime.now(UTC) + timedelta(days=1, hours=i),
        duration=90, capacity=10, is_private=False,
    )
    db_session.add(activity)
    await db_session.flush()
    return activity


async def _add_tariff(db_session, service: Service) -> None:
    from src.models.tariff import Tariff
    db_session.add(Tariff(service_id=service.id, title=f"T-{_uuid.uuid4().hex[:6]}", price=1000))
    await db_session.flush()


async def _add_photo(db_session, service: Service) -> None:
    from src.models.photo import Photo
    db_session.add(Photo(service_id=service.id, filename=f"p-{_uuid.uuid4().hex[:6]}", is_public=False))
    await db_session.flush()


async def _add_visit(db_session, *, record, visitor: Visitor | None = None, price: int = 100) -> None:
    from src.models.visit import Visit
    visit = Visit(
        record_id=record.id,
        visitor_id=visitor.id if visitor else None,
        price=price, status="waiting",
    )
    db_session.add(visit)


# ─── 1. FK_MATRIX structure (pure, no DB) ───────────────────────────────────────


class TestFKMatrixMaterial:
    def test_material_has_no_deps(self) -> None:
        assert FK_MATRIX.get(Material, []) == []


class TestFKMatrixMaster:
    def test_has_exactly_three_deps(self) -> None:
        assert {dep.entity for dep in FK_MATRIX[Master]} == {
            "activities", "users", "master_tags",
        }

    def test_activities_blocks(self) -> None:
        dep = _deps_map(Master)["activities"]
        assert dep.action == "block"
        assert dep.allowed_actions == []
        assert dep.auto is False
        assert dep.nullable is False

    def test_users_cascade_auto(self) -> None:
        dep = _deps_map(Master)["users"]
        assert dep.action == "cascade"
        assert dep.auto is True
        assert dep.allowed_actions == ["cascade"]
        assert dep.nullable is True

    def test_master_tags_cascade_auto(self) -> None:
        dep = _deps_map(Master)["master_tags"]
        assert dep.action == "cascade"
        assert dep.auto is True
        assert dep.allowed_actions == ["cascade"]
        assert dep.nullable is False


class TestFKMatrixLocation:
    def test_has_exactly_two_deps(self) -> None:
        assert {dep.entity for dep in FK_MATRIX[Location]} == {"activities", "location_tags"}

    def test_activities_blocks(self) -> None:
        dep = _deps_map(Location)["activities"]
        assert dep.action == "block"
        assert dep.allowed_actions == []
        assert dep.auto is False
        assert dep.nullable is False

    def test_location_tags_cascade_auto(self) -> None:
        dep = _deps_map(Location)["location_tags"]
        assert dep.action == "cascade"
        assert dep.auto is True
        assert dep.allowed_actions == ["cascade"]


class TestFKMatrixService:
    def test_has_exactly_four_deps(self) -> None:
        assert {dep.entity for dep in FK_MATRIX[Service]} == {
            "activities", "tariffs", "photos", "service_tags",
        }

    def test_activities_blocks(self) -> None:
        dep = _deps_map(Service)["activities"]
        assert dep.action == "block"
        assert dep.allowed_actions == []
        assert dep.auto is False

    def test_tariffs_cascade_auto(self) -> None:
        dep = _deps_map(Service)["tariffs"]
        assert dep.action == "cascade"
        assert dep.auto is True
        assert dep.allowed_actions == ["cascade"]
        assert dep.nullable is False

    def test_photos_nullify_auto(self) -> None:
        dep = _deps_map(Service)["photos"]
        assert dep.action == "nullify"
        assert dep.auto is True
        assert dep.allowed_actions == ["nullify"]
        assert dep.nullable is True

    def test_service_tags_cascade_auto(self) -> None:
        dep = _deps_map(Service)["service_tags"]
        assert dep.action == "cascade"
        assert dep.auto is True
        assert dep.allowed_actions == ["cascade"]


class TestFKMatrixClient:
    def test_has_exactly_three_deps(self) -> None:
        assert {dep.entity for dep in FK_MATRIX[Client]} == {
            "records", "visitors", "client_tags",
        }

    def test_records_nullify_user_choice(self) -> None:
        dep = _deps_map(Client)["records"]
        assert dep.action == "nullify"
        assert dep.auto is False
        assert dep.allowed_actions == ["nullify"]
        assert dep.nullable is True

    def test_visitors_cascade_user_choice(self) -> None:
        dep = _deps_map(Client)["visitors"]
        assert dep.action == "cascade"
        assert dep.auto is False
        assert dep.allowed_actions == ["cascade"]
        assert dep.nullable is False

    def test_client_tags_cascade_auto(self) -> None:
        dep = _deps_map(Client)["client_tags"]
        assert dep.action == "cascade"
        assert dep.auto is True
        assert dep.allowed_actions == ["cascade"]


class TestFKMatrixRecord:
    def test_has_exactly_three_deps(self) -> None:
        assert {dep.entity for dep in FK_MATRIX[Record]} == {
            "visits", "payments", "record_tags",
        }

    def test_visits_cascade_user_choice(self) -> None:
        dep = _deps_map(Record)["visits"]
        assert dep.action == "cascade"
        assert dep.auto is False
        assert dep.allowed_actions == ["cascade"]
        assert dep.nullable is False

    def test_payments_cascade_user_choice(self) -> None:
        dep = _deps_map(Record)["payments"]
        assert dep.action == "cascade"
        assert dep.auto is False
        assert dep.allowed_actions == ["cascade"]
        assert dep.nullable is False

    def test_record_tags_cascade_auto(self) -> None:
        dep = _deps_map(Record)["record_tags"]
        assert dep.action == "cascade"
        assert dep.auto is True
        assert dep.allowed_actions == ["cascade"]
        assert dep.nullable is False


# ─── 2. Exception hierarchy (pure) ─────────────────────────────────────────────


class TestExceptionHierarchy:
    def test_blocking_deps_error_subclasses_resolution_error(self) -> None:
        assert issubclass(BlockingDepsError, ResolutionError)

    def test_invalid_resolution_error_subclasses_resolution_error(self) -> None:
        assert issubclass(InvalidResolutionError, ResolutionError)

    def test_subclasses_are_distinct(self) -> None:
        assert BlockingDepsError is not InvalidResolutionError


# ─── 3. has_blocking_deps (pure) ────────────────────────────────────────────────


def _node(entity: str, allowed_actions: list[str], **kw) -> DependencyNode:
    return DependencyNode(
        entity=entity, relation=entity, count=1, allowed_actions=allowed_actions, **kw
    )


class TestHasBlockingDeps:
    def test_empty_nodes_no_block(self) -> None:
        assert has_blocking_deps([]) is False

    def test_no_blocked_deps(self) -> None:
        nodes = [
            _node("users", ["cascade"]),
            _node("records", ["nullify"]),
            _node("visitors", ["cascade"], cascade_preview={"visits": 5}),
        ]
        assert has_blocking_deps(nodes) is False

    def test_activities_blocks(self) -> None:
        nodes = [_node("activities", [])]
        assert has_blocking_deps(nodes) is True

    def test_mixed_blocked_present(self) -> None:
        nodes = [
            _node("activities", []),
            _node("users", ["cascade"]),
        ]
        assert has_blocking_deps(nodes) is True


# ─── 4. collect_dependencies (async, DB-seeded) ─────────────────────────────────


class TestCollectDependenciesMaster:
    async def test_counts_activities_users_and_master_tags(self, db_session) -> None:
        master = Master(first_name="A", last_name="B", color="#000000",
                        position="мастер", specialty="живопись")
        service = Service(title="S", description="d", image_url="i", specialty="живопись",
                          min_age=6, duration=90, record_info="r")
        location = Location(name="L", capacity=10)
        db_session.add_all([master, service, location])
        await db_session.flush()

        for i in range(3):
            await _add_activity(db_session, master=master, service=service, location=location, i=i)
        await _add_user(db_session, master.id)
        await _add_master_tag_links(db_session, master, 2)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Master, master.id)
        by_entity = {n.entity: n for n in nodes}
        assert set(by_entity) == {"activities", "users", "master_tags"}
        assert by_entity["activities"].count == 3
        assert by_entity["users"].count == 1
        assert by_entity["master_tags"].count == 2
        # The blocked (activities) node carries the spec §5 message; others carry none.
        assert by_entity["activities"].allowed_actions == []
        assert by_entity["activities"].message is not None
        assert by_entity["users"].allowed_actions == ["cascade"]
        assert by_entity["users"].cascade_preview is None
        assert by_entity["master_tags"].cascade_preview is None

    async def test_zero_count_deps_are_skipped(self, db_session) -> None:
        """A master with activities + a user but 0 master_tags → master_tags not in tree."""
        master = Master(first_name="A2", last_name="B2", color="#111111",
                        position="мастер", specialty="живопись")
        service = Service(title="S2", description="d", image_url="i", specialty="живопись",
                          min_age=6, duration=90, record_info="r")
        location = Location(name="L2", capacity=10)
        db_session.add_all([master, service, location])
        await db_session.flush()
        await _add_activity(db_session, master=master, service=service, location=location)
        await _add_user(db_session, master.id)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Master, master.id)
        by_entity = {n.entity: n for n in nodes}
        assert "master_tags" not in by_entity
        assert by_entity["activities"].count == 1
        assert by_entity["users"].count == 1

    async def test_no_deps_returns_empty(self, db_session) -> None:
        master = Master(first_name="Empty", last_name="M", color="#222222",
                        position="мастер", specialty="живопись")
        db_session.add(master)
        await db_session.commit()

        assert await collect_dependencies(db_session, Master, master.id) == []


class TestCollectDependenciesLocation:
    async def test_counts_activities_and_location_tags(self, db_session) -> None:
        master = Master(first_name="L1", last_name="m", color="#333333",
                        position="мастер", specialty="живопись")
        service = Service(title="LS", description="d", image_url="i", specialty="живопись",
                          min_age=6, duration=90, record_info="r")
        location = Location(name="LL", capacity=10)
        db_session.add_all([master, service, location])
        await db_session.flush()
        for i in range(2):
            await _add_activity(db_session, master=master, service=service, location=location, i=i)
        await _add_location_tag_links(db_session, location, 3)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Location, location.id)
        by_entity = {n.entity: n for n in nodes}
        assert set(by_entity) == {"activities", "location_tags"}
        assert by_entity["activities"].count == 2
        assert by_entity["location_tags"].count == 3


class TestCollectDependenciesService:
    async def test_counts_all_four_deps(self, db_session) -> None:
        master = Master(first_name="sv", last_name="m", color="#444444",
                        position="мастер", specialty="живопись")
        service = Service(title="SvS", description="d", image_url="i", specialty="живопись",
                          min_age=6, duration=90, record_info="r")
        location = Location(name="SvL", capacity=10)
        db_session.add_all([master, service, location])
        await db_session.flush()
        for i in range(2):
            await _add_activity(db_session, master=master, service=service, location=location, i=i)
        for _ in range(3):
            await _add_tariff(db_session, service)
        for _ in range(2):
            await _add_photo(db_session, service)
        await _add_service_tag_links(db_session, service, 4)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Service, service.id)
        by_entity = {n.entity: n for n in nodes}
        assert set(by_entity) == {"activities", "tariffs", "photos", "service_tags"}
        assert by_entity["activities"].count == 2
        assert by_entity["tariffs"].count == 3
        assert by_entity["photos"].count == 2
        assert by_entity["service_tags"].count == 4
        # Photos is nullify → no cascade_preview.
        assert by_entity["photos"].cascade_preview is None


class TestCollectDependenciesClient:
    async def test_cascade_preview_counts_visits_only_no_payments(
        self, db_session,
    ) -> None:
        """Client→visitors cascade_preview = {"visits": N} — visits count, NO payments key."""
        master = Master(first_name="c1", last_name="m", color="#555555",
                        position="мастер", specialty="живопись")
        service = Service(title="cS", description="d", image_url="i", specialty="живопись",
                          min_age=6, duration=90, record_info="r")
        location = Location(name="cL", capacity=50)
        client = Client(name="cc", phone=f"+7999{_uuid.uuid4().hex[:7]}",
                        email=None, channel="telegram")
        db_session.add_all([master, service, location, client])
        await db_session.flush()
        activity = await _add_activity(
            db_session, master=master, service=service, location=location,
        )
        from src.models.record import Record
        record = Record(activity_id=activity.id, client_id=client.id,
                        status="pending", seats=0, anonym_visits=0)
        db_session.add(record)
        await db_session.flush()

        v1 = Visitor(client_id=client.id, name="V1")
        v2 = Visitor(client_id=client.id, name="V2")
        db_session.add_all([v1, v2])
        await db_session.flush()
        # 5 visits: 3 linked to V1, 2 to V2 → 2 visitors, 5 visits.
        for _ in range(3):
            await _add_visit(db_session, record=record, visitor=v1)
        for _ in range(2):
            await _add_visit(db_session, record=record, visitor=v2)
        await _add_client_tag_links(db_session, client, 2)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Client, client.id)
        by_entity = {n.entity: n for n in nodes}
        assert set(by_entity) == {"records", "visitors", "client_tags"}
        assert by_entity["records"].count == 1
        assert by_entity["visitors"].count == 2
        assert by_entity["client_tags"].count == 2

        visitors_node = by_entity["visitors"]
        # cascade_preview contains ONLY {"visits": N} — NO payments key.
        assert visitors_node.cascade_preview is not None
        assert set(visitors_node.cascade_preview.keys()) == {"visits"}
        assert visitors_node.cascade_preview["visits"] == 5

    async def test_no_visitors_no_cascade_preview(self, db_session) -> None:
        master = Master(first_name="c2", last_name="m", color="#666666",
                        position="мастер", specialty="живопись")
        service = Service(title="c2S", description="d", image_url="i", specialty="живопись",
                          min_age=6, duration=90, record_info="r")
        location = Location(name="c2L", capacity=50)
        client = Client(name="cc2", phone=f"+7999{_uuid.uuid4().hex[:8]}",
                        email=None, channel="telegram")
        db_session.add_all([master, service, location, client])
        await db_session.flush()
        await _add_activity(db_session, master=master, service=service, location=location)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Client, client.id)
        assert nodes == []


class TestCollectDependenciesRecord:
    async def test_counts_visits_payments_and_record_tags(self, db_session) -> None:
        """Record→visits(cascade user), payments(cascade user), record_tags(auto)."""
        master = Master(first_name="r1", last_name="m", color="#777777",
                        position="мастер", specialty="живопись")
        service = Service(title="rS", description="d", image_url="i", specialty="живопись",
                          min_age=6, duration=90, record_info="r")
        location = Location(name="rL", capacity=50)
        db_session.add_all([master, service, location])
        await db_session.flush()
        activity = await _add_activity(
            db_session, master=master, service=service, location=location,
        )
        record = Record(activity_id=activity.id, client_id=None,
                        status="pending", seats=0, anonym_visits=0)
        db_session.add(record)
        await db_session.flush()
        # 3 visits (anonymous — visitor_id=None), 2 payments, 2 record_tags.
        for _ in range(3):
            await _add_visit(db_session, record=record)
        for _ in range(2):
            await _add_payment(db_session, record)
        await _add_record_tag_links(db_session, record, 2)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Record, record.id)
        by_entity = {n.entity: n for n in nodes}
        assert set(by_entity) == {"visits", "payments", "record_tags"}
        assert by_entity["visits"].count == 3
        assert by_entity["payments"].count == 2
        assert by_entity["record_tags"].count == 2
        # No cascade_preview on any Record dep (nothing FK-references visits/payments).
        assert by_entity["visits"].cascade_preview is None
        assert by_entity["payments"].cascade_preview is None
        assert by_entity["record_tags"].cascade_preview is None

    async def test_zero_count_deps_are_skipped(self, db_session) -> None:
        """Record with visits but 0 payments + 0 record_tags → only visits in tree."""
        master = Master(first_name="r2", last_name="m", color="#888888",
                        position="мастер", specialty="живопись")
        service = Service(title="r2S", description="d", image_url="i", specialty="живопись",
                          min_age=6, duration=90, record_info="r")
        location = Location(name="r2L", capacity=50)
        db_session.add_all([master, service, location])
        await db_session.flush()
        activity = await _add_activity(
            db_session, master=master, service=service, location=location,
        )
        record = Record(activity_id=activity.id, client_id=None,
                        status="pending", seats=0, anonym_visits=0)
        db_session.add(record)
        await db_session.flush()
        await _add_visit(db_session, record=record)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Record, record.id)
        by_entity = {n.entity: n for n in nodes}
        assert "payments" not in by_entity
        assert "record_tags" not in by_entity
        assert by_entity["visits"].count == 1

    async def test_no_deps_returns_empty(self, db_session) -> None:
        """Bare record (no visits/payments/tags) → empty dependency tree."""
        master = Master(first_name="r3", last_name="m", color="#999999",
                        position="мастер", specialty="живопись")
        service = Service(title="r3S", description="d", image_url="i", specialty="живопись",
                          min_age=6, duration=90, record_info="r")
        location = Location(name="r3L", capacity=50)
        db_session.add_all([master, service, location])
        await db_session.flush()
        activity = await _add_activity(
            db_session, master=master, service=service, location=location,
        )
        record = Record(activity_id=activity.id, client_id=None,
                        status="pending", seats=0, anonym_visits=0)
        db_session.add(record)
        await db_session.commit()

        assert await collect_dependencies(db_session, Record, record.id) == []


# ─── 5. validate_resolutions (pure — construct nodes directly) ──────────────────


def _client_nodes() -> list[DependencyNode]:
    return [
        DependencyNode(entity="records", relation="Запись", count=5,
                       allowed_actions=["nullify"]),
        DependencyNode(entity="visitors", relation="Посетитель", count=2,
                       allowed_actions=["cascade"], cascade_preview={"visits": 5}),
        DependencyNode(entity="client_tags", relation="Тег", count=2,
                       allowed_actions=["cascade"]),
    ]


def _master_auto_nodes() -> list[DependencyNode]:
    return [
        DependencyNode(entity="users", relation="Пользователь", count=1,
                       allowed_actions=["cascade"]),
        DependencyNode(entity="master_tags", relation="Тег", count=2,
                       allowed_actions=["cascade"]),
    ]


def _master_blocked_nodes() -> list[DependencyNode]:
    return [
        DependencyNode(entity="activities", relation="Активность", count=3,
                       allowed_actions=[]),
        DependencyNode(entity="users", relation="Пользователь", count=1,
                       allowed_actions=["cascade"]),
    ]


def _record_nodes() -> list[DependencyNode]:
    return [
        DependencyNode(entity="visits", relation="Посещение", count=3,
                       allowed_actions=["cascade"]),
        DependencyNode(entity="payments", relation="Платёж", count=2,
                       allowed_actions=["cascade"]),
        DependencyNode(entity="record_tags", relation="Тег", count=2,
                       allowed_actions=["cascade"]),
    ]


class TestValidateResolutions:
    def test_missing_non_auto_dep_returns_error(self) -> None:
        # body provides records:nullify but misses visitors (non-auto) → error.
        errors = validate_resolutions(Client, _client_nodes(),
                                       {"records": "nullify"})
        assert len(errors) == 1
        assert errors[0].relation == "Посетитель"

    def test_wrong_action_for_non_auto_dep_returns_error(self) -> None:
        # records only allows nullify; sending cascade → error.
        errors = validate_resolutions(Client, _client_nodes(),
                                       {"records": "cascade", "visitors": "cascade"})
        assert len(errors) == 1
        assert errors[0].relation == "Запись"

    def test_correct_resolutions_returns_no_errors(self) -> None:
        errors = validate_resolutions(Client, _client_nodes(),
                                       {"records": "nullify", "visitors": "cascade"})
        assert errors == []

    def test_auto_dep_ignored_even_when_sent_with_wrong_action(self) -> None:
        # Master → users/master_tags are auto: user sending wrong action is IGNORED.
        errors = validate_resolutions(Master, _master_auto_nodes(),
                                       {"users": "cascade", "master_tags": "nullify"})
        assert errors == []

    def test_auto_dep_ignored_when_body_empty(self) -> None:
        errors = validate_resolutions(Master, _master_auto_nodes(), {})
        assert errors == []

    def test_blocked_dep_invalid_regardless_of_body(self) -> None:
        # activities is blocked; even an empty body → error (blocked → 422 always).
        errors = validate_resolutions(Master, _master_blocked_nodes(), {})
        assert len(errors) == 1
        assert errors[0].relation == "Активность"

    def test_blocked_dep_still_invalid_when_body_attempts_action(self) -> None:
        # Sending a (wrong) action for a blocked dep does not satisfy it — stays invalid.
        errors = validate_resolutions(Master, _master_blocked_nodes(),
                                       {"activities": "cascade"})
        assert len(errors) == 1
        assert errors[0].relation == "Активность"

    def test_blocked_dep_does_not_mask_other_dep_errors(self) -> None:
        # Mixed: activities (block) + users (auto); body empty → only the block error.
        errors = validate_resolutions(Master, _master_blocked_nodes(), {})
        assert len(errors) == 1
        assert all(e.relation == "Активность" for e in errors)

    # ── Record cases (GH #139 — Addendum 13) ──────────────────────────────

    def test_record_missing_non_auto_dep_returns_error(self) -> None:
        # body provides visits:cascade but misses payments (non-auto) → error.
        errors = validate_resolutions(Record, _record_nodes(),
                                       {"visits": "cascade"})
        assert len(errors) == 1
        assert errors[0].relation == "Платёж"

    def test_record_wrong_action_returns_error(self) -> None:
        # visits only allows cascade; sending nullify → error.
        errors = validate_resolutions(Record, _record_nodes(),
                                       {"visits": "nullify", "payments": "cascade"})
        assert len(errors) == 1
        assert errors[0].relation == "Посещение"

    def test_record_correct_resolutions_returns_no_errors(self) -> None:
        errors = validate_resolutions(Record, _record_nodes(),
                                       {"visits": "cascade", "payments": "cascade"})
        assert errors == []

    def test_record_auto_dep_ignored_even_when_sent_with_wrong_action(self) -> None:
        # record_tags is auto: user sending wrong action is IGNORED.
        errors = validate_resolutions(Record, _record_nodes(),
                                       {"visits": "cascade", "payments": "cascade",
                                        "record_tags": "nullify"})
        assert errors == []

    def test_record_auto_dep_ignored_when_body_empty_for_auto_only(self) -> None:
        # If ONLY auto deps present (record_tags, no visits/payments) → no error.
        auto_only_nodes = [DependencyNode(
            entity="record_tags", relation="Тег", count=2,
            allowed_actions=["cascade"],
        )]
        errors = validate_resolutions(Record, auto_only_nodes, {})
        assert errors == []
