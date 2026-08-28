"""Tests for the seed data script."""

import pytest
from sqlalchemy import text

from src.db.base import Base
from src.db.database import DBManager

pytestmark = pytest.mark.misc


@pytest.fixture
async def db_manager():
    """Create an in-memory test database manager with tables."""
    manager = DBManager("sqlite+aiosqlite:///:memory:")
    async with manager.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield manager
    await manager.engine.dispose()


async def test_seed_populates_masters(db_manager: DBManager) -> None:
    """Seed script creates exactly 6 masters."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM masters"))
        assert result.scalar() == 6


async def test_seed_populates_locations(db_manager: DBManager) -> None:
    """Seed script creates exactly 3 locations."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM locations"))
        assert result.scalar() == 3


async def test_seed_populates_services(db_manager: DBManager) -> None:
    """Seed script creates exactly 7 services."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM services"))
        assert result.scalar() == 7


async def test_seed_populates_tariffs(db_manager: DBManager) -> None:
    """Seed script creates 21 tariffs (3 per service x 7 services)."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM tariffs"))
        assert result.scalar() == 21


async def test_seed_populates_tags(db_manager: DBManager) -> None:
    """Seed script creates exactly 7 tags (including 'гость')."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM tags"))
        assert result.scalar() == 7


async def test_seed_services_have_material_hint_and_image_url(db_manager: DBManager) -> None:
    """Each seeded service has non-empty material_hint and image_url."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(
            text("SELECT id, material_hint, image_url FROM services")
        )
        rows = result.all()
        assert len(rows) == 7
        for row in rows:
            assert row.material_hint, f"Service {row.id} missing material_hint"
            assert row.image_url, f"Service {row.id} missing image_url"


async def test_seed_locations_have_location_hint(db_manager: DBManager) -> None:
    """Each seeded location has non-empty location_hint."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(
            text("SELECT id, location_hint FROM locations")
        )
        rows = result.all()
        assert len(rows) == 3
        for row in rows:
            assert row.location_hint, f"Location {row.id} missing location_hint"


async def test_seed_service_tags_exist(db_manager: DBManager) -> None:
    """Seed creates service_tags join table entries."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM service_tags"))
        assert result.scalar() >= 7


async def test_seed_activity_tags_exist(db_manager: DBManager) -> None:
    """Seed creates activity_tags join table entries."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM activity_tags"))
        assert result.scalar() >= 2


async def test_seed_populates_photos(db_manager: DBManager) -> None:
    """Seed script creates 7 photos with mutually exclusive owners (GH #211).

    Layout: 2 client-owned (same client), 1 service-owned, 2 activity-owned
    (guest photos, activities co-located at L1='alpika'), 1 location-owned
    (L1 interior shot), 1 owner-less tag-pair photo ([T1=tag1, T2=tag2]).
    """
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM photos"))
        assert result.scalar() == 7

        # ≥1 location-owned photo (location gallery owner slot in use)
        result = await session.execute(
            text("SELECT COUNT(*) FROM photos WHERE location_id IS NOT NULL")
        )
        assert result.scalar() >= 1

        # no photo combines location_id with another owner (scenario 5 base)
        result = await session.execute(
            text(
                "SELECT COUNT(*) FROM photos WHERE location_id IS NOT NULL "
                "AND (client_id IS NOT NULL OR service_id IS NOT NULL "
                "OR activity_id IS NOT NULL)"
            )
        )
        assert result.scalar() == 0

        # no multi-owner row at all (mirrors CHECK ck_photos_single_owner)
        result = await session.execute(
            text(
                "SELECT COUNT(*) FROM photos WHERE (client_id IS NOT NULL) "
                "+ (service_id IS NOT NULL) + (activity_id IS NOT NULL) "
                "+ (location_id IS NOT NULL) > 1"
            )
        )
        assert result.scalar() == 0

        # the both-tags pair exists: a photo carrying T1 AND T2 (AND-demo)
        result = await session.execute(
            text(
                "SELECT COUNT(*) FROM photo_tags pt1 "
                "JOIN photo_tags pt2 ON pt1.photo_id = pt2.photo_id "
                "WHERE pt1.tag_id = 'tag1' AND pt2.tag_id = 'tag2'"
            )
        )
        assert result.scalar() >= 1


async def test_seed_photos_guest_tagged(db_manager: DBManager) -> None:
    """Guest photos (ph6, ph7) are tagged with 'гость'; tag rows total 5.

    photo_tags layout (GH #211): guest ×2 (both activity photos),
    T1+T2 pair (owner-less demo photo), T1 single (one activity photo).
    """
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM photo_tags"))
        assert result.scalar() == 5

        # guest tag (tag7) still marks exactly the 2 activity-owned photos
        result = await session.execute(
            text("SELECT COUNT(*) FROM photo_tags WHERE tag_id = 'tag7'")
        )
        assert result.scalar() == 2


async def test_seed_populates_materials(db_manager: DBManager) -> None:
    """Seed script creates at least 4 materials."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM materials"))
        count = result.scalar()
        assert count >= 4


