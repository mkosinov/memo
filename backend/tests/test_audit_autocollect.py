"""GH #344 Task 3 — repository auto-collection of raw audit records (spec §4.2, §4.6).

``BaseRepository.create/update/patch/delete/reorder`` stage RAW
``{entity, action, entity_id, before, after}`` records into the audit
accumulator opened by ``@transactional``:

* target-entity rule — a row is staged only when the mutated table's
  canonical #239 entity matches the accumulator's target (the service
  entity the wrapper resolved); cascade children never match;
* seniority — an explicit ``mark_audit`` for the same row displaces the
  auto-collected one (both orders), so one operation never yields two
  rows for the same row;
* no-op — an update/patch that changes no field stages nothing; a
  reorder that preserves the order stages nothing;
* reorder — ONE row per operation (§4.6): no entity_id, label «N
  объектов», no snapshot.

Staging-level classes open the accumulator manually (no decorator
machinery); the end-to-end class drives real decorated services with a
staged actor and asserts committed ``audit_logs`` rows.
"""

import json

import pytest
from sqlalchemy import text

from src.events import audit
from src.models.location import Location
from src.models.tag import Tag
from src.repositories.generic import get_base_repository
from src.schemas.record import RecordCreate, VisitItem
from src.schemas.tag import TagCreate, TagPatch
from src.services.decorators import transactional
from src.services.location import get_location_service
from src.services.tag import get_tag_service
from src.usecases.records import create_record

pytestmark = pytest.mark.integration


# ─── Helpers ──────────────────────────────────────────────────────────────────


@pytest.fixture
def audit_rows():
    """Factory: read all audit_logs rows (fresh sync connection per call)."""
    from tests.conftest import query_db

    def read() -> list[dict]:
        return query_db(
            "SELECT user_id, user_role, action, entity, entity_id, "
            "entity_label, changes FROM audit_logs ORDER BY rowid"
        )

    return read


@pytest.fixture
def real_user():
    """A real users row (FK target for audit_logs.user_id)."""
    from tests.conftest import insert_user

    return insert_user("+79990009998", "x", role="admin")


@pytest.fixture
def actor(real_user):
    """Open the actor contextvar around a test."""
    token = audit.set_actor(user_id=real_user["id"], role="admin")
    yield real_user
    audit.reset_actor(token)


def _insert_tag(tag_id: str, title: str) -> None:
    """Seed a tag row directly (no repository call → no auto-collection)."""
    from tests.conftest import query_db

    query_db(
        f"INSERT INTO tags (id, title, created_at, updated_at) "
        f"VALUES ('{tag_id}', '{title}', datetime('now'), datetime('now'))"
    )


def _insert_location(loc_id: str, title: str, sort_order: int) -> None:
    """Seed a location row directly (no repository call)."""
    from tests.conftest import query_db

    query_db(
        f"INSERT INTO locations (id, title, capacity, sort_order, is_active, "
        f"created_at, updated_at) VALUES ('{loc_id}', '{title}', 20, "
        f"{sort_order}, 1, datetime('now'), datetime('now'))"
    )


# ─── Staging: one representative per mutation method (spec §4.2) ─────────────


