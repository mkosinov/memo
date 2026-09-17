"""Copy-week service pipeline tests (GH #242, spec §5).

SERVICE-LEVEL tests: they call ``ActivityService.copy_week`` directly against
a real async ``db_session`` (same pattern as tests/services/test_delete_cascades.py)
and verify the resulting DB state. No HTTP — the route lands in Task 3.

Pipeline contract under test (spec §5, plan Task 2):
  * validation: week_start must be Monday; locations must exist;
  * source window [week_start−7 .. −1], target [week_start .. +6] via day_range;
  * filters: is_private / archived location → skipped_filtered; location not
    in the request list → silently out (no counter — spec §4);
  * remap of archived masters: first active master with a non-empty CSV
    specialty intersection in canonical board order (sort_order, first_name, id);
    no replacement → skipped_no_master;
  * dedup key (master_id, service_id, start+7d, duration) vs target rows AND
    in-run set → skipped_duplicates;
  * cap: > 100 rows to insert → 422 COPY_WEEK_SOURCE_TOO_LARGE (after dedup);
  * insertion: direct ORM Activity instances (NOT ActivityService.create —
    it is @transactional and would commit per row) + explicit activity_tags
    join rows + mark_changed("tags");
  * atomicity: a mid-pipeline failure → full rollback, zero copies.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import select

from src.models.activity import Activity
from src.models.location import Location
from src.models.master import Master
from src.models.service import Service
from src.models.staff import Staff
from src.models.tag import Tag, activity_tags
from src.services.activity import get_activity_service

pytestmark = pytest.mark.asyncio

# Sep 21 2026 is a Monday; the source week is Sep 14 (Mon) .. Sep 20 (Sun).
WEEK_MONDAY = date(2026, 9, 21)
SRC_TUE = datetime(2026, 9, 15, 10, 0)
SRC_WED = datetime(2026, 9, 16, 10, 0)


# ─── Direct-ORM setup helpers (service-level pattern, no HTTP) ─────────────────


async def _make_master(
    db_session,
    *,
    first_name: str = "Мастер",
    sort_order: int = 0,
    is_active: bool = True,
    specialty: str = "живопись",
    with_master_row: bool = True,
) -> str:
    """Insert a Staff card (+ masters extension) and return its id (master_id)."""
    staff = Staff(first_name=first_name, last_name="Тестов", sort_order=sort_order)
    db_session.add(staff)
    await db_session.flush()
    if with_master_row:
        db_session.add(
            Master(
                staff_id=staff.id, specialty=specialty,
                color="#5B8C7A", is_active=is_active,
            )
        )
        await db_session.flush()
    return staff.id


async def _make_service(db_session, *, is_active: bool = True) -> Service:
    service = Service(
        title="Тест-услуга", description="d", image_url="https://example.com/x.jpg",
        specialty="живопись", min_age=5, max_age=99, duration=60,
        record_info="r", is_active=is_active,
    )
    db_session.add(service)
    await db_session.flush()
    return service


async def _make_location(db_session, *, is_active: bool = True) -> Location:
    location = Location(name="Локация", capacity=20, is_active=is_active)
    db_session.add(location)
    await db_session.flush()
    return location


async def _make_activity(
    db_session,
    *,
    master_id: str,
    service_id: str,
    location_id: str,
    start: datetime,
    duration: int = 90,
    capacity: int = 10,
    is_private: bool = False,
    comment: str | None = None,
    record_info: str | None = None,
) -> Activity:
    activity = Activity(
        master_id=master_id, service_id=service_id, location_id=location_id,
        start=start, duration=duration, capacity=capacity,
        is_private=is_private, comment=comment, record_info=record_info,
    )
    db_session.add(activity)
    await db_session.flush()
    return activity


async def _tag_activity(db_session, activity: Activity, count: int = 1) -> list[Tag]:
    """Create ``count`` tags linked to the activity via activity_tags."""
    tags = []
    for i in range(count):
        tag = Tag(tag=f"tag-{activity.id[:8]}-{i}")
        db_session.add(tag)
        await db_session.flush()
        await db_session.execute(
            activity_tags.insert().values(activity_id=activity.id, tag_id=tag.id)
        )
        tags.append(tag)
    return tags


async def _target_week_activities(db_session) -> list[Activity]:
    """All activities inside the target window (committed state)."""
    from src.domain.dates import day_range

    from_dt, to_dt = day_range(WEEK_MONDAY, date(2026, 9, 27))
    rows = await db_session.execute(
        select(Activity).where(Activity.start >= from_dt, Activity.start <= to_dt)
    )
    return list(rows.scalars().all())


# ─── Validation guards ──────────────────────────────────────────────────────────


class TestCopyWeekValidation:
    async def test_non_monday_rejected(self, db_session) -> None:
        """week_start on a non-Monday → 422 COPY_WEEK_START_NOT_MONDAY."""
        from fastapi import HTTPException

        svc = get_activity_service()
        with pytest.raises(HTTPException) as exc_info:
            await svc.copy_week(
                db_session=db_session, week_start=date(2026, 9, 22),  # Tuesday
                locations=["loc-1"],
            )
        assert exc_info.value.status_code == 422
        assert exc_info.value.detail["code"] == "COPY_WEEK_START_NOT_MONDAY"

    async def test_unknown_location_rejected(self, db_session) -> None:
        """A location id absent from the DB → 422 COPY_WEEK_INVALID_LOCATION."""
        from fastapi import HTTPException

        svc = get_activity_service()
        with pytest.raises(HTTPException) as exc_info:
            await svc.copy_week(
                db_session=db_session, week_start=WEEK_MONDAY,
                locations=["no-such-location"],
            )
        assert exc_info.value.status_code == 422
        assert exc_info.value.detail["code"] == "COPY_WEEK_INVALID_LOCATION"


# ─── Happy path / merge / dedup ─────────────────────────────────────────────────


class TestCopyWeekPipeline:
    async def test_clean_week_copies_all_with_shift(self, db_session) -> None:
        """Empty target week: every source activity copied, fields match, +7d shift."""
        master_id = await _make_master(db_session)
        service = await _make_service(db_session)
        location = await _make_location(db_session)
        a1 = await _make_activity(
            db_session, master_id=master_id, service_id=service.id,
            location_id=location.id, start=SRC_TUE,
            capacity=7, comment="комментарий", record_info="инфо",
        )
        await _make_activity(
            db_session, master_id=master_id, service_id=service.id,
            location_id=location.id, start=SRC_WED, duration=60,
        )
        await db_session.commit()

        result = await get_activity_service().copy_week(
            db_session=db_session, week_start=WEEK_MONDAY, locations=[location.id]
        )
        assert result.copied == 2
        assert result.skipped_duplicates == 0
        assert result.skipped_filtered == 0
        assert result.skipped_no_master == 0

        copies = await _target_week_activities(db_session)
        assert len(copies) == 2
        by_start = {a.start: a for a in copies}
        c1 = by_start[datetime(2026, 9, 22, 10, 0)]  # SRC_TUE + 7d
        assert c1.master_id == a1.master_id
        assert c1.service_id == a1.service_id
        assert c1.location_id == a1.location_id
        assert c1.duration == a1.duration
        assert c1.capacity == 7
        assert c1.comment == "комментарий"
        assert c1.record_info == "инфо"
        assert c1.is_private is False  # copies are never private (spec §5.4)
        assert c1.id != a1.id
        c2 = by_start[datetime(2026, 9, 23, 10, 0)]  # SRC_WED + 7d
        assert c2.duration == 60

    async def test_repeat_click_all_duplicates(self, db_session) -> None:
        """Second copy with no edits → copied=0, every row skipped as duplicate."""
        master_id = await _make_master(db_session)
        service = await _make_service(db_session)
        location = await _make_location(db_session)
        await _make_activity(
            db_session, master_id=master_id, service_id=service.id,
            location_id=location.id, start=SRC_TUE,
        )
        await _make_activity(
            db_session, master_id=master_id, service_id=service.id,
            location_id=location.id, start=SRC_WED,
        )
        await db_session.commit()
        svc = get_activity_service()

        first = await svc.copy_week(
            db_session=db_session, week_start=WEEK_MONDAY, locations=[location.id]
        )
        assert first.copied == 2

        second = await svc.copy_week(
            db_session=db_session, week_start=WEEK_MONDAY, locations=[location.id]
        )
        assert second.copied == 0
        assert second.skipped_duplicates == 2
        assert len(await _target_week_activities(db_session)) == 2

    async def test_merge_copies_only_missing(self, db_session) -> None:
        """Merge: matching key already in target → skipped; the rest copied."""
        master_id = await _make_master(db_session)
        other_master_id = await _make_master(db_session, first_name="Другой")
        service = await _make_service(db_session)
        location = await _make_location(db_session)
        await _make_activity(
            db_session, master_id=master_id, service_id=service.id,
            location_id=location.id, start=SRC_TUE,
        )
        await _make_activity(
            db_session, master_id=master_id, service_id=service.id,
            location_id=location.id, start=SRC_WED,
        )
        await db_session.commit()

        # Pre-existing target activity with the SAME dedup key as source slot 1
        # (master+service+start+7d+duration — location/capacity are outside the key).
        await _make_activity(
            db_session, master_id=master_id, service_id=service.id,
            location_id=location.id, start=datetime(2026, 9, 22, 10, 0),
        )
        # An unrelated target activity — must not be touched.
        await _make_activity(
            db_session, master_id=other_master_id, service_id=service.id,
            location_id=location.id, start=datetime(2026, 9, 23, 12, 0),
        )
        await db_session.commit()

        result = await get_activity_service().copy_week(
            db_session=db_session, week_start=WEEK_MONDAY, locations=[location.id]
        )
        assert result.copied == 1
        assert result.skipped_duplicates == 1
        copies = await _target_week_activities(db_session)
        assert len(copies) == 3
        starts = sorted(a.start for a in copies)
        assert starts == [
            datetime(2026, 9, 22, 10, 0),
            datetime(2026, 9, 23, 10, 0),  # the only copied slot
            datetime(2026, 9, 23, 12, 0),  # unrelated pre-existing
        ]

    async def test_in_run_dedup_parallel_rows(self, db_session) -> None:
        """Two source candidates converging on one key (parallel rows in
        different locations — legal per #258/#259) → second is a duplicate."""
        master_id = await _make_master(db_session)
        service = await _make_service(db_session)
        loc_a = await _make_location(db_session)
        loc_b = await _make_location(db_session)
        # Same master+service+start+duration, different locations → same key
        # after the +7d shift (location is NOT part of the key, spec §5.2).
        await _make_activity(
            db_session, master_id=master_id, service_id=service.id,
            location_id=loc_a.id, start=SRC_TUE,
        )
        await _make_activity(
            db_session, master_id=master_id, service_id=service.id,
            location_id=loc_b.id, start=SRC_TUE,
        )
        await db_session.commit()

        result = await get_activity_service().copy_week(
            db_session=db_session, week_start=WEEK_MONDAY,
            locations=[loc_a.id, loc_b.id],
        )
        assert result.copied == 1
        assert result.skipped_duplicates == 1
        assert len(await _target_week_activities(db_session)) == 1


# ─── Filters (spec §5.1) ────────────────────────────────────────────────────────


class TestCopyWeekFilters:
    async def test_private_archived_location_and_list_filters(self, db_session) -> None:
        """is_private → skipped_filtered; archived location (in list) →
        skipped_filtered; location not in the request list → silently out."""
        master_id = await _make_master(db_session)
        service = await _make_service(db_session)
        loc_in_list = await _make_location(db_session)
        loc_archived = await _make_location(db_session, is_active=False)
        loc_not_in_list = await _make_location(db_session)

        await _make_activity(  # private → skipped_filtered
            db_session, master_id=master_id, service_id=service.id,
            location_id=loc_in_list.id, start=SRC_TUE, is_private=True,
        )
        await _make_activity(  # archived location (in list) → skipped_filtered
            db_session, master_id=master_id, service_id=service.id,
            location_id=loc_archived.id, start=SRC_WED,
        )
        await _make_activity(  # active location, unchecked in the popup → silent
            db_session, master_id=master_id, service_id=service.id,
            location_id=loc_not_in_list.id, start=datetime(2026, 9, 17, 10, 0),
        )
        await db_session.commit()

        result = await get_activity_service().copy_week(
            db_session=db_session, week_start=WEEK_MONDAY,
            locations=[loc_in_list.id, loc_archived.id],
        )
        assert result.copied == 0
        assert result.skipped_filtered == 2
        assert result.skipped_duplicates == 0
        assert result.skipped_no_master == 0
        assert len(await _target_week_activities(db_session)) == 0

    async def test_archived_service_is_copied(self, db_session) -> None:
        """Activities of ARCHIVED services are copied deliberately (spec §5.1):
        the guard covers locations and masters only."""
        master_id = await _make_master(db_session)
        service = await _make_service(db_session, is_active=False)
        location = await _make_location(db_session)
        await _make_activity(
            db_session, master_id=master_id, service_id=service.id,
            location_id=location.id, start=SRC_TUE,
        )
        await db_session.commit()

        result = await get_activity_service().copy_week(
            db_session=db_session, week_start=WEEK_MONDAY, locations=[location.id]
        )
        assert result.copied == 1


# ─── Remap of archived masters (spec §5.3) ──────────────────────────────────────


class TestCopyWeekRemap:
    async def test_remap_board_order_and_specialty_intersection(self, db_session) -> None:
        """Replacement = first ACTIVE master with a non-empty CSV-specialty
        intersection in canonical board order (sort_order ASC, first_name ASC, id ASC)."""
        archived = await _make_master(
            db_session, is_active=False, specialty="живопись, керамика",
        )
        service = await _make_service(db_session)
        location = await _make_location(db_session)
        await _make_activity(
            db_session, master_id=archived, service_id=service.id,
            location_id=location.id, start=SRC_TUE,
        )
        # No intersection → must NOT be picked despite the lowest sort_order.
        await _make_master(
            db_session, first_name="Ася", sort_order=0, specialty="вышивка",
        )
        await _make_master(
            db_session, first_name="Анна", sort_order=5, specialty="керамика",
        )
        boris = await _make_master(
            db_session, first_name="Борис", sort_order=1, specialty="живопись",
        )
        await db_session.commit()

        result = await get_activity_service().copy_week(
            db_session=db_session, week_start=WEEK_MONDAY, locations=[location.id]
        )
        assert result.copied == 1
        assert result.skipped_no_master == 0
        copies = await _target_week_activities(db_session)
        assert len(copies) == 1
        assert copies[0].master_id == boris  # sort_order 1 beats Анна's 5; Ася excluded

    async def test_remap_tie_broken_by_first_name(self, db_session) -> None:
        """Equal sort_order → first_name ASC decides (canonical board order)."""
        archived = await _make_master(
            db_session, is_active=False, specialty="гончарное дело",
        )
        service = await _make_service(db_session)
        location = await _make_location(db_session)
        await _make_activity(
            db_session, master_id=archived, service_id=service.id,
            location_id=location.id, start=SRC_TUE,
        )
        marina = await _make_master(
            db_session, first_name="Марина", sort_order=3, specialty="гончарное дело",
        )
        anna = await _make_master(
            db_session, first_name="Анна", sort_order=3, specialty="гончарное дело",
        )
        await db_session.commit()

        result = await get_activity_service().copy_week(
            db_session=db_session, week_start=WEEK_MONDAY, locations=[location.id]
        )
        assert result.copied == 1
        copies = await _target_week_activities(db_session)
        assert copies[0].master_id == anna  # «Анна» < «Марина»
        assert copies[0].master_id != marina

    async def test_no_replacement_skipped_no_master(self, db_session) -> None:
        """Archived master whose specialty no active master intersects →
        the row is skipped (skipped_no_master), nothing copied."""
        archived = await _make_master(
            db_session, is_active=False, specialty="вышивка",
        )
        service = await _make_service(db_session)
        location = await _make_location(db_session)
        await _make_activity(
            db_session, master_id=archived, service_id=service.id,
            location_id=location.id, start=SRC_TUE,
        )
        await _make_master(db_session, first_name="Борис", specialty="живопись")
        await db_session.commit()

        result = await get_activity_service().copy_week(
            db_session=db_session, week_start=WEEK_MONDAY, locations=[location.id]
        )
        assert result.copied == 0
        assert result.skipped_no_master == 1
        assert len(await _target_week_activities(db_session)) == 0

    async def test_copy_does_not_call_create_or_check_master_active(
        self, db_session, monkeypatch
    ) -> None:
        """copy_week must NOT loop ActivityService.create (per-row commits kill
        atomicity) and must NOT call check_master_active (remap invariant —
        spec §5.3: ids come from server-side remap, not user input)."""
        import src.services.activity as activity_module

        master_id = await _make_master(db_session)
        service = await _make_service(db_session)
        location = await _make_location(db_session)
        await _make_activity(
            db_session, master_id=master_id, service_id=service.id,
            location_id=location.id, start=SRC_TUE,
        )
        await db_session.commit()

        async def _fail(*args, **kwargs):
            raise AssertionError("copy_week must not call create/check_master_active")

        monkeypatch.setattr(activity_module.ActivityService, "create", _fail)
        monkeypatch.setattr(activity_module, "check_master_active", _fail)

        result = await get_activity_service().copy_week(
            db_session=db_session, week_start=WEEK_MONDAY, locations=[location.id]
        )
        assert result.copied == 1


# ─── Tags (spec §5.4) ───────────────────────────────────────────────────────────


class TestCopyWeekTags:
    async def test_tags_copied_and_marked(self, db_session, monkeypatch) -> None:
        """Tag links are copied via explicit activity_tags join rows and the
        ``tags`` family is marked (create never writes tags)."""
        import src.services.activity as activity_module

        master_id = await _make_master(db_session)
        service = await _make_service(db_session)
        location = await _make_location(db_session)
        source = await _make_activity(
            db_session, master_id=master_id, service_id=service.id,
            location_id=location.id, start=SRC_TUE,
        )
        tags = await _tag_activity(db_session, source, count=2)
        await db_session.commit()

        marks: list[str] = []
        monkeypatch.setattr(activity_module, "mark_changed", lambda fam: marks.append(fam))

        result = await get_activity_service().copy_week(
            db_session=db_session, week_start=WEEK_MONDAY, locations=[location.id]
        )
        assert result.copied == 1

        copies = await _target_week_activities(db_session)
        assert len(copies) == 1
        from tests.conftest import query_db

        rows = query_db(
            f"SELECT tag_id FROM activity_tags WHERE activity_id='{copies[0].id}'"
        )
        assert {r["tag_id"] for r in rows} == {t.id for t in tags}
        assert "tags" in marks


# ─── Atomicity: mid-pipeline failure → full rollback ────────────────────────────


class TestCopyWeekAtomicity:
    async def test_mid_insert_failure_rolls_back_everything(
        self, db_session, monkeypatch
    ) -> None:
        """A failure between inserts (simulated on the second add) propagates
        out of @transactional — nothing is committed: ZERO copies in the DB."""
        master_id = await _make_master(db_session)
        service = await _make_service(db_session)
        location = await _make_location(db_session)
        await _make_activity(
            db_session, master_id=master_id, service_id=service.id,
            location_id=location.id, start=SRC_TUE,
        )
        await _make_activity(
            db_session, master_id=master_id, service_id=service.id,
            location_id=location.id, start=SRC_WED,
        )
        await db_session.commit()

        real_add = db_session.add
        calls = {"n": 0}

        def flaky_add(obj):
            calls["n"] += 1
            if calls["n"] == 2:
                raise RuntimeError("simulated mid-insert failure")
            real_add(obj)

        monkeypatch.setattr(db_session, "add", flaky_add)

        with pytest.raises(RuntimeError, match="simulated mid-insert failure"):
            await get_activity_service().copy_week(
                db_session=db_session, week_start=WEEK_MONDAY,
                locations=[location.id],
            )

        await db_session.rollback()  # undo the uncommitted first insert

        from tests.conftest import query_db

        assert query_db(
            "SELECT COUNT(*) AS c FROM activities WHERE start >= '2026-09-21 00:00:00' "
            "AND start <= '2026-09-27 23:59:59.999999'"
        )[0]["c"] == 0


# ─── Volume cap (spec §4 D3) ────────────────────────────────────────────────────


class TestCopyWeekCap:
    async def test_cap_101_candidates_rejected(self, db_session) -> None:
        """After filters+dedup > 100 rows to insert → 422 COPY_WEEK_SOURCE_TOO_LARGE."""
        from fastapi import HTTPException

        master_id = await _make_master(db_session)
        service = await _make_service(db_session)
        location = await _make_location(db_session)
        for i in range(101):  # 101 distinct keys (different start times)
            await _make_activity(
                db_session, master_id=master_id, service_id=service.id,
                location_id=location.id,
                start=datetime(2026, 9, 15) + timedelta(minutes=10 * i),
            )
        await db_session.commit()

        with pytest.raises(HTTPException) as exc_info:
            await get_activity_service().copy_week(
                db_session=db_session, week_start=WEEK_MONDAY,
                locations=[location.id],
            )
        assert exc_info.value.status_code == 422
        assert exc_info.value.detail["code"] == "COPY_WEEK_SOURCE_TOO_LARGE"

        await db_session.rollback()
        assert len(await _target_week_activities(db_session)) == 0

    async def test_cap_100_candidates_allowed(self, db_session) -> None:
        """Exactly 100 rows to insert is within the cap — all copied."""
        master_id = await _make_master(db_session)
        service = await _make_service(db_session)
        location = await _make_location(db_session)
        for i in range(100):
            await _make_activity(
                db_session, master_id=master_id, service_id=service.id,
                location_id=location.id,
                start=datetime(2026, 9, 15) + timedelta(minutes=10 * i),
            )
        await db_session.commit()

        result = await get_activity_service().copy_week(
            db_session=db_session, week_start=WEEK_MONDAY, locations=[location.id]
        )
        assert result.copied == 100


# ─── Empty source week ──────────────────────────────────────────────────────────


class TestCopyWeekEmpty:
    async def test_empty_source_week_returns_zeros(self, db_session) -> None:
        """Empty source week → 200 with zeros (not an error, spec §4)."""
        location = await _make_location(db_session)
        await db_session.commit()

        result = await get_activity_service().copy_week(
            db_session=db_session, week_start=WEEK_MONDAY, locations=[location.id]
        )
        assert result.copied == 0
        assert result.skipped_duplicates == 0
        assert result.skipped_filtered == 0
        assert result.skipped_no_master == 0
