"""Cascade operations for the Record aggregate.

These are stateless DB operations that recompute denormalized fields on
the parent Record (seats, status) after changes to child entities (Visits).
Lives in the domain layer (not service layer) because cascade is an
aggregate invariant — the Record is the aggregate root and must maintain
its own consistency. Both VisitService and RecordService call these
functions; neither knows about the other.
"""

from datetime import UTC, datetime
from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.domain.visit_status import VisitItem, compute_record_status
from src.errors import ErrorCode, ErrorDetail
from src.models.activity import Activity
from src.models.record import Record
from src.models.visit import Visit


async def recompute_record_seats(
    db_session: AsyncSession, record_id: str,
) -> Record | None:
    """Recompute record.seats = len(active visits) + anonym_visits.

    Used by VisitService.create/delete (which change len(active_visits))
    and by RecordService.patch (when visits array is replaced).
    Replaces inlined logic at lines 127, 208, 268, 272 of services/record.py.
    """
    record = await db_session.get(Record, record_id)
    if not record:
        return None
    result = await db_session.execute(
        select(func.count()).select_from(Visit).where(
            Visit.record_id == record_id,
        )
    )
    active_count = result.scalar() or 0
    record.seats = active_count + record.anonym_visits
    record.updated_at = datetime.now(UTC)
    await db_session.flush()
    return record


async def recompute_record_status(
    db_session: AsyncSession, record_id: str,
) -> Record | None:
    """Recompute record.status from active visits.

    Wraps the pure compute_record_status domain function with the DB
    query and update. Used by VisitService.* and RecordService.patch.
    Replaces inlined logic at lines 123, 225, 277, 283 of services/record.py.
    """
    record = await db_session.get(Record, record_id)
    if not record:
        return None
    result = await db_session.execute(
        select(Visit).where(
            Visit.record_id == record_id,
        )
    )
    active_visits = list(result.scalars().all())
    record.status = compute_record_status([
        VisitItem(id=v.id, status=v.status)
        for v in active_visits
    ]).value
    record.updated_at = datetime.now(UTC)
    await db_session.flush()
    return record


async def check_activity_capacity(
    db_session: AsyncSession, activity_id: str, seats: int = 1,
) -> None:
    """Check if the activity has enough capacity for the new seats.

    Raises HTTPException 409 with code: ACTIVITY_AT_CAPACITY if exceeded.
    Extracted from RecordService._check_capacity (line 294) for symmetry
    with the other cascade functions. Both services use this directly.
    """
    result = await db_session.execute(
        select(Activity).where(Activity.id == activity_id, Activity.is_active)
    )
    activity = result.scalar_one_or_none()
    if not activity:
        return  # activity not found — let caller handle

    occupied_result = await db_session.execute(
        select(func.coalesce(func.sum(Record.seats), 0)).where(
            Record.activity_id == activity_id,
            Record.is_active.is_(True),
        )
    )
    occupied = occupied_result.scalar() or 0

    if occupied + seats > activity.capacity:
        raise HTTPException(
            status_code=409,
            detail=ErrorDetail(
                code=ErrorCode.ACTIVITY_AT_CAPACITY,
                message=f"Activity at capacity: {occupied}/{activity.capacity} seats occupied",
            ).model_dump(),
        )
