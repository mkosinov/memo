"""RecordService.list_view — display fields for the records view (GH #213 Task 3).

Service-level contract tests for the composite read query:
  - archived client/master/service/location RESOLVE their names (no
    is_active filters on display resolution — US-3, photos precedent)
  - anonymous record → client_name None
  - master_name composed «Фамилия Имя» (displayMasterName parity)
  - paid = COALESCE(SUM(Payment.amount), 0) — none/partial/full → 0/sum/total
  - is_private passthrough from the INNER-joined Activity
  - activity_start string is BYTE-IDENTICAL to the ActivityResponse.start
    serialization for the same row (parseActivityStart parity)
  - PaginatedResponse envelope + nested visits (selectinload through the
    multi-column select)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

import pytest

from src.models.activity import Activity
from src.models.client import Client
from src.models.location import Location
from src.models.master import Master
from src.models.payment import Payment
from src.models.record import Record
from src.models.service import Service
from src.models.visit import Visit
from src.schemas.activity import ActivityResponse
from src.schemas.record import RecordListParams
from src.services.record import get_record_service

pytestmark = pytest.mark.asyncio

# Fixed naive datetimes (SQLite roundtrips naive DATETIME; µs and 0-µs
# shapes both locked — pydantic trims/keeps microseconds identically to
# isoformat only for naive values).
START_PLAIN = datetime(2026, 9, 3, 15, 0, 0)
START_MICRO = datetime(2026, 9, 4, 16, 30, 45, 123456)


@dataclass
class _World:
    """Minimal ORM world: master/service/location/client/activity/record."""

    master: Master
    service: Service
    location: Location
    client: Client
    activity: Activity
    record: Record
    payments: list[Payment] = field(default_factory=list)


async def _seed_world(
    db_session,
    *,
    master_kwargs: dict | None = None,
    service_kwargs: dict | None = None,
    location_kwargs: dict | None = None,
    client_kwargs: dict | None = None,
    activity_kwargs: dict | None = None,
    record_kwargs: dict | None = None,
    payment_amounts: list[int] | None = None,
) -> _World:
    """Create one master/service/location/client/activity/record chain via ORM.

    All ``*_kwargs`` override ORM constructor args (e.g. ``is_active=False``
    to seed archived entities — impossible via the API factories).
    """
    master = Master(
        **{
            "first_name": "Имя",
            "last_name": "Фамилия",
            "color": "#5B8C7A",
            "position": "мастер",
            "specialty": "живопись",
            **(master_kwargs or {}),
        }
    )
    service = Service(
        **{
            "title": "Картина маслом",
            "description": "desc",
            "image_url": "https://example.com/x.jpg",
            "specialty": "живопись",
            "min_age": 6,
            "max_age": 99,
            "duration": 90,
            "record_info": "test",
            **(service_kwargs or {}),
        }
    )
    location = Location(
        **{
            "name": "Студия",
            "address": "Адрес",
            "capacity": 20,
            **(location_kwargs or {}),
        }
    )
    client = Client(
        **{
            "name": "Анна",
            "phone": None,
            "channel": "phone",
            **(client_kwargs or {}),
        }
    )
    db_session.add_all([master, service, location, client])
    await db_session.flush()

    activity = Activity(
        **{
            "master_id": master.id,
            "service_id": service.id,
            "location_id": location.id,
            "start": START_PLAIN,
            "duration": 90,
            "capacity": 10,
            **(activity_kwargs or {}),
        }
    )
    db_session.add(activity)
    await db_session.flush()

    record_fields = {
        "activity_id": activity.id,
        "client_id": client.id,
        "status": "waiting",
        "seats": 1,
        **(record_kwargs or {}),
    }
    record = Record(**record_fields)
    db_session.add(record)
    await db_session.flush()

    db_session.add(Visit(record_id=record.id, price=3500, status="waiting"))
    payments = [
        Payment(record_id=record.id, amount=amount, method="cash")
        for amount in (payment_amounts or [])
    ]
    db_session.add_all(payments)
    await db_session.flush()

    # Refresh so assertions read DB-roundtripped values (per-object refresh,
    # NOT expire_all — a second _seed_world would cross-expire the first
    # world's objects and trip MissingGreenlet on sync attribute access).
    for obj in (master, service, location, client, activity, record):
        await db_session.refresh(obj)
    return _World(
        master=master,
        service=service,
        location=location,
        client=client,
        activity=activity,
        record=record,
        payments=payments,
    )


async def _list_view(db_session, **params):
    """Call RecordService.list_view with RecordListParams defaults + overrides."""
    service = get_record_service()
    return await service.list_view(db_session, RecordListParams(**params))


async def test_archived_entities_resolve_display_names(db_session) -> None:
    """Archived client/master/service/location still resolve names + color (US-3).

    Display subqueries carry NO is_active filter — names come back real,
    not '—'. master_name is composed «Фамилия Имя» (displayMasterName).
    """
    await _seed_world(
        db_session,
        master_kwargs={"is_active": False, "last_name": "Архивова", "first_name": "Мария"},
        service_kwargs={"is_active": False, "title": "Архивная услуга"},
        location_kwargs={"is_active": False, "name": "Архивная студия"},
        client_kwargs={"is_active": False, "name": "Архивный Клиент"},
    )

    result = await _list_view(db_session)

    assert result.total == 1
    item = result.items[0]
    assert item.client_name == "Архивный Клиент"
    assert item.service_title == "Архивная услуга"
    assert item.location_name == "Архивная студия"
    assert item.master_name == "Архивова Мария"  # «Фамилия Имя»
    assert item.master_color == "#5B8C7A"


async def test_anonymous_record_client_name_none(db_session) -> None:
    """Record with client_id=None (anonymous) → client_name None."""
    await _seed_world(db_session, record_kwargs={"client_id": None})

    result = await _list_view(db_session)

    assert result.total == 1
    assert result.items[0].client_name is None


async def test_paid_none_partial_full(db_session) -> None:
    """paid = COALESCE(SUM(Payment.amount), 0): none → 0, partial → sum, full → total."""
    none_world = await _seed_world(db_session)  # no payments
    partial_world = await _seed_world(db_session, payment_amounts=[1000])
    full_world = await _seed_world(db_session, payment_amounts=[2000, 1500])

    result = await _list_view(db_session)

    assert result.total == 3
    by_id = {item.id: item for item in result.items}
    assert by_id[none_world.record.id].paid == 0
    assert by_id[partial_world.record.id].paid == 1000
    assert by_id[full_world.record.id].paid == 3500
    assert all(isinstance(item.paid, int) for item in result.items)


async def test_is_private_passthrough(db_session) -> None:
    """is_private passes through from the INNER-joined Activity (bool)."""
    public_world = await _seed_world(db_session, activity_kwargs={"is_private": False})
    private_world = await _seed_world(db_session, activity_kwargs={"is_private": True})

    result = await _list_view(db_session)

    by_id = {item.id: item for item in result.items}
    assert by_id[public_world.record.id].is_private is False
    assert by_id[private_world.record.id].is_private is True


async def test_activity_start_byte_parity_with_activity_response(db_session) -> None:
    """activity_start string == ActivityResponse.start JSON serialization.

    Both the 0-microsecond and the microsecond-carrying shapes are locked —
    parseActivityStart/formatDateRu slice the string, so byte parity is
    load-bearing.
    """
    plain_world = await _seed_world(db_session)  # start=START_PLAIN
    micro_world = await _seed_world(db_session, activity_kwargs={"start": START_MICRO})

    result = await _list_view(db_session)

    by_id = {item.id: item for item in result.items}
    for world in (plain_world, micro_world):
        expected = ActivityResponse.model_validate(world.activity).model_dump(mode="json")["start"]
        assert by_id[world.record.id].activity_start == expected


async def test_envelope_and_nested_visits(db_session) -> None:
    """PaginatedResponse envelope {items, total, page, per_page} + visits loaded.

    The multi-column select must keep selectinload alive: row[0] carries
    the nested visits exactly like GET /records items.
    """
    world = await _seed_world(db_session)

    result = await _list_view(db_session, page=1, per_page=20)

    assert result.total == 1
    assert result.page == 1
    assert result.per_page == 20
    item = result.items[0]
    assert item.id == world.record.id
    assert item.activity_id == world.activity.id
    assert item.client_id == world.client.id
    assert item.status == "waiting"
    assert item.seats == 1
    assert len(item.visits) == 1
    assert item.visits[0].price == 3500
