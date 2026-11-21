"""Tests for the production reference-data loader (``src.seed.reference``).

GH #601 Task 6: the loader must accept and APPLY the location web-visibility
flag ``is_public`` — both polarities, on create AND on the natural-key re-run
(in-place update). A field that is parsed but silently dropped from the
apply whitelist must turn these tests red.

GH #606 (spec §3.6, scenario 10): the same contract for services —
``ServiceIn.is_public`` + the apply whitelist + both polarities in the
shipped ``seed-data/services.yaml`` fixtures.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select

from src.db.base import Base
from src.db.database import DBManager
from src.models import Location, Position, Service, Specialty
from src.seed.reference import (
    DEFAULT_DIR,
    Summary,
    apply_reference_data,
    load_reference_data,
    main,
)

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = pytest.mark.misc

# Fixture template with BOTH polarities — at least one ``is_public: false``
# row, otherwise a loader that silently skips the column stays green.
LOCATIONS_YAML = """\
locations:
  - title: Витрина
    capacity: 10
    is_public: true
  - title: Закулисье
    capacity: 5
    is_public: false
"""


@pytest.fixture
def yaml_dir(tmp_path: Path) -> Path:
    (tmp_path / "locations.yaml").write_text(LOCATIONS_YAML, encoding="utf-8")
    return tmp_path


@pytest.fixture
async def db_manager():
    """In-memory DB: full schema + the migration-seeded built-in positions.

    The loader never creates the schema and requires the ``master``/``admin``
    position rows that the staff-restructuring migration inserts — the
    fixture mirrors that state (loader contract, seed-data README).
    """
    manager = DBManager("sqlite+aiosqlite:///:memory:")
    async with manager.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with manager.async_session() as session:
        session.add(Position(id="master", title="Мастер", is_system=True))
        session.add(Position(id="admin", title="Администратор", is_system=True))
        await session.commit()
    yield manager
    await manager.engine.dispose()


async def _apply(
    db_manager: DBManager, directory: Path
) -> Summary:
    """Load + apply + commit, mirroring the CLI's real (non-dry) run."""
    data = load_reference_data(directory)
    summary = Summary()
    async with db_manager.async_session() as session:
        await apply_reference_data(session, data, summary)
        await session.commit()
    return summary


async def test_load_accepts_is_public_both_polarities(yaml_dir: Path) -> None:
    """``is_public`` parses on both polarities (extra="forbid" accepts it)."""
    data = load_reference_data(yaml_dir)
    by_title = {loc.title: loc.is_public for loc in data.locations}
    assert by_title == {"Витрина": True, "Закулисье": False}


async def test_apply_writes_is_public_both_polarities(
    db_manager: DBManager, yaml_dir: Path
) -> None:
    """Created rows carry the file's polarity, not just the column default."""
    await _apply(db_manager, yaml_dir)

    async with db_manager.async_session() as session:
        rows = {
            loc.title: loc.is_public
            for loc in (await session.scalars(select(Location))).all()
        }
    assert rows == {"Витрина": True, "Закулисье": False}


async def test_re_run_updates_is_public_in_place(
    db_manager: DBManager, yaml_dir: Path
) -> None:
    """Natural-key re-run APPLIES ``is_public`` (whitelisted in the update).

    Pre-existing row «Закулисье» is public in the DB; the file says
    ``is_public: false`` → the update must flip it. A loader that skips the
    column leaves the row untouched (unchanged, not updated).
    """
    async with db_manager.async_session() as session:
        session.add(Location(title="Закулисье", capacity=5, is_public=True))
        await session.commit()

    summary = await _apply(db_manager, yaml_dir)

    async with db_manager.async_session() as session:
        row = (
            await session.scalars(select(Location).where(Location.title == "Закулисье"))
        ).one()
    assert row.is_public is False
    assert summary.bucket("Локации").updated == 1


def test_shipped_locations_yaml_all_public_and_check_converges() -> None:
    """Control: the shipped ``seed-data/`` passes ``--check`` and every
    current location is ``is_public: true`` (spec §2.7: все 3 — true)."""
    data = load_reference_data(DEFAULT_DIR)
    assert len(data.locations) == 3
    assert all(loc.is_public for loc in data.locations), (
        [loc.title for loc in data.locations if not loc.is_public],
    )
    assert main(["--check"]) == 0


