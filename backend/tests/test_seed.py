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


async def test_seed_tariff_audiences_match_titles(db_manager: DBManager) -> None:
    """GH #284: seeded tariff audience agrees with the title.

    «Взрослый» → adult, «Детский» → kid, the neutral «Индивидуальный» → all
    (same rule as the migration backfill), so demo data exercises the
    age-autofill feature.
    """
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT title, audience FROM tariffs"))
        expected = {"Взрослый": "adult", "Детский": "kid", "Индивидуальный": "all"}
        rows = result.all()
        assert len(rows) == 21
        for row in rows:
            assert row.audience == expected[row.title], (
                f"Tariff «{row.title}» has audience={row.audience!r}"
            )


async def test_seed_populates_tags(db_manager: DBManager) -> None:
    """Seed script creates exactly 7 tags (including 'гость')."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM tags"))
        assert result.scalar() == 7


async def test_seed_services_have_image_url(db_manager: DBManager) -> None:
    """Each seeded service has non-empty image_url."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT id, image_url FROM services"))
        rows = result.all()
        assert len(rows) == 7
        for row in rows:
            assert row.image_url, f"Service {row.id} missing image_url"


async def test_seed_services_have_no_material_hint_column(
    db_manager: DBManager,
) -> None:
    """GH #223 Task 13: services.material_hint is dropped from the schema."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        # pragma_table_info lists the live columns of `services`; the
        # assertion is that the dropped column no longer appears in them.
        result = await session.execute(
            text("SELECT name FROM pragma_table_info('services')")
        )
        columns = {row.name for row in result}
        assert "material_hint" not in columns


async def test_seed_service_materials_exist(db_manager: DBManager) -> None:
    """GH #223 Task 13: seed links services to materials (spec §10 seeds).

    At least 3 links exist; at least one carries a note (dev/demo data must
    exercise the per-link note); services read back with non-empty materials.
    """
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(
            text("SELECT COUNT(*) FROM service_materials")
        )
        total = result.scalar()
        assert total >= 3, f"expected >=3 service_materials links, got {total}"

        # Services read back with non-empty materials (distinct linked services).
        result = await session.execute(
            text("SELECT COUNT(DISTINCT service_id) FROM service_materials")
        )
        linked_services = result.scalar()
        assert linked_services >= 3, (
            f"expected >=3 distinct services with non-empty materials, "
            f"got {linked_services}"
        )

        result = await session.execute(
            text("SELECT COUNT(*) FROM service_materials WHERE note IS NOT NULL")
        )
        with_note = result.scalar()
        assert with_note >= 1, "expected at least one link with a note"

        # Every link resolves to existing seeded rows (no dangling FKs).
        result = await session.execute(
            text(
                "SELECT COUNT(*) FROM service_materials sm "
                "WHERE NOT EXISTS (SELECT 1 FROM services s WHERE s.id = sm.service_id) "
                "OR NOT EXISTS (SELECT 1 FROM materials m WHERE m.id = sm.material_id)"
            )
        )
        assert result.scalar() == 0


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
    """Seed script creates 9 photos with mutually exclusive owners (GH #211).

    Layout: 3 client-owned by c1 (2 public + 1 private — the #513 cabinet
    delta), 1 client-owned by c2 (private — second-client isolation С2),
    1 service-owned, 2 activity-owned (guest photos, activities co-located
    at L1='alpika'), 1 location-owned (L1 interior shot), 1 owner-less
    tag-pair photo ([T1=tag1, T2=tag2]).
    """
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM photos"))
        assert result.scalar() == 9

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

        # the both-tags pair exists: a photo carrying T1 AND T2 (AND-demo) —
        # tags resolved by title; tag ids are UUIDs now (GH #491)
        result = await session.execute(
            text(
                "SELECT COUNT(*) FROM photo_tags pt1 "
                "JOIN photo_tags pt2 ON pt1.photo_id = pt2.photo_id "
                "JOIN tags t1 ON t1.id = pt1.tag_id "
                "JOIN tags t2 ON t2.id = pt2.tag_id "
                "WHERE t1.title = 'новинка' AND t2.title = 'хит'"
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

        # guest tag («гость») still marks exactly the 2 activity-owned photos
        result = await session.execute(
            text(
                "SELECT COUNT(*) FROM photo_tags pt "
                "JOIN tags t ON t.id = pt.tag_id "
                "WHERE t.title = 'гость'"
            )
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
    """The guest tag (title 'гость'; former alias tag7) exists exactly once."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(
            text("SELECT COUNT(*) FROM tags WHERE title = 'гость'")
        )
        assert result.scalar() == 1, "guest tag does not exist"


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
    from sqlalchemy.exc import IntegrityError

    from src.seed.seed import seed_data

    await seed_data(db_manager)  # first run: OK on empty DB

    with pytest.raises(IntegrityError):
        await seed_data(db_manager)  # second run: raises on duplicate PK


