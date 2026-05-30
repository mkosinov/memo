"""FastAPI router for activity CRUD endpoints with date filtering."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.db import SessionDep
from src.schemas.activity import (
    ActivityCreate,
    ActivityResponse,
    ActivityUpdate,
)
from src.services.activity import ActivityService, get_activity_service

router = APIRouter(tags=["activities"])


@lru_cache
def _get_activity_service() -> ActivityService:
    """Dependency factory returning a singleton ActivityService."""
    return get_activity_service()


_ServiceDep = Annotated[ActivityService, Depends(_get_activity_service)]


async def _to_response(
    service: ActivityService,
    db_session: AsyncSession,
    activity,
) -> ActivityResponse:
    """Map an Activity ORM object to ActivityResponse with computed occupied."""
    data = ActivityResponse.model_validate(activity)
    data.occupied = await service.count_records(db_session=db_session, activity_id=activity.id)
    return data


@router.get("", response_model=list[ActivityResponse])
async def list_activities(
    service: _ServiceDep,
    session: SessionDep,
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
) -> list[ActivityResponse]:
    """Return all active activities, optionally filtered by date range."""
    activities = await service.list(db_session=session, date_from=date_from, date_to=date_to)
    return [await _to_response(service, db_session=session, activity=a) for a in activities]


@router.get("/{activity_id}", response_model=ActivityResponse)
async def get_activity(
    activity_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> ActivityResponse:
    """Return a single activity by ID with computed occupied count."""
    activity = await service.get(db_session=session, id=activity_id)
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    return await _to_response(service, db_session=session, activity=activity)


@router.post("", response_model=ActivityResponse, status_code=201)
async def create_activity(
    data: ActivityCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> ActivityResponse:
    """Create a new activity."""
    activity = await service.create(db_session=session, data=data)
    return await _to_response(service, db_session=session, activity=activity)


@router.put("/{activity_id}", response_model=ActivityResponse)
async def update_activity(
    activity_id: str,
    data: ActivityUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> ActivityResponse:
    """Full-update an activity by ID (PUT, not PATCH)."""
    activity = await service.update(db_session=session, id=activity_id, data=data)
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    return await _to_response(service, db_session=session, activity=activity)


@router.delete("/{activity_id}", status_code=204)
async def delete_activity(
    activity_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> None:
    """Soft-delete an activity (set is_active=False)."""
    deleted = await service.delete(db_session=session, id=activity_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Activity not found")
