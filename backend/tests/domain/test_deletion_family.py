"""GH #324 Task 1 — the six delete-family subjects (matrix + registries).

Covers the new entries of ``src/domain/deletion.py`` for Visit, Payment,
UserSettings (leaves) and Photo, Visitor, Position (dependents):

* ``FK_MATRIX`` — three leaf keys + the owner-side deps (spec §3).
* ``_COUNTERS`` / ``_ITEM_COLLECTORS`` — 409 tree nodes via
  ``collect_dependencies`` (busy AND clean row per subject).
* ``_ID_COLLECTORS`` — the ``expected`` input via ``collect_dependency_ids``
  (visit ids by ``visitor_id``; join-row id-strings by owner column).
* ``CASCADE_HANDLERS`` — the three owner-side join-delete handlers
  (Core bulk, join rows → subject, deterministic under any PRAGMA).
* ``stale_expected_entities`` — subset verification on the new deps.

Perspective rule (spec §3): the same join table legitimately appears in
several matrices with different auto-ness — ``(Photo, "photo_tags")`` is
the OTHER side of ``(Tag, "photo_tags")`` (keys include the model), NOT a
duplicate; merging the two keys is forbidden.
"""

from __future__ import annotations

import uuid as _uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import insert, select

from src.domain.deletion import (
    CASCADE_HANDLERS,
    FK_MATRIX,
    FKDependency,
    collect_dependencies,
    collect_dependency_ids,
    stale_expected_entities,
)
from src.models.activity import Activity
from src.models.client import Client
from src.models.location import Location
from src.models.master import Master
from src.models.material import Material
from src.models.payment import Payment
from src.models.photo import Photo, photo_tags
from src.models.position import Position, staff_positions
from src.models.record import Record
from src.models.service import Service
from src.models.staff import Staff
from src.models.tag import Tag, visitor_tags
from src.models.tariff import Tariff
from src.models.user import User
from src.models.user_settings import UserSettings
from src.models.visit import Visit
from src.models.visitor import Visitor
from src.services.photo import get_photo_service
from src.services.position import get_position_service
from src.services.visitor import get_visitor_service

# ─── Helpers ────────────────────────────────────────────────────────────────────


def _deps_map(model: type) -> dict[str, FKDependency]:
    return {dep.entity: dep for dep in FK_MATRIX.get(model, [])}


async def _add_staff(
    db_session,
    first: str = "Иван",
    last: str = "Петров",
) -> Staff:
    staff = Staff(first_name=first, last_name=last)
    db_session.add(staff)
    await db_session.flush()
    return staff


async def _add_service(db_session, title: str = "Гончарное дело") -> Service:
    service = Service(
        title=title,
        description="d",
        image_url="i",
        specialty="живопись",
        min_age=6,
        duration=90,
        record_info="r",
    )
    db_session.add(service)
    await db_session.flush()
    return service


async def _add_location(db_session, title: str = "Студия Лофт") -> Location:
    location = Location(title=title, capacity=10)
    db_session.add(location)
    await db_session.flush()
    return location


async def _add_client(db_session, name: str | None = "Мария Смирнова") -> Client:
    client = Client(name=name, phone=f"+7999{_uuid.uuid4().hex[:7]}")
    db_session.add(client)
    await db_session.flush()
    return client


async def _add_visitor(db_session, client: Client, name: str = "Петя") -> Visitor:
    visitor = Visitor(client_id=client.id, name=name)
    db_session.add(visitor)
    await db_session.flush()
    return visitor


async def _add_activity(db_session, *, service: Service) -> Activity:
    staff = await _add_staff(db_session)
    db_session.add(Master(staff_id=staff.id, specialty="живопись", color="#000000"))
    location = await _add_location(db_session)
    await db_session.flush()
    activity = Activity(
        master_id=staff.id,
        service_id=service.id,
        location_id=location.id,
        start=datetime(2026, 3, 15, 10, 0, tzinfo=UTC) + timedelta(hours=1),
        duration=90,
        capacity=10,
        is_private=False,
    )
    db_session.add(activity)
    await db_session.flush()
    return activity


async def _add_record(
    db_session,
    activity: Activity,
    client: Client | None = None,
) -> Record:
    record = Record(
        activity_id=activity.id,
        client_id=client.id if client else None,
        status="confirmed",
        seats=1,
    )
    db_session.add(record)
    await db_session.flush()
    return record


