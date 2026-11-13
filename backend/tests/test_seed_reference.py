"""Tests for the production reference-data loader (``src.seed.reference``).

GH #601 Task 6: the loader must accept and APPLY the location web-visibility
flag ``is_public`` — both polarities, on create AND on the natural-key re-run
(in-place update). A field that is parsed but silently dropped from the
apply whitelist must turn these tests red.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select

from src.db.base import Base
from src.db.database import DBManager
from src.models import Location, Position
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
