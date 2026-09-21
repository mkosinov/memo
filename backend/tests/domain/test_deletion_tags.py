"""GH #318 Task 1 — Tag domain wiring tests (matrix + four registries).

Covers the Tag-side entries of ``src/domain/deletion.py``:

* ``FK_MATRIX[Tag]`` — 8 join-table deps, all cascade / non-auto (D1).
* ``_COUNTERS`` — 8 per-``tag_id`` counters (via ``collect_dependencies``).
* ``_ID_COLLECTORS`` — 8 parent-id collectors (via ``collect_dependency_ids``).
* ``_ITEM_COLLECTORS`` — 8 ``{id, label}`` builders (parent one-liners, D6).
* ``CASCADE_HANDLERS`` — 8 join-delete handlers executed by
  ``GenericService.resolve_delete`` (D8).

Labels per plan Task 1: Service/Location → ``title``; Client/Visitor →
``name`` (Client.name nullable → «Аноним» fallback); Staff → first+last
via ``masters.staff_id → staff``; Record/Activity → date one-liners in
the records style; Photo → ``filename``. PII boundary: NO phones (D6).
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
from src.models.photo import Photo, photo_tags
from src.models.record import Record
from src.models.service import Service
from src.models.staff import Staff
from src.models.tag import (
    Tag,
    activity_tags,
    client_tags,
    location_tags,
    master_tags,
    record_tags,
    service_tags,
    visitor_tags,
)
from src.models.visitor import Visitor
from src.services.generic import GenericService
from src.services.tag import TagService, get_tag_service

# ─── Helpers ────────────────────────────────────────────────────────────────────


def _deps_map(model: type) -> dict[str, FKDependency]:
    return {dep.entity: dep for dep in FK_MATRIX.get(model, [])}


async def _flush_tag(db_session, title: str) -> str:
    tag = Tag(title=title)
    db_session.add(tag)
    await db_session.flush()
    return tag.id


async def _add_staff(db_session) -> Staff:
    staff = Staff(first_name="Иван", last_name="Петров")
    db_session.add(staff)
    await db_session.flush()
    return staff


async def _add_service(db_session, title: str = "Гончарное дело") -> Service:
    service = Service(
        title=title, description="d", image_url="i", specialty="живопись",
        min_age=6, duration=90, record_info="r",
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
        master_id=staff.id, service_id=service.id, location_id=location.id,
        start=datetime(2026, 3, 15, 10, 0, tzinfo=UTC) + timedelta(hours=1),
        duration=90, capacity=10, is_private=False,
    )
    db_session.add(activity)
    await db_session.flush()
    return activity


async def _add_record(
    db_session, activity: Activity, client: Client | None = None,
) -> Record:
    record = Record(
        activity_id=activity.id,
        client_id=client.id if client else None,
        status="confirmed", seats=1,
    )
    db_session.add(record)
    await db_session.flush()
    return record


async def _add_photo(db_session, filename: str) -> Photo:
    photo = Photo(filename=filename, is_public=False)
    db_session.add(photo)
    await db_session.flush()
    return photo


async def _link(db_session, table, owner_col: str, owner_id: str, tag_id: str) -> None:
    await db_session.execute(
        insert(table).values(**{owner_col: owner_id, "tag_id": tag_id})
    )
    await db_session.flush()


# ─── 1. FK_MATRIX[Tag] structure (pure, no DB) — spec D1 ───────────────────────


class TestFKMatrixTag:
    def test_has_exactly_eight_join_deps(self) -> None:
        """Spec D1: the 8 join tables, seen from the TAG side."""
        assert {dep.entity for dep in FK_MATRIX[Tag]} == {
            "service_tags", "activity_tags", "master_tags", "location_tags",
            "client_tags", "visitor_tags", "record_tags", "photo_tags",
        }

    @pytest.mark.parametrize(
        ("entity", "relation"),
        [
            ("service_tags", "Услуга"),
            ("activity_tags", "Занятие"),
            ("master_tags", "Мастер"),
            ("location_tags", "Локация"),
            ("client_tags", "Клиент"),
            ("visitor_tags", "Посетитель"),
            ("record_tags", "Запись"),
            ("photo_tags", "Фото"),
        ],
    )
    def test_dep_shape_cascade_non_auto(
        self, entity: str, relation: str,
    ) -> None:
        """Every Tag dep: cascade, allowed=["cascade"], auto=False (D1 —
        the perspective rule: the SAME join tables stay auto=True in the
        parent matrices, but are VISIBLE from the tag's side)."""
        dep = _deps_map(Tag)[entity]
        assert dep.action == "cascade"
        assert dep.auto is False
        assert dep.allowed_actions == ["cascade"]
        assert dep.nullable is False
        assert dep.relation == relation
        assert dep.message is None


# ─── 2. Counters (DB) — D8 ──────────────────────────────────────────────────────


class TestCollectDependenciesTag:
    async def test_busy_tag_full_tree_counts_and_items(self, db_session) -> None:
        """A tag linked to one parent of each kind → 8 nodes with count=1
        each, all non-auto with allowed_actions=["cascade"], items present."""
        tag_id = await _flush_tag(db_session, "busy")

        service = await _add_service(db_session)
        await _link(db_session, service_tags, "service_id", service.id, tag_id)

        activity_service = await _add_service(db_session, "Другая услуга")
        activity = await _add_activity(db_session, service=activity_service)
        await _link(db_session, activity_tags, "activity_id", activity.id, tag_id)

        staff = await _add_staff(db_session)
        db_session.add(Master(staff_id=staff.id, specialty="живопись", color="#000000"))
        await db_session.flush()
        await _link(db_session, master_tags, "master_id", staff.id, tag_id)

        location = await _add_location(db_session)
        await _link(db_session, location_tags, "location_id", location.id, tag_id)

        client = await _add_client(db_session)
        await _link(db_session, client_tags, "client_id", client.id, tag_id)

        visitor = await _add_visitor(db_session, client)
        await _link(db_session, visitor_tags, "visitor_id", visitor.id, tag_id)

        record = await _add_record(db_session, activity, client)
        await _link(db_session, record_tags, "record_id", record.id, tag_id)

        photo = await _add_photo(db_session, "p1.jpg")
        await _link(db_session, photo_tags, "photo_id", photo.id, tag_id)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Tag, tag_id)
        by_entity = {n.entity: n for n in nodes}
        assert set(by_entity) == {
            "service_tags", "activity_tags", "master_tags", "location_tags",
            "client_tags", "visitor_tags", "record_tags", "photo_tags",
        }
        for node in by_entity.values():
            assert node.count == 1
            assert node.auto is False
            assert node.allowed_actions == ["cascade"]
            assert node.cascade_preview is None
            assert node.items is not None and len(node.items) == 1
            # D6: items.id = the PARENT's id (join rows have no surrogate id).
        assert by_entity["service_tags"].items[0].id == service.id
        assert by_entity["activity_tags"].items[0].id == activity.id
        assert by_entity["master_tags"].items[0].id == staff.id
        assert by_entity["location_tags"].items[0].id == location.id
        assert by_entity["client_tags"].items[0].id == client.id
        assert by_entity["visitor_tags"].items[0].id == visitor.id
        assert by_entity["record_tags"].items[0].id == record.id
        assert by_entity["photo_tags"].items[0].id == photo.id

    async def test_zero_count_deps_are_skipped(self, db_session) -> None:
        """A tag linked only to a service → one node, no empty groups."""
        tag_id = await _flush_tag(db_session, "service-only")
        service = await _add_service(db_session)
        await _link(db_session, service_tags, "service_id", service.id, tag_id)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Tag, tag_id)
        assert [n.entity for n in nodes] == ["service_tags"]

    async def test_free_tag_returns_empty(self, db_session) -> None:
        tag_id = await _flush_tag(db_session, "free")
        await db_session.commit()
        assert await collect_dependencies(db_session, Tag, tag_id) == []


