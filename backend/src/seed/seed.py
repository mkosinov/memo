"""Seed script — populates the database with mock data for development.

Contract: seed assumes an EMPTY database. Running on a populated DB
raises SQLAlchemy IntegrityError on the first duplicate business key
(users.phone UNIQUE) — this is intended fail-loud behaviour. Test stacks
(`scripts/e2e-shard-start.sh`) wipe the DB file before starting the
backend, so alembic recreates the schema and seed runs on empty.

ID policy (GH #491): every seeded user-data row carries a random UUID id —
the same shape the ORM column default and the API create-path produce, so
UUID-typed contract surfaces (``?id=`` list filters, ``material_id``,
``activity_id``) accept seeded rows. The readable legacy literals (m1,
alpika, s7, t7a, c1, vis1, r1, v1, p1, ph1, tag1, mat1, ev_0, ev_fixed_0)
survive ONLY as alias keys of :class:`_SeedIds`: the demo-data constants
keep referencing them, while cross-family foreign keys resolve through the
registry at insert time. Built-in position rows (master/admin/smm) keep
their system-code ids — a migration-seeded dictionary with runtime logic
keyed to the short codes, not seed-owned data.

Fixed-week invariant (GH #422): every seed date is pinned — the three
functional weeks derive from ``FUNC_WEEK_START`` (2026-06-01), the visual
week from ``WEEK_FIXED_START`` (2026-06-15); nothing is computed from the
current date. This relies on an API invariant: write paths accept
activities and records dated in the past, and the fixed seed deliberately
lives in the past. Introducing server-side ``date >= now`` validation
would break dev, playground and e2e simultaneously — recompute the fixed
weeks before adding such validation.

Usage:
    uv run python -m seed.seed          # direct module
    uv run python -m seed               # via __main__
    DATABASE_URL=sqlite+aiosqlite:///./memo.db uv run python -m seed

Staff demo users (GH #247 §3.11): in non-production ENV the seed also
creates admin ``+79990000001/admin12345`` and master
``+79990000002/master12345`` (linked to the first seeded master). Skipped
when ``ENV=production`` — staging must set it too (spec deployment note).
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

# ruff: noqa: RUF001, RUF002, RUF003  -- Cyrillic text is intentional (Russian language app)
from sqlalchemy import select

from src.auth.passwords import hash_password
from src.db.base import Base
from src.db.database import DBManager
from src.domain.visit_status import VisitStatus
from src.models import (
    Activity,
    Client,
    Location,
    Master,
    Material,
    Payment,
    Photo,
    Position,
    Record,
    Service,
    ServiceMaterial,
    Staff,
    Tag,
    Tariff,
    User,
    Visit,
    Visitor,
)
from src.models.enums import TariffAudience
from src.models.photo import photo_tags
from src.models.position import staff_positions
from src.models.tag import activity_tags, service_tags

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

# ---------------------------------------------------------------------------
# Seed data constants
# ---------------------------------------------------------------------------


def _new_id() -> str:
    """Random UUID string — the id shape every user-data seed row gets."""
    return str(uuid.uuid4())


class _SeedIds:
    """Alias → DB id registry for one seed run.

    Aliases are the former literal seed ids; the constants below keep using
    them so the demo data stays readable, while every insert maps alias →
    fresh UUID through this registry (GH #491).
    """

    def __init__(self) -> None:
        self._families: dict[str, dict[str, str]] = {}

    def put(self, family: str, alias: str, entity_id: str) -> None:
        self._families.setdefault(family, {})[alias] = entity_id

    def get(self, family: str, alias: str) -> str:
        try:
            return self._families[family][alias]
        except KeyError:
            raise KeyError(f"seed alias {family}:{alias} is not registered") from None


# One seeded activity row: (day, master, start_hour, dur_hours, service_name,
# location, capacity, is_private) — start_hour/dur_hours are float (10.5 etc).
# master/location are _SeedIds aliases; service_name goes through
# _SERVICE_NAME_TO_ALIAS.
type _ActivityRow = tuple[int, str, float, float, str, str, int, bool]


# Functional half of the seed is pinned to a fixed reference week (GH #422):
# FUNC_WEEK_START is the single source of the three activity weeks — no
# calendar derivation, so a seed run produces identical data on any day.
# E2E and dev open these weeks explicitly (?date=…, SEED_WEEK_MONDAY on
# the TS side); the seed no longer chases "the current week".
FUNC_WEEK_START = datetime(2026, 6, 1)  # Monday, 2026-06-01

WEEK_START = FUNC_WEEK_START - timedelta(days=14)  # 2026-05-18 — oldest functional week
WEEK2_START = FUNC_WEEK_START - timedelta(days=7)  # 2026-05-25 — middle functional week
WEEK3_START = FUNC_WEEK_START                      # 2026-06-01 — reference functional week

# Fixed reference week for visual regression baselines.
# Activities and records r1-r6 in this week have stable dates so that
# page.clock.install({ time: '2026-06-15' }) in visual tests produces
# consistent screenshots regardless of when tests are run.
WEEK_FIXED_START = datetime(2026, 6, 15)  # Monday, 2026-06-15 (original — for visual baselines)

# Fixed rising created_at for the 9 seed photos (aliases ph1–ph7 +
# ph_c1_private, ph_c2_private): consecutive days at noon starting at
# WEEK_FIXED_START — pins photos visual baselines to the fixed week
# (sorted-by-created_at lists stop drifting across UTC midnight). Keys
# are photo ALIASES, not DB ids. Naive datetimes: the DB column is
# naive; explicit values so the AbstractModel default (datetime.utcnow)
# no longer fires for seed photos.
PHOTO_FIXED_DATES: dict[str, datetime] = {
    "ph1": datetime(2026, 6, 15, 12, 0, 0),
    "ph2": datetime(2026, 6, 16, 12, 0, 0),
    "ph3": datetime(2026, 6, 17, 12, 0, 0),
    "ph4": datetime(2026, 6, 18, 12, 0, 0),
    "ph5": datetime(2026, 6, 19, 12, 0, 0),
    "ph6": datetime(2026, 6, 20, 12, 0, 0),
    "ph7": datetime(2026, 6, 21, 12, 0, 0),
    # #513 cabinet delta (both NON-public — the public gallery feed of 7
    # is untouched): c1's private photo (С3) + c2's photo (С2 isolation).
    "ph_c1_private": datetime(2026, 6, 22, 12, 0, 0),
    "ph_c2_private": datetime(2026, 6, 23, 12, 0, 0),
}

_SERVICE_NAME_TO_ALIAS: dict[str, str] = {
    "Морской пейзаж": "s7",
    "Ручная лепка": "s5",
    "Индивидуальный МК": "s3",
    "Картина акрилом": "s2",
    "Мини-картина акрилом": "s3",
    "Роспись одежды": "s6",
    "Акварель": "s4",
    "Мини-картина": "s3",
    "Индивидуальный урок": "s5",
    "Картина маслом": "s1",
    "Индив. керамика": "s5",
}

# (day, master, start_hour, dur_hours, service_name, location, capacity, is_private)
_ACTIVITIES_RAW: list[_ActivityRow] = [
    # ПН (day 0)
    (0, "m1", 10, 3, "Морской пейзаж", "grand", 8, False),
    (0, "m2", 12, 1.5, "Ручная лепка", "alpika", 6, False),
    (0, "m4", 14, 2, "Индивидуальный МК", "grand", 1, True),
    (0, "m3", 16, 2, "Картина акрилом", "p1389", 10, False),
    # ВТ (day 1)
    (1, "m3", 11, 2, "Картина акрилом", "alpika", 10, False),
    (1, "m1", 15, 1.5, "Мини-картина акрилом", "grand", 8, False),
    (1, "m5", 17, 2.5, "Картина маслом", "p1389", 8, False),
    # СР (day 2)
    (2, "m2", 10.5, 2, "Роспись одежды", "alpika", 10, False),
    (2, "m7", 13, 1.5, "Мини-картина", "grand", 8, False),
    (2, "m4", 16, 2.5, "Акварель", "p1389", 6, False),
    # ЧТ (day 3)
    (3, "m1", 11, 3, "Морской пейзаж", "grand", 8, False),
    (3, "m3", 14.5, 2, "Картина акрилом", "alpika", 10, False),
    (3, "m5", 18, 1.5, "Индивидуальный урок", "p1389", 1, True),
    # ПТ (day 4)
    (4, "m2", 10, 2.5, "Ручная лепка", "alpika", 6, False),
    (4, "m7", 12, 2, "Картина акрилом", "grand", 10, False),
    (4, "m1", 15, 2.5, "Картина маслом", "grand", 8, False),
    (4, "m4", 18, 1.5, "Мини-картина", "p1389", 8, False),
    # СБ (day 5)
    (5, "m1", 10, 3, "Морской пейзаж", "grand", 8, False),
    (5, "m2", 10, 1.5, "Мини-картина", "alpika", 8, False),
    (5, "m3", 12, 2, "Картина акрилом", "alpika", 10, False),
    (5, "m5", 13, 2.5, "Картина маслом", "p1389", 8, False),
    (5, "m7", 15.5, 1.5, "Мини-картина", "grand", 8, False),
    (5, "m4", 16, 2.5, "Акварель", "p1389", 6, False),
    (5, "m3", 14.5, 1.5, "Индив. керамика", "alpika", 1, True),
    # ВС (day 6)
    (6, "m1", 11, 2.5, "Картина маслом", "grand", 8, False),
    (6, "m2", 11, 1.5, "Ручная лепка", "alpika", 6, False),
    (6, "m7", 14, 2, "Картина акрилом", "grand", 10, False),
    (6, "m5", 16.5, 2, "Роспись одежды", "p1389", 8, False),
]

# Activities for week 2 (2026-05-25…31)
_ACTIVITIES_RAW_WEEK2: list[_ActivityRow] = [
    # ПН (day 0) — May 25
    (0, "m1", 10, 3, "Морской пейзаж", "grand", 8, False),
    # ВТ (day 1) — May 26
    (1, "m3", 11, 2, "Картина акрилом", "alpika", 10, False),
    # СР (day 2) — May 27
    (2, "m2", 10, 2, "Роспись одежды", "alpika", 10, False),
    # ЧТ (day 3) — May 28
    (3, "m1", 10, 3, "Морской пейзаж", "grand", 8, False),
    # ПТ (day 4) — May 29
    (4, "m5", 14, 2.5, "Картина маслом", "p1389", 8, False),
    # СБ (day 5) — May 30
    (5, "m1", 10, 3, "Морской пейзаж", "grand", 8, False),
    (5, "m3", 14, 2, "Картина акрилом", "alpika", 10, False),
    # ВС (day 6) — May 31
    (6, "m2", 11, 1.5, "Ручная лепка", "alpika", 6, False),
]

# Activities for week 3 (reference functional week, 2026-06-01…07)
_ACTIVITIES_RAW_WEEK3: list[_ActivityRow] = [
    # ПН (day 0)
    (0, "m1", 10, 3, "Морской пейзаж", "grand", 8, False),
    (0, "m4", 14, 2, "Мини-картина акрилом", "p1389", 8, False),
    # ВТ (day 1)
    (1, "m3", 11, 2, "Картина акрилом", "alpika", 10, False),
    # СР (day 2)
    (2, "m2", 10, 2, "Роспись одежды", "alpika", 10, False),
    # ЧТ (day 3)
    (3, "m1", 10, 3, "Морской пейзаж", "grand", 8, False),
    # ПТ (day 4)
    (4, "m5", 14, 2.5, "Картина маслом", "p1389", 8, False),
    # СБ (day 5)
    (5, "m1", 10, 3, "Морской пейзаж", "grand", 8, False),
    (5, "m3", 14, 2, "Картина акрилом", "alpika", 10, False),
    # ВС (day 6)
    (6, "m2", 11, 1.5, "Ручная лепка", "alpika", 6, False),
]

# Fixed reference week: stable dates for visual regression baselines.
# Used with page.clock.install({ time: '2026-06-15' }) in visual tests.
# Records r1-r6 link to activities here (indices 0,1,2,3,5,8).
_ACTIVITIES_RAW_FIXED: list[_ActivityRow] = [
    # day, master, start_h, dur_h, svc_name, location, capacity, is_private
    (0, "m1", 10, 2, "Морской пейзаж", "grand", 8, False),       # ev_fixed_0 → r1
    (0, "m2", 12, 1.5, "Ручная лепка", "alpika", 6, False),      # ev_fixed_1 → r2
    (1, "m3", 11, 2, "Картина акрилом", "alpika", 10, False),    # ev_fixed_2 → r3
    (1, "m1", 15, 1, "Мини-картина акрилом", "grand", 8, False), # ev_fixed_3 → r4
    (2, "m2", 14, 2, "Акварель", "p1389", 8, False),             # ev_fixed_4 (filler)
    (3, "m1", 11, 2, "Морской пейзаж", "grand", 8, False),       # ev_fixed_5 → r5
    (3, "m3", 16, 1, "Картина маслом", "alpika", 4, False),      # ev_fixed_6 (filler)
    (4, "m2", 10, 2, "Ручная лепка", "alpika", 6, False),        # ev_fixed_7 (filler)
    (5, "m1", 10, 2, "Морской пейзаж", "grand", 8, False),       # ev_fixed_8 → r6
    (6, "m2", 11, 1.5, "Мини-картина акрилом", "grand", 6, False), # ev_fixed_9 (filler)
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
# NOTE: no `_exists` guard — seed assumes an empty DB (see module docstring).
# `from sqlalchemy import select` below is kept for the three join-table
# existence checks in `_seed_service_tags`, `_seed_activity_tags`, and
# `_seed_photos` (they use `select(service_tags)`, `select(activity_tags)`,
# `select(photo_tags)` patterns, not PK existence).


# ---------------------------------------------------------------------------
# Seed functions
# ---------------------------------------------------------------------------

# Demo staff passwords (GH #247 §3.11) — obviously-fake, dev/demo only,
# never seeded when ENV=production. Satisfy the policy (8–64 chars).
_STAFF_PASSWORDS_HASHED = {
    "admin12345": hash_password("admin12345"),
    "master12345": hash_password("master12345"),
}


async def seed_staff_users(session: AsyncSession) -> None:
    """Seed the demo staff users (GH #247 §3.11) — dev/demo only.

    Admin ``+79990000001/admin12345``; master ``+79990000002/master12345``
    linked to the first seeded staff card (by ``sort_order`` — «Ольга
    Середа», the m1 alias). Guarded by ``ENV != production`` at the call
    site in :func:`seed_data`; the obviously-fake passwords are deliberate
    (public repo).

    GH #319 §5.5: both accounts also get their ``UserSettings`` defaults
    rows («база закрыта с рождения») via the shared creation core
    (``UserSettingsService.insert_defaults`` — the same path as the
    user-creation scenario and the test factory; no second path).
    """
    from src.services.user_settings import UserSettingsService

    first_staff = (
        await session.execute(
            select(Staff).order_by(Staff.sort_order, Staff.id).limit(1)
        )
    ).scalar_one()
    admin = User(phone="+79990000001", role="admin",
                 password_hash=_STAFF_PASSWORDS_HASHED["admin12345"])
    master = User(phone="+79990000002", role="master",
                  staff_id=first_staff.id,
                  password_hash=_STAFF_PASSWORDS_HASHED["master12345"])
    session.add(admin)
    session.add(master)
    # Flush so the client-side uuid4 default materializes the user ids.
    await session.flush()
    await UserSettingsService.insert_defaults(session, admin.id)
    await UserSettingsService.insert_defaults(session, master.id)


# GH #266: former single masters seed is split into staff cards (people) +
# masters extension rows (schedule) + positions dictionary + links.
# Aliases are the former literal ids (m1–m5, m7; m6 never existed).
_STAFF_RAW: list[tuple[str, dict[str, str | int]]] = [
    ("m1", {"first_name": "Ольга", "last_name": "Середа", "sort_order": 0}),
    ("m2", {"first_name": "Юлия", "last_name": "Большакова", "sort_order": 1}),
    ("m3", {"first_name": "Анастасия", "last_name": "П.", "sort_order": 2}),
    ("m4", {"first_name": "Дарья", "last_name": "Тюльпина", "sort_order": 3}),
    ("m5", {"first_name": "Александра", "last_name": "В.", "sort_order": 4}),
    ("m7", {"first_name": "Ирина", "last_name": "Горох", "sort_order": 5}),
]

_MASTER_EXTENSIONS: list[tuple[str, dict[str, str]]] = [
    ("m1", {"specialty": "живопись", "color": "#5B8C7A"}),
    ("m2", {"specialty": "керамика", "color": "#6B7E9C"}),
    ("m3", {"specialty": "живопись", "color": "#A07060"}),
    ("m4", {"specialty": "керамика", "color": "#7A6E9C"}),
    ("m5", {"specialty": "живопись", "color": "#8A7840"}),
    ("m7", {"specialty": "керамика", "color": "#9A5870"}),
]


async def _seed_masters(session: AsyncSession, ids: _SeedIds) -> None:
    """Seed staff cards, positions, master extensions and links (#266)."""
    for alias, fields in _STAFF_RAW:
        staff = Staff(id=_new_id(), **fields)
        ids.put("staff", alias, staff.id)
        session.add(staff)
    # positions dictionary: built-ins keep system-code ids (module docstring)
    # + user-defined «СММ» (unassigned)
    session.add(Position(id="master", title="Мастер", is_system=True))
    session.add(Position(id="admin", title="Администратор", is_system=True))
    session.add(Position(id="smm", title="СММ", is_system=False))
    # master extension rows: staff alias → registry id
    for alias, ext_fields in _MASTER_EXTENSIONS:
        session.add(Master(staff_id=ids.get("staff", alias), **ext_fields))
    # FK=ON (#207 §11.3 idiom): flush parents before the Core link inserts
    # below — the Core inserts bypass the unit-of-work ordering.
    await session.flush()
    # every seeded staff member holds the «мастер» position
    for alias, _fields in _STAFF_RAW:
        await session.execute(
            staff_positions.insert().values(
                staff_id=ids.get("staff", alias), position_id="master",
            )
        )


_LOCATION_RAW: list[tuple[str, dict[str, str | int]]] = [
    ("alpika", {"title": "Альпика", "address": "Альпика, 1 этаж", "capacity": 10,
                "location_hint": "1 этаж, светлая студия с панорамными окнами", "sort_order": 0}),
    ("grand", {"title": "Гранд Отель Поляна", "address": "Гранд Отель, лобби", "capacity": 12,
               "location_hint": "Лобби отеля, зона у ресепшн", "sort_order": 1}),
    ("p1389", {"title": "Поляна 1389", "address": "Поляна 1389, 2 этаж", "capacity": 8,
               "location_hint": "2 этаж, рядом с детской зоной", "sort_order": 2}),
]


async def _seed_locations(session: AsyncSession, ids: _SeedIds) -> None:
    for alias, fields in _LOCATION_RAW:
        location = Location(id=_new_id(), **fields)
        ids.put("locations", alias, location.id)
        session.add(location)


_SERVICE_RAW: list[tuple[str, dict[str, str | int | None]]] = [
    ("s1", {"title": "Картина маслом", "description": "Масляная живопись на холсте",
            "image_url": "/images/card-seascape.jpg", "specialty": "живопись",
            "min_age": 12, "max_age": None, "duration": 150, "record_info": "",}),
    ("s2", {"title": "Картина акрилом", "description": "Акриловая живопись на холсте",
            "image_url": "/images/card-mountain-acrylic.jpg", "specialty": "живопись",
            "min_age": 6, "max_age": None, "duration": 120, "record_info": "",}),
    ("s3", {"title": "Мини-картина акрилом", "description": "Миниатюра акрилом на маленьком холсте",
            "image_url": "/images/card-watercolor.jpg", "specialty": "живопись",
            "min_age": 6, "max_age": None, "duration": 90, "record_info": "",}),
    ("s4", {"title": "Акварель", "description": "Акварельная живопись",
            "image_url": "/images/card-watercolor.jpg", "specialty": "живопись",
            "min_age": 6, "max_age": 12, "duration": 150, "record_info": "",}),
    ("s5", {"title": "Ручная лепка", "description": "Лепка из глины",
            "image_url": "/images/card-animals.jpg", "specialty": "керамика",
            "min_age": 5, "max_age": None, "duration": 90, "record_info": "",}),
    ("s6", {"title": "Роспись одежды", "description": "Роспись футболки или шоппера",
            "image_url": "/images/card-shopper.jpg", "specialty": "живопись",
            "min_age": 8, "max_age": None, "duration": 120, "record_info": "",}),
    ("s7", {"title": "Морской пейзаж", "description": "Морской пейзаж маслом",
            "image_url": "/images/card-seascape.jpg", "specialty": "живопись",
            "min_age": 12, "max_age": None, "duration": 180, "record_info": "",}),
]


async def _seed_services(session: AsyncSession, ids: _SeedIds) -> None:
    for alias, fields in _SERVICE_RAW:
        service = Service(id=_new_id(), **fields)
        ids.put("services", alias, service.id)
        session.add(service)


async def _seed_tariffs(session: AsyncSession, ids: _SeedIds) -> None:
    # (alias, service alias, title, price, audience) — GH #284: the audience
    # marker matches the title (kid-titled → kid, adult-titled → adult, the
    # neutral «Индивидуальный» → all), mirroring the migration backfill rule
    # so demo data exercises the age-autofill feature end-to-end.
    tariff_data: list[tuple[str, str, str, int, str]] = [
        # s1 — Картина маслом
        ("t1a", "s1", "Взрослый", 3500, "adult"),
        ("t1c", "s1", "Детский", 2500, "kid"),
        ("t1i", "s1", "Индивидуальный", 5000, "all"),
        # s2 — Картина акрилом
        ("t2a", "s2", "Взрослый", 2800, "adult"),
        ("t2c", "s2", "Детский", 2000, "kid"),
        ("t2i", "s2", "Индивидуальный", 4000, "all"),
        # s3 — Мини-картина акрилом
        ("t3a", "s3", "Взрослый", 2000, "adult"),
        ("t3c", "s3", "Детский", 1500, "kid"),
        ("t3i", "s3", "Индивидуальный", 3000, "all"),
        # s4 — Акварель
        ("t4a", "s4", "Взрослый", 2800, "adult"),
        ("t4c", "s4", "Детский", 2000, "kid"),
        ("t4i", "s4", "Индивидуальный", 4000, "all"),
        # s5 — Ручная лепка
        ("t5a", "s5", "Взрослый", 2200, "adult"),
        ("t5c", "s5", "Детский", 1800, "kid"),
        ("t5i", "s5", "Индивидуальный", 3500, "all"),
        # s6 — Роспись одежды
        ("t6a", "s6", "Взрослый", 3200, "adult"),
        ("t6c", "s6", "Детский", 2500, "kid"),
        ("t6i", "s6", "Индивидуальный", 4500, "all"),
        # s7 — Морской пейзаж
        ("t7a", "s7", "Взрослый", 3800, "adult"),
        ("t7c", "s7", "Детский", 2800, "kid"),
        ("t7i", "s7", "Индивидуальный", 5500, "all"),
    ]
    for alias, service_alias, title, price, audience in tariff_data:
        tariff = Tariff(
            id=_new_id(),
            service_id=ids.get("services", service_alias),
            title=title,
            price=price,
            audience=TariffAudience(audience),
        )
        ids.put("tariffs", alias, tariff.id)
        session.add(tariff)


async def _seed_tags(session: AsyncSession, ids: _SeedIds) -> None:
    tag_titles = ["новинка", "хит", "для детей", "популярное", "индивидуальное", "сезонное", "гость"]
    for i, title in enumerate(tag_titles, start=1):
        tag = Tag(id=_new_id(), title=title)
        ids.put("tags", f"tag{i}", tag.id)
        session.add(tag)


async def _seed_activities(session: AsyncSession, ids: _SeedIds) -> None:
    # Alias prefixes keep the registry layout of the former literal ids
    # (ev_0… for the three fixed functional weeks, ev_fixed_0… for the
    # visual fixed week).
    await _seed_activities_for(session, ids, "ev", [
        (WEEK_START, _ACTIVITIES_RAW),
        (WEEK2_START, _ACTIVITIES_RAW_WEEK2),
        (WEEK3_START, _ACTIVITIES_RAW_WEEK3),
    ])
    # Fixed reference week with distinct alias prefix for visual regression
    # baselines.
    await _seed_activities_for(session, ids, "ev_fixed", [
        (WEEK_FIXED_START, _ACTIVITIES_RAW_FIXED),
    ])


async def _seed_activities_for(
    session: AsyncSession,
    ids: _SeedIds,
    alias_prefix: str,
    weeks: list[tuple[datetime, list[_ActivityRow]]],
) -> None:
    """Seed activities for a list of weeks under the given alias prefix."""
    idx = 0
    for week_start, activities in weeks:
        for day, master, start_h, dur_h, svc_name, loc, cap, is_priv in activities:
            alias = f"{alias_prefix}_{idx}"
            idx += 1
            hour = int(start_h)
            minute = 30 if start_h % 1 else 0
            start_dt = (week_start + timedelta(days=day)).replace(hour=hour, minute=minute)
            duration_min = int(dur_h * 60)
            activity = Activity(
                id=_new_id(),
                master_id=ids.get("staff", master),
                service_id=ids.get("services", _SERVICE_NAME_TO_ALIAS[svc_name]),
                location_id=ids.get("locations", loc),
                start=start_dt,
                duration=duration_min,
                capacity=cap,
                is_private=is_priv,
            )
            ids.put("activities", alias, activity.id)
            session.add(activity)


_CLIENT_RAW: list[tuple[str, dict[str, str | None]]] = [
    ("c1", {"name": "Анна Иванова", "phone": "+79001234567", "email": "anna@example.com", "channel": "telegram"}),
    ("c2", {"name": "Мария Петрова", "phone": "+79002345678", "email": None, "channel": "max"}),
    ("c3", {"name": "Елена Сидорова", "phone": "+79003456789", "email": None, "channel": "telegram"}),
    ("c4", {"name": "Дмитрий Козлов", "phone": "+79004567890", "email": None, "channel": "whatsapp"}),
    ("c5", {"name": "Ольга Новикова", "phone": "+79005678901", "email": None, "channel": "telegram"}),
]


async def _seed_clients(session: AsyncSession, ids: _SeedIds) -> None:
    # Explicit row type: the literals mix ``email: str`` and ``email: None``,
    # and mypy's join of dict[str, str] and dict[str, None] is ``object``
    # (dict invariance) — which would break ``Client(**c)`` below.
    for alias, fields in _CLIENT_RAW:
        client = Client(id=_new_id(), **fields)
        ids.put("clients", alias, client.id)
        session.add(client)


# (alias, client alias, name, age)
_VISITOR_RAW: list[tuple[str, str, str, int]] = [
    ("vis1", "c1", "Анна Иванова", 30),
    ("vis2", "c1", "Софья Иванова", 8),
    ("vis3", "c2", "Мария Петрова", 28),
    ("vis4", "c2", "Артём Петров", 6),
    ("vis5", "c3", "Елена Сидорова", 35),
    ("vis6", "c3", "Максим Сидоров", 10),
    ("vis7", "c4", "Дмитрий Козлов", 40),
    ("vis8", "c5", "Ольга Новикова", 32),
    ("vis9", "c5", "Лиза Новикова", 7),
    ("vis10", "c4", "Алиса Козлова", 12),
]


async def _seed_visitors(session: AsyncSession, ids: _SeedIds) -> None:
    for alias, client_alias, name, age in _VISITOR_RAW:
        visitor = Visitor(
            id=_new_id(),
            client_id=ids.get("clients", client_alias),
            name=name,
            age=age,
        )
        ids.put("visitors", alias, visitor.id)
        session.add(visitor)


# (alias, activity alias, client alias, status, seats)
_RECORD_RAW: list[tuple[str, str, str, VisitStatus, int]] = [
    ("r1", "ev_fixed_0", "c1", VisitStatus.VISITED, 2),
    ("r2", "ev_fixed_1", "c2", VisitStatus.VISITED, 2),
    ("r3", "ev_fixed_2", "c3", VisitStatus.VISITED, 2),
    ("r4", "ev_fixed_3", "c1", VisitStatus.VISITED, 1),
    ("r5", "ev_fixed_5", "c5", VisitStatus.WAITING, 2),
    ("r6", "ev_fixed_8", "c4", VisitStatus.WAITING, 1),
]


async def _seed_records(session: AsyncSession, ids: _SeedIds) -> None:
    for alias, activity_alias, client_alias, status, seats in _RECORD_RAW:
        record = Record(
            id=_new_id(),
            activity_id=ids.get("activities", activity_alias),
            client_id=ids.get("clients", client_alias),
            status=status,
            seats=seats,
            comment=None,
        )
        ids.put("records", alias, record.id)
        session.add(record)


# (alias, record alias, visitor alias, tariff alias, price, status)
_VISIT_RAW: list[tuple[str, str, str, str, int, VisitStatus]] = [
    ("v1", "r1", "vis1", "t7a", 3500, VisitStatus.VISITED),
    ("v2", "r1", "vis2", "t7c", 2500, VisitStatus.VISITED),
    ("v3", "r2", "vis3", "t5a", 2200, VisitStatus.VISITED),
    ("v4", "r2", "vis4", "t5c", 1800, VisitStatus.VISITED),
    ("v5", "r3", "vis5", "t2a", 2800, VisitStatus.VISITED),
    ("v6", "r3", "vis6", "t2c", 2000, VisitStatus.VISITED),
    ("v7", "r4", "vis1", "t3a", 2000, VisitStatus.VISITED),
    ("v8", "r5", "vis8", "t7a", 3800, VisitStatus.WAITING),
    ("v9", "r5", "vis9", "t7c", 2800, VisitStatus.WAITING),
    ("v10", "r6", "vis7", "t7a", 3800, VisitStatus.WAITING),
]


async def _seed_visits(session: AsyncSession, ids: _SeedIds) -> None:
    for alias, record_alias, visitor_alias, tariff_alias, price, status in _VISIT_RAW:
        visit = Visit(
            id=_new_id(),
            record_id=ids.get("records", record_alias),
            visitor_id=ids.get("visitors", visitor_alias),
            tariff_id=ids.get("tariffs", tariff_alias),
            price=price,
            status=status,
        )
        ids.put("visits", alias, visit.id)
        session.add(visit)


# (alias, record alias, amount, method)
_PAYMENT_RAW: list[tuple[str, str, int, str]] = [
    ("p1", "r1", 6000, "card"),
    ("p2", "r2", 4000, "card"),
    ("p3", "r3", 4800, "transfer"),
    ("p4", "r4", 2000, "cash"),
    ("p5", "r5", 6600, "card"),
    ("p6", "r6", 1500, "cash"),
]


async def _seed_payments(session: AsyncSession, ids: _SeedIds) -> None:
    for alias, record_alias, amount, method in _PAYMENT_RAW:
        payment = Payment(
            id=_new_id(),
            record_id=ids.get("records", record_alias),
            amount=amount,
            method=method,
        )
        ids.put("payments", alias, payment.id)
        session.add(payment)


async def _seed_service_tags(session: AsyncSession, ids: _SeedIds) -> None:
    """Link services to tags via service_tags join table."""
    # (service alias, tag alias)
    links = [
        ("s1", "tag2"),  # хит
        ("s1", "tag4"),  # популярное
        ("s2", "tag4"),  # популярное
        ("s4", "tag3"),  # для детей
        ("s5", "tag3"),  # для детей
        ("s7", "tag1"),  # новинка
        ("s7", "tag2"),  # хит
    ]
    for service_alias, tag_alias in links:
        service_id = ids.get("services", service_alias)
        tag_id = ids.get("tags", tag_alias)
        result = await session.execute(
            select(service_tags).where(
                service_tags.c.service_id == service_id,
                service_tags.c.tag_id == tag_id,
            )
        )
        if not result.first():
            await session.execute(
                service_tags.insert().values(service_id=service_id, tag_id=tag_id)
            )


async def _seed_service_materials(session: AsyncSession, ids: _SeedIds) -> None:
    """Link services to materials via service_materials (GH #223 §10).

    Idiom: ``_seed_service_tags``. Dev/demo data must exercise the feature:
    ≥3 links across ≥3 services, at least one with a per-link ``note``
    (renders instead of the material description on the client screen).
    Material aliases follow ``_seed_materials``: mat1 масло, mat2 акрил,
    mat3 акварель, mat4 гуашь.
    """
    # (service alias, material alias, note)
    links = [
        ("s1", "mat1", None),  # Картина маслом — масло
        # s2 «Картина акрилом» stays UNLINKED — the web S6 scenario pins a
        # no-links service (no materials block on the client screen).
        ("s3", "mat2", None),  # Мини-картина акрилом — акрил
        ("s4", "mat3", None),  # Акварель — акварель
        # s7 «Морской пейзаж» — the web S6 scenario data: two links, chip =
        # first by title ASC (Акварель), note-vs-description fallback demo.
        ("s7", "mat3", None),  # Акварель, note NULL → falls back to description
        ("s7", "mat1", "Масляные краски для морского пейзажа"),  # Масло + note
    ]
    for service_alias, material_alias, note in links:
        service_id = ids.get("services", service_alias)
        material_id = ids.get("materials", material_alias)
        result = await session.execute(
            select(ServiceMaterial).where(
                ServiceMaterial.service_id == service_id,
                ServiceMaterial.material_id == material_id,
            )
        )
        if not result.first():
            session.add(
                ServiceMaterial(
                    service_id=service_id, material_id=material_id, note=note
                )
            )


async def _seed_activity_tags(session: AsyncSession, ids: _SeedIds) -> None:
    """Link activities to tags via activity_tags join table."""
    # (activity alias, tag alias)
    links = [
        ("ev_0", "tag1"),  # новинка
        ("ev_0", "tag6"),  # сезонное
    ]
    for activity_alias, tag_alias in links:
        activity_id = ids.get("activities", activity_alias)
        tag_id = ids.get("tags", tag_alias)
        result = await session.execute(
            select(activity_tags).where(
                activity_tags.c.activity_id == activity_id,
                activity_tags.c.tag_id == tag_id,
            )
        )
        if not result.first():
            await session.execute(
                activity_tags.insert().values(activity_id=activity_id, tag_id=tag_id)
            )


async def _seed_photos(session: AsyncSession, ids: _SeedIds) -> None:
    """Seed 9 photos with mutually exclusive owners (GH #211).

    Layout (L1=«Альпика» alias alpika, T1=tag1 «новинка», T2=tag2 «хит»):
    - ph1, ph2 — client-owned by the SAME client (c1); filenames share the
      substring "client" for q-search e2e
    - ph3 — service-owned card image (s1)
    - ph4 — location-OWNED interior shot (alpika) → scenario 5 pin: location
      filter L1 returns only this photo, not the activity-owned ones
    - ph5 — owner-less tag-pair photo ([T1, T2]) → tags AND demo
    - ph6, ph7 — activity-owned guest photos (tag 'гость'); both activities
      are located at L1='alpika'; ph6 additionally carries T1 only
    - ph_c1_private — c1's NON-public photo (#513 С3: the cabinet shows it
      with «Не опубликовано», the guest gallery must not show it)
    - ph_c2_private — c2's NON-public photo (#513 С2: second-client
      isolation on the photos screen; c2 already carries record+payment)

    Both #513 delta rows are non-public, so the public gallery feed
    (``is_public=true``) stays exactly the 7 original photos. The
    filenames deliberately avoid the "client" substring — the admin
    q-search e2e pins ph1/ph2 by it.
    """
    # (alias, fields with FK aliases)
    photos: list[tuple[str, dict[str, object]]] = [
        ("ph1", {"filename": "/images/client-work-1.jpg",
                 "client_id": ids.get("clients", "c1"),
                 "is_public": True, "created_at": PHOTO_FIXED_DATES["ph1"]}),
        ("ph2", {"filename": "/images/client-work-2.jpg",
                 "client_id": ids.get("clients", "c1"),
                 "is_public": True, "created_at": PHOTO_FIXED_DATES["ph2"]}),
        ("ph3", {"filename": "/images/card-seascape.jpg",
                 "service_id": ids.get("services", "s1"),
                 "is_public": True, "created_at": PHOTO_FIXED_DATES["ph3"]}),
        ("ph4", {"filename": "/images/studio-alpika-interior.jpg",
                 "location_id": ids.get("locations", "alpika"),
                 "is_public": True, "created_at": PHOTO_FIXED_DATES["ph4"]}),
        ("ph5", {"filename": "/images/tag-pair.jpg", "is_public": True,
                 "created_at": PHOTO_FIXED_DATES["ph5"]}),
        # ev_1 and ev_4 both run at location 'alpika' (L1) — see
        # _ACTIVITIES_RAW indices 1 and 4.
        ("ph6", {"filename": "/images/guest-1.jpg",
                 "activity_id": ids.get("activities", "ev_1"),
                 "is_public": True, "created_at": PHOTO_FIXED_DATES["ph6"]}),
        ("ph7", {"filename": "/images/guest-2.jpg",
                 "activity_id": ids.get("activities", "ev_4"),
                 "is_public": True, "created_at": PHOTO_FIXED_DATES["ph7"]}),
        ("ph_c1_private", {"filename": "/images/cabinet-draft.jpg",
                           "client_id": ids.get("clients", "c1"),
                           "is_public": False,
                           "created_at": PHOTO_FIXED_DATES["ph_c1_private"]}),
        ("ph_c2_private", {"filename": "/images/maria-canvas.jpg",
                           "client_id": ids.get("clients", "c2"),
                           "is_public": False,
                           "created_at": PHOTO_FIXED_DATES["ph_c2_private"]}),
    ]
    for alias, fields in photos:
        photo = Photo(id=_new_id(), **fields)
        ids.put("photos", alias, photo.id)
        session.add(photo)
    # Flush photo rows so the photo_tags FK insert below sees them (#207 §11.3).
    await session.flush()

    # Tag links: guest ×2 activity photos, T1+T2 pair, T1 single (AND demo).
    # (photo alias, tag alias)
    tag_links = [
        ("ph5", "tag1"),  # T1
        ("ph5", "tag2"),  # T2 — ph5 carries BOTH → tags AND filter demo
        ("ph6", "tag7"),  # гость
        ("ph6", "tag1"),  # + T1 only → excluded when T1+T2 AND-filtered
        ("ph7", "tag7"),  # гость
    ]
    for photo_alias, tag_alias in tag_links:
        photo_id = ids.get("photos", photo_alias)
        tag_id = ids.get("tags", tag_alias)
        result = await session.execute(
            select(photo_tags).where(
                photo_tags.c.photo_id == photo_id,
                photo_tags.c.tag_id == tag_id,
            )
        )
        if not result.first():
            await session.execute(
                photo_tags.insert().values(photo_id=photo_id, tag_id=tag_id)
            )


# (alias, title, description)
_MATERIAL_RAW: list[tuple[str, str, str]] = [
    ("mat1", "Масло", "Масляные краски — классика живописи. Густые, насыщенные, сохнут долго."),
    ("mat2", "Акрил", "Акриловые краски — быстросохнущие, яркие, подходят для любых поверхностей."),
    ("mat3", "Акварель", "Акварельные краски — прозрачные, нежные, требуют специальной бумаги."),
    ("mat4", "Гуашь", "Гуашь — плотные матовые краски на водной основе, идеальны для детей."),
]


async def _seed_materials(session: AsyncSession, ids: _SeedIds) -> None:
    """Seed material references (art techniques)."""
    for alias, title, description in _MATERIAL_RAW:
        material = Material(id=_new_id(), title=title, description=description)
        ids.put("materials", alias, material.id)
        session.add(material)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def seed_data(manager: DBManager) -> None:
    """Seed the database with mock development data.

    Contract: assumes an EMPTY database — see module docstring.
    Running on a populated DB raises IntegrityError (intended fail-loud).
    """
    # Ensure tables exist.
    async with manager.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    ids = _SeedIds()
    async with manager.async_session() as session:
        # FK=ON (#207 §11.3): SQLAlchemy's unit-of-work orders inserts by
        # relationships, NOT by bare FK constraints — and most seed rows
        # reference parents by plain-string FK (no relationship), so a single
        # end-of-flow flush can emit children before parents and trip FK.
        # The _seed_* calls below are already in dependency order, so a flush
        # after each guarantees each parent batch is in the DB before later
        # batches reference it (through the alias registry).
        await _seed_masters(session, ids)
        await session.flush()
        await _seed_locations(session, ids)
        await session.flush()
        await _seed_services(session, ids)
        await session.flush()
        await _seed_tariffs(session, ids)
        await session.flush()
        await _seed_tags(session, ids)
        await session.flush()
        await _seed_activities(session, ids)
        await session.flush()
        await _seed_clients(session, ids)
        await session.flush()
        await _seed_visitors(session, ids)
        await session.flush()
        await _seed_records(session, ids)
        await session.flush()
        await _seed_visits(session, ids)
        await session.flush()
        await _seed_payments(session, ids)
        await session.flush()
        await _seed_service_tags(session, ids)
        await _seed_activity_tags(session, ids)
        await _seed_photos(session, ids)
        await _seed_materials(session, ids)
        await _seed_service_materials(session, ids)
        # GH #247 §3.11 — demo staff accounts, never in production ENV.
        if os.environ.get("ENV", "development") != "production":
            await seed_staff_users(session)
        await session.commit()


async def main() -> None:
    """Entry point: connect, seed, disconnect."""
    database_url = os.environ.get(
        "DATABASE_URL", "sqlite+aiosqlite:///./memo.db"
    )
    manager = DBManager(database_url)
    try:
        await seed_data(manager)
        print("Database seeded successfully.")
    finally:
        await manager.engine.dispose()


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