# ---------------------------------------------------------------------------
# GH #606 — services ``is_public`` (mirror of the locations section above)
# ---------------------------------------------------------------------------

# GH #599: services.yaml references specialties BY TITLE — the loader
# resolves them case-insensitively against the specialties.yaml
# dictionary (unknown title → load error), so the fixture dir must
# declare every title the services section uses (the
# test_seed_reference_specialties.py pattern).
SPECIALTIES_YAML = """\
specialties:
  - Живопись
  - Керамика
"""

# Fixture template with BOTH polarities — at least one ``is_public: false``
# row, otherwise a loader that silently skips the column stays green.
SERVICES_YAML = """\
services:
  - title: Витринная услуга
    description: "Показывается на сайте"
    image_url: "/images/card-watercolor.jpg"
    specialty: живопись
    min_age: 6
    duration: 90
    record_info: ""
    is_public: true
  - title: Закулисная услуга
    description: "Скрыта с сайта"
    image_url: "/images/card-animals.jpg"
    specialty: керамика
    min_age: 5
    duration: 60
    record_info: ""
    is_public: false
"""


@pytest.fixture
def services_yaml_dir(tmp_path: Path) -> Path:
    (tmp_path / "specialties.yaml").write_text(SPECIALTIES_YAML, encoding="utf-8")
    (tmp_path / "services.yaml").write_text(SERVICES_YAML, encoding="utf-8")
    return tmp_path


async def test_load_accepts_service_is_public_both_polarities(
    services_yaml_dir: Path,
) -> None:
    """Service ``is_public`` parses on both polarities (extra="forbid")."""
    data = load_reference_data(services_yaml_dir)
    by_title = {svc.title: svc.is_public for svc in data.services}
    assert by_title == {"Витринная услуга": True, "Закулисная услуга": False}


async def test_apply_writes_service_is_public_both_polarities(
    db_manager: DBManager, services_yaml_dir: Path
) -> None:
    """Created rows carry the file's polarity, not just the column default."""
    await _apply(db_manager, services_yaml_dir)

    async with db_manager.async_session() as session:
        rows = {
            svc.title: svc.is_public
            for svc in (await session.scalars(select(Service))).all()
        }
    assert rows == {"Витринная услуга": True, "Закулисная услуга": False}


async def test_re_run_updates_service_is_public_in_place(
    db_manager: DBManager, services_yaml_dir: Path
) -> None:
    """Natural-key re-run APPLIES service ``is_public`` (update whitelist).

    Pre-existing row «Закулисная услуга» is public in the DB; the file says
    ``is_public: false`` → the update must flip it. A loader that skips the
    column leaves the row untouched (unchanged, not updated).
    """
    async with db_manager.async_session() as session:
        # GH #599: the direction is a NOT NULL FK — seed the dictionary
        # row first (the yaml «Керамика» upsert then finds it by
        # lower(title), so ``specialty_id`` survives the re-run unchanged)
        # and link the pre-existing service to it (the ORM ``specialty``
        # is a read-only property, not a column).
        session.add(Specialty(id="spec-ceramics", title="Керамика"))
        session.add(
            Service(
                title="Закулисная услуга",
                description="Скрыта с сайта",
                image_url="/images/card-animals.jpg",
                specialty_id="spec-ceramics",
                min_age=5,
                duration=60,
                record_info="",
                is_public=True,
            )
        )
        await session.commit()

    summary = await _apply(db_manager, services_yaml_dir)

    async with db_manager.async_session() as session:
        row = (
            await session.scalars(select(Service).where(Service.title == "Закулисная услуга"))
        ).one()
    assert row.is_public is False
    assert summary.bucket("Услуги").updated == 1


def test_shipped_services_yaml_carries_both_polarities_and_check_converges() -> None:
    """Control: the shipped ``services.yaml`` passes ``--check`` and carries
    BOTH polarities (spec §3.6: минимум одна ``is_public: false`` — иначе
    молчаливый пропуск колонки остаётся зелёным)."""
    data = load_reference_data(DEFAULT_DIR)
    polarities = {svc.is_public for svc in data.services}
    assert polarities == {True, False}, (
        [svc.title for svc in data.services],
    )
    assert main(["--check"]) == 0
