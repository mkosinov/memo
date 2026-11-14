"""Production reference-data loader — owner-maintained CSV.

Fills the *reference* tables only: tags, materials, positions, locations,
services (+ tariffs, tag links, material links), staff (+ master extensions,
position links, master tag links). Operational data (activities, clients,
records, visits, payments) is NOT created — that is the dev seed's job
(``src.seed.seed``).

Contract:

* **Idempotent.** Every row is matched by its natural key — ``title`` for
  dictionaries, ``first_name + last_name`` for staff — so a re-run updates
  rows in place instead of duplicating them. Renaming a title after the first
  load creates a NEW row: rename through the admin UI instead.
* **All-or-nothing.** One transaction; any validation or DB error rolls the
  whole load back.
* **Non-destructive for children.** Tariffs that exist in the DB but are
  absent from the file are left untouched (reported as a warning). Tag /
  material / position links are synced as an exact set (the file is the
  source of truth).
* **Schema is never created.** Run ``alembic upgrade head`` first; the loader
  only writes rows.

Usage (from ``backend/``)::

    uv run python -m src.seed.reference --csv <file.csv> --check
    uv run python -m src.seed.reference --csv <file.csv> --dry-run
    uv run python -m src.seed.reference --csv <file.csv>

``DATABASE_URL`` selects the database (same default as the dev seed).
"""

# ruff: noqa: RUF001  -- Russian operator-facing messages

from __future__ import annotations

import argparse
import asyncio
import csv
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy import delete, select
from sqlalchemy.exc import OperationalError

from src.db.database import DBManager
from src.models import Location, Master, Material, Position, Service, Staff, Tag, Tariff
from src.models.enums import TariffAudience
from src.models.position import staff_positions
from src.models.service_material import ServiceMaterial
from src.models.tag import location_tags, master_tags, service_tags

if TYPE_CHECKING:
    from collections.abc import Mapping
    from typing import Any, Self

    from sqlalchemy import Table
    from sqlalchemy.ext.asyncio import AsyncSession

DEFAULT_CSV = Path(__file__).resolve().parents[2] / "seed-data" / "prod-seed-template.csv"

# Built-in positions, seeded by the staff-restructuring migration under fixed
# string ids (``master``/``admin``). Titles are that migration's defaults; the
# role template anchors on the ids, so these rows must never be re-created.
BUILTIN_POSITION_IDS = ("master", "admin")
BUILTIN_POSITION_TITLES = frozenset({"Мастер", "Администратор"})


class SeedDataError(Exception):
    """Invalid template file or unresolvable cross-reference."""


# ---------------------------------------------------------------------------
# Parsed rows use the same typed models as the database writer.
# ---------------------------------------------------------------------------


class _In(BaseModel):
    """Shared config of every template row."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class TariffIn(_In):
    title: str = Field(min_length=1, max_length=100)
    description: str | None = None
    price: int = Field(ge=0)
    audience: TariffAudience = TariffAudience.ALL


class MaterialLinkIn(_In):
    title: str = Field(min_length=1, max_length=200)
    note: str | None = None


class LocationIn(_In):
    title: str = Field(min_length=1, max_length=100)
    short_title: str | None = Field(default=None, max_length=50)
    address: str | None = None
    description: str | None = None
    capacity: int = Field(ge=0)
    # GH #601: false hides the location from the client site only.
    is_public: bool = True
    yandex_map_url: str | None = None
    review_url: str | None = None
    record_info: str | None = None
    image_url: str | None = None
    location_hint: str | None = None
    sort_order: int | None = None
    tags: list[str] = Field(default_factory=list)


class ServiceIn(_In):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    image_url: str = ""
    specialty: str = Field(min_length=1)
    min_age: int = Field(ge=0)
    max_age: int | None = Field(default=None, ge=0)
    duration: int = Field(gt=0)
    record_info: str = ""
    tags: list[str] = Field(default_factory=list)
    tariffs: list[TariffIn] = Field(default_factory=list)
    materials: list[MaterialLinkIn] = Field(default_factory=list)

    @model_validator(mode="after")
    def _age_range(self) -> Self:
        if self.max_age is not None and self.max_age < self.min_age:
            raise ValueError("max_age не может быть меньше min_age")
        return self


class MaterialIn(_In):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""


class PositionIn(_In):
    title: str = Field(min_length=1, max_length=100)


class MasterIn(_In):
    specialties: list[str] = Field(min_length=1)
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    is_active: bool = True
    tags: list[str] = Field(default_factory=list)

    @property
    def specialty(self) -> str:
        """Legacy display value while #599 is not present in this checkout."""
        return ", ".join(self.specialties)


class StaffIn(_In):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    avatar_url: str | None = None
    sort_order: int | None = None
    positions: list[str] = Field(default_factory=list)
    master: MasterIn | None = None


