"""GH #599 Task 7 — specialty dictionary in the reference loader (CSV era).

Spec §6 (docs/specs/2026-11-13-specialty-dictionary-599-design.md), migrated
to CSV fixtures by GH #612 Task 4 (spec §4.8 of the CSV-loader design):

* the ``specialty`` section — a flat list of titles; ``_apply_specialties``
  upserts by ``lower(title)`` (the ``_apply_positions`` pattern) and takes a
  list of titles REGARDLESS of the file format — the #612 CSV loader only
  swaps the parser that produces the list.
* ``services.specialty`` stays a title reference, resolved case-insensitively;
  an unknown title → load error naming the value.
* ``staff.master_specialty`` — a ``;``-separated list of title references
  replacing the old singular ``specialty`` key.

Dropped in the CSV migration (with the role's new home):

* the shipped-seed ``--check`` control — the template fixture test in
  ``test_seed_reference.py`` (``test_shipped_csv_template_checks_and_has_linked_specialties``)
  is the single owner of the «shipped template always converges» contract
  (#612 Task 5 formalizes it as spec §6 №8).
* the «old singular ``specialty`` key fails the load» error — the CSV staff
  header has a fixed column set, so an extra ``specialty`` column is a
  WARNING (spec §4.5), not a load error. The meaningful remainder is kept:
  the singular column never feeds the master block (see
  ``test_staff_singular_specialty_column_is_extra_and_ignored``).
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
    SPECIALTY_MAX,
    SeedDataError,
    Summary,
    apply_reference_data,
    load_reference_data,
)

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = pytest.mark.misc

# The #599 fixture data as a CSV (GH #612 §4.8): the specialty dictionary is
# a flat section, the service line references «ЖИВОПИСЬ» (case does not
# matter), the staff master block lists «живопись;КЕРАМИКА».
SPEC_CSV = """\
locations
;title;short_title;address;description;capacity;location_hint;record_info;image_url;yandex_map_url;review_url;sort_order;tags;is_public
;Мастерская примера;Пример;Учебный адрес, 7;;6;;;;;;0;;True

services
;title;description;image_url;specialty;min_age;max_age;duration;record_info;tags
;Картина маслом;Масляная живопись на холсте;;ЖИВОПИСЬ;12;;150;;

materials
;title;description
;Холст из примера;

service_materials
;service_title;material_title;note

tariffs
;service_title;title;description;price;audience

staff
;first_name;last_name;sort_order;avatar_url;positions;master_specialty;master_color;master_is_active;master_tags
;Ольга;Середа;;;;"живопись;КЕРАМИКА";#5B8C7A;True;

positions
;title

tags
;title

specialty
;Живопись
;Керамика
"""


@pytest.fixture
def spec_csv(tmp_path: Path) -> Path:
    """A valid CSV with the specialty-relevant parts cross-referencing."""
    path = tmp_path / "specialties.csv"
    path.write_text(SPEC_CSV, encoding="utf-8")
    return path


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


async def _apply(db_manager: DBManager, csv_path: Path) -> Summary:
    """Load + apply + commit, mirroring the CLI's real (non-dry) run."""
    data = load_reference_data(csv_path)
    summary = Summary()
    async with db_manager.async_session() as session:
        await apply_reference_data(session, data, summary)
        await session.commit()
    return summary


def _mutated(csv_path: Path, original: str, replacement: str) -> Path:
    """Rewrite the fixture with one text mutation, asserting it hit."""
    text = csv_path.read_text(encoding="utf-8")
    assert original in text, f"mutation source not found: {original!r}"
    csv_path.write_text(text.replace(original, replacement), encoding="utf-8")
    return csv_path


# ---------------------------------------------------------------------------
# _apply_specialties — upsert by lower(title)
# ---------------------------------------------------------------------------


async def test_apply_specialties_upserts_by_lower_title(
    db_manager: DBManager, spec_csv: Path
) -> None:
    """A file title that differs only in CASE from an existing row updates
    nothing and creates no duplicate — the match key is ``lower(title)``."""
    async with db_manager.async_session() as session:
        session.add(Specialty(title="Живопись"))
        await session.commit()

    summary = await _apply(db_manager, spec_csv)

    async with db_manager.async_session() as session:
        rows = {row.title for row in (await session.scalars(select(Specialty))).all()}
    # one «Живопись» (DB casing preserved, not duplicated by «живопись»
    # file lines elsewhere) + «Керамика» created by the file
    assert rows == {"Живопись", "Керамика"}
    stats = summary.bucket("Направления")
    assert stats.created == 1
    assert stats.unchanged == 1


def test_specialty_section_ci_duplicates_fail_load(spec_csv: Path) -> None:
    """Two titles equal modulo case are one dictionary row — the section must
    not list the pair (mirrors the DB's lower(title) unique index)."""
    _mutated(spec_csv, "\n;Керамика", "\n;ЖИВОПИСЬ\n;Керамика")

    with pytest.raises(SeedDataError, match=r"строка 31: секция specialty"):
        load_reference_data(spec_csv)


