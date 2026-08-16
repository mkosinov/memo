"""FastAPI router for master CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import asc

from src.db import SessionDep
from src.domain.deletion import ResolutionError, collect_dependencies
from src.errors import ErrorCode, ErrorDetail
from src.models.enums import ArchiveStatus
from src.models.master import Master
from src.schemas.common import PaginatedResponse
from src.schemas.master import MasterCreate, MasterPatch, MasterResponse, MasterUpdate, ReorderRequest
from src.services.master import MasterService, get_master_service

router = APIRouter(tags=["masters"])


@lru_cache
def _get_master_service() -> MasterService:
    """Dependency factory returning a singleton MasterService."""
    return get_master_service()


_ServiceDep = Annotated[MasterService, Depends(_get_master_service)]


@router.get("", response_model=PaginatedResponse[MasterResponse])
async def list_masters(
    service: _ServiceDep,
    session: SessionDep,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status: ArchiveStatus = Query(ArchiveStatus.ACTIVE),
) -> PaginatedResponse[MasterResponse]:
    """Return masters filtered by archive status (default: active),
    sorted by sort_order, then name.

    ``status`` accepts ``active`` (default), ``archived``, or ``all`` — see
    ``ArchiveStatus``. Invalid values are rejected with 422 by FastAPI's
    enum validation.
    """
    return await service.list(
        db_session=session,
        page=page,
        per_page=per_page,
        status=status,
        order_by=[asc(Master.sort_order), asc(Master.first_name)],
    )


@router.put("/reorder", response_model=list[MasterResponse])
async def reorder_masters(
    data: ReorderRequest,
    service: _ServiceDep,
    session: SessionDep,
) -> list[MasterResponse]:
    """Reorder masters by assigning sort_order from the provided ID list."""
    return await service.reorder(db_session=session, ids=data.ids)


@router.get("/{master_id}", response_model=MasterResponse)
async def get_master(
    master_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> MasterResponse:
    """Return a single master by ID."""
    master = await service.get(db_session=session, id=master_id)
    if not master:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MASTER_NOT_FOUND,
                message="Master not found",
            ).model_dump(),
        )
    return master


@router.post("", response_model=MasterResponse, status_code=201)
async def create_master(
    data: MasterCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> MasterResponse:
    """Create a new master."""
    return await service.create(db_session=session, data=data)


@router.put("/{master_id}", response_model=MasterResponse)
async def update_master(
    master_id: str,
    data: MasterUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> MasterResponse:
    """Full-update a master by ID (PUT, not PATCH)."""
    master = await service.update(db_session=session, id=master_id, data=data)
    if not master:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MASTER_NOT_FOUND,
                message="Master not found",
            ).model_dump(),
        )
    return master


@router.patch("/{master_id}", response_model=MasterResponse)
async def patch_master(
    master_id: str,
    data: MasterPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> MasterResponse:
    """Partial-update a master by ID (PATCH)."""
    master = await service.patch(db_session=session, id=master_id, data=data)
    if not master:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MASTER_NOT_FOUND,
                message="Master not found",
            ).model_dump(),
        )
    return master


@router.delete("/{master_id}", status_code=204)
async def delete_master(
    master_id: str,
    service: _ServiceDep,
    session: SessionDep,
    resolutions: dict[str, str] | None = Body(default=None),
) -> None:
    """Unified DELETE — dry-run (no body) or execute (with body). Spec §2/§5/§6.

    * No body (dry-run): ``collect_dependencies`` → empty → hard delete (204);
      non-empty → 409 + dependency tree (no rows modified).
    * With body (execute): ``service.resolve_delete`` runs the resolution
      transaction (Task 10) → 204; ``ResolutionError`` → 422; missing → 404.
    """
    if resolutions is not None:
        try:
            ok = await service.resolve_delete(
                db_session=session, id=master_id, resolutions=resolutions
            )
        except ResolutionError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        if not ok:
            raise HTTPException(
                status_code=404,
                detail=ErrorDetail(
                    code=ErrorCode.MASTER_NOT_FOUND,
                    message="Master not found",
                ).model_dump(),
            )
        return

    deps = await collect_dependencies(session, Master, master_id)
    if deps:
        return JSONResponse(
            status_code=409,
            content={
                "detail": "has_dependencies",
                "dependencies": [d.model_dump() for d in deps],
            },
        )
    deleted = await service.delete(db_session=session, id=master_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.MASTER_NOT_FOUND,
                message="Master not found",
            ).model_dump(),
        )