@dataclass
class ReferenceData:
    """Validated content of all CSV sections."""

    locations: list[LocationIn] = field(default_factory=list)
    services: list[ServiceIn] = field(default_factory=list)
    materials: list[MaterialIn] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    specialties: list[str] = field(default_factory=list)
    positions: list[PositionIn] = field(default_factory=list)
    staff: list[StaffIn] = field(default_factory=list)


# ---------------------------------------------------------------------------
# CSV parsing + cross-reference validation
# ---------------------------------------------------------------------------


CSV_COLUMNS: dict[str, tuple[str, ...]] = {
    "locations": (
        "title",
        "short_title",
        "address",
        "description",
        "capacity",
        "location_hint",
        "record_info",
        "image_url",
        "yandex_map_url",
        "review_url",
        "sort_order",
        "tags",
        "is_public",
    ),
    "services": (
        "title",
        "description",
        "image_url",
        "specialty",
        "min_age",
        "max_age",
        "duration",
        "record_info",
        "tags",
    ),
    "materials": ("title", "description"),
    "service_materials": ("service_title", "material_title", "note"),
    "tariffs": ("service_title", "title", "description", "price", "audience"),
    "staff": (
        "first_name",
        "last_name",
        "sort_order",
        "avatar_url",
        "positions",
        "master_specialty",
        "master_color",
        "master_is_active",
        "master_tags",
    ),
    "positions": ("title",),
    "tags": ("title",),
}
CSV_SECTIONS = frozenset((*CSV_COLUMNS, "specialty"))
REQUIRED_SECTIONS = frozenset(
    {
        "locations",
        "services",
        "materials",
        "service_materials",
        "tariffs",
        "staff",
        "positions",
        "specialty",
    }
)
_INTEGER = re.compile(r"^[+-]?\d+$")


@dataclass(frozen=True)
class _CsvRow:
    section: str
    line: int
    cells: dict[str, str]


@dataclass
class _ParsedCsv:
    sections: dict[str, list[_CsvRow]]
    specialties: list[_CsvRow]
    seen: set[str] = field(default_factory=set)
    last_line: int = 0


def _format_error(error: Mapping[str, Any]) -> str:
    location = ".".join(str(part) for part in error.get("loc", ()))
    value = error.get("input")
    shown = f" (значение: {value!r})"
    if len(shown) > 160:
        shown = f" (значение: {str(value)[:120]!r}…)"
    return f"{location}: {error.get('msg', 'ошибка')}{shown}"


def _validate_row[ModelT: BaseModel](
    model: type[ModelT], values: dict[str, Any], row: _CsvRow
) -> ModelT:
    try:
        return model.model_validate(values)
    except ValidationError as exc:
        details = "; ".join(_format_error(error) for error in exc.errors())
        raise SeedDataError(f"строка {row.line} ({row.section}): {details}") from exc


def _trim_trailing_empty(row: list[str]) -> list[str]:
    trimmed = list(row)
    while len(trimmed) > 1 and not trimmed[-1].strip():
        trimmed.pop()
    return trimmed