async def test_seed_has_guest_tag(db_manager: DBManager) -> None:
    """Tag with id 'tag7' exists and has tag 'гость'."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(
            text("SELECT tag FROM tags WHERE id = 'tag7'")
        )
        row = result.one_or_none()
        assert row is not None, "tag7 does not exist"
        assert row[0] == "гость"


async def test_seed_populates_activities(db_manager: DBManager) -> None:
    """Seed script creates 55 activities (three-week + fixed reference week)."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM activities"))
        assert result.scalar() == 55


async def test_seed_populates_clients(db_manager: DBManager) -> None:
    """Seed script creates 5 clients."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM clients"))
        assert result.scalar() == 5


async def test_seed_populates_visitors(db_manager: DBManager) -> None:
    """Seed script creates at least 8 visitors."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM visitors"))
        count = result.scalar()
        assert count >= 8


async def test_seed_populates_records(db_manager: DBManager) -> None:
    """Seed script creates at least 5 records."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM records"))
        count = result.scalar()
        assert count >= 5


async def test_seed_populates_visits(db_manager: DBManager) -> None:
    """Seed script creates at least 8 visits."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM visits"))
        count = result.scalar()
        assert count >= 8


async def test_seed_populates_payments(db_manager: DBManager) -> None:
    """Seed script creates at least 5 payments."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM payments"))
        count = result.scalar()
        assert count >= 5


async def test_seed_raises_on_populated_db(db_manager: DBManager) -> None:
    """Seed is NOT idempotent: running twice on the same DB raises IntegrityError.

    Contract: seed assumes empty DB (see module docstring). E2E test stacks
    wipe the DB before re-seeding. UNIQUE violation is the diagnostic.

    Replaces the old test_seed_is_idempotent which asserted skip-on-exists
    (a contract abolished in #152).
    """
    from src.seed.seed import seed_data
    from sqlalchemy.exc import IntegrityError

    await seed_data(db_manager)  # first run: OK on empty DB

    with pytest.raises(IntegrityError):
        await seed_data(db_manager)  # second run: raises on duplicate PK


async def test_seed_creates_fixed_week_activities(db_manager: DBManager) -> None:
    """Seed creates 10 activities with ev_fixed_ prefix for the fixed reference week."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(
            text("SELECT COUNT(*) FROM activities WHERE id LIKE 'ev_fixed_%'")
        )
        assert result.scalar() == 10


async def test_seed_fixed_week_dates_in_range(db_manager: DBManager) -> None:
    """All fixed-week activities fall within 2026-06-15 to 2026-06-21 (Mon-Sun)."""
    from datetime import datetime as _dt

    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(
            text(
                "SELECT id, start FROM activities WHERE id LIKE 'ev_fixed_%' "
                "ORDER BY id"
            )
        )
        rows = result.all()
        assert len(rows) == 10
        for row in rows:
            # SQLite stores datetime as ISO string; parse it.
            start = _dt.fromisoformat(row.start) if isinstance(row.start, str) else row.start
            assert start.year == 2026, f"{row.id}: expected year 2026, got {start.year}"
            assert start.month == 6, f"{row.id}: expected month 6, got {start.month}"
            assert 15 <= start.day <= 21, (
                f"{row.id}: expected day 15-21, got {start.day}"
            )


