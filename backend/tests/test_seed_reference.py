"""Tests for the production reference-data loader (``src.seed.reference``).

GH #601 Task 6: the loader must accept and APPLY the location web-visibility
flag ``is_public`` — both polarities, on create AND on the natural-key re-run
(in-place update). A field that is parsed but silently dropped from the
apply whitelist must turn these tests red.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select

from src.db.base import Base
from src.db.database import DBManager
from src.models import Location, Position
from src.seed.reference import (
    DEFAULT_CSV,
    SeedDataError,
    Summary,
    apply_reference_data,
    load_reference_data,
    main,
)

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = pytest.mark.misc


@pytest.fixture
def csv_path(tmp_path: Path) -> Path:
    path = tmp_path / "reference.csv"
    path.write_text(DEFAULT_CSV.read_text(encoding="utf-8"), encoding="utf-8")
    return path


@pytest.fixture
def both_public_values(csv_path: Path) -> Path:
    text = csv_path.read_text(encoding="utf-8")
    public_row = ";Примерная мастерская;Пример;Учебный адрес, 1;;12;;;;;;0;пример;True"
    hidden_row = ";Скрытая мастерская;Скрытая;Учебный адрес, 2;;5;;;;;;1;;False"
    csv_path.write_text(
        text.replace(public_row, f"{public_row}\n{hidden_row}"),
        encoding="utf-8",
    )
    return csv_path


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


async def _apply(db_manager: DBManager, csv_path: Path) -> Summary:
    """Load + apply + commit, mirroring the CLI's real (non-dry) run."""
    data = load_reference_data(csv_path)
    summary = Summary()
    async with db_manager.async_session() as session:
        await apply_reference_data(session, data, summary)
        await session.commit()
    return summary


async def test_load_accepts_is_public_both_polarities(both_public_values: Path) -> None:
    """is_public parses on both polarities."""
    data = load_reference_data(both_public_values)
    by_title = {loc.title: loc.is_public for loc in data.locations}
    assert by_title == {"Примерная мастерская": True, "Скрытая мастерская": False}


async def test_apply_writes_is_public_both_polarities(
    db_manager: DBManager, both_public_values: Path
) -> None:
    """Created rows carry the file's polarity, not just the column default."""
    await _apply(db_manager, both_public_values)

    async with db_manager.async_session() as session:
        rows = {loc.title: loc.is_public for loc in (await session.scalars(select(Location))).all()}
    assert rows == {"Примерная мастерская": True, "Скрытая мастерская": False}


async def test_re_run_updates_is_public_in_place(
    db_manager: DBManager, both_public_values: Path
) -> None:
    """Natural-key re-run APPLIES ``is_public`` (whitelisted in the update).

    Pre-existing row «Закулисье» is public in the DB; the file says
    ``is_public: false`` → the update must flip it. A loader that skips the
    column leaves the row untouched (unchanged, not updated).
    """
    async with db_manager.async_session() as session:
        session.add(Location(title="Скрытая мастерская", capacity=5, is_public=True))
        await session.commit()

    summary = await _apply(db_manager, both_public_values)

    async with db_manager.async_session() as session:
        row = (
            await session.scalars(select(Location).where(Location.title == "Скрытая мастерская"))
        ).one()
    assert row.is_public is False
    assert summary.bucket("Локации").updated == 1


def test_shipped_csv_template_checks_and_has_linked_specialties() -> None:
    data = load_reference_data(DEFAULT_CSV)
    assert len(data.locations) == 1
    assert all(loc.is_public for loc in data.locations)
    assert data.specialties == ["Моделирование", "Графика"]
    assert data.services[0].specialty == "Графика"
    assert [item.title for item in data.services[0].materials] == ["Учебный материал"]
    assert [item.title for item in data.services[0].tariffs] == ["Обычный"]
    assert data.staff[0].master is not None
    assert data.staff[0].master.specialties == ["Графика", "Моделирование"]
    assert data.staff[0].positions == ["Мастер", "Администратор"]
    assert main(["--csv", str(DEFAULT_CSV), "--check"]) == 0