def _parse_csv(path: Path) -> _ParsedCsv:
    if not path.is_file():
        raise SeedDataError(f"CSV-файл не найден или это не файл: {path}")

    parsed = _ParsedCsv(sections={name: [] for name in CSV_COLUMNS}, specialties=[])
    active: str | None = None
    columns: list[str] | None = None
    header_width: int | None = None
    needs_header = False
    previous_line = 0
    try:
        with path.open(encoding="utf-8-sig", newline="") as source:
            reader = csv.reader(source, delimiter=";", strict=True)
            while True:
                start_line = previous_line + 1
                try:
                    raw = next(reader)
                except StopIteration:
                    break
                except csv.Error as exc:
                    raise SeedDataError(f"строка {start_line}: ошибка CSV: {exc}") from exc
                previous_line = reader.line_num
                parsed.last_line = previous_line

                if not raw or not any(cell.strip() for cell in raw):
                    continue

                first = raw[0].strip()
                is_marker = bool(first) and all(not cell.strip() for cell in raw[1:])
                if is_marker:
                    if needs_header and active is not None:
                        raise SeedDataError(
                            f"строка {start_line}: в секции {active} отсутствует шапка"
                        )
                    if first not in CSV_SECTIONS:
                        raise SeedDataError(f"строка {start_line}: неизвестная секция «{first}»")
                    if first in parsed.seen:
                        raise SeedDataError(f"строка {start_line}: секция {first} повторяется")
                    parsed.seen.add(first)
                    active = first
                    columns = None
                    header_width = None
                    needs_header = first != "specialty"
                    continue

                if active is None:
                    raise SeedDataError(
                        f"строка {start_line}: данные находятся вне секции; ожидается маркер секции"
                    )
                if first:
                    raise SeedDataError(
                        f"строка {start_line} ({active}): первая колонка должна быть пустой"
                    )

                trimmed = _trim_trailing_empty(raw)
                if active == "specialty":
                    if len(trimmed) < 2 or not trimmed[1].strip():
                        raise SeedDataError(
                            f"строка {start_line} (specialty): укажите название во второй колонке"
                        )
                    if any(cell.strip() for cell in trimmed[2:]):
                        raise SeedDataError(
                            f"строка {start_line} (specialty): допустимо только одно название "
                            "во второй колонке"
                        )
                    parsed.specialties.append(
                        _CsvRow("specialty", start_line, {"title": trimmed[1]})
                    )
                    continue

                if needs_header:
                    if len(trimmed) < 2:
                        raise SeedDataError(f"строка {start_line} ({active}): пустая шапка")
                    header = [cell.strip() for cell in trimmed[1:]]
                    if any(not name for name in header):
                        raise SeedDataError(
                            f"строка {start_line} ({active}): пустое имя колонки внутри шапки"
                        )
                    duplicates = sorted({name for name in header if header.count(name) > 1})
                    if duplicates:
                        raise SeedDataError(
                            f"строка {start_line} ({active}): повтор колонки "
                            f"{', '.join(duplicates)}"
                        )
                    expected = set(CSV_COLUMNS[active])
                    missing = [name for name in CSV_COLUMNS[active] if name not in header]
                    if missing:
                        raise SeedDataError(
                            f"строка {start_line} ({active}): нет обязательных колонок: "
                            f"{', '.join(missing)}"
                        )
                    for name in header:
                        if name not in expected:
                            print(
                                f"  ! лишняя колонка {active}.{name} "
                                f"(строка {start_line}) — проигнорирована"
                            )
                    columns = header
                    header_width = len(raw)
                    needs_header = False
                    continue

                assert columns is not None and header_width is not None
                if len(raw) != header_width:
                    raise SeedDataError(
                        f"строка {start_line} ({active}): в строке "
                        f"{max(len(raw) - 1, 0)} колонок данных, в шапке "
                        f"{max(header_width - 1, 0)}"
                    )
                parsed.sections[active].append(
                    _CsvRow(
                        active,
                        start_line,
                        dict(zip(columns, raw[1 : len(columns) + 1], strict=True)),
                    )
                )
    except UnicodeDecodeError as exc:
        raise SeedDataError(f"CSV должен быть в UTF-8: {exc}") from exc
    except OSError as exc:
        raise SeedDataError(f"Не удалось прочитать CSV-файл {path}: {exc}") from exc

    if needs_header and active is not None:
        raise SeedDataError(f"строка {parsed.last_line + 1} ({active}): отсутствует шапка секции")
    if not parsed.seen:
        raise SeedDataError("строка 1: CSV не содержит секций")
    missing_sections = sorted(REQUIRED_SECTIONS - parsed.seen)
    if missing_sections:
        raise SeedDataError(
            f"строка {parsed.last_line + 1}: отсутствуют обязательные секции: "
            f"{', '.join(missing_sections)}"
        )
    return parsed


def _required(row: _CsvRow, column: str) -> str:
    value = row.cells.get(column, "").strip()
    if not value:
        raise SeedDataError(
            f"строка {row.line} ({row.section}): колонка {column} не может быть пустой"
        )
    return value


def _integer(row: _CsvRow, column: str, *, nullable: bool = False) -> int | None:
    value = row.cells[column].strip()
    if not value:
        if nullable:
            return None
        raise SeedDataError(
            f"строка {row.line} ({row.section}): колонка {column} должна содержать целое число"
        )
    if not _INTEGER.fullmatch(value):
        raise SeedDataError(
            f"строка {row.line} ({row.section}): в колонке {column} "
            f"ожидалось целое число, получено {value!r}"
        )
    return int(value)


def _boolean(row: _CsvRow, column: str, *, empty_default: bool | None = None) -> bool:
    value = row.cells[column].strip()
    if not value and empty_default is not None:
        return empty_default
    if value.lower() == "true":
        return True
    if value.lower() == "false":
        return False
    raise SeedDataError(
        f"строка {row.line} ({row.section}): в колонке {column} ожидалось True или False"
    )


def _list_cell(value: str) -> list[str]:
    return [part.strip() for part in value.split(";") if part.strip()]


