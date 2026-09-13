"""FastAPI router for the positions dictionary (GH #266 T4, spec D4).

Plain dictionary CRUD (not archive-aware): paginated list, bare ``/all``,
get, create, PUT/PATCH, DELETE. The single domain rule: built-ins
(``is_system``) never delete — 422 ``POSITION_IS_SYSTEM``; their title
stays freely editable (tested in the same route).
"""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import asc

from src.auth.permissions import require_permission, verify_fetch_metadata
from src.db import SessionDep
from src.domain.errors import PositionIsSystemError
from src.errors import ErrorCode, ErrorDetail
from src.models.position import Position
from src.schemas.common import PaginatedResponse
from src.schemas.pagination import PaginationParams
from src.schemas.position import (
    PositionCreate,
    PositionPatch,
    PositionResponse,
    PositionUpdate,
)
from src.services.position import PositionService, get_position_service

router = APIRouter(tags=["positions"])


@lru_cache
def _get_position_service() -> PositionService:
    """Dependency factory returning a singleton PositionService."""
    return get_position_service()


_ServiceDep = Annotated[PositionService, Depends(_get_position_service)]

# GH #247 (spec §3.7): mutating routes carry positions:write + the CSRF
# fetch-metadata secondary line; /all carries positions:read.
_WRITE_GUARD = [
    Depends(require_permission("positions:write")),
    Depends(verify_fetch_metadata),
]
_READ_GUARD = [Depends(require_permission("positions:read"))]


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail=ErrorDetail(
            code=ErrorCode.POSITION_NOT_FOUND,
            message="Должность не найдена",
        ).model_dump(),
    )


@router.get(
    "",
    response_model=PaginatedResponse[PositionResponse],
    dependencies=_READ_GUARD,
)
async def list_positions(
    service: _ServiceDep,
    session: SessionDep,
    pagination: PaginationParams = Depends(),
) -> PaginatedResponse[PositionResponse]:
    """Paginated dictionary list — ``title ASC, id ASC`` (plain dictionary,
    no archive status; the set is tiny, the envelope keeps UI parity)."""
    return await service.list(
        db_session=session,
        page=pagination.page,
        per_page=pagination.per_page,
        order_by=[asc(Position.title), asc(Position.id)],
    )


@router.get("/all", response_model=list[PositionResponse], dependencies=_READ_GUARD)
async def list_all_positions(
    service: _ServiceDep,
    session: SessionDep,
) -> list[PositionResponse]:
    """Bare array of dictionary rows (GH #205), sorted ``title ASC, id ASC``.

    No pagination — the checkbox list in the staff card consumes the whole
    dictionary; capped by ``BARE_LIST_MAX_ROWS`` like every /all route.
    """
    from src.domain.errors import BareListLimitExceededError

    try:
        return await service.list_all(
            db_session=session,
            order_by=[asc(Position.title), asc(Position.id)],
        )
    except BareListLimitExceededError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get(
    "/{position_id}", response_model=PositionResponse, dependencies=_READ_GUARD
)
async def get_position(
    position_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> PositionResponse:
    """Return a single dictionary row by ID."""
    position = await service.get(db_session=session, id=position_id)
    if not position:
        raise _not_found()
    return position


@router.post(
    "", response_model=PositionResponse, status_code=201, dependencies=_WRITE_GUARD
)
async def create_position(
    data: PositionCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> PositionResponse:
    """Create a user-defined position (``is_system`` is owned by the
    dictionary — always ``false`` here)."""
    return await service.create(db_session=session, data=data)


@router.put(
    "/{position_id}", response_model=PositionResponse, dependencies=_WRITE_GUARD
)
async def update_position(
    position_id: str,
    data: PositionUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> PositionResponse:
    """Full-update a position (title only; built-ins included — the title
    of a system position stays editable, D4)."""
    position = await service.update(db_session=session, id=position_id, data=data)
    if not position:
        raise _not_found()
    return position


@router.patch(
    "/{position_id}", response_model=PositionResponse, dependencies=_WRITE_GUARD
)
async def patch_position(
    position_id: str,
    data: PositionPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> PositionResponse:
    """Partial-update a position (title only)."""
    position = await service.patch(db_session=session, id=position_id, data=data)
    if not position:
        raise _not_found()
    return position


@router.delete("/{position_id}", status_code=204, dependencies=_WRITE_GUARD)
async def delete_position(
    position_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> None:
    """Delete a user-defined position — built-ins raise 422 POSITION_IS_SYSTEM.

    ``staff_positions`` join rows go at the DB level (ON DELETE CASCADE on
    the join FK) — cards holding the position simply lose the link.
    """
    try:
        deleted = await service.delete(db_session=session, id=position_id)
    except PositionIsSystemError as exc:
        raise HTTPException(
            status_code=422,
            detail=ErrorDetail(
                code=ErrorCode.POSITION_IS_SYSTEM,
                message="Встроенная должность не удаляется",
            ).model_dump(),
        ) from exc
    if not deleted:
        raise _not_found()