async def _add_tariff(
    db_session,
    service: Service,
    title: str = "Взрослый",
    price: int = 3000,
) -> Tariff:
    tariff = Tariff(service_id=service.id, title=title, price=price)
    db_session.add(tariff)
    await db_session.flush()
    return tariff


async def _add_visit(
    db_session,
    record: Record,
    visitor: Visitor | None = None,
    tariff: Tariff | None = None,
    price: int = 3000,
) -> Visit:
    visit = Visit(
        record_id=record.id,
        visitor_id=visitor.id if visitor else None,
        tariff_id=tariff.id if tariff else None,
        price=price,
        status="waiting",
    )
    db_session.add(visit)
    await db_session.flush()
    return visit


async def _add_payment(
    db_session,
    record: Record,
    amount: int = 1000,
) -> Payment:
    payment = Payment(record_id=record.id, amount=amount, method="cash")
    db_session.add(payment)
    await db_session.flush()
    return payment


async def _add_position(db_session, title: str = "Администратор") -> Position:
    position = Position(title=title, is_system=False)
    db_session.add(position)
    await db_session.flush()
    return position


async def _add_user(db_session) -> User:
    user = User(
        phone=f"+7998{_uuid.uuid4().hex[:7]}",
        password_hash="x",
        role="admin",
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _add_user_settings(db_session) -> UserSettings:
    user = await _add_user(db_session)
    settings = UserSettings(user_id=user.id)
    db_session.add(settings)
    await db_session.flush()
    return settings


async def _add_photo(db_session, filename: str) -> Photo:
    photo = Photo(filename=filename, is_public=False)
    db_session.add(photo)
    await db_session.flush()
    return photo


async def _add_tag(db_session, title: str) -> Tag:
    tag = Tag(title=title)
    db_session.add(tag)
    await db_session.flush()
    return tag


async def _link(db_session, table, owner_col: str, owner_id: str, tag_id: str) -> None:
    await db_session.execute(insert(table).values(**{owner_col: owner_id, "tag_id": tag_id}))
    await db_session.flush()


async def _link_position(db_session, staff_id: str, position_id: str) -> None:
    await db_session.execute(
        insert(staff_positions).values(
            staff_id=staff_id,
            position_id=position_id,
        )
    )
    await db_session.flush()


# ─── 1. FK_MATRIX structure (pure, no DB) — spec §3 ────────────────────────────


class TestFKMatrixFamily:
    def test_matrix_has_exactly_fourteen_keys(self) -> None:
        """8 pre-existing subjects + the 6 new ones (Visit, Payment, Photo,
        UserSettings, Visitor, Position) — leaves carry the empty list."""
        assert set(FK_MATRIX) == {
            Staff,
            Location,
            Service,
            Client,
            Record,
            Activity,
            Material,
            Tag,
            Visit,
            Payment,
            Photo,
            UserSettings,
            Visitor,
            Position,
        }

    @pytest.mark.parametrize("model", [Visit, Payment, UserSettings])
    def test_leaves_have_no_deps(self, model: type) -> None:
        """Leaf subjects: no incoming FK edges — the dialog preview is
        structurally empty; the key exists so the routes↔matrix guard
        (spec §7) maps their DELETE routes."""
        assert FK_MATRIX[model] == []

    def test_existing_subjects_unchanged(self) -> None:
        """The 8 pre-existing matrix rows keep their exact dep sets — the
        #324 additions are purely additive (existing routes untouched)."""
        assert {d.entity for d in FK_MATRIX[Staff]} == {
            "activities",
            "users",
            "masters",
            "master_tags",
            "staff_positions",
        }
        assert {d.entity for d in FK_MATRIX[Location]} == {
            "activities",
            "location_tags",
            "photos",
        }
        assert {d.entity for d in FK_MATRIX[Service]} == {
            "activities",
            "tariffs",
            "photos",
            "service_tags",
            "service_materials",
        }
        assert {d.entity for d in FK_MATRIX[Client]} == {
            "records",
            "visitors",
            "client_tags",
            "photos",
        }
        assert {d.entity for d in FK_MATRIX[Record]} == {
            "visits",
            "payments",
            "record_tags",
        }
        assert {d.entity for d in FK_MATRIX[Activity]} == {
            "records",
            "photos",
            "activity_tags",
        }
        assert {d.entity for d in FK_MATRIX[Material]} == {"service_materials"}
        assert {d.entity for d in FK_MATRIX[Tag]} == {
            "service_tags",
            "activity_tags",
            "master_tags",
            "location_tags",
            "client_tags",
            "visitor_tags",
            "record_tags",
            "photo_tags",
        }

    def test_photo_has_exactly_one_dep(self) -> None:
        assert [d.entity for d in FK_MATRIX[Photo]] == ["photo_tags"]

    def test_photo_photo_tags_cascade_non_auto(self) -> None:
        """At the photo the tag-unlink IS the visible main effect (non-auto,
        user choice); the tags themselves always survive."""
        dep = _deps_map(Photo)["photo_tags"]
        assert dep.action == "cascade"
        assert dep.auto is False
        assert dep.allowed_actions == ["cascade"]
        assert dep.nullable is False
        assert dep.relation == "Тег"
        assert dep.message is None

    def test_visitor_has_exactly_two_deps_in_order(self) -> None:
        assert [d.entity for d in FK_MATRIX[Visitor]] == ["visits", "visitor_tags"]

    def test_visitor_visits_cascade_non_auto_nullable(self) -> None:
        """``visit.visitor_id`` is nullable (anonymous visits) — the matrix
        mirrors the column (nullable=True), but the action is pinned
        explicitly: allowed_actions=["cascade"], the single action (the
        «nullable ⇒ nullify viable» heuristic is overridden — user
        decision 21.09: visits die with the visitor)."""
        dep = _deps_map(Visitor)["visits"]
        assert dep.action == "cascade"
        assert dep.auto is False
        assert dep.allowed_actions == ["cascade"]
        assert dep.nullable is True
        assert dep.relation == "Посещение"
        assert dep.message is None

    def test_visitor_visitor_tags_cascade_auto(self) -> None:
        """The visitor's OWN tags die with him (auto — no user choice);
        the same join table is NON-auto in FK_MATRIX[Tag] (perspective)."""
        dep = _deps_map(Visitor)["visitor_tags"]
        assert dep.action == "cascade"
        assert dep.auto is True
        assert dep.allowed_actions == ["cascade"]
        assert dep.nullable is False
        assert dep.relation == "Тег"

    def test_position_has_exactly_one_dep(self) -> None:
        assert [d.entity for d in FK_MATRIX[Position]] == ["staff_positions"]

    def test_position_staff_positions_cascade_non_auto(self) -> None:
        """From the position's side stripping it from staff IS the main
        effect (non-auto, single action); the same join is AUTO in
        FK_MATRIX[Staff] (perspective rule)."""
        dep = _deps_map(Position)["staff_positions"]
        assert dep.action == "cascade"
        assert dep.auto is False
        assert dep.allowed_actions == ["cascade"]
        assert dep.nullable is False
        assert dep.relation == "Сотрудник"
        assert dep.message is None

    def test_both_sides_of_photo_tags_edge_coexist(self) -> None:
        """Precedent guard: ``(Tag, "photo_tags")`` and ``(Photo,
        "photo_tags")`` are the two sides of ONE edge — distinct registry
        keys (the key includes the model); both handlers must exist
        simultaneously and NEVER be merged into one."""
        assert (Tag, "photo_tags") in CASCADE_HANDLERS
        assert (Photo, "photo_tags") in CASCADE_HANDLERS
        assert CASCADE_HANDLERS[(Tag, "photo_tags")] is not CASCADE_HANDLERS[(Photo, "photo_tags")]

    def test_both_sides_of_staff_positions_edge_coexist(self) -> None:
        """Same guard for the staff_positions edge: Staff side (by
        staff_id) + the new Position side (by position_id)."""
        assert (Staff, "staff_positions") in CASCADE_HANDLERS
        assert (Position, "staff_positions") in CASCADE_HANDLERS
        assert (
            CASCADE_HANDLERS[(Staff, "staff_positions")]
            is not CASCADE_HANDLERS[(Position, "staff_positions")]
        )


# ─── 2. Tree building: busy AND clean row per subject (DB) ─────────────────────


class TestCollectDependenciesFamily:
    async def test_busy_photo_full_tree(self, db_session) -> None:
        """Photo with 2 tags → one node «Тег», count=2, non-auto,
        items carry the tag ids."""
        photo = await _add_photo(db_session, "hall.jpg")
        tag1 = await _add_tag(db_session, "зал")
        tag2 = await _add_tag(db_session, "реконструкция")
        await _link(db_session, photo_tags, "photo_id", photo.id, tag1.id)
        await _link(db_session, photo_tags, "photo_id", photo.id, tag2.id)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Photo, photo.id)
        assert len(nodes) == 1
        node = nodes[0]
        assert node.entity == "photo_tags"
        assert node.relation == "Тег"
        assert node.count == 2
        assert node.auto is False
        assert node.allowed_actions == ["cascade"]
        assert node.cascade_preview is None
        assert node.items is not None
        assert {i.id for i in node.items} == {tag1.id, tag2.id}

    async def test_clean_photo_returns_empty(self, db_session) -> None:
        photo = await _add_photo(db_session, "clean.jpg")
        await db_session.commit()
        assert await collect_dependencies(db_session, Photo, photo.id) == []

    async def test_busy_visitor_two_nodes(self, db_session) -> None:
        """Visitor with 2 visits + 1 tag → nodes [visits (non-auto),
        visitor_tags (auto)] — both with items; visit items carry
        visit.id."""
        service = await _add_service(db_session)
        activity = await _add_activity(db_session, service=service)
        client = await _add_client(db_session)
        visitor = await _add_visitor(db_session, client)
        record = await _add_record(db_session, activity, client)
        tariff = await _add_tariff(db_session, service)
        visit1 = await _add_visit(db_session, record, visitor, tariff)
        visit2 = await _add_visit(db_session, record, visitor, None, price=1500)
        tag = await _add_tag(db_session, "постоянный")
        await _link(db_session, visitor_tags, "visitor_id", visitor.id, tag.id)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Visitor, visitor.id)
        by_entity = {n.entity: n for n in nodes}
        assert set(by_entity) == {"visits", "visitor_tags"}

        visits_node = by_entity["visits"]
        assert visits_node.count == 2
        assert visits_node.auto is False
        assert visits_node.allowed_actions == ["cascade"]
        assert visits_node.relation == "Посещение"
        assert {i.id for i in (visits_node.items or [])} == {visit1.id, visit2.id}

        tags_node = by_entity["visitor_tags"]
        assert tags_node.count == 1
        assert tags_node.auto is True
        assert tags_node.allowed_actions == ["cascade"]
        assert tags_node.items is not None
        assert tags_node.items[0].id == tag.id

    async def test_visitor_visits_only_single_node(self, db_session) -> None:
        """Visitor with visits but no tags → only the visits node."""
        service = await _add_service(db_session)
        activity = await _add_activity(db_session, service=service)
        client = await _add_client(db_session)
        visitor = await _add_visitor(db_session, client)
        record = await _add_record(db_session, activity, client)
        await _add_visit(db_session, record, visitor)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Visitor, visitor.id)
        assert [n.entity for n in nodes] == ["visits"]

    async def test_clean_visitor_returns_empty(self, db_session) -> None:
        client = await _add_client(db_session)
        visitor = await _add_visitor(db_session, client)
        await db_session.commit()
        assert await collect_dependencies(db_session, Visitor, visitor.id) == []

    async def test_busy_position_full_tree(self, db_session) -> None:
        """Position held by 2 staff → node «Сотрудник», count=2, items
        carry the staff ids."""
        position = await _add_position(db_session)
        staff1 = await _add_staff(db_session, "Анна", "Иванова")
        staff2 = await _add_staff(db_session, "Пётр", "Смирнов")
        await _link_position(db_session, staff1.id, position.id)
        await _link_position(db_session, staff2.id, position.id)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Position, position.id)
        assert len(nodes) == 1
        node = nodes[0]
        assert node.entity == "staff_positions"
        assert node.relation == "Сотрудник"
        assert node.count == 2
        assert node.auto is False
        assert node.allowed_actions == ["cascade"]
        assert {i.id for i in (node.items or [])} == {staff1.id, staff2.id}

    async def test_clean_position_returns_empty(self, db_session) -> None:
        position = await _add_position(db_session)
        await db_session.commit()
        assert await collect_dependencies(db_session, Position, position.id) == []

    async def test_leaf_rows_always_empty_tree(self, db_session) -> None:
        """Existing Visit/Payment/UserSettings rows still preview as leaves
        — no incoming FK edges means no nodes even with data around."""
        service = await _add_service(db_session)
        activity = await _add_activity(db_session, service=service)
        client = await _add_client(db_session)
        record = await _add_record(db_session, activity, client)
        visitor = await _add_visitor(db_session, client)
        visit = await _add_visit(db_session, record, visitor)
        payment = await _add_payment(db_session, record)
        settings = await _add_user_settings(db_session)
        await db_session.commit()

        assert await collect_dependencies(db_session, Visit, visit.id) == []
        assert await collect_dependencies(db_session, Payment, payment.id) == []
        assert await collect_dependencies(db_session, UserSettings, settings.id) == []


