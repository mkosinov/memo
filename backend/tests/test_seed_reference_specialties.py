"""GH #599 Task 7 — specialty dictionary in the reference loader.

Spec §6 (docs/specs/2026-11-13-specialty-dictionary-599-design.md):

* ``specialties.yaml`` — a plain list of titles; ``_apply_specialties``
  upserts by ``lower(title)`` (the ``_apply_positions`` pattern) and takes
  a list of titles REGARDLESS of the file format — the #612 CSV loader
  only swaps the parser that produces the list.
* ``services.yaml`` ``specialty`` stays a title reference, resolved
  case-insensitively; unknown title → load error naming the value.
* ``staff.yaml`` master block: ``specialties: [titles]`` replaces the old
  CSV key ``specialty`` — the old key is a load error (a silent ignore
  would mask typos).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select

from src.db.base import Base
from src.db.database import DBManager
from src.models import Position, Service, Specialty, Staff
from src.models.specialty import staff_specialties
from src.seed.reference import (
    DEFAULT_DIR,
    SeedDataError,
    Summary,
    apply_reference_data,
    load_reference_data,
    main,
)

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = pytest.mark.misc

SPECIALTIES_YAML = """\
specialties:
  - Живопись
  - Керамика
"""

# The service ``specialty`` line is a TITLE REFERENCE — case does not matter
# («ЖИВОПИСЬ» must resolve against the dictionary row «Живопись»).
SERVICES_YAML = """\
services:
  - title: Картина маслом
    description: "Масляная живопись на холсте"
    image_url: "/images/card-seascape.jpg"
    specialty: ЖИВОПИСЬ
    min_age: 12
    max_age: null
    duration: 150
    record_info: ""
    tags: []
    materials: []
    tariffs: []
"""

STAFF_YAML = """\
staff:
  - first_name: Ольга
    last_name: Середа
    positions: []
    master:
      specialties: [живопись, КЕРАМИКА]
      color: "#5B8C7A"
      is_active: true
      tags: []
"""


def _write(directory: Path, name: str, content: str) -> None:
    (directory / name).write_text(content, encoding="utf-8")


@pytest.fixture
def spec_dir(tmp_path: Path) -> Path:
    """All three specialty-relevant files, valid and cross-referencing."""
    _write(tmp_path, "specialties.yaml", SPECIALTIES_YAML)
    _write(tmp_path, "services.yaml", SERVICES_YAML)
    _write(tmp_path, "staff.yaml", STAFF_YAML)
    return tmp_path


@pytest.fixture
async def db_manager():
    """In-memory DB: full schema + the migration-seeded built-in positions
    (the loader requires the ``master``/``admin`` rows — see
    test_seed_reference.py for the rationale)."""
    manager = DBManager("sqlite+aiosqlite:///:memory:")
    async with manager.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with manager.async_session() as session:
        session.add(Position(id="master", title="Мастер", is_system=True))
        session.add(Position(id="admin", title="Администратор", is_system=True))
        await session.commit()
    yield manager
    await manager.engine.dispose()


async def _apply(db_manager: DBManager, directory: Path) -> Summary:
    """Load + apply + commit, mirroring the CLI's real (non-dry) run."""
    data = load_reference_data(directory)
    summary = Summary()
    async with db_manager.async_session() as session:
        await apply_reference_data(session, data, summary)
        await session.commit()
    return summary


# ---------------------------------------------------------------------------
# _apply_specialties — upsert by lower(title)
# ---------------------------------------------------------------------------


async def test_apply_specialties_upserts_by_lower_title(
    db_manager: DBManager, spec_dir: Path
) -> None:
    """A file title that differs only in CASE from an existing row updates
    nothing and creates no duplicate — the match key is ``lower(title)``."""
    async with db_manager.async_session() as session:
        session.add(Specialty(title="Живопись"))
        await session.commit()

    summary = await _apply(db_manager, spec_dir)

    async with db_manager.async_session() as session:
        rows = {row.title for row in (await session.scalars(select(Specialty))).all()}
    # one «Живопись» (DB casing preserved, not duplicated by «живопись»
    # file lines elsewhere) + «Керамика» created by the file
    assert rows == {"Живопись", "Керамика"}
    stats = summary.bucket("Направления")
    assert stats.created == 1
    assert stats.unchanged == 1


async def test_specialties_file_ci_duplicates_fail_load(tmp_path: Path) -> None:
    """Two titles equal modulo case are one dictionary row — the file must
    not list the pair (mirrors the DB's lower(title) unique index)."""
    _write(
        tmp_path,
        "specialties.yaml",
        "specialties:\n  - Живопись\n  - живопись\n",
    )

    with pytest.raises(SeedDataError, match="дважды"):
        load_reference_data(tmp_path)