class TestStagingPerMethod:
    async def test_create_stages_raw_record(self, db_session) -> None:
        token = audit.open_audit("tags")
        try:
            instance = await get_base_repository().create(
                db_session, TagCreate(title="Журнал"), Tag
            )
            rows = audit.pending_rows()
            assert rows is not None and len(rows) == 1
            row = rows[0]
            assert (row["action"], row["entity"], row["entity_id"]) == (
                "create", "tags", instance.id,
            )
            assert row["changes"] == {"title": [None, "Журнал"]}
            assert row["entity_label"] == "Журнал"
            # Observable insert shape (not the internal auto marker):
            # the drawn row is exactly the journal columns the wrapper
            # inserts — no internal keys leak into it.
            assert audit.draw_rows() == [{
                "user_id": None,
                "user_role": None,
                "action": "create",
                "entity": "tags",
                "entity_id": instance.id,
                "entity_label": "Журнал",
                "changes": {"title": [None, "Журнал"]},
            }]
        finally:
            audit.reset_audit(token)

    async def test_update_stages_field_diff(self, db_session) -> None:
        _insert_tag("tag-u1", "Старое")
        token = audit.open_audit("tags")
        try:
            await get_base_repository().update(
                db_session, Tag, "tag-u1", TagCreate(title="Новое")
            )
            rows = audit.pending_rows()
            assert rows is not None and len(rows) == 1
            row = rows[0]
            assert (row["action"], row["entity"], row["entity_id"]) == (
                "update", "tags", "tag-u1",
            )
            assert row["changes"] == {"title": ["Старое", "Новое"]}
        finally:
            audit.reset_audit(token)

    async def test_patch_diff_covers_only_changed_fields(
        self, db_session
    ) -> None:
        _insert_location("loc-p1", "Студия", 0)
        token = audit.open_audit("locations")
        try:
            await get_base_repository().patch(
                db_session, Location, "loc-p1", {"capacity": 30, "sort_order": 0}
            )
            rows = audit.pending_rows()
            assert rows is not None and len(rows) == 1
            assert rows[0]["changes"] == {"capacity": [20, 30]}
        finally:
            audit.reset_audit(token)

    async def test_patch_no_change_stages_nothing(self, db_session) -> None:
        _insert_tag("tag-n1", "То же")
        token = audit.open_audit("tags")
        try:
            await get_base_repository().patch(
                db_session, Tag, "tag-n1", {"title": "То же"}
            )
            assert audit.pending_rows() == []
        finally:
            audit.reset_audit(token)

    async def test_delete_stages_before_snapshot(self, db_session) -> None:
        _insert_tag("tag-d1", "Удаляемое")
        token = audit.open_audit("tags")
        try:
            deleted = await get_base_repository().delete(
                db_session, Tag, "tag-d1"
            )
            assert deleted is True
            rows = audit.pending_rows()
            assert rows is not None and len(rows) == 1
            row = rows[0]
            assert (row["action"], row["entity"], row["entity_id"]) == (
                "delete", "tags", "tag-d1",
            )
            assert row["changes"] == {"title": ["Удаляемое", None]}
            assert row["entity_label"] == "Удаляемое"
        finally:
            audit.reset_audit(token)

    async def test_reorder_stages_one_row_without_id(self, db_session) -> None:
        _insert_location("loc-r1", "А", 0)
        _insert_location("loc-r2", "Б", 1)
        token = audit.open_audit("locations")
        try:
            updated = await get_base_repository().reorder(
                db_session, Location, ["loc-r2", "loc-r1"]
            )
            assert [u.id for u in updated] == ["loc-r2", "loc-r1"]
            rows = audit.pending_rows()
            assert rows is not None and len(rows) == 1
            row = rows[0]
            assert (row["action"], row["entity"], row["entity_id"]) == (
                "reorder", "locations", None,
            )
            assert row["entity_label"] == "2 объектов"
            assert row["changes"] is None
        finally:
            audit.reset_audit(token)

    async def test_reorder_same_order_stages_nothing(self, db_session) -> None:
        _insert_location("loc-s1", "А", 0)
        _insert_location("loc-s2", "Б", 1)
        token = audit.open_audit("locations")
        try:
            await get_base_repository().reorder(
                db_session, Location, ["loc-s1", "loc-s2"]
            )
            assert audit.pending_rows() == []
        finally:
            audit.reset_audit(token)


# ─── Deferral: no snapshot work outside an open accumulator ───────────────────


class TestSnapshotDeferral:
    """create/delete build their snapshot ONLY when an accumulator is open.

    The snapshot build pays the lazy entities import + ``MODEL_ENTITY``
    lookup + getattr walk; mutations outside ``@transactional`` (reads,
    seeds, CLI) must never pay it.
    """

    async def test_create_without_accumulator_builds_no_snapshot(
        self, db_session, monkeypatch
    ) -> None:
        import src.repositories.generic as generic_mod

        def _boom(instance: object, table: object) -> dict:
            raise AssertionError("snapshot built with no accumulator open")

        monkeypatch.setattr(generic_mod, "_raw_snapshot", _boom)
        await get_base_repository().create(
            db_session, TagCreate(title="Без журнала"), Tag
        )

    async def test_delete_without_accumulator_builds_no_snapshot(
        self, db_session, monkeypatch
    ) -> None:
        import src.repositories.generic as generic_mod

        def _boom(instance: object, table: object) -> dict:
            raise AssertionError("snapshot built with no accumulator open")

        monkeypatch.setattr(generic_mod, "_raw_snapshot", _boom)
        _insert_tag("tag-lazy", "Ленивый")
        deleted = await get_base_repository().delete(db_session, Tag, "tag-lazy")
        assert deleted is True


# ─── Target-entity rule (spec §4.2/§4.6) ─────────────────────────────────────