# ─── 3. Item one-liners (DB) ────────────────────────────────────────────────────


class TestFamilyItemLabels:
    async def test_photo_tag_label_is_title(self, db_session) -> None:
        photo = await _add_photo(db_session, "p.jpg")
        tag = await _add_tag(db_session, "интерьер")
        await _link(db_session, photo_tags, "photo_id", photo.id, tag.id)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Photo, photo.id)
        assert nodes[0].items[0].label == "интерьер"

    async def test_visit_label_service_and_price(self, db_session) -> None:
        """The visitor's visits reuse the records one-liner «{service.title},
        {price}»; a tariff-less visit degrades to «Без тарифа, {price}»."""
        service = await _add_service(db_session, "Лепка")
        activity = await _add_activity(db_session, service=service)
        client = await _add_client(db_session)
        visitor = await _add_visitor(db_session, client)
        record = await _add_record(db_session, activity, client)
        tariff = await _add_tariff(db_session, service, price=3000)
        await _add_visit(db_session, record, visitor, tariff, price=3000)
        await _add_visit(db_session, record, visitor, None, price=1200)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Visitor, visitor.id)
        labels = sorted(i.label for i in (nodes[0].items or []))
        assert labels == ["Без тарифа, 1200", "Лепка, 3000"]

    async def test_visitor_tag_label_is_title(self, db_session) -> None:
        client = await _add_client(db_session)
        visitor = await _add_visitor(db_session, client)
        tag = await _add_tag(db_session, "VIP")
        await _link(db_session, visitor_tags, "visitor_id", visitor.id, tag.id)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Visitor, visitor.id)
        by_entity = {n.entity: n for n in nodes}
        assert by_entity["visitor_tags"].items[0].label == "VIP"

    async def test_staff_label_first_last(self, db_session) -> None:
        position = await _add_position(db_session)
        staff = await _add_staff(db_session, "Ольга", "Кузнецова")
        await _link_position(db_session, staff.id, position.id)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Position, position.id)
        item = nodes[0].items[0]
        assert item.id == staff.id
        assert "Ольга" in item.label and "Кузнецова" in item.label