def _read_entity_sections(
    parsed: _ParsedCsv,
) -> tuple[ReferenceData, dict[tuple[str, str], int]]:
    line_by_entity: dict[tuple[str, str], int] = {}

    locations: list[LocationIn] = []
    for row in parsed.sections["locations"]:
        locations.append(
            _validate_row(
                LocationIn,
                {
                    "title": row.cells["title"],
                    "short_title": row.cells["short_title"],
                    "address": row.cells["address"],
                    "description": row.cells["description"],
                    "capacity": _integer(row, "capacity"),
                    "location_hint": row.cells["location_hint"],
                    "record_info": row.cells["record_info"],
                    "image_url": row.cells["image_url"],
                    "yandex_map_url": row.cells["yandex_map_url"],
                    "review_url": row.cells["review_url"],
                    "sort_order": _integer(row, "sort_order", nullable=True),
                    "tags": _list_cell(row.cells["tags"]),
                    "is_public": _boolean(row, "is_public"),
                },
                row,
            )
        )
    for item, row in zip(locations, parsed.sections["locations"], strict=True):
        line_by_entity[("locations", item.title)] = row.line

    services: list[ServiceIn] = []
    for row in parsed.sections["services"]:
        services.append(
            _validate_row(
                ServiceIn,
                {
                    "title": row.cells["title"],
                    "description": row.cells["description"],
                    "image_url": row.cells["image_url"],
                    "specialty": row.cells["specialty"],
                    "min_age": _integer(row, "min_age"),
                    "max_age": _integer(row, "max_age", nullable=True),
                    "duration": _integer(row, "duration"),
                    "record_info": row.cells["record_info"],
                    "tags": _list_cell(row.cells["tags"]),
                },
                row,
            )
        )
    for item, row in zip(services, parsed.sections["services"], strict=True):
        line_by_entity[("services", item.title)] = row.line

    materials = [
        _validate_row(
            MaterialIn,
            {"title": row.cells["title"], "description": row.cells["description"]},
            row,
        )
        for row in parsed.sections["materials"]
    ]
    for item, row in zip(materials, parsed.sections["materials"], strict=True):
        line_by_entity[("materials", item.title)] = row.line

    positions = [
        _validate_row(PositionIn, {"title": row.cells["title"]}, row)
        for row in parsed.sections["positions"]
    ]
    for item, row in zip(positions, parsed.sections["positions"], strict=True):
        line_by_entity[("positions", item.title)] = row.line

    tags = [_required(row, "title") for row in parsed.sections.get("tags", [])]
    for title, row in zip(tags, parsed.sections.get("tags", []), strict=True):
        line_by_entity[("tags", title)] = row.line
    specialties = [_required(row, "title") for row in parsed.specialties]
    for title, row in zip(specialties, parsed.specialties, strict=True):
        line_by_entity[("specialty", title)] = row.line

    staff: list[StaffIn] = []
    for row in parsed.sections["staff"]:
        specialty_names = _list_cell(row.cells["master_specialty"])
        color = row.cells["master_color"].strip()
        tag_names = _list_cell(row.cells["master_tags"])
        has_master_values = any(
            row.cells[column].strip()
            for column in ("master_specialty", "master_color", "master_is_active", "master_tags")
        )
        master: MasterIn | None = None
        if has_master_values:
            if not specialty_names:
                raise SeedDataError(
                    f"строка {row.line} (staff): master_specialty обязателен для блока master"
                )
            if not color:
                raise SeedDataError(
                    f"строка {row.line} (staff): master_color обязателен для блока master"
                )
            master = _validate_row(
                MasterIn,
                {
                    "specialties": specialty_names,
                    "color": color,
                    "is_active": _boolean(row, "master_is_active", empty_default=True),
                    "tags": tag_names,
                },
                row,
            )
        person = _validate_row(
            StaffIn,
            {
                "first_name": row.cells["first_name"],
                "last_name": row.cells["last_name"],
                "sort_order": _integer(row, "sort_order", nullable=True),
                "avatar_url": row.cells["avatar_url"],
                "positions": _list_cell(row.cells["positions"]),
                "master": master,
            },
            row,
        )
        staff.append(person)
        line_by_entity[("staff", f"{person.first_name} {person.last_name}")] = row.line

    return (
        ReferenceData(
            locations=locations,
            services=services,
            materials=materials,
            tags=tags,
            specialties=specialties,
            positions=positions,
            staff=staff,
        ),
        line_by_entity,
    )