# ─── 3. Item collectors (DB) — D6 one-liners ────────────────────────────────────


class TestTagItemLabels:
    async def test_service_and_location_labels_use_title(self, db_session) -> None:
        tag_id = await _flush_tag(db_session, "t")
        service = await _add_service(db_session, "Лепка")
        location = await _add_location(db_session, "Главный зал")
        await _link(db_session, service_tags, "service_id", service.id, tag_id)
        await _link(db_session, location_tags, "location_id", location.id, tag_id)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Tag, tag_id)
        by_entity = {n.entity: n for n in nodes}
        assert by_entity["service_tags"].items[0].label == "Лепка"
        assert by_entity["location_tags"].items[0].label == "Главный зал"

    async def test_client_name_with_anonymous_fallback(self, db_session) -> None:
        """Client.name nullable → «Аноним» fallback (deletion.py:644-647 style);
        Visitor.name is NOT NULL → used as-is. Phones NEVER appear (D6 PII)."""
        tag_id = await _flush_tag(db_session, "t")
        named = await _add_client(db_session, "Анна К.")
        anon = await _add_client(db_session, None)
        visitor = await _add_visitor(db_session, named, "Оля")
        await _link(db_session, client_tags, "client_id", named.id, tag_id)
        await _link(db_session, visitor_tags, "visitor_id", visitor.id, tag_id)
        await db_session.commit()

        # Second client link row for the anonymous client (same tag).
        await _link(db_session, client_tags, "client_id", anon.id, tag_id)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Tag, tag_id)
        by_entity = {n.entity: n for n in nodes}
        client_labels = {i.label for i in by_entity["client_tags"].items}
        assert client_labels == {"Анна К.", "Аноним"}
        assert by_entity["visitor_tags"].items[0].label == "Оля"
        # PII boundary: no phone digits anywhere in the tree.
        serialized = "\n".join(
            i.label for n in nodes for i in (n.items or [])
        )
        assert "+7999" not in serialized

    async def test_master_label_via_staff_two_table_build(self, db_session) -> None:
        """master_tags.master_id → masters.staff_id → staff: label built from
        the staff card (node id = staff_id), two-table join."""
        tag_id = await _flush_tag(db_session, "t")
        staff = await _add_staff(db_session)  # Иван Петров
        db_session.add(Master(staff_id=staff.id, specialty="живопись", color="#000000"))
        await db_session.flush()
        await _link(db_session, master_tags, "master_id", staff.id, tag_id)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Tag, tag_id)
        by_entity = {n.entity: n for n in nodes}
        item = by_entity["master_tags"].items[0]
        assert item.id == staff.id
        assert "Иван" in item.label and "Петров" in item.label

    async def test_record_label_date_one_liner(self, db_session) -> None:
        """Record one-liner mirrors the records style:
        «{service.title}, {date}, {client | Аноним}»."""
        tag_id = await _flush_tag(db_session, "t")
        service = await _add_service(db_session)
        activity = await _add_activity(db_session, service=service)
        client = await _add_client(db_session)
        record = await _add_record(db_session, activity, client)
        await _link(db_session, record_tags, "record_id", record.id, tag_id)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Tag, tag_id)
        by_entity = {n.entity: n for n in nodes}
        item = by_entity["record_tags"].items[0]
        assert item.id == record.id
        assert item.label.startswith(f"{service.title}, 2026-03-15")
        assert "Мария Смирнова" in item.label

    async def test_activity_label_date_one_liner(self, db_session) -> None:
        tag_id = await _flush_tag(db_session, "t")
        service = await _add_service(db_session)
        activity = await _add_activity(db_session, service=service)
        await _link(db_session, activity_tags, "activity_id", activity.id, tag_id)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Tag, tag_id)
        by_entity = {n.entity: n for n in nodes}
        item = by_entity["activity_tags"].items[0]
        assert item.id == activity.id
        assert item.label.startswith(f"{service.title}, 2026-03-15")

    async def test_photo_label_uses_filename(self, db_session) -> None:
        tag_id = await _flush_tag(db_session, "t")
        photo = await _add_photo(db_session, "hall-2026.jpg")
        await _link(db_session, photo_tags, "photo_id", photo.id, tag_id)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Tag, tag_id)
        by_entity = {n.entity: n for n in nodes}
        assert by_entity["photo_tags"].items[0].label == "hall-2026.jpg"