class TestTargetEntityRule:
    async def test_target_mismatch_stages_nothing(self, db_session) -> None:
        """A write to a NON-target entity (cascade child) is not journaled."""
        _insert_tag("tag-m1", "Цель другая")
        token = audit.open_audit("locations")
        try:
            await get_base_repository().patch(
                db_session, Tag, "tag-m1", {"title": "Изменено"}
            )
            assert audit.pending_rows() == []
        finally:
            audit.reset_audit(token)

    async def test_no_accumulator_stages_nothing(self, db_session) -> None:
        """Outside @transactional there is no accumulator — silent no-op."""
        _insert_tag("tag-x1", "Без транзакции")
        await get_base_repository().patch(
            db_session, Tag, "tag-x1", {"title": "Изменено"}
        )
        assert audit.pending_rows() is None


# ─── Seniority: explicit mark beats auto-collection (spec §4.2) ──────────────


class TestSeniority:
    async def test_explicit_mark_displaces_auto_row(self, db_session) -> None:
        _insert_tag("tag-s1", "Старое")
        token = audit.open_audit("tags")
        try:
            await get_base_repository().patch(
                db_session, Tag, "tag-s1", {"title": "Новое"}
            )
            assert len(audit.pending_rows() or []) == 1  # the auto row
            audit.mark_audit(
                entity="tags",
                action="archive",
                entity_id="tag-s1",
                entity_label="Тег (архив)",
                changes=None,
            )
            rows = audit.pending_rows()
            assert rows is not None and len(rows) == 1
            assert rows[0]["action"] == "archive"
            # The surviving row IS the explicit mark (label + empty
            # changes), observable without any internal marker key.
            assert rows[0]["entity_label"] == "Тег (архив)"
            assert rows[0]["changes"] is None
        finally:
            audit.reset_audit(token)

    async def test_auto_row_skipped_when_explicit_mark_came_first(
        self, db_session
    ) -> None:
        _insert_tag("tag-s2", "Старое")
        token = audit.open_audit("tags")
        try:
            audit.mark_audit(
                entity="tags",
                action="archive",
                entity_id="tag-s2",
                entity_label="Тег (архив)",
                changes=None,
            )
            await get_base_repository().patch(
                db_session, Tag, "tag-s2", {"title": "Новое"}
            )
            rows = audit.pending_rows()
            assert rows is not None and len(rows) == 1
            assert rows[0]["action"] == "archive"
            assert rows[0]["entity_label"] == "Тег (архив)"
        finally:
            audit.reset_audit(token)


# ─── End-to-end: decorated services + actor + committed audit_logs ───────────


class _ArchiveishService:
    """Corridor-1 stand-in: repository patch + explicit mark in ONE method."""

    entity_name = "tags"

    @transactional
    async def patch_and_mark(self, db_session, tag_id: str, title: str) -> None:
        await get_base_repository().patch(db_session, Tag, tag_id, {"title": title})
        audit.mark_audit(
            entity="tags",
            action="archive",
            entity_id=tag_id,
            entity_label="Тег (архив)",
            changes=None,
        )