def _attach_service_children(
    parsed: _ParsedCsv,
    data: ReferenceData,
    line_by_entity: dict[tuple[str, str], int],
) -> None:
    services = {item.title for item in data.services}
    materials = {item.title for item in data.materials}
    links: dict[str, list[MaterialLinkIn]] = {}
    tariffs: dict[str, list[TariffIn]] = {}

    for row in parsed.sections["service_materials"]:
        service_title = _required(row, "service_title")
        material_title = _required(row, "material_title")
        if service_title not in services:
            raise SeedDataError(
                f"строка {row.line}: услуга «{service_title}» из service_materials "
                "не найдена в секции services"
            )
        if material_title not in materials:
            raise SeedDataError(
                f"строка {row.line}: материал «{material_title}» не найден в секции materials"
            )
        item = _validate_row(
            MaterialLinkIn,
            {"title": material_title, "note": row.cells["note"]},
            row,
        )
        links.setdefault(service_title, []).append(item)
        line_by_entity[("service_materials", f"{service_title}\0{material_title}")] = row.line

    for row in parsed.sections["tariffs"]:
        service_title = _required(row, "service_title")
        if service_title not in services:
            raise SeedDataError(
                f"строка {row.line}: услуга «{service_title}» из tariffs "
                "не найдена в секции services"
            )
        item = _validate_row(
            TariffIn,
            {
                "title": row.cells["title"],
                "description": row.cells["description"],
                "price": _integer(row, "price"),
                "audience": row.cells["audience"],
            },
            row,
        )
        tariffs.setdefault(service_title, []).append(item)
        line_by_entity[("tariffs", f"{service_title}\0{item.title}")] = row.line

    data.services = [
        service.model_copy(
            update={
                "materials": links.get(service.title, []),
                "tariffs": tariffs.get(service.title, []),
            }
        )
        for service in data.services
    ]
    for service in data.services:
        _check_unique(
            [item.title for item in service.materials],
            f"services «{service.title}» (materials)",
            {
                item.title: line_by_entity[("service_materials", f"{service.title}\0{item.title}")]
                for item in service.materials
            },
        )
        _check_unique(
            [item.title for item in service.tariffs],
            f"services «{service.title}» (tariffs)",
            {
                item.title: line_by_entity[("tariffs", f"{service.title}\0{item.title}")]
                for item in service.tariffs
            },
        )


def _check_unique(values: list[str], what: str, lines: dict[str, int] | None = None) -> None:
    seen: set[str] = set()
    for value in values:
        if value in seen:
            line = lines.get(value, 0) if lines else 0
            prefix = f"строка {line}: " if line else ""
            raise SeedDataError(
                f"{prefix}{what}: значение «{value}» встречается дважды — уберите дубль"
            )
        seen.add(value)


def _check_refs(owner: str, refs: list[str], known: set[str], source: str, line: int) -> None:
    for ref in refs:
        if ref not in known:
            raise SeedDataError(
                f"строка {line}: {owner}: «{ref}» не найдено в секции {source}. "
                "Добавьте его туда или поправьте название"
            )


def _load_csv_data(parsed: _ParsedCsv) -> ReferenceData:
    data, line_by_entity = _read_entity_sections(parsed)
    _attach_service_children(parsed, data, line_by_entity)

    _check_unique(
        data.tags,
        "секция tags",
        {title: line_by_entity[("tags", title)] for title in data.tags},
    )
    _check_unique(
        [item.title for item in data.materials],
        "секция materials",
        {item.title: line_by_entity[("materials", item.title)] for item in data.materials},
    )
    _check_unique(
        [item.title for item in data.locations],
        "секция locations",
        {item.title: line_by_entity[("locations", item.title)] for item in data.locations},
    )
    _check_unique(
        [item.title for item in data.services],
        "секция services",
        {item.title: line_by_entity[("services", item.title)] for item in data.services},
    )
    _check_unique(
        [item.title for item in data.positions],
        "секция positions",
        {item.title: line_by_entity[("positions", item.title)] for item in data.positions},
    )
    _check_unique(
        [f"{item.first_name} {item.last_name}" for item in data.staff],
        "секция staff",
        {
            f"{item.first_name} {item.last_name}": line_by_entity[
                ("staff", f"{item.first_name} {item.last_name}")
            ]
            for item in data.staff
        },
    )
    if not (data.locations or data.services or data.staff):
        raise SeedDataError(
            f"строка {parsed.last_line + 1}: нет ни локаций, ни услуг, ни сотрудников"
        )

    tag_titles = set(data.tags)
    position_titles = {item.title for item in data.positions} | set(BUILTIN_POSITION_TITLES)
    specialty_titles = {title.lower() for title in data.specialties}
    for location in data.locations:
        line = line_by_entity[("locations", location.title)]
        _check_refs(
            f"locations «{location.title}»",
            location.tags,
            tag_titles,
            "tags",
            line,
        )
    for service in data.services:
        line = line_by_entity[("services", service.title)]
        _check_refs(f"services «{service.title}»", service.tags, tag_titles, "tags", line)
        if service.specialty.lower() not in specialty_titles:
            _check_refs(
                f"services «{service.title}»",
                [service.specialty],
                specialty_titles,
                "specialty",
                line,
            )
    for person in data.staff:
        identity = f"{person.first_name} {person.last_name}"
        line = line_by_entity[("staff", identity)]
        _check_refs(
            f"staff «{identity}»",
            person.positions,
            position_titles,
            "positions",
            line,
        )
        if person.master is None:
            continue
        _check_refs(
            f"staff «{identity}»",
            person.master.tags,
            tag_titles,
            "tags",
            line,
        )
        unknown_specialties = [
            title for title in person.master.specialties if title.lower() not in specialty_titles
        ]
        if unknown_specialties:
            _check_refs(
                f"staff «{identity}»",
                unknown_specialties,
                specialty_titles,
                "specialty",
                line,
            )

    print(
        f"  локаций {len(data.locations)}, услуг {len(data.services)}, "
        f"тегов {len(data.tags)}, материалов {len(data.materials)}, "
        f"направлений {len(data.specialties)}, сотрудников {len(data.staff)}, "
        f"должностей {len(data.positions)}"
    )
    return data