# ─── 4. Id collectors (DB) — the ``expected`` verification input ───────────────


class TestCollectDependencyIdsTag:
    async def test_parent_ids_per_entity(self, db_session) -> None:
        """collect_dependency_ids returns PARENT ids keyed by join-table
        entity — the route's subset verification consumes these (D8)."""
        tag_id = await _flush_tag(db_session, "t")
        service = await _add_service(db_session)
        client = await _add_client(db_session)
        record = await _add_record(
            db_session, await _add_activity(db_session, service=service), client,
        )
        visitor = await _add_visitor(db_session, client)
        await _link(db_session, service_tags, "service_id", service.id, tag_id)
        await _link(db_session, record_tags, "record_id", record.id, tag_id)
        await _link(db_session, visitor_tags, "visitor_id", visitor.id, tag_id)
        await db_session.commit()

        ids = await collect_dependency_ids(db_session, Tag, tag_id)
        assert ids == {
            "service_tags": [service.id],
            "record_tags": [record.id],
            "visitor_tags": [visitor.id],
        }

    async def test_free_tag_yields_empty_map(self, db_session) -> None:
        tag_id = await _flush_tag(db_session, "free")
        await db_session.commit()
        assert await collect_dependency_ids(db_session, Tag, tag_id) == {}


# ─── 5. Cascade handlers + resolve_delete on the base service — D8 ─────────────


