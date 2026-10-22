"""GH #482 — ``new_record`` event snapshot builder (spec §3.2, family #476 §4.1).

The builder runs BEFORE the scenario's commit, reading ONLY local rows
in the same transaction (``session.get`` / one visits select): the
snapshot must be self-sufficient — the renderer never re-reads the DB.

Contract (family §4.1, fixed here): every top-level key is ALWAYS
present; values may be null (client not linked, tariff deleted, no map
url). ``tariffs`` carries ONE element per visit — the visit's tariff
title (null when the tariff is gone) + the VISIT's price; repeats are
allowed (aggregation belongs to the template).

Time interpretation (spec §3.2 — single interpretation pinned there):
- ``activity.start`` is stored naive local business time and is carried
  into the snapshot AS IS (``isoformat()``, no conversion, no ``Z``);
- ``event.occurred_at`` is naive UTC per the repository timestamp
  convention, serialized as ISO 8601 WITH the ``Z`` suffix.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.models.activity import Activity
from src.models.client import Client
from src.models.location import Location
from src.models.master import Master
from src.models.service import Service
from src.models.staff import Staff
from src.models.visit import Visit
from src.services.record import record_total_price

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from src.models.record import Record


def _utc_now_iso_z() -> str:
    """UTC now → ISO 8601 with the ``Z`` suffix (spec §3.2)."""
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


async def build_new_record_snapshot(
    session: AsyncSession,
    record: Record,
) -> dict[str, Any]:
    """Build the §4.1 ``new_record`` snapshot — local reads, pre-commit.

    ``session`` is the scenario's own transaction (the caller passes the
    same ``db_session`` that holds ``record``); every related row is
    fetched by primary key in that transaction. The result is a plain
    JSON-able dict (it lands in ``domain_events.snapshot``).
    """
    activity = await session.get(Activity, record.activity_id)
    service = await session.get(Service, activity.service_id) if activity else None
    location = await session.get(Location, activity.location_id) if activity else None
    # names live on the staff card; the master row is the schedule
    # extension keyed by staff_id (GH #266)
    master_ext = await session.get(Master, activity.master_id) if activity else None
    staff = await session.get(Staff, master_ext.staff_id) if master_ext else None
    client = await session.get(Client, record.client_id) if record.client_id else None
    visits = (
        (
            await session.execute(
                select(Visit)
                .where(Visit.record_id == record.id)
                .options(selectinload(Visit.tariff))
                .order_by(Visit.created_at, Visit.id)
            )
        )
        .scalars()
        .all()
    )

    return {
        "event": {
            "type": "new_record",
            "occurred_at": _utc_now_iso_z(),
            "record_id": record.id,
        },
        "client": (
            {"id": client.id, "name": client.name, "phone": client.phone} if client else None
        ),
        # stored naive local business time — AS IS (spec §3.2)
        "activity": {
            "start": activity.start.isoformat() if activity else None,
            "duration": activity.duration if activity else None,
        },
        "service": {"title": service.title} if service else None,
        # one element per visit; deleted tariff → title null, price stays
        "tariffs": [
            {"title": v.tariff.title if v.tariff else None, "price": v.price} for v in visits
        ],
        "total_price": record_total_price(visits),
        "location": (
            {
                "title": location.title,
                "address": location.address,
                "map_url": location.yandex_map_url,
            }
            if location
            else None
        ),
        # «Фамилия Имя» — display composite parity (list_records_view)
        "master": ({"name": f"{staff.last_name} {staff.first_name}"} if staff else None),
    }
