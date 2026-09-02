"""FastAPI router for record CRUD endpoints with nested visits."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from src.db import SessionDep
from src.domain.deletion import ResolutionError, collect_dependencies
from src.errors import ErrorCode, ErrorDetail
from src.models.record import Record
from src.schemas.common import PaginatedResponse
from src.schemas.record import (
    RecordCreate,
    RecordListParams,
    RecordPatch,
    RecordResponse,
    RecordUpdate,
    RecordViewResponse,
)
from src.services.record import RecordService, get_record_service, map_record

router = APIRouter(tags=["records"])


@lru_cache
def _get_record_service() -> RecordService:
    """Dependency factory returning a singleton RecordService."""
    return get_record_service()


_ServiceDep = Annotated[RecordService, Depends(_get_record_service)]


@router.get("", response_model=PaginatedResponse[RecordResponse])
async def list_records(
    service: _ServiceDep,
    session: SessionDep,
    params: Annotated[RecordListParams, Query()],
) -> PaginatedResponse[RecordResponse]:
    """Return records with nested visits — server-side filter, sort, paginate (#191)."""
    result = await service.list(db_session=session, params=params)
    return PaginatedResponse(
        items=[map_record(r) for r in result.items],
        total=result.total,
        page=result.page,
        per_page=result.per_page,
    )


@router.get("/view", response_model=PaginatedResponse[RecordViewResponse])
async def list_records_view(
    service: _ServiceDep,
    session: SessionDep,
    params: Annotated[RecordListParams, Query()],
) -> PaginatedResponse[RecordViewResponse]:
    """Composite read for the records table — records page enriched with
    denormalized display fields from joins (GH #213 §4).

    Same params/sort/pagination as ``GET /records`` (single
    ``RecordListParams`` class — no contract drift); display resolution
    carries NO ``is_active`` filters, so archived entities resolve their
    names (US-3). MUST stay declared BEFORE ``GET /{record_id}``: FastAPI
    matches routes in declaration order and ``/view`` would otherwise be
    captured by the id path param (404 instead of a page).
    """
    return await service.list_view(db_session=session, params=params)


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
    return map_record(record)


@router.post("", response_model=RecordResponse, status_code=201)
async def create_record(
    data: RecordCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> RecordResponse:
    """Create a new record with visits. Seats auto-calculated from len(visits)."""
    record = await service.create(db_session=session, data=data)
    return map_record(record)


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
    return map_record(record)


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
    return map_record(record)


@router.delete("/{record_id}", status_code=204)
async def delete_record(
    record_id: str,
    service: _ServiceDep,
    session: SessionDep,
    resolutions: dict[str, str] | None = Body(default=None, embed=True),
) -> None:
    """Unified DELETE — dry-run (no body) or execute (with body).

    Mirrors the masters/clients routes (GH #139, Addendum 13). Record deps
    (visits, payments, record_tags) are never blocking; record with none →
    instant 204 (Materials-like path). Execution stays in
    ``RecordService.delete`` (the ``@transactional`` cascade visits →
    payments → record_tags → record); validation runs via the deletion
    layer free functions in ``RecordService.resolve_delete``.

    * No body (dry-run): ``collect_dependencies`` → empty → hard delete (204);
      non-empty → 409 + dependency tree (no rows modified).
    * With body (execute): ``{"resolutions": {...}}`` per spec §6
      (``embed=True`` rejects a bare dict as a dry-run shape).
      ``service.resolve_delete`` validates then executes → 204;
      ``ResolutionError`` → 422; missing → 404.
    """
    if resolutions is not None:
        try:
            ok = await service.resolve_delete(
                db_session=session, id=record_id, resolutions=resolutions
            )
        except ResolutionError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        if not ok:
            raise HTTPException(
                status_code=404,
                detail=ErrorDetail(
                    code=ErrorCode.RECORD_NOT_FOUND,
                    message="Record not found",
                ).model_dump(),
            )
        return

    deps = await collect_dependencies(session, Record, record_id)
    if deps:
        return JSONResponse(
            status_code=409,
            content={
                "detail": "has_dependencies",
                "dependencies": [d.model_dump() for d in deps],
            },
        )
    deleted = await service.delete(db_session=session, id=record_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.RECORD_NOT_FOUND,
                message="Record not found",
            ).model_dump(),
        )
