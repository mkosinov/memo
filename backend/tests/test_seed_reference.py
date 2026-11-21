"""Tests for the production reference-data loader (``src.seed.reference``).

GH #601 Task 6: the loader must accept and APPLY the location web-visibility
flag ``is_public`` — both polarities, on create AND on the natural-key re-run
(in-place update). A field that is parsed but silently dropped from the
apply whitelist must turn these tests red.

Spec §6 test map — items №1–№3 (issue #612 Task 1 DoD):

№1 sections & assembly — ``test_shipped_csv_template_checks_and_has_linked_specialties``
(all sections load), ``test_each_required_section_is_mandatory``,
``test_tags_section_present_collects_tags`` / ``..._optional_and_absence_...``,
``test_service_children_nest_by_service_title``,
``test_staff_row_without_master_columns_has_no_master_block``,
``test_partial_master_fill_reports_staff_line``,
``test_master_block_requires_specialty_and_color`` (D5).

№2 typing — ``test_service_children_nest_by_service_title`` (int ok + audience
``kid``), ``test_bad_integer_reports_starting_csv_line``,
``test_non_numeric_integer_columns_fail``, ``test_blank_required_integer_columns_fail``,
``test_blank_optional_numeric_columns_become_none``, bool polarities
``test_load_accepts_is_public_both_polarities`` +
``test_boolean_literals_parse_case_insensitive`` / ``test_non_boolean_literal_fails_with_line``
/ ``test_empty_required_boolean_and_audience_are_rejected``, audience invalid —
``test_tariff_audience_invalid_value_russian_error``; quoted ``;`` → positions
assert in the template test.

№3 file mechanics — ``test_csv_bom_crlf_and_case_insensitive_specialty_refs``
(BOM + CRLF branch; every other test runs the no-BOM/LF branch),
``test_blank_separator_lines_are_skipped``,
``test_trailing_empty_header_columns_match_empty_data_cells``,
``test_duplicate_section_marker_fails_with_line``,
``test_unknown_section_and_duplicate_header_report_csv_lines``,
``test_marker_with_non_empty_tail_fails_with_line``,
``test_unclosed_quoted_cell_reports_record_start``,
``test_multiline_quoted_field_error_cites_record_start``.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select

from src.db.base import Base
from src.db.database import DBManager
from src.models import Location, Position
from src.models.enums import TariffAudience
from src.seed.reference import (
    CSV_SECTIONS,
    DEFAULT_CSV,
    REQUIRED_SECTIONS,
    SPECIALTY_MAX,
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
    text = text.replace(";0;пример;True", ";;пример;True")
    csv_path.write_text(text, encoding="utf-8")

    data = load_reference_data(csv_path)
    assert data.services[0].max_age is None
    assert data.staff[0].sort_order is None
    assert data.locations[0].sort_order is None


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


# ---------------------------------------------------------------------------
# Audit vs spec §4 (subtask 1.2): dictionary-section bounds (#599 contract)
# and operator-facing Russian errors for source-typed columns.
# ---------------------------------------------------------------------------


def test_specialty_title_over_column_width_fails_with_line(csv_path: Path) -> None:
    """A dictionary title beyond the String(100) column fails at PARSE time —
    a clean SeedDataError with the record line, not a raw DB error
    (domain rules specialties.md: the SPECIALTY_MAX bound ServiceIn and
    MasterIn already carry, mirrored for the dictionary itself)."""
    text = csv_path.read_text(encoding="utf-8")
    csv_path.write_text(text.replace("\n;Графика", f"\n;{'А' * (SPECIALTY_MAX + 1)}"))

    with pytest.raises(
        SeedDataError, match=rf"строка 36 \(specialty\).*длиннее {SPECIALTY_MAX} символов"
    ):
        load_reference_data(csv_path)


def test_specialty_section_ci_duplicates_fail_load(csv_path: Path) -> None:
    """Two titles equal modulo case are one dictionary row (the DB's
    lower(title) unique index) — the section must not list the pair."""
    text = csv_path.read_text(encoding="utf-8")
    csv_path.write_text(text.replace("\n;Графика", "\n;Графика\n;ГРАФИКА"))

    with pytest.raises(SeedDataError, match=r"строка 37.*дважды"):
        load_reference_data(csv_path)


def test_tariff_audience_invalid_value_russian_error(csv_path: Path) -> None:
    """``audience`` is source-typed (spec §4.4, same league as int/bool):
    anything outside kid/adult/all — including empty — is a Russian
    operator-facing error, not a wrapped English pydantic message."""
    text = csv_path.read_text(encoding="utf-8")
    csv_path.write_text(text.replace(";1000;all", ";1000;подростки"))

    with pytest.raises(SeedDataError, match=r"строка 19 .*kid, adult или all"):
        load_reference_data(csv_path)


def test_extra_column_warning_printed_after_summary(
    csv_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """Extra-column warnings form an end-of-run list (plan Task 1) — printed
    after the loading summary, not inline mid-parse."""
    text = csv_path.read_text(encoding="utf-8")
    text = text.replace(
        ";record_info;tags\n;Линогравюра для примера;Демонстрационная услуга;;Графика;8;;90;;пример",
        ";record_info;tags;legacy_flag\n;Линогравюра для примера;Демонстрационная услуга;;Графика;8;;90;;пример;unused",
    )
    csv_path.write_text(text, encoding="utf-8")

    load_reference_data(csv_path)
    out = capsys.readouterr().out
    assert out.index("лишняя колонка services.legacy_flag") > out.index("локаций")


def test_multiline_quoted_field_error_cites_record_start(csv_path: Path) -> None:
    """A quoted field may span physical lines (spec §4.1); an error inside
    such a record must cite the record's START line (§6 test 3)."""
    text = csv_path.read_text(encoding="utf-8")
    text = text.replace(
        ";Линогравюра для примера;Демонстрационная услуга;;Графика;8;;90;;пример",
        ';Линогравюра для примера;"многострочное\nописание";;Графика;много;;90;;пример',
    )
    csv_path.write_text(text, encoding="utf-8")

    with pytest.raises(SeedDataError, match=r"строка 7 .*min_age"):
        load_reference_data(csv_path)


