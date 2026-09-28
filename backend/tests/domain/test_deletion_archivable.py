"""GH #345 Task 1 — id/item-collectors for the 5 archivable entities.

Covers the new registry entries of ``src/domain/deletion.py`` (spec §4.3):

* ``_ID_COLLECTORS`` — 5 keys: ``(Staff, "activities")``,
  ``(Location, "activities")``, ``(Service, "activities")``,
  ``(Client, "records")``, ``(Client, "visitors")`` — the input of the
  ``expected`` id-set verification (S5 race gate: without the activities
  collectors a mid-window lesson on an at-dialog-time-clean staff would
  fall through as 422 blocked instead of 409 stale).
* ``_ITEM_COLLECTORS`` — ONLY ``(Client, "records")`` and
  ``(Client, "visitors")``. Blocked activities nodes are NEVER confirmed
  (the archive path) — items for them are deliberately NOT introduced;
  the 409 stale tree for those entities shows counters only.
* Labels mirror the ready-made builders: records — date one-liners in
  the ``_items_a_records`` style («{service}, {date}, {client | Аноним}»);
  visitors — name with the «Аноним» fallback (#318 D6 style).
* PII boundary per #285 D9: NO phone substrings anywhere in items.
"""

from __future__ import annotations

import uuid as _uuid
from datetime import datetime

import pytest
from sqlalchemy import insert

from src.domain.deletion import (
    _ID_COLLECTORS,
    _ITEM_COLLECTORS,
    DependencyItem,
    collect_dependencies,
    collect_dependency_ids,
)
from src.models.activity import Activity
from src.models.client import Client
from src.models.location import Location
from src.models.master import Master
from src.models.record import Record
from src.models.service import Service
from src.models.staff import Staff
from src.models.tag import Tag, client_tags
from src.models.visitor import Visitor

# Deterministic date for the label one-liners (same anchor as the #285
# tests: 2026-09-18 → «2026-09-18» in every label assertion).
_START = datetime(2026, 9, 18, 10, 0)

# ─── Helpers ────────────────────────────────────────────────────────────────────


async def _add_staff(db_session, first: str = "Иван") -> Staff:
    staff = Staff(first_name=first, last_name="Петров")
    db_session.add(staff)
    await db_session.flush()
    return staff


async def _ensure_extension(db_session, staff_id: str) -> Master:
    ext = await db_session.get(Master, staff_id)
    if ext is None:
        ext = Master(staff_id=staff_id, specialty="живопись", color="#000000")
        db_session.add(ext)
        await db_session.flush()
    return ext


async def _add_service(db_session, title: str = "МК Лепка") -> Service:
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


async def _add_client(db_session, name: str | None = "Мария") -> Client:
    client = Client(name=name, phone=f"+7999{_uuid.uuid4().hex[:7]}")
    db_session.add(client)
    await db_session.flush()
    return client