def test_csv_bom_crlf_and_case_insensitive_specialty_refs(csv_path: Path) -> None:
    text = csv_path.read_text(encoding="utf-8")
    text = text.replace(";Графика;8;;90;;пример", ";гРАФИКА;8;;90;;пример")
    text = text.replace('"Графика;Моделирование"', '"гРАФИКА;мОДЕЛИРОВАНИЕ"')
    csv_path.write_text("\ufeff" + text.replace("\n", "\r\n"), encoding="utf-8")

    data = load_reference_data(csv_path)
    assert data.services[0].specialty == "гРАФИКА"
    assert data.staff[0].master is not None
    assert data.staff[0].master.specialties == ["гРАФИКА", "мОДЕЛИРОВАНИЕ"]


def test_tags_section_is_optional_and_absence_clears_tag_lists(csv_path: Path) -> None:
    text = csv_path.read_text(encoding="utf-8")
    text = text.replace(";0;пример;True", ";0;;True")
    text = text.replace(";90;;пример", ";90;;")
    text = text.replace(";#456789;True;пример", ";#456789;True;")
    text = text.replace("\ntags\n;title\n;пример\n\nspecialty", "\nspecialty")
    csv_path.write_text(text, encoding="utf-8")

    data = load_reference_data(csv_path)
    assert data.tags == []
    assert data.locations[0].tags == []
    assert data.services[0].tags == []
    assert data.staff[0].master is not None
    assert data.staff[0].master.tags == []


def test_blank_optional_numeric_columns_become_none(csv_path: Path) -> None:
    text = csv_path.read_text(encoding="utf-8")
    text = text.replace(";Алексей;Примеров;0;;", ";Алексей;Примеров;;;")
    csv_path.write_text(text, encoding="utf-8")

    data = load_reference_data(csv_path)
    assert data.services[0].max_age is None
    assert data.staff[0].sort_order is None


def test_empty_required_boolean_and_audience_are_rejected(csv_path: Path) -> None:
    text = csv_path.read_text(encoding="utf-8")
    csv_path.write_text(text.replace(";0;пример;True", ";0;пример;"))
    with pytest.raises(SeedDataError, match=r"строка .*is_public"):
        load_reference_data(csv_path)

    text = DEFAULT_CSV.read_text(encoding="utf-8")
    csv_path.write_text(
        text.replace(
            ";Обычный;Демонстрационный тариф;1000;all", ";Обычный;Демонстрационный тариф;1000;"
        )
    )
    with pytest.raises(SeedDataError, match=r"строка .*audience"):
        load_reference_data(csv_path)


def test_blank_master_active_defaults_to_true(csv_path: Path) -> None:
    text = csv_path.read_text(encoding="utf-8")
    csv_path.write_text(text.replace(";#456789;True;пример", ";#456789;;пример"))

    data = load_reference_data(csv_path)
    assert data.staff[0].master is not None
    assert data.staff[0].master.is_active is True


def test_bad_integer_reports_starting_csv_line(csv_path: Path) -> None:
    text = csv_path.read_text(encoding="utf-8")
    csv_path.write_text(text.replace(";Графика;8;;90;;пример", ";Графика;много;;90;;пример"))

    with pytest.raises(SeedDataError, match=r"строка 7 .*min_age"):
        load_reference_data(csv_path)


def test_unknown_staff_position_fails_during_check(csv_path: Path) -> None:
    text = csv_path.read_text(encoding="utf-8")
    text = text.replace(
        ';Алексей;Примеров;0;;"Мастер;Администратор";',
        ";Алексей;Примеров;0;;Неизвестная;",
    )
    csv_path.write_text(text, encoding="utf-8")

    with pytest.raises(SeedDataError, match=r"строка .*Неизвестная.*секц.*positions"):
        load_reference_data(csv_path)


def test_master_block_requires_specialty_and_color(csv_path: Path) -> None:
    text = csv_path.read_text(encoding="utf-8")
    csv_path.write_text(text.replace('"Графика;Моделирование";#456789', '"";#456789'))

    with pytest.raises(SeedDataError, match="master_specialty обязателен"):
        load_reference_data(csv_path)