def test_services_is_public_column_is_extra_and_ignored(
    csv_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """``is_public`` is NOT in the services contract (spec §4.2): the column
    falls under the generic extra-column warning and the model keeps its
    default (GH #606 left services visibility admin-side for the loader)."""
    text = csv_path.read_text(encoding="utf-8")
    text = text.replace(
        ";record_info;tags\n;Линогравюра для примера;Демонстрационная услуга;;Графика;8;;90;;пример",
        ";record_info;tags;is_public\n;Линогравюра для примера;Демонстрационная услуга;;Графика;8;;90;;пример;False",
    )
    csv_path.write_text(text, encoding="utf-8")

    data = load_reference_data(csv_path)
    assert data.services[0].is_public is True
    assert "лишняя колонка services.is_public" in capsys.readouterr().out


# ---------------------------------------------------------------------------
# Spec §6 items №1–№3 completion (issue #612 Task 1.3): section assembly,
# source-side typing, file mechanics. Test map lives in the module docstring.
# ---------------------------------------------------------------------------


def _drop_section(text: str, name: str) -> str:
    """Remove one whole section block (marker line through the line before
    the next marker/EOF) — the missing-section test's mutation."""
    kept: list[str] = []
    skipping = False
    for line in text.splitlines():
        if line.strip() in CSV_SECTIONS:
            skipping = line.strip() == name
            if skipping:
                continue
        if not skipping:
            kept.append(line)
    return "\n".join(kept) + "\n"


@pytest.mark.parametrize("section", sorted(REQUIRED_SECTIONS))
def test_each_required_section_is_mandatory(csv_path: Path, section: str) -> None:
    """Spec §6 №1: any of the eight required sections absent → load error
    naming exactly that section."""
    csv_path.write_text(_drop_section(csv_path.read_text(encoding="utf-8"), section))
    with pytest.raises(
        SeedDataError, match=rf"строка \d+: отсутствуют обязательные секции: {section}$"
    ):
        load_reference_data(csv_path)


def test_tags_section_present_collects_tags() -> None:
    """Spec §6 №1: with the optional ``tags`` section present, the dictionary
    is collected and tag columns assemble into entity tag lists."""
    data = load_reference_data(DEFAULT_CSV)
    assert data.tags == ["пример"]
    assert data.locations[0].tags == ["пример"]
    assert data.services[0].tags == ["пример"]
    assert data.staff[0].master is not None
    assert data.staff[0].master.tags == ["пример"]


def test_service_children_nest_by_service_title(csv_path: Path) -> None:
    """Spec §6 №1: service_materials/tariffs rows nest under the service with
    the matching ``service_title`` — and only under it."""
    text = csv_path.read_text(encoding="utf-8")
    text = text.replace(
        ";Линогравюра для примера;Демонстрационная услуга;;Графика;8;;90;;пример",
        ";Линогравюра для примера;Демонстрационная услуга;;Графика;8;;90;;пример\n"
        ";Керамика для примера;Вторая услуга;;Моделирование;6;;60;;",
    )
    text = text.replace(
        ";Линогравюра для примера;Учебный материал;Для демонстрации связи",
        ";Линогравюра для примера;Учебный материал;Для демонстрации связи\n"
        ";Керамика для примера;Учебный материал;",
    )
    text = text.replace(
        ";Линогравюра для примера;Обычный;Демонстрационный тариф;1000;all",
        ";Линогравюра для примера;Обычный;Демонстрационный тариф;1000;all\n"
        ";Керамика для примера;Льготный;Тариф второй услуги;500;kid",
    )
    csv_path.write_text(text, encoding="utf-8")

    data = load_reference_data(csv_path)
    by_title = {service.title: service for service in data.services}
    assert set(by_title) == {"Линогравюра для примера", "Керамика для примера"}

    linogravure = by_title["Линогравюра для примера"]
    assert [item.title for item in linogravure.materials] == ["Учебный материал"]
    assert [item.title for item in linogravure.tariffs] == ["Обычный"]

    ceramics = by_title["Керамика для примера"]
    assert (ceramics.min_age, ceramics.duration) == (6, 60)
    assert [item.title for item in ceramics.materials] == ["Учебный материал"]
    assert [item.title for item in ceramics.tariffs] == ["Льготный"]
    assert ceramics.tariffs[0].price == 500
    assert ceramics.tariffs[0].audience == TariffAudience.KID


def test_staff_row_without_master_columns_has_no_master_block(csv_path: Path) -> None:
    """Spec §6 №1 / §4.3: every master_* cell empty → no block is assembled
    and the staff person still parses."""
    text = csv_path.read_text(encoding="utf-8")
    csv_path.write_text(
        text.replace(
            ';Алексей;Примеров;0;;"Мастер;Администратор";"Графика;Моделирование";#456789;True;пример',
            ';Алексей;Примеров;0;;"Мастер;Администратор";;;;',
        ),
        encoding="utf-8",
    )

    data = load_reference_data(csv_path)
    assert data.staff[0].master is None
    assert data.staff[0].positions == ["Мастер", "Администратор"]


def test_partial_master_fill_reports_staff_line(csv_path: Path) -> None:
    """Spec §6 №1 / §4.3: partial master_* fill is an explicit error with the
    record's line — both directions plus a tags-only fragment."""
    full = csv_path.read_text(encoding="utf-8")

    csv_path.write_text(full.replace(";#456789;True;пример", ";;True;пример"))
    with pytest.raises(SeedDataError, match=r"строка 23 .*master_color обязателен"):
        load_reference_data(csv_path)

    csv_path.write_text(
        full.replace('"Графика;Моделирование";#456789;True;пример', '"";;;пример'),
        encoding="utf-8",
    )
    with pytest.raises(SeedDataError, match=r"строка 23 .*master_specialty обязателен"):
        load_reference_data(csv_path)


@pytest.mark.parametrize(
    ("original", "replacement", "section", "column", "line"),
    [
        ("Учебный адрес, 1;;12;", "Учебный адрес, 1;;;", "locations", "capacity", 3),
        (";Графика;8;;90;", ";Графика;;;90;", "services", "min_age", 7),
        (";Графика;8;;90;", ";Графика;8;;;", "services", "duration", 7),
        (
            ";Демонстрационный тариф;1000;all",
            ";Демонстрационный тариф;;all",
            "tariffs",
            "price",
            19,
        ),
    ],
)
def test_blank_required_integer_columns_fail(
    csv_path: Path,
    original: str,
    replacement: str,
    section: str,
    column: str,
    line: int,
) -> None:
    """Spec §6 №2 / §4.4: capacity/min_age/duration/price never degrade to 0
    or null — an empty cell is a load error with the record line."""
    text = csv_path.read_text(encoding="utf-8")
    assert original in text
    csv_path.write_text(text.replace(original, replacement), encoding="utf-8")

    with pytest.raises(
        SeedDataError,
        match=rf"строка {line} \({section}\): колонка {column} должна содержать целое число",
    ):
        load_reference_data(csv_path)


@pytest.mark.parametrize(
    ("original", "replacement", "section", "column", "line"),
    [
        (
            "Учебный адрес, 1;;12;",
            "Учебный адрес, 1;;двенадцать;",
            "locations",
            "capacity",
            3,
        ),
        (
            ";Демонстрационный тариф;1000;all",
            ";Демонстрационный тариф;1000р;all",
            "tariffs",
            "price",
            19,
        ),
    ],
)
def test_non_numeric_integer_columns_fail(
    csv_path: Path,
    original: str,
    replacement: str,
    section: str,
    column: str,
    line: int,
) -> None:
    """Spec §6 №2 / §4.4: a non-numeric cell in ANY integer column (not just
    min_age) is a load error with the record line."""
    text = csv_path.read_text(encoding="utf-8")
    assert original in text
    csv_path.write_text(text.replace(original, replacement), encoding="utf-8")

    with pytest.raises(
        SeedDataError,
        match=rf"строка {line} \({section}\): в колонке {column} ожидалось целое число",
    ):
        load_reference_data(csv_path)


def test_boolean_literals_parse_case_insensitive(csv_path: Path) -> None:
    """Spec §6 №2 / §4.4: True/False literals parse in any case, both bool
    columns, both polarities."""
    text = csv_path.read_text(encoding="utf-8")
    text = text.replace(";0;пример;True", ";0;пример;TRUE")
    text = text.replace(";#456789;True;пример", ";#456789;fAlSe;пример")
    csv_path.write_text(text, encoding="utf-8")

    data = load_reference_data(csv_path)
    assert data.locations[0].is_public is True
    assert data.staff[0].master is not None
    assert data.staff[0].master.is_active is False


def test_non_boolean_literal_fails_with_line(csv_path: Path) -> None:
    """Spec §6 №2 / §4.4: anything but True/False (case-insensitive) in a
    bool column is a load error with the record line."""
    text = csv_path.read_text(encoding="utf-8")
    csv_path.write_text(text.replace(";0;пример;True", ";0;пример;да"), encoding="utf-8")

    with pytest.raises(SeedDataError, match=r"строка 3 .*is_public ожидалось True или False"):
        load_reference_data(csv_path)


def test_blank_separator_lines_are_skipped(csv_path: Path) -> None:
    """Spec §6 №3: fully blank rows — mid-section, doubled, or between
    sections — are skipped without corrupting the parsed rows."""
    text = csv_path.read_text(encoding="utf-8")
    text = text.replace(";Мастер\n", ";Мастер\n\n")
    text = text.replace(";Администратор\n", ";Администратор\n\n\n")
    text = text.replace("\nstaff\n", "\n\n\nstaff\n")
    csv_path.write_text(text, encoding="utf-8")

    data = load_reference_data(csv_path)
    assert [item.title for item in data.positions] == ["Мастер", "Администратор"]
    assert data.staff[0].master is not None


def test_duplicate_section_marker_fails_with_line(csv_path: Path) -> None:
    """Spec §6 №3 / §4.1: a second marker of an already-seen section is a
    load error citing the duplicate marker's line."""
    text = csv_path.read_text(encoding="utf-8")
    csv_path.write_text(
        text.replace("\ntags\n", "\nmaterials\n;title\n;Дополнительный материал\n\ntags\n"),
        encoding="utf-8",
    )

    with pytest.raises(SeedDataError, match=r"строка 30: секция materials повторяется"):
        load_reference_data(csv_path)


def test_marker_with_non_empty_tail_fails_with_line(csv_path: Path) -> None:
    """Spec §6 №3 / §4.1: a marker row with a non-empty tail cell is NOT a
    marker — the row errors with its own line number."""
    text = csv_path.read_text(encoding="utf-8")
    csv_path.write_text(text.replace("\nmaterials\n", "\nmaterials;примечание\n"), encoding="utf-8")

    with pytest.raises(SeedDataError, match=r"строка 9 .*первая колонка должна быть пустой"):
        load_reference_data(csv_path)
