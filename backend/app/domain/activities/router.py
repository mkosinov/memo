"""FastAPI router for activity CRUD endpoints with date filtering."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db_session
from app.domain.activities.schemas import (
    ActivityCreate,
    ActivityResponse,
    ActivityUpdate,
)
from app.domain.activities.service import ActivityService

router = APIRouter(tags=["activities"])

_SessionDep = Annotated[AsyncSession, Depends(get_db_session)]


def _get_service(session: _SessionDep) -> ActivityService:
    """Dependency factory for ActivityService."""
    return ActivityService(session)


_ServiceDep = Annotated[ActivityService, Depends(_get_service)]


async def _to_response(
    service: ActivityService, activity
) -> ActivityResponse:
    """Map an Activity ORM object to ActivityResponse with computed occupied."""
    data = ActivityResponse.model_validate(activity)
    data.occupied = await service.count_records(activity.id)
    return data


@router.get("", response_model=list[ActivityResponse])
async def list_activities(
    service: _ServiceDep,
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
) -> list[ActivityResponse]:
    """Return all active activities, optionally filtered by date range."""
    activities = await service.list_all(date_from=date_from, date_to=date_to)
    return [await _to_response(service, a) for a in activities]


@router.get("/{activity_id}", response_model=ActivityResponse)
async def get_activity(
    activity_id: str, service: _ServiceDep
) -> ActivityResponse:
    """Return a single activity by ID with computed occupied count."""
    activity = await service.get_by_id(activity_id)
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    return await _to_response(service, activity)


@router.post("", response_model=ActivityResponse, status_code=201)
async def create_activity(
    data: ActivityCreate, service: _ServiceDep
) -> ActivityResponse:
    """Create a new activity."""
    activity = await service.create(data)
    return await _to_response(service, activity)


@router.put("/{activity_id}", response_model=ActivityResponse)
async def update_activity(
    activity_id: str,
    data: ActivityUpdate,
    service: _ServiceDep,
) -> ActivityResponse:
    """Full-update an activity by ID (PUT, not PATCH)."""
    activity = await service.update(activity_id, data)
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    return await _to_response(service, activity)


@router.delete("/{activity_id}", status_code=204)
async def delete_activity(
    activity_id: str, service: _ServiceDep
) -> None:
    """Soft-delete an activity (set is_active=False)."""
    deleted = await service.delete(activity_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Activity not found")