# ─── 4. Id collectors — the ``expected`` verification input (DB) ───────────────


class TestCollectDependencyIdsFamily:
    async def test_visitor_ids_per_entity(self, db_session) -> None:
        """visits → ``visit.id`` by ``visitor_id``; visitor_tags → the
        join-row id-strings (``tag_id``) within the visitor's scope."""
        service = await _add_service(db_session)
        activity = await _add_activity(db_session, service=service)
        client = await _add_client(db_session)
        visitor = await _add_visitor(db_session, client)
        record = await _add_record(db_session, activity, client)
        visit = await _add_visit(db_session, record, visitor)
        tag = await _add_tag(db_session, "VIP")
        await _link(db_session, visitor_tags, "visitor_id", visitor.id, tag.id)
        await db_session.commit()

        ids = await collect_dependency_ids(db_session, Visitor, visitor.id)
        assert ids == {"visits": [visit.id], "visitor_tags": [tag.id]}

    async def test_visitor_ids_exclude_other_visitors(self, db_session) -> None:
        """Only THIS visitor's visits/tags are collected — a sibling
        visitor's rows stay out of the map."""
        service = await _add_service(db_session)
        activity = await _add_activity(db_session, service=service)
        client = await _add_client(db_session)
        mine = await _add_visitor(db_session, client, "Мой")
        other = await _add_visitor(db_session, client, "Чужой")
        record = await _add_record(db_session, activity, client)
        my_visit = await _add_visit(db_session, record, mine)
        await _add_visit(db_session, record, other)
        tag_mine = await _add_tag(db_session, "мой-тег")
        tag_other = await _add_tag(db_session, "чужой-тег")
        await _link(db_session, visitor_tags, "visitor_id", mine.id, tag_mine.id)
        await _link(db_session, visitor_tags, "visitor_id", other.id, tag_other.id)
        await db_session.commit()

        ids = await collect_dependency_ids(db_session, Visitor, mine.id)
        assert ids == {"visits": [my_visit.id], "visitor_tags": [tag_mine.id]}

    async def test_photo_ids(self, db_session) -> None:
        photo = await _add_photo(db_session, "p.jpg")
        tag1 = await _add_tag(db_session, "t1")
        tag2 = await _add_tag(db_session, "t2")
        await _link(db_session, photo_tags, "photo_id", photo.id, tag1.id)
        await _link(db_session, photo_tags, "photo_id", photo.id, tag2.id)
        await db_session.commit()

        ids = await collect_dependency_ids(db_session, Photo, photo.id)
        assert set(ids) == {"photo_tags"}
        assert set(ids["photo_tags"]) == {tag1.id, tag2.id}

    async def test_position_ids(self, db_session) -> None:
        position = await _add_position(db_session)
        staff = await _add_staff(db_session)
        await _link_position(db_session, staff.id, position.id)
        await db_session.commit()

        ids = await collect_dependency_ids(db_session, Position, position.id)
        assert ids == {"staff_positions": [staff.id]}

    async def test_leaves_yield_empty_map(self, db_session) -> None:
        service = await _add_service(db_session)
        activity = await _add_activity(db_session, service=service)
        client = await _add_client(db_session)
        record = await _add_record(db_session, activity, client)
        visitor = await _add_visitor(db_session, client)
        visit = await _add_visit(db_session, record, visitor)
        payment = await _add_payment(db_session, record)
        settings = await _add_user_settings(db_session)
        await db_session.commit()

        assert await collect_dependency_ids(db_session, Visit, visit.id) == {}
        assert await collect_dependency_ids(db_session, Payment, payment.id) == {}
        assert await collect_dependency_ids(db_session, UserSettings, settings.id) == {}

    async def test_clean_rows_yield_empty_map(self, db_session) -> None:
        client = await _add_client(db_session)
        visitor = await _add_visitor(db_session, client)
        photo = await _add_photo(db_session, "clean.jpg")
        position = await _add_position(db_session)
        await db_session.commit()

        assert await collect_dependency_ids(db_session, Visitor, visitor.id) == {}
        assert await collect_dependency_ids(db_session, Photo, photo.id) == {}
        assert await collect_dependency_ids(db_session, Position, position.id) == {}