class TestTagResolveDelete:
    def test_tag_service_is_generic_not_archive(self) -> None:
        """D8: resolve_delete lives on the BASE GenericService — TagService
        gets it by inheritance WITHOUT becoming an ArchiveService."""
        assert issubclass(TagService, GenericService)
        service = get_tag_service()
        assert callable(getattr(service, "resolve_delete", None))

    async def test_resolve_delete_strips_all_join_rows(self, db_session) -> None:
        """All 8 handlers run: join rows die, ALL parent rows survive."""
        tag_id = await _flush_tag(db_session, "busy")
        service = await _add_service(db_session)
        activity_service = await _add_service(db_session, "Другая")
        activity = await _add_activity(db_session, service=activity_service)
        staff = await _add_staff(db_session)
        db_session.add(Master(staff_id=staff.id, specialty="живопись", color="#000000"))
        location = await _add_location(db_session)
        client = await _add_client(db_session)
        visitor = await _add_visitor(db_session, client)
        record = await _add_record(db_session, activity, client)
        photo = await _add_photo(db_session, "p.jpg")
        await db_session.flush()
        await _link(db_session, service_tags, "service_id", service.id, tag_id)
        await _link(db_session, activity_tags, "activity_id", activity.id, tag_id)
        await _link(db_session, master_tags, "master_id", staff.id, tag_id)
        await _link(db_session, location_tags, "location_id", location.id, tag_id)
        await _link(db_session, client_tags, "client_id", client.id, tag_id)
        await _link(db_session, visitor_tags, "visitor_id", visitor.id, tag_id)
        await _link(db_session, record_tags, "record_id", record.id, tag_id)
        await _link(db_session, photo_tags, "photo_id", photo.id, tag_id)
        await db_session.commit()

        ok = await get_tag_service().resolve_delete(
            db_session, tag_id,
            {
                "service_tags": "cascade",
                "activity_tags": "cascade",
                "master_tags": "cascade",
                "location_tags": "cascade",
                "client_tags": "cascade",
                "visitor_tags": "cascade",
                "record_tags": "cascade",
                "photo_tags": "cascade",
            },
        )
        await db_session.commit()

        assert ok is True
        assert await db_session.get(Tag, tag_id) is None
        for table, col, owner_id in (
            (service_tags, "service_id", service.id),
            (activity_tags, "activity_id", activity.id),
            (master_tags, "master_id", staff.id),
            (location_tags, "location_id", location.id),
            (client_tags, "client_id", client.id),
            (visitor_tags, "visitor_id", visitor.id),
            (record_tags, "record_id", record.id),
            (photo_tags, "photo_id", photo.id),
        ):
            left = (await db_session.execute(
                select(table).where(table.c[col] == owner_id)
            )).scalars().all()
            assert left == [], f"join rows survived for {table.name}"
        # Every parent survives — only the links die.
        assert await db_session.get(Service, service.id) is not None
        assert await db_session.get(Activity, activity.id) is not None
        assert await db_session.get(Staff, staff.id) is not None
        assert await db_session.get(Location, location.id) is not None
        assert await db_session.get(Client, client.id) is not None
        assert await db_session.get(Visitor, visitor.id) is not None
        assert await db_session.get(Record, record.id) is not None
        assert await db_session.get(Photo, photo.id) is not None

    async def test_resolve_delete_missing_tag_returns_false(self, db_session) -> None:
        assert await get_tag_service().resolve_delete(
            db_session, "00000000-0000-0000-0000-000000000000", {}
        ) is False

    def test_all_eight_pairs_have_cascade_handlers(self) -> None:
        """Guard: every FK_MATRIX[Tag] dep is wired in CASCADE_HANDLERS —
        the executor is deterministic (no ORM-cascade reliance, D8)."""
        wired = {
            (model, entity) for (model, entity) in CASCADE_HANDLERS
            if model is Tag
        }
        assert wired == {(Tag, dep.entity) for dep in FK_MATRIX[Tag]}


