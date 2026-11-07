"""Production reference-data loader — YAML templates in ``seed-data/``.

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

    uv run python -m src.seed.reference --check     # validate files, no DB
    uv run python -m src.seed.reference --dry-run   # full load, rolled back
    uv run python -m src.seed.reference             # real load

``DATABASE_URL`` selects the database (same default as the dev seed).
"""

# ruff: noqa: RUF001  -- Russian operator-facing messages

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

import yaml
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

DEFAULT_DIR = Path(__file__).resolve().parents[2] / "seed-data"

# Service.specialty is String(20) in the ORM; tag/location/service titles have
# their own DB widths — the template mirrors them so a typo fails here, not on
# INSERT.
SPECIALTY_MAX = 20

# Built-in positions, seeded by the staff-restructuring migration under fixed
# string ids (``master``/``admin``). Titles are that migration's defaults; the
# role template anchors on the ids, so these rows must never be re-created.
BUILTIN_POSITION_IDS = ("master", "admin")
BUILTIN_POSITION_TITLES = frozenset({"Мастер", "Администратор"})


class SeedDataError(Exception):
    """Invalid template file or unresolvable cross-reference."""


# ---------------------------------------------------------------------------
# YAML schemas — one model per file, ``extra="forbid"`` so a mistyped key is
# an error instead of a silently ignored line.
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
    specialty: str = Field(min_length=1, max_length=SPECIALTY_MAX)
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
    specialty: str = Field(min_length=1)
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    is_active: bool = True
    tags: list[str] = Field(default_factory=list)


class StaffIn(_In):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    avatar_url: str | None = None
    sort_order: int | None = None
    positions: list[str] = Field(default_factory=list)
    master: MasterIn | None = None


class LocationsFile(_In):
    locations: list[LocationIn] = Field(default_factory=list)


class ServicesFile(_In):
    services: list[ServiceIn] = Field(default_factory=list)


class MaterialsFile(_In):
    materials: list[MaterialIn] = Field(default_factory=list)


class TagsFile(_In):
    tags: list[str] = Field(default_factory=list)


class StaffFile(_In):
    positions: list[PositionIn] = Field(default_factory=list)
    staff: list[StaffIn] = Field(default_factory=list)


@dataclass
class ReferenceData:
    """Validated content of all template files."""

    locations: list[LocationIn] = field(default_factory=list)
    services: list[ServiceIn] = field(default_factory=list)
    materials: list[MaterialIn] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    positions: list[PositionIn] = field(default_factory=list)
    staff: list[StaffIn] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Loading + cross-file validation
# ---------------------------------------------------------------------------


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        print(f"  ! файл {path.name} не найден — раздел пропущен")
        return {}
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise SeedDataError(f"{path.name}: синтаксис YAML сломан — {exc}") from exc
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise SeedDataError(f"{path.name}: ожидался словарь верхнего уровня, например «locations:»")
    return raw


def _format_error(error: Mapping[str, Any]) -> str:
    location = ".".join(str(part) for part in error.get("loc", ()))
    value = error.get("input")
    shown = f" (значение: {value!r})"
    if len(shown) > 160:
        # Row-level errors carry the whole YAML mapping as ``input`` — show a
        # short prefix instead of dumping the row.
        shown = f" (значение: {str(value)[:120]!r}…)"
    return f"{location}: {error.get('msg', 'ошибка')}{shown}"


def _load_file[ModelT: BaseModel](directory: Path, filename: str, model: type[ModelT]) -> ModelT:
    path = directory / filename
    raw = _read_yaml(path)
    try:
        return model.model_validate(raw)
    except ValidationError as exc:
        details = "\n".join(f"  {filename}: {_format_error(e)}" for e in exc.errors())
        raise SeedDataError(f"Файл {filename} заполнен неверно:\n{details}") from exc


def _check_unique(values: list[str], what: str) -> None:
    seen: set[str] = set()
    for value in values:
        if value in seen:
            raise SeedDataError(f"{what}: значение «{value}» встречается дважды — уберите дубль")
        seen.add(value)