async def test_seed_creates_fixed_week_activities(db_manager: DBManager) -> None:
    """Seed creates 10 activities in the fixed reference week (2026-06-15..21)."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(
            text(
                "SELECT COUNT(*) FROM activities "
                "WHERE start >= '2026-06-15' AND start < '2026-06-22'"
            )
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
                "SELECT start FROM activities "
                "WHERE start >= '2026-06-15' AND start < '2026-06-22' "
                "ORDER BY start"
            )
        )
        rows = result.all()
        assert len(rows) == 10
        for row in rows:
            # SQLite stores datetime as ISO string; parse it.
            start = _dt.fromisoformat(row.start) if isinstance(row.start, str) else row.start
            assert start.year == 2026, f"{start}: expected year 2026"
            assert start.month == 6, f"{start}: expected month 6"
            assert 15 <= start.day <= 21, (
                f"{start}: expected day 15-21"
            )


async def test_seed_activities_pinned_to_functional_weeks(db_manager: DBManager) -> None:
    """GH #422: all ev_* activities land exactly in the three fixed weeks.

    Guard canon #341: expected spans and counts are LITERALS here —
    deliberately NOT imported from the seed's WEEK_*/FUNC_WEEK_START
    constants, so editing a seed week constant fails loudly in this test
    instead of silently following the constant (importing them would make
    the guard vacuous).

    ev_* spans (inclusive Mon…Sun), counts from the seed's week lists:
      week 1 (WEEK_START):  2026-05-18…24 — 28 activities
      week 2 (WEEK2_START): 2026-05-25…31 —  8 activities
      week 3 (WEEK3_START): 2026-06-01…07 —  9 activities
    Together with the 10 ev_fixed_* in 2026-06-15…21 (guarded above) these
    account for every seeded activity: nothing may sit outside all four
    spans (the 2026-06-08…14 gap included).
    """
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(
            text(
                "SELECT CASE "
                "WHEN start >= '2026-05-18' AND start < '2026-05-25' THEN 'w1' "
                "WHEN start >= '2026-05-25' AND start < '2026-06-01' THEN 'w2' "
                "WHEN start >= '2026-06-01' AND start < '2026-06-08' THEN 'w3' "
                "WHEN start >= '2026-06-15' AND start < '2026-06-22' THEN 'fixed' "
                "ELSE 'outside' END AS bucket, COUNT(*) AS n "
                "FROM activities GROUP BY bucket"
            )
        )
        buckets = {row.bucket: row.n for row in result}

    expected = {"w1": 28, "w2": 8, "w3": 9, "fixed": 10}
    assert buckets == expected, (
        f"Seed activity week distribution drifted from the fixed weeks "
        f"(expected {expected}, got {buckets})"
    )


async def test_seed_photos_fixed_dates(db_manager: DBManager) -> None:
    """Seed photos carry fixed rising created_at (2026-06-15..23, noon).

    Guard test: expectations are hardcoded literals ON PURPOSE (not imported
    from PHOTO_FIXED_DATES) so a later edit of the seed constant fails loudly
    here instead of silently passing. Rising dates are the determinism
    contract behind DESC ordering of the photos feed.
    """
    from datetime import datetime as _dt

    from src.seed.seed import seed_data

    await seed_data(db_manager)

    expected: list[_dt] = [
        _dt(2026, 6, 15, 12, 0, 0),
        _dt(2026, 6, 16, 12, 0, 0),
        _dt(2026, 6, 17, 12, 0, 0),
        _dt(2026, 6, 18, 12, 0, 0),
        _dt(2026, 6, 19, 12, 0, 0),
        _dt(2026, 6, 20, 12, 0, 0),
        _dt(2026, 6, 21, 12, 0, 0),
        _dt(2026, 6, 22, 12, 0, 0),
        _dt(2026, 6, 23, 12, 0, 0),
    ]

    async with db_manager.async_session() as session:
        result = await session.execute(
            text("SELECT created_at FROM photos ORDER BY created_at")
        )
        rows = result.all()
        assert len(rows) == 9

        dates: list[_dt] = []
        for row in rows:
            # SQLite stores datetime as ISO string; parse it.
            created_at = (
                _dt.fromisoformat(row.created_at)
                if isinstance(row.created_at, str)
                else row.created_at
            )
            dates.append(created_at)

        # Determinism contract: the exact date set, strictly rising order.
        assert dates == expected, f"Photo created_at set drifted, got {dates}"
        assert len(set(dates)) == 9, "Photo created_at values must be unique"


async def test_seed_cabinet_photos_delta(db_manager: DBManager) -> None:
    """#513 cabinet seed delta: c1 owns ONE non-public photo (С3 — the
    cabinet shows it with «Не опубликовано», the guest gallery must not
    show it), c2 owns ONE photo (С2 — second-client isolation on the
    photos screen; c2 already carries record+visit+payment).

    Everything else stays public — the public gallery feed is unchanged
    by this delta. No new tag links ride along (photo_tags stays at 5).
    Expectations are hardcoded literals ON PURPOSE (guard-test canon,
    same as the fixed-dates pin above).
    """
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        # c1 «Анна Иванова»: 3 photos total — 2 public (ph1, ph2) +
        # exactly 1 private with the pinned filename.
        result = await session.execute(
            text(
                "SELECT filename, is_public FROM photos "
                "WHERE client_id = (SELECT id FROM clients "
                "WHERE phone = '+79001234567') ORDER BY created_at"
            )
        )
        c1_rows = result.all()
        assert len(c1_rows) == 3
        assert [row.is_public for row in c1_rows] == [True, True, False]
        assert c1_rows[-1].filename == "/images/cabinet-draft.jpg"

        # c2 «Мария Петрова»: exactly 1 photo, non-public, pinned filename.
        result = await session.execute(
            text(
                "SELECT filename, is_public FROM photos "
                "WHERE client_id = (SELECT id FROM clients "
                "WHERE phone = '+79002345678')"
            )
        )
        c2_rows = result.all()
        assert len(c2_rows) == 1
        assert not c2_rows[0].is_public
        assert c2_rows[0].filename == "/images/maria-canvas.jpg"

        # Public gallery is untouched: exactly the 7 original photos.
        result = await session.execute(
            text("SELECT COUNT(*) FROM photos WHERE is_public = 1")
        )
        assert result.scalar() == 7

        # No tag links on the delta rows (photo_tags stays at 5).
        result = await session.execute(text("SELECT COUNT(*) FROM photo_tags"))
        assert result.scalar() == 5


async def test_seed_records_link_to_fixed_week(db_manager: DBManager) -> None:
    """All 6 seed records link to fixed-week activities (2026-06-15..21)."""
    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(
            text(
                "SELECT r.id, a.start FROM records r "
                "JOIN activities a ON r.activity_id = a.id"
            )
        )
        rows = result.all()
        assert len(rows) == 6
        for row in rows:
            start = str(row.start)
            assert "2026-06-15" <= start[:10] <= "2026-06-21", (
                f"Record {row.id}: activity outside the fixed week, start={start}"
            )


async def test_seed_records_match_original_master_service(db_manager: DBManager) -> None:
    """Seed records link to fixed-week activities matching original (master, service) pairs.

    Original mapping (aliases → business keys; ids are UUIDs now, so the
    pairs are pinned by client name + service title + staff last name):
      r1 → Середа/Морской пейзаж Mon   (client Анна Иванова)
      r2 → Большакова/Ручная лепка Mon (client Мария Петрова)
      r3 → П./Картина акрилом Tue      (client Елена Сидорова)
      r4 → Середа/Мини-картина акрилом Tue (client Анна Иванова)
      r5 → Середа/Морской пейзаж Thu   (client Ольга Новикова)
      r6 → Середа/Морской пейзаж Sat   (client Дмитрий Козлов)
    """
    from datetime import datetime as _dt

    from src.seed.seed import seed_data

    await seed_data(db_manager)

    async with db_manager.async_session() as session:
        result = await session.execute(
            text(
                "SELECT c.name AS client_name, s.title AS service_title, "
                "st.last_name AS master_last_name, a.start AS start "
                "FROM records r "
                "JOIN activities a ON r.activity_id = a.id "
                "JOIN services s ON a.service_id = s.id "
                "JOIN staff st ON a.master_id = st.id "
                "JOIN clients c ON r.client_id = c.id"
            )
        )
        rows = result.all()

        def _parse_dt(val: object) -> _dt:
            """Parse ISO string from SQLite into datetime."""
            return _dt.fromisoformat(val) if isinstance(val, str) else val

        expected: set[tuple[str, str, str, int]] = {
            ("Анна Иванова", "Морской пейзаж", "Середа", 0),      # r1
            ("Мария Петрова", "Ручная лепка", "Большакова", 0),   # r2
            ("Елена Сидорова", "Картина акрилом", "П.", 1),       # r3
            ("Анна Иванова", "Мини-картина акрилом", "Середа", 1),  # r4
            ("Ольга Новикова", "Морской пейзаж", "Середа", 3),    # r5
            ("Дмитрий Козлов", "Морской пейзаж", "Середа", 5),    # r6
        }
        actual = {
            (r.client_name, r.service_title, r.master_last_name,
             _parse_dt(r.start).weekday())
            for r in rows
        }
        assert actual == expected


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
