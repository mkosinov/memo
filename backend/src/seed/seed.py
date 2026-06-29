"""Seed script — populates the database with mock data for development.

Usage:
    uv run python -m seed.seed          # direct module
    uv run python -m seed               # via __main__
    DATABASE_URL=sqlite+aiosqlite:///./memo.db uv run python -m seed
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta

# ruff: noqa: RUF001, RUF003  -- Cyrillic text is intentional (Russian language app)
from sqlalchemy import select

from src.db.base import Base
from src.db.database import DBManager
from src.models import (
    Activity,
    Client,
    Location,
    Master,
    Material,
    Payment,
    Photo,
    Record,
    Service,
    Tag,
    Tariff,
    Visit,
    Visitor,
)
from src.models.photo import photo_tags
from src.models.tag import activity_tags, service_tags

# ---------------------------------------------------------------------------
# Seed data constants
# ---------------------------------------------------------------------------

def _get_week_monday(dt: datetime) -> datetime:
    """Return the Monday of the week containing *dt*."""
    return dt - timedelta(days=dt.weekday())


_today = datetime.now()
_THIS_WEEK_MONDAY = _get_week_monday(_today)
_LAST_WEEK_MONDAY = _THIS_WEEK_MONDAY - timedelta(days=7)
_WEEK_BEFORE_MONDAY = _THIS_WEEK_MONDAY - timedelta(days=14)

WEEK_START = _WEEK_BEFORE_MONDAY  # week before last — records r1-r6 link here
WEEK2_START = _LAST_WEEK_MONDAY   # last week
WEEK3_START = _THIS_WEEK_MONDAY   # current week (so e2e tests find activities)

_SERVICE_NAME_TO_ID: dict[str, str] = {
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
_ACTIVITIES_RAW: list[tuple] = [
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

# Activities for week 2 (June 9-15, 2026)
_ACTIVITIES_RAW_WEEK2: list[tuple] = [
    # ПН (day 0) — June 9
    (0, "m1", 10, 3, "Морской пейзаж", "grand", 8, False),
    # ВТ (day 1) — June 10
    (1, "m3", 11, 2, "Картина акрилом", "alpika", 10, False),
    # СР (day 2) — June 11
    (2, "m2", 10, 2, "Роспись одежды", "alpika", 10, False),
    # ЧТ (day 3) — June 12
    (3, "m1", 10, 3, "Морской пейзаж", "grand", 8, False),
    # ПТ (day 4) — June 13
    (4, "m5", 14, 2.5, "Картина маслом", "p1389", 8, False),
    # СБ (day 5) — June 14
    (5, "m1", 10, 3, "Морской пейзаж", "grand", 8, False),
    (5, "m3", 14, 2, "Картина акрилом", "alpika", 10, False),
    # ВС (day 6) — June 15
    (6, "m2", 11, 1.5, "Ручная лепка", "alpika", 6, False),
]

# Activities for week 3 (current week — always fresh relative to today)
_ACTIVITIES_RAW_WEEK3: list[tuple] = [
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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _exists(session, model, id_value: str) -> bool:
    """Return True if a row with the given primary key exists."""
    result = await session.execute(select(model).where(model.id == id_value))
    return result.scalar_one_or_none() is not None


# ---------------------------------------------------------------------------
# Seed functions
# ---------------------------------------------------------------------------

async def _seed_masters(session) -> None:
    masters = [
        {"id": "m1", "first_name": "Ольга", "last_name": "Середа", "color": "#5B8C7A", "specialty": "живопись", "position": "мастер", "sort_order": 0},
        {"id": "m2", "first_name": "Юлия", "last_name": "Большакова", "color": "#6B7E9C", "specialty": "керамика", "position": "мастер", "sort_order": 1},
        {"id": "m3", "first_name": "Анастасия", "last_name": "П.", "color": "#A07060", "specialty": "живопись", "position": "мастер", "sort_order": 2},
        {"id": "m4", "first_name": "Дарья", "last_name": "Тюльпина", "color": "#7A6E9C", "specialty": "керамика", "position": "мастер", "sort_order": 3},
        {"id": "m5", "first_name": "Александра", "last_name": "В.", "color": "#8A7840", "specialty": "живопись", "position": "мастер", "sort_order": 4},
        {"id": "m7", "first_name": "Ирина", "last_name": "Горох", "color": "#9A5870", "specialty": "керамика", "position": "мастер", "sort_order": 5},
    ]
    for m in masters:
        if not await _exists(session, Master, m["id"]):
            session.add(Master(**m))


async def _seed_locations(session) -> None:
    locations = [
        {"id": "alpika", "name": "Альпика", "address": "Альпика, 1 этаж", "capacity": 10,
         "location_hint": "1 этаж, светлая студия с панорамными окнами", "sort_order": 0},
        {"id": "grand", "name": "Гранд Отель Поляна", "address": "Гранд Отель, лобби", "capacity": 12,
         "location_hint": "Лобби отеля, зона у ресепшн", "sort_order": 1},
        {"id": "p1389", "name": "Поляна 1389", "address": "Поляна 1389, 2 этаж", "capacity": 8,
         "location_hint": "2 этаж, рядом с детской зоной", "sort_order": 2},
    ]
    for loc in locations:
        if not await _exists(session, Location, loc["id"]):
            session.add(Location(**loc))


async def _seed_services(session) -> None:
    services = [
        {"id": "s1", "title": "Картина маслом", "description": "Масляная живопись на холсте",
         "image_url": "/images/card-seascape.jpg", "specialty": "живопись",
         "min_age": 12, "max_age": None, "duration": 150, "record_info": "",
         "material_hint": "Масляные краски, холст на подрамнике 40×50 см, набор кистей, мастихин"},
        {"id": "s2", "title": "Картина акрилом", "description": "Акриловая живопись на холсте",
         "image_url": "/images/card-mountain-acrylic.jpg", "specialty": "живопись",
         "min_age": 6, "max_age": None, "duration": 120, "record_info": "",
         "material_hint": "Акриловые краски, холст 30×40 см, кисти, палитра"},
        {"id": "s3", "title": "Мини-картина акрилом", "description": "Миниатюра акрилом на маленьком холсте",
         "image_url": "/images/card-watercolor.jpg", "specialty": "живопись",
         "min_age": 6, "max_age": None, "duration": 90, "record_info": "",
         "material_hint": "Акриловые краски, холст 20×30 см, кисти"},
        {"id": "s4", "title": "Акварель", "description": "Акварельная живопись",
         "image_url": "/images/card-watercolor.jpg", "specialty": "живопись",
         "min_age": 6, "max_age": 12, "duration": 150, "record_info": "",
         "material_hint": "Акварельные краски, бумага A3 300 г/м², кисти"},
        {"id": "s5", "title": "Ручная лепка", "description": "Лепка из глины",
         "image_url": "/images/card-animals.jpg", "specialty": "керамика",
         "min_age": 5, "max_age": None, "duration": 90, "record_info": "",
         "material_hint": "Глина, стек, вода, фартук"},
        {"id": "s6", "title": "Роспись одежды", "description": "Роспись футболки или шоппера",
         "image_url": "/images/card-shopper.jpg", "specialty": "живопись",
         "min_age": 8, "max_age": None, "duration": 120, "record_info": "",
         "material_hint": "Текстильные краски, шоппер из хлопка, трафареты, кисти"},
        {"id": "s7", "title": "Морской пейзаж", "description": "Морской пейзаж маслом",
         "image_url": "/images/card-seascape.jpg", "specialty": "живопись",
         "min_age": 12, "max_age": None, "duration": 180, "record_info": "",
         "material_hint": "Масляные краски, холст 50×60 см, набор кистей, мастихин"},
    ]
    for s in services:
        if not await _exists(session, Service, s["id"]):
            session.add(Service(**s))


async def _seed_tariffs(session) -> None:
    # (service_id, title, price)
    tariff_data = [
        # s1 — Картина маслом
        ("t1a", "s1", "Взрослый", 3500),
        ("t1c", "s1", "Детский", 2500),
        ("t1i", "s1", "Индивидуальный", 5000),
        # s2 — Картина акрилом
        ("t2a", "s2", "Взрослый", 2800),
        ("t2c", "s2", "Детский", 2000),
        ("t2i", "s2", "Индивидуальный", 4000),
        # s3 — Мини-картина акрилом
        ("t3a", "s3", "Взрослый", 2000),
        ("t3c", "s3", "Детский", 1500),
        ("t3i", "s3", "Индивидуальный", 3000),
        # s4 — Акварель
        ("t4a", "s4", "Взрослый", 2800),
        ("t4c", "s4", "Детский", 2000),
        ("t4i", "s4", "Индивидуальный", 4000),
        # s5 — Ручная лепка
        ("t5a", "s5", "Взрослый", 2200),
        ("t5c", "s5", "Детский", 1800),
        ("t5i", "s5", "Индивидуальный", 3500),
        # s6 — Роспись одежды
        ("t6a", "s6", "Взрослый", 3200),
        ("t6c", "s6", "Детский", 2500),
        ("t6i", "s6", "Индивидуальный", 4500),
        # s7 — Морской пейзаж
        ("t7a", "s7", "Взрослый", 3800),
        ("t7c", "s7", "Детский", 2800),
        ("t7i", "s7", "Индивидуальный", 5500),
    ]
    for tid, sid, title, price in tariff_data:
        if not await _exists(session, Tariff, tid):
            session.add(Tariff(id=tid, service_id=sid, title=title, price=price))


async def _seed_tags(session) -> None:
    tag_names = ["новинка", "хит", "для детей", "популярное", "индивидуальное", "сезонное", "гость"]
    for i, name in enumerate(tag_names, start=1):
        tag_id = f"tag{i}"
        if not await _exists(session, Tag, tag_id):
            session.add(Tag(id=tag_id, tag=name))


async def _seed_activities(session) -> None:
    idx = 0
    for week_start, activities in [
        (WEEK_START, _ACTIVITIES_RAW),
        (WEEK2_START, _ACTIVITIES_RAW_WEEK2),
        (WEEK3_START, _ACTIVITIES_RAW_WEEK3),
    ]:
        for day, master, start_h, dur_h, svc_name, loc, cap, is_priv in activities:
            activity_id = f"ev_{idx}"
            idx += 1
            if await _exists(session, Activity, activity_id):
                continue
            service_id = _SERVICE_NAME_TO_ID[svc_name]
            hour = int(start_h)
            minute = 30 if start_h % 1 else 0
            start_dt = (week_start + timedelta(days=day)).replace(hour=hour, minute=minute)
            duration_min = int(dur_h * 60)
            session.add(Activity(
                id=activity_id,
                master_id=master,
                service_id=service_id,
                location_id=loc,
                start=start_dt,
                duration=duration_min,
                capacity=cap,
                is_private=is_priv,
            ))


async def _seed_clients(session) -> None:
    clients = [
        {"id": "c1", "name": "Анна Иванова", "phone": "+79001234567", "email": "anna@example.com", "channel": "telegram"},
        {"id": "c2", "name": "Мария Петрова", "phone": "+79002345678", "email": None, "channel": "max"},
        {"id": "c3", "name": "Елена Сидорова", "phone": "+79003456789", "email": None, "channel": "telegram"},
        {"id": "c4", "name": "Дмитрий Козлов", "phone": "+79004567890", "email": None, "channel": "whatsapp"},
        {"id": "c5", "name": "Ольга Новикова", "phone": "+79005678901", "email": None, "channel": "telegram"},
    ]
    for c in clients:
        if not await _exists(session, Client, c["id"]):
            session.add(Client(**c))


async def _seed_visitors(session) -> None:
    visitors = [
        {"id": "vis1", "client_id": "c1", "name": "Анна Иванова", "age": 30},
        {"id": "vis2", "client_id": "c1", "name": "Софья Иванова", "age": 8},
        {"id": "vis3", "client_id": "c2", "name": "Мария Петрова", "age": 28},
        {"id": "vis4", "client_id": "c2", "name": "Артём Петров", "age": 6},
        {"id": "vis5", "client_id": "c3", "name": "Елена Сидорова", "age": 35},
        {"id": "vis6", "client_id": "c3", "name": "Максим Сидоров", "age": 10},
        {"id": "vis7", "client_id": "c4", "name": "Дмитрий Козлов", "age": 40},
        {"id": "vis8", "client_id": "c5", "name": "Ольга Новикова", "age": 32},
        {"id": "vis9", "client_id": "c5", "name": "Лиза Новикова", "age": 7},
        {"id": "vis10", "client_id": "c4", "name": "Алиса Козлова", "age": 12},
    ]
    for v in visitors:
        if not await _exists(session, Visitor, v["id"]):
            session.add(Visitor(**v))


async def _seed_records(session) -> None:
    records = [
        {"id": "r1", "activity_id": "ev_0", "client_id": "c1", "status": "visited", "seats": 2, "comment": None},
        {"id": "r2", "activity_id": "ev_1", "client_id": "c2", "status": "visited", "seats": 2, "comment": None},
        {"id": "r3", "activity_id": "ev_4", "client_id": "c3", "status": "visited", "seats": 2, "comment": None},
        {"id": "r4", "activity_id": "ev_5", "client_id": "c1", "status": "visited", "seats": 1, "comment": None},
        {"id": "r5", "activity_id": "ev_10", "client_id": "c5", "status": "waiting", "seats": 2, "comment": None},
        {"id": "r6", "activity_id": "ev_17", "client_id": "c4", "status": "waiting", "seats": 1, "comment": None},
    ]
    for r in records:
        if not await _exists(session, Record, r["id"]):
            session.add(Record(**r))


async def _seed_visits(session) -> None:
    visits = [
        {"id": "v1", "record_id": "r1", "visitor_id": "vis1", "tariff_id": "t7a", "price": 3500, "status": "visited"},
        {"id": "v2", "record_id": "r1", "visitor_id": "vis2", "tariff_id": "t7c", "price": 2500, "status": "visited"},
        {"id": "v3", "record_id": "r2", "visitor_id": "vis3", "tariff_id": "t5a", "price": 2200, "status": "visited"},
        {"id": "v4", "record_id": "r2", "visitor_id": "vis4", "tariff_id": "t5c", "price": 1800, "status": "visited"},
        {"id": "v5", "record_id": "r3", "visitor_id": "vis5", "tariff_id": "t2a", "price": 2800, "status": "visited"},
        {"id": "v6", "record_id": "r3", "visitor_id": "vis6", "tariff_id": "t2c", "price": 2000, "status": "visited"},
        {"id": "v7", "record_id": "r4", "visitor_id": "vis1", "tariff_id": "t3a", "price": 2000, "status": "visited"},
        {"id": "v8", "record_id": "r5", "visitor_id": "vis8", "tariff_id": "t7a", "price": 3800, "status": "waiting"},
        {"id": "v9", "record_id": "r5", "visitor_id": "vis9", "tariff_id": "t7c", "price": 2800, "status": "waiting"},
        {"id": "v10", "record_id": "r6", "visitor_id": "vis7", "tariff_id": "t7a", "price": 3800, "status": "waiting"},
    ]
    for v in visits:
        if not await _exists(session, Visit, v["id"]):
            session.add(Visit(**v))


async def _seed_payments(session) -> None:
    payments = [
        {"id": "p1", "record_id": "r1", "amount": 6000, "method": "card"},
        {"id": "p2", "record_id": "r2", "amount": 4000, "method": "card"},
        {"id": "p3", "record_id": "r3", "amount": 4800, "method": "transfer"},
        {"id": "p4", "record_id": "r4", "amount": 2000, "method": "cash"},
        {"id": "p5", "record_id": "r5", "amount": 6600, "method": "card"},
        {"id": "p6", "record_id": "r6", "amount": 1500, "method": "cash"},
    ]
    for p in payments:
        if not await _exists(session, Payment, p["id"]):
            session.add(Payment(**p))


async def _seed_service_tags(session) -> None:
    """Link services to tags via service_tags join table."""
    links = [
        ("s1", "tag2"),  # хит
        ("s1", "tag4"),  # популярное
        ("s2", "tag4"),  # популярное
        ("s4", "tag3"),  # для детей
        ("s5", "tag3"),  # для детей
        ("s7", "tag1"),  # новинка
        ("s7", "tag2"),  # хит
    ]
    for service_id, tag_id in links:
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


async def _seed_activity_tags(session) -> None:
    """Link activities to tags via activity_tags join table."""
    links = [
        ("ev_0", "tag1"),  # новинка
        ("ev_0", "tag6"),  # сезонное
    ]
    for activity_id, tag_id in links:
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


async def _seed_photos(session) -> None:
    """Seed public photos linked to services/activities + guest tagged."""
    photos = [
        {"id": "ph1", "filename": "/images/card-seascape.jpg", "service_id": "s1",
         "activity_id": None, "is_public": True},
        {"id": "ph2", "filename": "/images/card-mountain-acrylic.jpg", "service_id": "s2",
         "activity_id": None, "is_public": True},
        {"id": "ph3", "filename": "/images/card-watercolor.jpg", "service_id": "s4",
         "activity_id": None, "is_public": True},
        {"id": "ph4", "filename": "/images/card-family.jpg", "service_id": "s5",
         "activity_id": None, "is_public": True},
        {"id": "ph5", "filename": "/images/card-shopper.jpg", "service_id": "s6",
         "activity_id": None, "is_public": True},
        {"id": "ph6", "filename": "/images/guest-1.jpg", "service_id": None,
         "activity_id": "ev_0", "is_public": True},
        {"id": "ph7", "filename": "/images/guest-2.jpg", "service_id": None,
         "activity_id": "ev_4", "is_public": True},
    ]
    for p in photos:
        if not await _exists(session, Photo, p["id"]):
            session.add(Photo(**p))

    # Tag ph6, ph7 as "гость" via photo_tags
    for photo_id in ["ph6", "ph7"]:
        result = await session.execute(
            select(photo_tags).where(
                photo_tags.c.photo_id == photo_id,
                photo_tags.c.tag_id == "tag7",
            )
        )
        if not result.first():
            await session.execute(
                photo_tags.insert().values(photo_id=photo_id, tag_id="tag7")
            )


async def _seed_materials(session) -> None:
    """Seed material references (art techniques)."""
    materials = [
        {"id": "mat1", "title": "Масло", "description": "Масляные краски — классика живописи. Густые, насыщенные, сохнут долго."},
        {"id": "mat2", "title": "Акрил", "description": "Акриловые краски — быстросохнущие, яркие, подходят для любых поверхностей."},
        {"id": "mat3", "title": "Акварель", "description": "Акварельные краски — прозрачные, нежные, требуют специальной бумаги."},
        {"id": "mat4", "title": "Гуашь", "description": "Гуашь — плотные матовые краски на водной основе, идеальны для детей."},
    ]
    for m in materials:
        if not await _exists(session, Material, m["id"]):
            session.add(Material(**m))


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def seed_data(manager: DBManager) -> None:
    """Seed the database with mock development data.

    Idempotent — safe to run multiple times.
    """
    # Ensure tables exist.
    async with manager.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with manager.async_session() as session:
        await _seed_masters(session)
        await _seed_locations(session)
        await _seed_services(session)
        await _seed_tariffs(session)
        await _seed_tags(session)
        await _seed_activities(session)
        await _seed_clients(session)
        await _seed_visitors(session)
        await _seed_records(session)
        await _seed_visits(session)
        await _seed_payments(session)
        await _seed_service_tags(session)
        await _seed_activity_tags(session)
        await _seed_photos(session)
        await _seed_materials(session)
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