# ─── 5. Expected id-set verification (subset) on the new deps (pure) ──────────


class TestStaleExpectedEntitiesFamily:
    def test_visitor_new_visit_is_stale(self) -> None:
        now = {"visits": ["v-1", "v-new"], "visitor_tags": ["t-1"]}
        expected = {"visits": ["v-1"], "visitor_tags": ["t-1"]}
        assert stale_expected_entities(Visitor, now, expected) == ["visits"]

    def test_visitor_auto_tags_never_verified(self) -> None:
        """visitor_tags is AUTO — it resolves itself during execution, so a
        mid-window tag link is not a race the user confirmed."""
        now = {"visits": ["v-1"], "visitor_tags": ["t-new"]}
        expected = {"visits": ["v-1"], "visitor_tags": []}
        assert stale_expected_entities(Visitor, now, expected) == []

    def test_visitor_disappeared_visit_does_not_block(self) -> None:
        now = {"visits": ["v-1"]}
        expected = {"visits": ["v-1", "v-gone"]}
        assert stale_expected_entities(Visitor, now, expected) == []

    def test_photo_swapped_tag_is_stale(self) -> None:
        now = {"photo_tags": ["tag-other"]}
        expected = {"photo_tags": ["tag-1"]}
        assert stale_expected_entities(Photo, now, expected) == ["photo_tags"]

    def test_position_new_holder_is_stale(self) -> None:
        now = {"staff_positions": ["staff-1", "staff-2"]}
        expected = {"staff_positions": ["staff-1"]}
        assert stale_expected_entities(Position, now, expected) == ["staff_positions"]

    @pytest.mark.parametrize(
        "model",
        [Visit, Payment, UserSettings],
    )
    def test_leaves_never_stale(self, model: type) -> None:
        """Empty matrix → nothing to verify; any drift keys are skipped."""
        assert (
            stale_expected_entities(
                model,
                {"bogus": ["x"]},
                {},
            )
            == []
        )