def test_over_long_specialty_title_fails_load(spec_csv: Path) -> None:
    """A dictionary title beyond the String(100) column width fails load
    validation at PARSE time — a clean SeedDataError with the record line,
    not a raw DB error (the bound ServiceIn.specialty already carries,
    mirrored here)."""
    _mutated(spec_csv, "\n;Живопись", f"\n;{'А' * (SPECIALTY_MAX + 1)}")

    with pytest.raises(
        SeedDataError,
        match=rf"строка 30 \(specialty\).*не должно быть длиннее {SPECIALTY_MAX} символов",
    ):
        load_reference_data(spec_csv)


# ---------------------------------------------------------------------------
# services.specialty — title reference, case-insensitive resolve
# ---------------------------------------------------------------------------


async def test_services_specialty_resolves_case_insensitively(
    db_manager: DBManager, spec_csv: Path
) -> None:
    """``specialty: ЖИВОПИСЬ`` links the service to the dictionary row
    «Живопись» (``specialty_id`` FK, not a literal)."""
    await _apply(db_manager, spec_csv)

    async with db_manager.async_session() as session:
        service = (
            await session.scalars(select(Service).where(Service.title == "Картина маслом"))
        ).one()
        specialty = (
            await session.scalars(select(Specialty).where(Specialty.id == service.specialty_id))
        ).one()
    assert specialty.title == "Живопись"


def test_unknown_specialty_in_services_fails_load(spec_csv: Path) -> None:
    """A service referencing a title absent from the specialty section fails
    the load, naming the value (spec §6)."""
    _mutated(spec_csv, ";ЖИВОПИСЬ;12;;150;;", ";Батик;12;;150;;")

    with pytest.raises(SeedDataError) as exc_info:
        load_reference_data(spec_csv)
    message = str(exc_info.value)
    assert message.startswith("строка 7: ")
    assert "направление «Батик» не найдено в справочнике" in message


def test_unknown_specialty_with_empty_specialty_section_fails_load(
    spec_csv: Path,
) -> None:
    """An empty specialty section → every service specialty ref is unknown:
    the error names the value (a silent skip would mask a missing
    dictionary)."""
    _mutated(spec_csv, "specialty\n;Живопись\n;Керамика\n", "specialty\n")

    with pytest.raises(SeedDataError) as exc_info:
        load_reference_data(spec_csv)
    message = str(exc_info.value)
    assert message.startswith("строка 7: ")
    assert "«ЖИВОПИСЬ» не найдено в справочнике" in message


# ---------------------------------------------------------------------------
# staff.master_specialty — the list of title references
# ---------------------------------------------------------------------------


async def test_staff_specialties_apply_links(db_manager: DBManager, spec_csv: Path) -> None:
    """``master_specialty: "живопись;КЕРАМИКА"`` becomes staff_specialties
    links, resolved case-insensitively («КЕРАМИКА» → the row «Керамика»)."""
    await _apply(db_manager, spec_csv)

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


def test_unknown_specialty_in_staff_master_fails_load(spec_csv: Path) -> None:
    """A master block listing an unknown title fails the load, naming it."""
    _mutated(spec_csv, "живопись;КЕРАМИКА", "живопись;Батик")

    with pytest.raises(SeedDataError) as exc_info:
        load_reference_data(spec_csv)
    message = str(exc_info.value)
    assert message.startswith("строка 21: ")
    assert "staff «Ольга Середа»: направление «Батик» не найдено в справочнике" in message


def test_staff_singular_specialty_column_is_extra_and_ignored(
    spec_csv: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """The singular ``specialty`` key has NO place in the CSV staff contract
    (spec §4.2): a column by that name is an extra column — warned about
    (§4.5) and IGNORED, never feeding the master block (the list lives in
    ``master_specialty`` only). The YAML-era «old key fails the load» error
    is gone with the fixed header; this is its meaningful remainder."""
    _mutated(
        spec_csv,
        ";positions;master_specialty;master_color;master_is_active;master_tags",
        ";positions;master_specialty;master_color;master_is_active;master_tags;specialty",
    )
    _mutated(spec_csv, ";#5B8C7A;True;", ";#5B8C7A;True;;Батик")

    data = load_reference_data(spec_csv)

    assert data.staff[0].master is not None
    assert data.staff[0].master.specialties == ["живопись", "КЕРАМИКА"]
    assert "лишняя колонка staff.specialty" in capsys.readouterr().out


def test_staff_master_block_without_specialties_fails_load(spec_csv: Path) -> None:
    """A live master block carries ≥1 specialty (the D5 invariant at file
    level): an empty list is a fill error, not a silently bare section."""
    _mutated(
        spec_csv,
        ';Ольга;Середа;;;;"живопись;КЕРАМИКА";#5B8C7A;True;',
        ";Ольга;Середа;;;;;#5B8C7A;True;",
    )

    with pytest.raises(
        SeedDataError, match=r"строка 21 \(staff\): master_specialty обязателен"
    ):
        load_reference_data(spec_csv)


def test_over_long_staff_specialty_ref_fails_load(spec_csv: Path) -> None:
    """A master-block specialty ref beyond the String(100) width fails load
    validation at PARSE time (the ServiceIn.specialty bound, mirrored) —
    not an unknown-ref cross-check error."""
    _mutated(spec_csv, "живопись;КЕРАМИКА", "А" * (SPECIALTY_MAX + 1))

    with pytest.raises(
        SeedDataError, match=r"строка 21 \(staff\): specialties\.0"
    ) as exc_info:
        load_reference_data(spec_csv)
    assert "at most 100 characters" in str(exc_info.value)