def test_unknown_section_and_duplicate_header_report_csv_lines(csv_path: Path) -> None:
    text = csv_path.read_text(encoding="utf-8")
    csv_path.write_text(text.replace("\nmaterials\n", "\nunknown_section\n"))
    with pytest.raises(SeedDataError, match=r"строка 9: неизвестная секция"):
        load_reference_data(csv_path)

    text = DEFAULT_CSV.read_text(encoding="utf-8")
    csv_path.write_text(
        text.replace(
            ";title;description;image_url;specialty;min_age;max_age;duration;record_info;tags",
            ";title;description;image_url;specialty;min_age;max_age;duration;record_info;tags;tags",
        )
    )
    with pytest.raises(SeedDataError, match=r"строка 6 .*повтор колонки tags"):
        load_reference_data(csv_path)


def test_unclosed_quoted_cell_reports_record_start(csv_path: Path) -> None:
    text = csv_path.read_text(encoding="utf-8")
    csv_path.write_text(text.replace("Демонстрационная услуга", '"Демонстрационная услуга'))

    with pytest.raises(SeedDataError, match=r"строка 7: ошибка CSV"):
        load_reference_data(csv_path)


def test_extra_column_is_reported_and_ignored(
    csv_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    text = csv_path.read_text(encoding="utf-8")
    text = text.replace(
        ";record_info;tags\n;Линогравюра для примера;Демонстрационная услуга;;Графика;8;;90;;пример",
        ";record_info;tags;legacy_flag\n;Линогравюра для примера;Демонстрационная услуга;;Графика;8;;90;;пример;unused",
    )
    csv_path.write_text(text, encoding="utf-8")

    data = load_reference_data(csv_path)
    assert data.services[0].title == "Линогравюра для примера"
    assert "services.legacy_flag" in capsys.readouterr().out


def test_trailing_empty_header_columns_match_empty_data_cells(csv_path: Path) -> None:
    lines = csv_path.read_text(encoding="utf-8").splitlines()
    active: str | None = None
    for index, line in enumerate(lines):
        if line == "services":
            active = "services"
        elif line and not line.startswith(";"):
            active = None
        if active == "services" and line.startswith(";"):
            lines[index] += ";;"
    csv_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    data = load_reference_data(csv_path)
    assert data.services[0].title == "Линогравюра для примера"


def test_unmatched_extra_data_cell_is_rejected(csv_path: Path) -> None:
    text = csv_path.read_text(encoding="utf-8")
    text = text.replace(
        ";Линогравюра для примера;Демонстрационная услуга;;Графика;8;;90;;пример",
        ";Линогравюра для примера;Демонстрационная услуга;;Графика;8;;90;;пример;",
    )
    csv_path.write_text(text, encoding="utf-8")

    with pytest.raises(SeedDataError, match=r"строка 7 .*колонок данных, в шапке 9"):
        load_reference_data(csv_path)


def test_dry_run_rolls_back_all_csv_writes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    database_path = tmp_path / "dry-run.db"
    database_url = f"sqlite+aiosqlite:///{database_path}"

    async def create_schema() -> None:
        manager = DBManager(database_url)
        async with manager.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with manager.async_session() as session:
            session.add(Position(id="master", title="Мастер", is_system=True))
            session.add(Position(id="admin", title="Администратор", is_system=True))
            await session.commit()
        await manager.engine.dispose()

    async def assert_no_locations() -> None:
        manager = DBManager(database_url)
        async with manager.async_session() as session:
            assert list((await session.scalars(select(Location))).all()) == []
        await manager.engine.dispose()

    asyncio.run(create_schema())

    monkeypatch.setenv("DATABASE_URL", database_url)
    assert main(["--csv", str(DEFAULT_CSV), "--dry-run"]) == 0
    asyncio.run(assert_no_locations())


def test_missing_section_is_reported_with_csv_line(csv_path: Path) -> None:
    text = csv_path.read_text(encoding="utf-8")
    csv_path.write_text(text.replace("\nspecialty\n;Моделирование\n;Графика\n", ""))

    with pytest.raises(
        SeedDataError, match=r"строка .* отсутствуют обязательные секции: specialty"
    ):
        load_reference_data(csv_path)