async def _add_activity(
    db_session, *, master: Staff, service: Service, location: Location,
) -> Activity:
    # activities.master_id targets masters.staff_id — the extension row
    # must exist before the FK (GH #266).
    await _ensure_extension(db_session, master.id)
    activity = Activity(
        master_id=master.id, service_id=service.id, location_id=location.id,
        start=_START, duration=90, capacity=10, is_private=False,
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


async def _add_visitor(db_session, client: Client, name: str = "Петя") -> Visitor:
    visitor = Visitor(client_id=client.id, name=name)
    db_session.add(visitor)
    await db_session.flush()
    return visitor


async def _flush_tag(db_session, title: str) -> str:
    """Add a fresh Tag row and return its id (direct ORM insert)."""
    tag = Tag(title=title)
    db_session.add(tag)
    await db_session.flush()
    return tag.id


async def _seed_activity(db_session) -> tuple[Staff, Service, Location, Activity]:
    """One master card + service + location + a single activity on them."""
    master = await _add_staff(db_session)
    service = await _add_service(db_session)
    location = await _add_location(db_session)
    activity = await _add_activity(
        db_session, master=master, service=service, location=location,
    )
    return master, service, location, activity


# ─── 1. Registry wiring (pure, no DB) — spec §4.3 exact composition ────────────


class TestArchivableCollectorWiring:
    def test_id_collectors_have_exactly_five_new_keys(self) -> None:
        """Spec §4.3: exactly the 5 keys for the archivable family — the
        auto deps of Staff/Client (users/masters/joins/photos) stay
        unwired (their rows resolve themselves, nothing to confirm)."""
        wired = {
            (model, entity) for (model, entity) in _ID_COLLECTORS
            if model in (Staff, Location, Service, Client)
        }
        assert wired == {
            (Staff, "activities"),
            (Location, "activities"),
            (Service, "activities"),
            (Client, "records"),
            (Client, "visitors"),
        }

    def test_item_collectors_have_exactly_two_new_keys(self) -> None:
        """Spec §4.3: ONLY the Client dialog carries items — blocked
        activities nodes never get confirmed, so no builder for them."""
        wired = {
            (model, entity) for (model, entity) in _ITEM_COLLECTORS
            if model in (Staff, Location, Service, Client)
        }
        assert wired == {
            (Client, "records"),
            (Client, "visitors"),
        }


# ─── 2. Id collectors (DB) — the ``expected`` verification input ────────────────


class TestCollectDependencyIdsStaff:
    async def test_activity_ids_via_masters_extension(self, db_session) -> None:
        """The staff join path runs through the extension string
        (activities.master_id → masters.staff_id = staff.id): the
        collector returns ONLY the card's own activities."""
        master, _svc, _loc, a1 = await _seed_activity(db_session)
        a2 = await _add_activity(
            db_session, master=master,
            service=await _add_service(db_session, "Вторая"),
            location=await _add_location(db_session, "Второй зал"),
        )
        other = await _add_staff(db_session, "Пётр")
        await _add_activity(
            db_session, master=other,
            service=await _add_service(db_session, "Чужая"),
            location=await _add_location(db_session, "Чужой зал"),
        )
        await db_session.commit()

        ids = await collect_dependency_ids(db_session, Staff, master.id)

        assert set(ids) == {"activities"}
        assert set(ids["activities"]) == {a1.id, a2.id}

    async def test_clean_staff_yields_empty_map(self, db_session) -> None:
        """No activities (and no id-collectors for the auto deps) → {}."""
        master = await _add_staff(db_session)
        await _ensure_extension(db_session, master.id)
        await db_session.commit()

        assert await collect_dependency_ids(db_session, Staff, master.id) == {}


class TestCollectDependencyIdsLocation:
    async def test_activity_ids_direct_fk(self, db_session) -> None:
        _m, _s, location, mine = await _seed_activity(db_session)
        other_loc = await _add_location(db_session, "Другой зал")
        await _add_activity(
            db_session,
            master=await _add_staff(db_session, "Пётр"),
            service=await _add_service(db_session, "Другая"),
            location=other_loc,
        )
        await db_session.commit()

        ids = await collect_dependency_ids(db_session, Location, location.id)

        assert ids == {"activities": [mine.id]}

    async def test_clean_location_yields_empty_map(self, db_session) -> None:
        location = await _add_location(db_session)
        await db_session.commit()

        assert await collect_dependency_ids(db_session, Location, location.id) == {}


class TestCollectDependencyIdsService:
    async def test_activity_ids_direct_fk(self, db_session) -> None:
        _m, service, _l, mine = await _seed_activity(db_session)
        await _add_activity(
            db_session,
            master=await _add_staff(db_session, "Пётр"),
            service=await _add_service(db_session, "Другая"),
            location=await _add_location(db_session, "Другой зал"),
        )
        await db_session.commit()

        ids = await collect_dependency_ids(db_session, Service, service.id)

        assert ids == {"activities": [mine.id]}

    async def test_clean_service_yields_empty_map(self, db_session) -> None:
        service = await _add_service(db_session)
        await db_session.commit()

        assert await collect_dependency_ids(db_session, Service, service.id) == {}


class TestCollectDependencyIdsClient:
    async def test_records_and_visitors_id_sets(self, db_session) -> None:
        """Records + visitors of the client (direct FKs) — and ONLY those:
        the auto deps (client_tags/photos) have no id-collectors."""
        _m, _s, _l, activity = await _seed_activity(db_session)
        client = await _add_client(db_session)
        other = await _add_client(db_session, "Другой")
        r1 = await _add_record(db_session, activity, client)
        r2 = await _add_record(db_session, activity, client)
        await _add_record(db_session, activity, other)  # not ours
        await _add_record(db_session, activity, None)  # anonymous — not ours
        v1 = await _add_visitor(db_session, client, "Оля")
        v2 = await _add_visitor(db_session, client, "Петя")
        await _add_visitor(db_session, other, "Чужой")
        # Auto dep row (real tag — FK enforcement is ON in the test DB);
        # must NOT surface in the id map.
        tag_id = await _flush_tag(db_session, "345-auto")
        await db_session.execute(insert(client_tags).values(
            client_id=client.id, tag_id=tag_id,
        ))
        await db_session.commit()

        ids = await collect_dependency_ids(db_session, Client, client.id)

        assert set(ids) == {"records", "visitors"}
        assert set(ids["records"]) == {r1.id, r2.id}
        assert set(ids["visitors"]) == {v1.id, v2.id}

    async def test_clean_client_yields_empty_map(self, db_session) -> None:
        client = await _add_client(db_session)
        await db_session.commit()

        assert await collect_dependency_ids(db_session, Client, client.id) == {}


# ─── 3. Item builders (DB) — Client dialog one-liners (spec §4.3) ───────────────


class TestClientItemsLabels:
    async def test_records_date_one_liner_with_client_name(
        self, db_session,
    ) -> None:
        """Records label mirrors the ``(Activity, "records")`` builder:
        «{service.title}, {date}, {client | Аноним}» — here the client
        component is the deleted client's own name."""
        _m, _s, _l, activity = await _seed_activity(db_session)
        client = await _add_client(db_session, "Борис")
        record = await _add_record(db_session, activity, client)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Client, client.id)
        by_entity = {n.entity: n for n in nodes}

        assert by_entity["records"].items == [
            DependencyItem(id=record.id, label="МК Лепка, 2026-09-18, Борис"),
        ]

    async def test_records_label_fallback_when_client_name_null(
        self, db_session,
    ) -> None:
        _m, _s, _l, activity = await _seed_activity(db_session)
        client = await _add_client(db_session, None)
        record = await _add_record(db_session, activity, client)
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Client, client.id)
        by_entity = {n.entity: n for n in nodes}

        assert by_entity["records"].items == [
            DependencyItem(id=record.id, label="МК Лепка, 2026-09-18, Аноним"),
        ]

    async def test_visitors_label_uses_name(self, db_session) -> None:
        _m, _s, _l, _a = await _seed_activity(db_session)
        client = await _add_client(db_session)
        visitor = await _add_visitor(db_session, client, "Оля")
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Client, client.id)
        by_entity = {n.entity: n for n in nodes}

        assert by_entity["visitors"].items == [
            DependencyItem(id=visitor.id, label="Оля"),
        ]

    async def test_visitors_label_fallback_when_name_empty(
        self, db_session,
    ) -> None:
        """Defensive «Аноним» on a falsy name (column is NOT NULL, but an
        empty string reaches the same fallback — #318 D6 style)."""
        _m, _s, _l, _a = await _seed_activity(db_session)
        client = await _add_client(db_session)
        visitor = await _add_visitor(db_session, client, "")
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Client, client.id)
        by_entity = {n.entity: n for n in nodes}

        assert by_entity["visitors"].items == [
            DependencyItem(id=visitor.id, label="Аноним"),
        ]