def _check_refs(owner: str, refs: list[str], known: set[str], source: str) -> None:
    for ref in refs:
        if ref not in known:
            raise SeedDataError(
                f"{owner}: «{ref}» не найдено в {source}. Добавьте его туда или поправьте название"
            )


def load_reference_data(directory: Path) -> ReferenceData:
    """Read + validate every template file; raise :class:`SeedDataError`."""
    if not directory.is_dir():
        raise SeedDataError(f"Папка с шаблонами не найдена: {directory}")

    print(f"Читаю шаблоны: {directory}")
    tags_file = _load_file(directory, "tags.yaml", TagsFile)
    materials_file = _load_file(directory, "materials.yaml", MaterialsFile)
    locations_file = _load_file(directory, "locations.yaml", LocationsFile)
    services_file = _load_file(directory, "services.yaml", ServicesFile)
    staff_file = _load_file(directory, "staff.yaml", StaffFile)

    data = ReferenceData(
        locations=locations_file.locations,
        services=services_file.services,
        materials=materials_file.materials,
        tags=tags_file.tags,
        positions=staff_file.positions,
        staff=staff_file.staff,
    )

    _check_unique(data.tags, "tags.yaml")
    _check_unique([m.title for m in data.materials], "materials.yaml")
    _check_unique([loc.title for loc in data.locations], "locations.yaml")
    _check_unique([s.title for s in data.services], "services.yaml")
    _check_unique([p.title for p in data.positions], "staff.yaml (positions)")
    _check_unique([f"{s.first_name} {s.last_name}" for s in data.staff], "staff.yaml (staff)")

    if not (data.locations or data.services or data.staff):
        raise SeedDataError(
            "Все шаблоны пусты: нет ни локаций, ни услуг, ни сотрудников. "
            "Проверьте папку с файлами (--dir)"
        )

    tag_titles = set(data.tags)
    material_titles = {m.title for m in data.materials}

    for location in data.locations:
        _check_refs(f"locations.yaml «{location.title}»", location.tags, tag_titles, "tags.yaml")
    for service in data.services:
        _check_refs(f"services.yaml «{service.title}»", service.tags, tag_titles, "tags.yaml")
        _check_refs(
            f"services.yaml «{service.title}»",
            [m.title for m in service.materials],
            material_titles,
            "materials.yaml",
        )
        _check_unique(
            [t.title for t in service.tariffs],
            f"services.yaml «{service.title}» (тарифы)",
        )
    for person in data.staff:
        if person.master is not None:
            _check_refs(
                f"staff.yaml «{person.first_name} {person.last_name}»",
                person.master.tags,
                tag_titles,
                "tags.yaml",
            )

    print(
        f"  локаций {len(data.locations)}, услуг {len(data.services)}, "
        f"тегов {len(data.tags)}, материалов {len(data.materials)}, "
        f"сотрудников {len(data.staff)}, должностей {len(data.positions)}"
    )
    return data


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
                f"staff.yaml (positions): «{item.title}» — системная должность, она уже есть "
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
                    f"staff.yaml «{who}»: должность «{title}» не найдена. "
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


async def _run(directory: Path, *, dry_run: bool) -> int:
    data = load_reference_data(directory)
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
        description="Загрузка справочных данных (локации, услуги, мастера…) из YAML.",
    )
    parser.add_argument(
        "--dir",
        type=Path,
        default=DEFAULT_DIR,
        help=f"папка с YAML-шаблонами (по умолчанию {DEFAULT_DIR})",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="только проверить файлы, базу не трогать",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="выполнить загрузку и откатить транзакцию",
    )
    args = parser.parse_args(argv)

    try:
        if args.check:
            load_reference_data(args.dir)
            print("Проверка пройдена: файлы заполнены корректно.")
            return 0
        return asyncio.run(_run(args.dir, dry_run=args.dry_run))
    except SeedDataError as exc:
        sys.stdout.flush()  # keep the progress output above the error
        print(f"\nОШИБКА: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
