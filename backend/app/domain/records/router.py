"""FastAPI router for record CRUD endpoints with nested visits."""

from datetime import datetime
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.db import SessionDep
from src.schemas.record import (
    RecordCreate,
    RecordResponse,
    RecordUpdate,
    VisitResponse,
)
from app.domain.records.service import RecordService, get_record_service

router = APIRouter(tags=["records"])


@lru_cache
def _get_record_service() -> RecordService:
    """Dependency factory returning a singleton RecordService."""
    return get_record_service()


_ServiceDep = Annotated[RecordService, Depends(_get_record_service)]


def _map_record(record) -> RecordResponse:
    """Map a Record ORM object to RecordResponse with nested visits."""

    def _dt_to_str(dt: datetime | None) -> str:
        if dt is None:
            return ""
        return dt.isoformat()

    visits = [
        VisitResponse(
            id=v.id,
            record_id=v.record_id,
            visitor_id=v.visitor_id,
            price=v.price,
            status=v.status,
            created_at=_dt_to_str(v.created_at),
            updated_at=_dt_to_str(v.updated_at),
            is_active=v.is_active,
        )
        for v in record.visits
        if v.is_active
    ]

    return RecordResponse(
        id=record.id,
        activity_id=record.activity_id,
        client_id=record.client_id,
        status=record.status,
        seats=record.seats,
        comment=record.comment,
        created_at=_dt_to_str(record.created_at),
        updated_at=_dt_to_str(record.updated_at),
        is_active=record.is_active,
        visits=visits,
    )


@router.get("", response_model=list[RecordResponse])
async def list_records(
    service: _ServiceDep,
    session: SessionDep,
) -> list[RecordResponse]:
    """Return all active records with nested visits."""
    records = await service.list(db_session=session)
    return [_map_record(r) for r in records]


@router.get("/{record_id}", response_model=RecordResponse)
async def get_record(
    record_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> RecordResponse:
    """Return a single record by ID with nested visits."""
    record = await service.get(db_session=session, id=record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    return _map_record(record)


@router.post("", response_model=RecordResponse, status_code=201)
async def create_record(
    data: RecordCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> RecordResponse:
    """Create a new record with visits. Seats auto-calculated from len(visits)."""
    record = await service.create(db_session=session, data=data)
    return _map_record(record)


@router.put("/{record_id}", response_model=RecordResponse)
async def update_record(
    record_id: str,
    data: RecordUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> RecordResponse:
    """Full-update a record by ID. Replaces visits, recalculates seats."""
    record = await service.update(db_session=session, id=record_id, data=data)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    return _map_record(record)


@router.delete("/{record_id}", status_code=204)
async def delete_record(
    record_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> None:
    """Soft-delete a record (set is_active=False)."""
    deleted = await service.delete(db_session=session, id=record_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Record not found")