# ─── 6. Expected id-set verification (subset) — #318 Task 5, D7 #285 mirror ────


class TestStaleExpectedEntitiesTag:
    """``stale_expected_entities(Tag, ...)`` — the subset check over the 8
    join-table deps (mirror of ``TestStaleExpectedEntitiesActivity`` in
    test_deletion.py, #285 D9a):

    * an id present on the server but missing from ``expected`` blocks
      (the mid-window race — a new link appeared after confirmation);
    * swapped ids at an equal counter block (ids, not counts, are the
      currency of ``expected`` — rev6);
    * a dep that disappeared in the undo window does NOT block (deleting
      less than was confirmed is fine);
    * a missing ``expected`` key = «nothing was confirmed» for that entity.

    Tag specifics vs Activity: NO auto deps and NO recursive subtree —
    all 8 entities in ``now_ids`` are verified as user-confirmed
    non-auto deps.
    """

    _ALL8 = (
        "service_tags", "activity_tags", "master_tags", "location_tags",
        "client_tags", "visitor_tags", "record_tags", "photo_tags",
    )

    @staticmethod
    def _full(now_suffix: str = "-1", expected_suffix: str = "-1",
              ) -> tuple[dict, dict]:
        """now/expected covering all 8 entities, one distinct id each
        (``{entity}{suffix}`` — entity-unique so single-entity edits in a
        test cannot cross-contaminate other entities' id-sets)."""
        all8 = TestStaleExpectedEntitiesTag._ALL8
        return (
            {e: [f"{e}{now_suffix}"] for e in all8},
            {e: [f"{e}{expected_suffix}"] for e in all8},
        )

    def test_new_link_appeared_is_stale(self) -> None:
        """A link added mid-window to one join table → that entity is
        stale, the other seven confirmations stay valid."""
        now_ids, expected = self._full()
        now_ids["photo_tags"] = ["photo_tags-new"]  # race: new photo link

        assert stale_expected_entities(Tag, now_ids, expected) == ["photo_tags"]

    def test_mismatch_by_id_is_stale(self) -> None:
        """One entity carries a different id than confirmed → stale."""
        now_ids, expected = self._full()
        now_ids["client_tags"] = ["client-other"]

        assert stale_expected_entities(Tag, now_ids, expected) == ["client_tags"]

    def test_swapped_id_blocks_at_equal_counter(self) -> None:
        """Same counter everywhere, one id swapped → blocks (rev6: id-sets,
        not counters, are the currency of ``expected``)."""
        now_ids, expected = self._full()
        now_ids["record_tags"] = ["swapped-id"]  # counter unchanged: 1 == 1

        assert stale_expected_entities(Tag, now_ids, expected) == ["record_tags"]

    def test_disappeared_link_does_not_block_subset(self) -> None:
        """Expected carries ids that no longer exist — deleting less than
        was confirmed is fine (subset semantics, #285 D9a)."""
        now_ids, expected = self._full()
        expected["visitor_tags"] = ["visitor_tags-1", "v-gone"]  # v-gone vanished

        assert stale_expected_entities(Tag, now_ids, expected) == []

    def test_full_match_returns_empty(self) -> None:
        """All 8 confirmed exactly → nothing stale."""
        now_ids, expected = self._full()

        assert stale_expected_entities(Tag, now_ids, expected) == []

    def test_missing_expected_key_means_nothing_confirmed(self) -> None:
        """No ``service_tags`` key in expected, but a link exists → the
        current row is stale (a missing key = «nothing was confirmed»);
        the #318 route relies on this for its partial-expected 409."""
        now_ids, expected = self._full()
        del expected["service_tags"]

        assert stale_expected_entities(Tag, now_ids, expected) == ["service_tags"]

    def test_unknown_entity_keys_never_verified(self) -> None:
        """now_ids keys outside the Tag matrix (e.g. a drift key) are not
        verified — mirrors the defensive ``continue`` branch."""
        now_ids, expected = self._full("svc-1", "svc-1")
        now_ids["bogus_deps"] = ["x"]

        assert stale_expected_entities(Tag, now_ids, expected) == []
