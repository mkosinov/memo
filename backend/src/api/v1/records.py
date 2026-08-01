"""FastAPI router for record CRUD endpoints with nested visits."""

from datetime import datetime
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from src.db import SessionDep
from src.errors import ErrorCode, ErrorDetail
from src.schemas.common import PaginatedResponse
from src.schemas.record import (
    RecordCreate,
    RecordPatch,
    RecordResponse,
    RecordUpdate,
    VisitResponse,
)
from src.services.record import RecordService, get_record_service

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
            tariff_id=v.tariff_id,
            price=v.price,
            custom_price=v.custom_price,
            status=v.status,
            created_at=_dt_to_str(v.created_at),
            updated_at=_dt_to_str(v.updated_at),
        )
        for v in record.visits
    ]

    return RecordResponse(
        id=record.id,
        activity_id=record.activity_id,
        client_id=record.client_id,
        status=record.status,
        seats=record.seats,
        anonym_visits=record.anonym_visits,
        comment=record.comment,
        custom_price=record.custom_price,
        created_at=_dt_to_str(record.created_at),
        updated_at=_dt_to_str(record.updated_at),
        visits=visits,
    )


@router.get("", response_model=PaginatedResponse[RecordResponse])
async def list_records(
    service: _ServiceDep,
    session: SessionDep,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    client_id: str | None = None,
) -> PaginatedResponse[RecordResponse]:
    """Return all records with nested visits, optionally filtered by client_id."""
    result = await service.list(db_session=session, page=page, per_page=per_page, client_id=client_id)
    return PaginatedResponse(
        items=[_map_record(r) for r in result.items],
        total=result.total,
        page=result.page,
        per_page=result.per_page,
    )


@router.get("/{record_id}", response_model=RecordResponse)
async def get_record(
    record_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> RecordResponse:
    """Return a single record by ID with nested visits."""
    record = await service.get(db_session=session, id=record_id)
    if not record:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.RECORD_NOT_FOUND,
                message="Record not found",
            ).model_dump(),
        )
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
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.RECORD_NOT_FOUND,
                message="Record not found",
            ).model_dump(),
        )
    return _map_record(record)


@router.patch("/{record_id}", response_model=RecordResponse)
async def patch_record(
    record_id: str,
    data: RecordPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> RecordResponse:
    """Partial-update a record by ID (PATCH). Only sent fields are changed."""
    record = await service.patch(db_session=session, id=record_id, data=data)
    if not record:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.RECORD_NOT_FOUND,
                message="Record not found",
            ).model_dump(),
        )
    return _map_record(record)


@router.delete("/{record_id}", status_code=204)
async def delete_record(
    record_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> None:
    """Delete a record (hard delete)."""
    deleted = await service.delete(db_session=session, id=record_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.RECORD_NOT_FOUND,
                message="Record not found",
            ).model_dump(),
        )