def load_reference_data(csv_path: Path) -> ReferenceData:
    """Read and validate the owner CSV without connecting to a database."""
    if csv_path.is_dir():
        raise SeedDataError(f"Ожидался CSV-файл, получена папка: {csv_path}")
    print(f"Читаю CSV: {csv_path}")
    return _load_csv_data(_parse_csv(csv_path))


# ---------------------------------------------------------------------------
# Applying to the database
# ---------------------------------------------------------------------------


@dataclass
class Stats:
    created: int = 0
    updated: int = 0
    unchanged: int = 0


@dataclass
class Summary:
    stats: dict[str, Stats] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    def bucket(self, name: str) -> Stats:
        return self.stats.setdefault(name, Stats())

    def print(self) -> None:
        print("Итог:")
        for name, stats in self.stats.items():
            print(
                f"  {name}: создано {stats.created}, обновлено {stats.updated}, "
                f"без изменений {stats.unchanged}"
            )
        for warning in self.warnings:
            print(f"  ! {warning}")


def _assign(row: Any, fields: dict[str, Any]) -> bool:
    """Write ``fields`` onto ``row``; return True when anything changed."""
    changed = False
    for name, value in fields.items():
        if getattr(row, name) != value:
            setattr(row, name, value)
            changed = True
    return changed


def _require_active(row: Any, what: str, title: str) -> None:
    if getattr(row, "is_active", True) is False:
        raise SeedDataError(
            f"{what} «{title}» находится в архиве — восстановите его в админке "
            f"или переименуйте запись в файле"
        )


def _note(value: str | None) -> str | None:
    """Normalize a per-link note: blank → NULL (API write contract)."""
    stripped = (value or "").strip()
    return stripped or None


async def _sync_links(
    session: AsyncSession,
    table: Table,
    owner_column: str,
    target_column: str,
    owner_id: str,
    desired_ids: set[str],
) -> None:
    """Make the link set of one owner equal to ``desired_ids``."""
    current = set(
        (
            await session.scalars(
                select(table.c[target_column]).where(table.c[owner_column] == owner_id)
            )
        ).all()
    )
    to_add = desired_ids - current
    to_remove = current - desired_ids
    if to_add:
        await session.execute(
            table.insert(),
            [{owner_column: owner_id, target_column: target_id} for target_id in sorted(to_add)],
        )
    if to_remove:
        await session.execute(
            delete(table).where(
                table.c[owner_column] == owner_id,
                table.c[target_column].in_(sorted(to_remove)),
            )
        )


async def _apply_tags(session: AsyncSession, titles: list[str], summary: Summary) -> dict[str, Tag]:
    existing = {tag.title: tag for tag in (await session.scalars(select(Tag))).all()}
    stats = summary.bucket("Теги")
    for title in titles:
        if title in existing:
            stats.unchanged += 1
            continue
        tag = Tag(title=title)
        session.add(tag)
        existing[title] = tag
        stats.created += 1
    await session.flush()
    return existing


async def _apply_materials(
    session: AsyncSession, rows: list[MaterialIn], summary: Summary
) -> dict[str, Material]:
    existing = {m.title: m for m in (await session.scalars(select(Material))).all()}
    stats = summary.bucket("Материалы")
    for item in rows:
        row = existing.get(item.title)
        if row is None:
            row = Material(title=item.title, description=item.description)
            session.add(row)
            existing[item.title] = row
            stats.created += 1
            continue
        _require_active(row, "Материал", item.title)
        if _assign(row, {"description": item.description}):
            stats.updated += 1
        else:
            stats.unchanged += 1
    await session.flush()
    return existing


async def _apply_positions(
    session: AsyncSession, rows: list[PositionIn], summary: Summary
) -> dict[str, Position]:
    rows_existing = (await session.scalars(select(Position))).all()
    existing = {position.title: position for position in rows_existing}
    by_id = {position.id: position for position in rows_existing}
    # The two built-ins are migration-seeded rows with fixed string ids
    # (``master``/``admin``) that the role template anchors on — a missing
    # built-in means the migrations were never applied, and re-creating it
    # under a UUID id would silently break role templating.
    missing = [pid for pid in BUILTIN_POSITION_IDS if pid not in by_id]
    if missing:
        raise SeedDataError(
            "В базе нет системных должностей (master/admin) — их создают миграции. "
            "Сначала выполните: uv run alembic upgrade head"
        )
    stats = summary.bucket("Должности")
    for item in rows:
        if item.title in existing:
            stats.unchanged += 1
            continue
        if item.title in BUILTIN_POSITION_TITLES:
            raise SeedDataError(
                f"positions: «{item.title}» — системная должность, она уже есть "
                f"в базе под другим названием. Поправьте название в файле под фактическое"
            )
        position = Position(title=item.title, is_system=False)
        session.add(position)
        existing[item.title] = position
        stats.created += 1
    await session.flush()
    return existing