# ─── 4. PII boundary (#285 D9) — no phones in items ─────────────────────────────


class TestClientItemsPIIBoundary:
    async def test_no_phone_substrings_in_items(self, db_session) -> None:
        """The client row carries a phone; every label must be built from
        names/titles/dates only (admin route, same audience as records —
        but the phone NEVER leaks into the dialog rows)."""
        _m, _s, _l, activity = await _seed_activity(db_session)
        client = await _add_client(db_session, "Борис")
        await _add_record(db_session, activity, client)
        await _add_visitor(db_session, client, "Оля")
        await db_session.commit()

        nodes = await collect_dependencies(db_session, Client, client.id)
        serialized = "\n".join(
            i.label for n in nodes for i in (n.items or [])
        )

        assert client.phone not in serialized
        assert "+7999" not in serialized


# ─── 5. Fixed boundary — blocked activities nodes carry NO items (§4.3) ─────────


class TestActivitiesNodesCarryNoItems:
    """Guard for the negative space of this task: Staff/Location/Service
    activities nodes stay counter-only (a blocked node is never confirmed
    → expected is never built from it → no builders wired)."""

    @pytest.mark.parametrize("owner", ["staff", "location", "service"])
    async def test_activities_node_items_stay_none(
        self, db_session, owner: str,
    ) -> None:
        master, service, location, _activity = await _seed_activity(db_session)
        await db_session.commit()

        model, entity_id = {
            "staff": (Staff, master.id),
            "location": (Location, location.id),
            "service": (Service, service.id),
        }[owner]

        nodes = await collect_dependencies(db_session, model, entity_id)
        activities = [n for n in nodes if n.entity == "activities"]

        assert len(activities) == 1
        assert activities[0].count == 1
        assert activities[0].items is None