class TestAutoCollectEndToEnd:
    async def test_service_create_inserts_journal_row(
        self, db_session, actor, audit_rows
    ) -> None:
        tag = await get_tag_service().create(db_session, TagCreate(title="Журнал"))
        rows = audit_rows()
        assert len(rows) == 1
        row = rows[0]
        assert (row["action"], row["entity"], row["entity_id"]) == (
            "create", "tags", tag.id,
        )
        assert row["entity_label"] == "Журнал"
        assert json.loads(row["changes"]) == {"title": [None, "Журнал"]}
        assert row["user_id"] == actor["id"]
        assert row["user_role"] == "admin"

    async def test_service_update_inserts_field_diff_row(
        self, db_session, actor, audit_rows
    ) -> None:
        _insert_tag("tag-e1", "Старое")
        await get_tag_service().update(db_session, "tag-e1", TagCreate(title="Новое"))
        rows = audit_rows()
        assert len(rows) == 1
        row = rows[0]
        assert (row["action"], row["entity"], row["entity_id"]) == (
            "update", "tags", "tag-e1",
        )
        assert json.loads(row["changes"]) == {"title": ["Старое", "Новое"]}

    async def test_service_patch_noop_inserts_nothing(
        self, db_session, actor, audit_rows
    ) -> None:
        _insert_tag("tag-e2", "Без изменений")
        await get_tag_service().patch(
            db_session, "tag-e2", TagPatch(title="Без изменений")
        )
        assert audit_rows() == []

    async def test_service_delete_inserts_snapshot_row(
        self, db_session, actor, audit_rows
    ) -> None:
        _insert_tag("tag-e3", "Снимок удаления")
        deleted = await get_tag_service().delete(db_session, "tag-e3")
        assert deleted is True
        rows = audit_rows()
        assert len(rows) == 1
        row = rows[0]
        assert (row["action"], row["entity"], row["entity_id"]) == (
            "delete", "tags", "tag-e3",
        )
        assert json.loads(row["changes"]) == {"title": ["Снимок удаления", None]}

    async def test_service_reorder_inserts_single_row(
        self, db_session, actor, audit_rows
    ) -> None:
        _insert_location("loc-e1", "А", 0)
        _insert_location("loc-e2", "Б", 1)
        await get_location_service().reorder(db_session, ["loc-e2", "loc-e1"])
        rows = audit_rows()
        assert len(rows) == 1
        row = rows[0]
        assert (row["action"], row["entity"], row["entity_id"]) == (
            "reorder", "locations", None,
        )
        assert row["entity_label"] == "2 объектов"
        assert json.loads(row["changes"]) is None  # JSON column stores 'null'
        orders = await db_session.execute(
            text("SELECT id, sort_order FROM locations ORDER BY sort_order")
        )
        assert orders.all() == [("loc-e2", 0), ("loc-e1", 1)]

    async def test_explicit_plus_auto_yields_single_row(
        self, db_session, actor, audit_rows
    ) -> None:
        _insert_tag("tag-e4", "Старое")
        await _ArchiveishService().patch_and_mark(db_session, "tag-e4", "Новое")
        rows = audit_rows()
        assert len(rows) == 1
        assert rows[0]["action"] == "archive"
        kept = await db_session.execute(
            text("SELECT title FROM tags WHERE id = 'tag-e4'")
        )
        assert kept.scalar_one() == "Новое"

    async def test_record_scenario_cascade_journals_no_child_rows(
        self, db_session, actor, audit_rows
    ) -> None:
        from tests.conftest import query_db

        # Seed the FK chain directly (no API factories: their own
        # transactions would legitimately journal their own entities and
        # pollute the assertion below).
        master = "m-scen"
        service = "svc-scen"
        location = "loc-scen"
        client = "cl-scen"
        for sql in (
            f"INSERT INTO staff (id, first_name, last_name, sort_order, is_active, "
            f"created_at, updated_at) VALUES ('{master}', 'А', 'Б', 0, 1, "
            f"datetime('now'), datetime('now'))",
            f"INSERT INTO masters (staff_id, specialty, color, is_active, "
            f"created_at, updated_at) VALUES ('{master}', 'живопись', "
            f"'#5B8C7A', 1, datetime('now'), datetime('now'))",
            f"INSERT INTO services (id, title, description, image_url, specialty, "
            f"min_age, duration, record_info, is_active, created_at, updated_at) "
            f"VALUES ('{service}', 'Сценарная услуга', 'описание', "
            f"'https://example.com/x.jpg', 'живопись', 6, 90, 'инфо', 1, "
            f"datetime('now'), datetime('now'))",
            f"INSERT INTO locations (id, title, capacity, sort_order, is_active, "
            f"created_at, updated_at) VALUES ('{location}', 'Сценарная студия', "
            f"20, 0, 1, datetime('now'), datetime('now'))",
            f"INSERT INTO activities (id, master_id, service_id, location_id, "
            f"start, duration, capacity, is_private, created_at, updated_at) "
            f"VALUES ('act-scen', '{master}', '{service}', '{location}', "
            f"datetime('now', '+1 day'), 90, 10, 0, datetime('now'), "
            f"datetime('now'))",
            f"INSERT INTO clients (id, name, phone, channel, is_active, "
            f"created_at, updated_at) VALUES ('{client}', 'Гость Хост', "
            f"'+79990001234', 'telegram', 1, datetime('now'), datetime('now'))",
        ):
            query_db(sql)

        record = await create_record(
            None,
            db_session=db_session,
            data=RecordCreate(
                activity_id="act-scen",
                client_id=client,
                visits=[VisitItem(name="Гость", price=3500)],
            ),
        )
        # The cascade really happened: the visit row exists...
        assert query_db(f"SELECT id FROM visits WHERE record_id = '{record.id}'")
        # ...but the journal carries no record/visit/visitor/payment rows.
        entities = {r["entity"] for r in audit_rows()}
        assert not entities & {"records", "visits", "visitors", "payments"}