# ---------------------------------------------------------------------------
# services.yaml — title reference, case-insensitive resolve
# ---------------------------------------------------------------------------


async def test_services_specialty_resolves_case_insensitively(
    db_manager: DBManager, spec_dir: Path
) -> None:
    """``specialty: ЖИВОПИСЬ`` links the service to the dictionary row
    «Живопись» (``specialty_id`` FK, not a literal)."""
    await _apply(db_manager, spec_dir)

    async with db_manager.async_session() as session:
        service = (
            await session.scalars(select(Service).where(Service.title == "Картина маслом"))
        ).one()
        specialty = (
            await session.scalars(select(Specialty).where(Specialty.id == service.specialty_id))
        ).one()
    assert specialty.title == "Живопись"


def test_unknown_specialty_in_services_fails_load(spec_dir: Path) -> None:
    """A service referencing a title absent from specialties.yaml fails the
    load, naming the value (spec §6)."""
    _write(
        spec_dir,
        "services.yaml",
        SERVICES_YAML.replace("specialty: ЖИВОПИСЬ", "specialty: Батик"),
    )

    with pytest.raises(SeedDataError) as exc_info:
        load_reference_data(spec_dir)
    message = str(exc_info.value)
    assert "Батик" in message
    assert "specialties.yaml" in message


def test_unknown_specialty_without_specialties_file_fails_load(
    tmp_path: Path,
) -> None:
    """No specialties.yaml at all → every service specialty ref is unknown:
    the error names the value (a silent skip would mask a missing file)."""
    _write(tmp_path, "services.yaml", SERVICES_YAML)

    with pytest.raises(SeedDataError, match="ЖИВОПИСЬ"):
        load_reference_data(tmp_path)


# ---------------------------------------------------------------------------
# staff.yaml — specialties list replaces the CSV key
# ---------------------------------------------------------------------------


async def test_staff_specialties_apply_links(db_manager: DBManager, spec_dir: Path) -> None:
    """``specialties: [titles]`` becomes staff_specialties links, resolved
    case-insensitively («КЕРАМИКА» → the row «Керамика»)."""
    await _apply(db_manager, spec_dir)

    async with db_manager.async_session() as session:
        staff = (
            await session.scalars(
                select(Staff).where((Staff.first_name == "Ольга") & (Staff.last_name == "Середа"))
            )
        ).one()
        linked = set(
            (
                await session.scalars(
                    select(Specialty.title)
                    .join(
                        staff_specialties,
                        staff_specialties.c.specialty_id == Specialty.id,
                    )
                    .where(staff_specialties.c.staff_id == staff.id)
                )
            ).all()
        )
    assert linked == {"Живопись", "Керамика"}


def test_unknown_specialty_in_staff_master_fails_load(spec_dir: Path) -> None:
    """A master block listing an unknown title fails the load, naming it."""
    _write(
        spec_dir,
        "staff.yaml",
        STAFF_YAML.replace("[живопись, КЕРАМИКА]", "[живопись, Батик]"),
    )

    with pytest.raises(SeedDataError) as exc_info:
        load_reference_data(spec_dir)
    message = str(exc_info.value)
    assert "Батик" in message
    assert "specialties.yaml" in message


def test_staff_old_csv_specialty_key_fails_load(spec_dir: Path) -> None:
    """The old CSV key ``specialty`` (singular, comma-separated) is gone:
    keeping it must FAIL the load — a silent ignore masks the rename
    (spec §6)."""
    _write(
        spec_dir,
        "staff.yaml",
        STAFF_YAML.replace(
            "      specialties: [живопись, КЕРАМИКА]",
            "      specialty: живопись",
        ),
    )

    with pytest.raises(SeedDataError) as exc_info:
        load_reference_data(spec_dir)
    assert "specialty" in str(exc_info.value)


def test_staff_master_block_without_specialties_fails_load(spec_dir: Path) -> None:
    """A live master block carries ≥1 specialty (the D5 invariant at file
    level): an empty list is a fill error, not a silently bare section."""
    _write(
        spec_dir,
        "staff.yaml",
        STAFF_YAML.replace("[живопись, КЕРАМИКА]", "[]"),
    )

    with pytest.raises(SeedDataError):
        load_reference_data(spec_dir)


# ---------------------------------------------------------------------------
# Control: the shipped templates converge
# ---------------------------------------------------------------------------


def test_shipped_seed_data_specialties_check_converges() -> None:
    """The shipped ``seed-data/`` mirrors the dev seed dictionary and passes
    ``--check`` (staff.yaml already on the ``specialties`` list key)."""
    data = load_reference_data(DEFAULT_DIR)
    assert data.specialties == ["Живопись", "Керамика", "Декор"]
    assert main(["--check"]) == 0