async def _apply_locations(
    session: AsyncSession,
    rows: list[LocationIn],
    tags: dict[str, Tag],
    summary: Summary,
) -> None:
    existing = {loc.title: loc for loc in (await session.scalars(select(Location))).all()}
    stats = summary.bucket("Локации")
    for index, item in enumerate(rows):
        # Apply whitelist — every column the file owns. GH #601: is_public
        # included, so a re-run flips web visibility per the file. CSV
        # conversion rule (spec §2.7): «видно клиентам» пусто/«да» → true,
        # «нет» → false.
        fields: dict[str, Any] = {
            "short_title": item.short_title,
            "address": item.address,
            "description": item.description,
            "capacity": item.capacity,
            "yandex_map_url": item.yandex_map_url,
            "review_url": item.review_url,
            "record_info": item.record_info,
            "image_url": item.image_url,
            "location_hint": item.location_hint,
            "sort_order": item.sort_order if item.sort_order is not None else index,
            "is_public": item.is_public,
        }
        row = existing.get(item.title)
        if row is None:
            row = Location(title=item.title, **fields)
            session.add(row)
            existing[item.title] = row
            stats.created += 1
        else:
            _require_active(row, "Локация", item.title)
            if _assign(row, fields):
                stats.updated += 1
            else:
                stats.unchanged += 1
        await session.flush()
        await _sync_links(
            session,
            location_tags,
            "location_id",
            "tag_id",
            row.id,
            {tags[title].id for title in item.tags},
        )


async def _sync_service_materials(
    session: AsyncSession, service_id: str, desired: dict[str, str | None]
) -> None:
    rows = (
        await session.scalars(
            select(ServiceMaterial).where(ServiceMaterial.service_id == service_id)
        )
    ).all()
    by_material = {row.material_id: row for row in rows}
    for material_id, note in desired.items():
        row = by_material.pop(material_id, None)
        if row is None:
            session.add(ServiceMaterial(service_id=service_id, material_id=material_id, note=note))
        elif row.note != note:
            row.note = note
    for stale in by_material.values():
        await session.delete(stale)


async def _sync_tariffs(
    session: AsyncSession, service: Service, rows: list[TariffIn], summary: Summary
) -> None:
    existing = (await session.scalars(select(Tariff).where(Tariff.service_id == service.id))).all()
    by_title = {tariff.title: tariff for tariff in existing}
    stats = summary.bucket("Тарифы")
    for item in rows:
        fields: dict[str, Any] = {
            "description": item.description,
            "price": item.price,
            "audience": item.audience,
        }
        row = by_title.pop(item.title, None)
        if row is None:
            session.add(
                Tariff(
                    service_id=service.id,
                    title=item.title,
                    description=item.description,
                    price=item.price,
                    audience=item.audience,
                )
            )
            stats.created += 1
            continue
        _require_active(row, f"Тариф «{item.title}» услуги", service.title)
        if _assign(row, fields):
            stats.updated += 1
        else:
            stats.unchanged += 1
    if by_title:
        summary.warnings.append(
            f"У услуги «{service.title}» есть тарифы вне файла: "
            f"{', '.join(sorted(by_title))} — оставлены без изменений"
        )


async def _apply_services(
    session: AsyncSession,
    rows: list[ServiceIn],
    tags: dict[str, Tag],
    materials: dict[str, Material],
    summary: Summary,
) -> None:
    existing = {svc.title: svc for svc in (await session.scalars(select(Service))).all()}
    stats = summary.bucket("Услуги")
    for item in rows:
        fields: dict[str, Any] = {
            "description": item.description,
            "image_url": item.image_url,
            "specialty": item.specialty,
            "min_age": item.min_age,
            "max_age": item.max_age,
            "duration": item.duration,
            "record_info": item.record_info,
        }
        row = existing.get(item.title)
        if row is None:
            row = Service(title=item.title, **fields)
            session.add(row)
            existing[item.title] = row
            stats.created += 1
        else:
            _require_active(row, "Услуга", item.title)
            if _assign(row, fields):
                stats.updated += 1
            else:
                stats.unchanged += 1
        await session.flush()
        await _sync_links(
            session,
            service_tags,
            "service_id",
            "tag_id",
            row.id,
            {tags[title].id for title in item.tags},
        )
        await _sync_service_materials(
            session,
            row.id,
            {materials[link.title].id: _note(link.note) for link in item.materials},
        )
        await _sync_tariffs(session, row, item.tariffs, summary)
        if not item.image_url:
            summary.warnings.append(
                f"У услуги «{item.title}» не заполнен image_url — карточка будет без картинки"
            )