# ─── 6. Cascade handlers + resolve_delete (join rows → subject) ────────────────


class TestFamilyResolveDelete:
    def test_all_new_pairs_have_cascade_handlers(self) -> None:
        """Guard: every cascade dep of the new subjects is wired in
        CASCADE_HANDLERS — Core bulk, deterministic under any PRAGMA.
        ``(Visitor, "visits")`` — the #324 Task-2 batch handler (bulk
        delete + record recompute via the VisitService block) — is asserted
        by its own suite (tests/services/test_delete_visits_by_visitor.py)."""
        wired = {
            (Photo, "photo_tags"),
            (Visitor, "visitor_tags"),
            (Visitor, "visits"),
            (Position, "staff_positions"),
        }
        assert wired <= set(CASCADE_HANDLERS)

    async def test_photo_resolve_delete_join_first(self, db_session) -> None:
        """Photo with tags: the join rows die BEFORE the photo row (the
        executor's own order), the tags themselves survive."""
        photo = await _add_photo(db_session, "busy.jpg")
        tag1 = await _add_tag(db_session, "t1")
        tag2 = await _add_tag(db_session, "t2")
        await _link(db_session, photo_tags, "photo_id", photo.id, tag1.id)
        await _link(db_session, photo_tags, "photo_id", photo.id, tag2.id)
        await db_session.commit()

        ok = await get_photo_service().resolve_delete(
            db_session,
            photo.id,
            {"photo_tags": "cascade"},
        )
        await db_session.commit()

        assert ok is True
        assert await db_session.get(Photo, photo.id) is None
        left = (
            await db_session.execute(select(photo_tags).where(photo_tags.c.photo_id == photo.id))
        ).all()
        assert left == []
        # Tags survive — only the links die.
        assert await db_session.get(Tag, tag1.id) is not None
        assert await db_session.get(Tag, tag2.id) is not None

    async def test_position_resolve_delete(self, db_session) -> None:
        """Non-system position held by 2 staff: join rows die, the staff
        cards survive, the position row dies."""
        position = await _add_position(db_session)
        staff1 = await _add_staff(db_session, "Анна", "Иванова")
        staff2 = await _add_staff(db_session, "Пётр", "Смирнов")
        await _link_position(db_session, staff1.id, position.id)
        await _link_position(db_session, staff2.id, position.id)
        await db_session.commit()

        ok = await get_position_service().resolve_delete(
            db_session,
            position.id,
            {"staff_positions": "cascade"},
        )
        await db_session.commit()

        assert ok is True
        assert await db_session.get(Position, position.id) is None
        left = (
            await db_session.execute(
                select(staff_positions).where(staff_positions.c.position_id == position.id)
            )
        ).all()
        assert left == []
        assert await db_session.get(Staff, staff1.id) is not None
        assert await db_session.get(Staff, staff2.id) is not None

    async def test_visitor_resolve_delete_tags_only(self, db_session) -> None:
        """Visitor WITHOUT visits but WITH a tag: visitor_tags is auto
        (empty resolutions body is valid), the handler strips the join
        rows, the visitor row dies, the tag survives."""
        client = await _add_client(db_session)
        visitor = await _add_visitor(db_session, client)
        tag = await _add_tag(db_session, "VIP")
        await _link(db_session, visitor_tags, "visitor_id", visitor.id, tag.id)
        await db_session.commit()

        ok = await get_visitor_service().resolve_delete(
            db_session,
            visitor.id,
            {},
        )
        await db_session.commit()

        assert ok is True
        assert await db_session.get(Visitor, visitor.id) is None
        left = (
            await db_session.execute(
                select(visitor_tags).where(visitor_tags.c.visitor_id == visitor.id)
            )
        ).all()
        assert left == []
        assert await db_session.get(Tag, tag.id) is not None

    async def test_missing_subject_returns_false(self, db_session) -> None:
        missing = "00000000-0000-0000-0000-000000000000"
        assert (
            await get_photo_service().resolve_delete(
                db_session,
                missing,
                {},
            )
            is False
        )
        assert (
            await get_position_service().resolve_delete(
                db_session,
                missing,
                {},
            )
            is False
        )