async def test_seed_records_link_to_fixed_week(db_manager: DBManager) -> None:
    """Records r1-r6 are linked to fixed-week activities (ev_fixed_*)."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(
            text(
                "SELECT id, activity_id FROM records "
                "WHERE id IN ('r1','r2','r3','r4','r5','r6') ORDER BY id"
            )
        )
        rows = {r.id: r.activity_id for r in result.all()}
        for rid, expected_prefix in [
            ("r1", "ev_fixed_"),
            ("r2", "ev_fixed_"),
            ("r3", "ev_fixed_"),
            ("r4", "ev_fixed_"),
            ("r5", "ev_fixed_"),
            ("r6", "ev_fixed_"),
        ]:
            assert rows[rid].startswith(expected_prefix), (
                f"Record {rid}: expected activity starting with {expected_prefix}, "
                f"got {rows[rid]}"
            )


async def test_seed_records_match_original_master_service(db_manager: DBManager) -> None:
    """Records r1-r6 link to fixed-week activities matching original (master, service) pairs.

    Original mapping:
      r1 → m1/s7 (Морской пейзаж) Mon
      r2 → m2/s5 (Ручная лепка) Mon
      r3 → m3/s2 (Картина акрилом) Tue
      r4 → m1/s3 (Мини-картина акрилом) Tue
      r5 → m1/s7 (Морской пейзаж) Thu
      r6 → m1/s7 (Морской пейзаж) Sat
    """
    from datetime import datetime as _dt

    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(
            text(
                "SELECT r.id AS rid, a.master_id, a.service_id, a.start "
                "FROM records r "
                "JOIN activities a ON r.activity_id = a.id "
                "WHERE r.id IN ('r1','r2','r3','r4','r5','r6') "
                "ORDER BY r.id"
            )
        )
        rows = {r.rid: r for r in result.all()}

        def _parse_dt(val: object) -> _dt:
            """Parse ISO string from SQLite into datetime."""
            return _dt.fromisoformat(val) if isinstance(val, str) else val

        # r1 → m1, s7, Monday (weekday 0)
        assert rows["r1"].master_id == "m1"
        assert rows["r1"].service_id == "s7"
        assert _parse_dt(rows["r1"].start).weekday() == 0  # Monday

        # r2 → m2, s5, Monday (weekday 0)
        assert rows["r2"].master_id == "m2"
        assert rows["r2"].service_id == "s5"
        assert _parse_dt(rows["r2"].start).weekday() == 0

        # r3 → m3, s2, Tuesday (weekday 1)
        assert rows["r3"].master_id == "m3"
        assert rows["r3"].service_id == "s2"
        assert _parse_dt(rows["r3"].start).weekday() == 1

        # r4 → m1, s3, Tuesday (weekday 1)
        assert rows["r4"].master_id == "m1"
        assert rows["r4"].service_id == "s3"
        assert _parse_dt(rows["r4"].start).weekday() == 1

        # r5 → m1, s7, Thursday (weekday 3)
        assert rows["r5"].master_id == "m1"
        assert rows["r5"].service_id == "s7"
        assert _parse_dt(rows["r5"].start).weekday() == 3

        # r6 → m1, s7, Saturday (weekday 5)
        assert rows["r6"].master_id == "m1"
        assert rows["r6"].service_id == "s7"
        assert _parse_dt(rows["r6"].start).weekday() == 5


async def test_seed_handles_month_boundary_overflow(db_manager: DBManager) -> None:
    """Regression for seed.py:286 — day arithmetic must not overflow month boundary.

    Bug: week_start.replace(day=week_start.day + day) raises ValueError when
    the resulting day exceeds the month's length (e.g., June 29 + day=2 = 31,
    but June has only 30 days). The fix must use timedelta or equivalent.

    Triggered by: WEEK3_START computing to 2026-06-29 (a Monday), so day=2
    (Wednesday) gives day=31 which is invalid for June.
    """
    from datetime import datetime

    from src.seed import seed as seed_module
    from src.seed.seed import seed_data

    original_week3 = seed_module.WEEK3_START
    # June has 30 days; 29 + 2 = 31 → ValueError before fix
    seed_module.WEEK3_START = datetime(2026, 6, 29)
    try:
        await seed_data(db_manager)
        async with db_manager.async_session() as session:
            result = await session.execute(text("SELECT COUNT(*) FROM activities"))
            count = result.scalar()
            assert count > 0, "Expected activities to be created after seed"
    finally:
        seed_module.WEEK3_START = original_week3