async def _apply_staff(
    session: AsyncSession,
    rows: list[StaffIn],
    positions: dict[str, Position],
    tags: dict[str, Tag],
    summary: Summary,
) -> None:
    existing = {
        (person.first_name, person.last_name): person
        for person in (await session.scalars(select(Staff))).all()
    }
    masters = {m.staff_id: m for m in (await session.scalars(select(Master))).all()}
    staff_stats = summary.bucket("Сотрудники")
    master_stats = summary.bucket("Мастера")
    for index, item in enumerate(rows):
        who = f"{item.first_name} {item.last_name}"
        fields: dict[str, Any] = {
            "avatar_url": item.avatar_url,
            "sort_order": item.sort_order if item.sort_order is not None else index,
        }
        row = existing.get((item.first_name, item.last_name))
        if row is None:
            row = Staff(first_name=item.first_name, last_name=item.last_name, **fields)
            session.add(row)
            existing[(item.first_name, item.last_name)] = row
            staff_stats.created += 1
        else:
            _require_active(row, "Сотрудник", who)
            if _assign(row, fields):
                staff_stats.updated += 1
            else:
                staff_stats.unchanged += 1
        await session.flush()

        desired_positions: set[str] = set()
        for title in item.positions:
            position = positions.get(title)
            if position is None:
                raise SeedDataError(
                    f"staff «{who}»: должность «{title}» не найдена. "
                    f"Объявите её в блоке positions или поправьте название"
                )
            desired_positions.add(position.id)
        await _sync_links(
            session, staff_positions, "staff_id", "position_id", row.id, desired_positions
        )

        if item.master is None:
            continue
        master_fields: dict[str, Any] = {
            "specialty": item.master.specialty,
            "color": item.master.color,
            "is_active": item.master.is_active,
        }
        master = masters.get(row.id)
        if master is None:
            master = Master(staff_id=row.id, **master_fields)
            session.add(master)
            masters[row.id] = master
            master_stats.created += 1
        elif _assign(master, master_fields):
            master_stats.updated += 1
        else:
            master_stats.unchanged += 1
        await session.flush()
        await _sync_links(
            session,
            master_tags,
            "master_id",
            "tag_id",
            row.id,
            {tags[title].id for title in item.master.tags},
        )


async def apply_reference_data(
    session: AsyncSession, data: ReferenceData, summary: Summary
) -> None:
    """Upsert every section in dependency order (FK-safe flushes inside)."""
    tags = await _apply_tags(session, data.tags, summary)
    materials = await _apply_materials(session, data.materials, summary)
    positions = await _apply_positions(session, data.positions, summary)
    await _apply_locations(session, data.locations, tags, summary)
    await _apply_services(session, data.services, tags, materials, summary)
    await _apply_staff(session, data.staff, positions, tags, summary)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


async def _run(csv_path: Path, *, dry_run: bool) -> int:
    data = load_reference_data(csv_path)
    database_url = os.environ.get("DATABASE_URL", "sqlite+aiosqlite:///./memo.db")
    manager = DBManager(database_url)
    summary = Summary()
    try:
        async with manager.async_session() as session:
            try:
                await apply_reference_data(session, data, summary)
            except OperationalError as exc:
                raise SeedDataError(
                    "В базе нет таблиц. Сначала примените миграции: uv run alembic upgrade head"
                ) from exc
            if dry_run:
                await session.rollback()
            else:
                await session.commit()
    finally:
        await manager.engine.dispose()

    summary.print()
    if dry_run:
        print("ПРОБНЫЙ ЗАПУСК: изменения откатаны, база не изменена.")
    else:
        print("Готово: справочные данные загружены.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m src.seed.reference",
        description="Загрузка справочных данных из CSV.",
    )
    parser.add_argument(
        "--csv",
        type=Path,
        required=True,
        help="CSV-файл со справочными данными",
    )
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--check", action="store_true", help="проверить CSV, базу не трогать")
    modes.add_argument("--dry-run", action="store_true", help="загрузить и откатить транзакцию")
    args = parser.parse_args(argv)

    try:
        if args.check:
            load_reference_data(args.csv)
            print("Проверка пройдена: CSV заполнен корректно.")
            return 0
        return asyncio.run(_run(args.csv, dry_run=args.dry_run))
    except SeedDataError as exc:
        sys.stdout.flush()  # keep the progress output above the error
        print(f"\nОШИБКА: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
