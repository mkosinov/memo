"""FastAPI router for visitor CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.permissions import require_permission, verify_fetch_metadata
from src.auth.scope import ScopeContext, get_scope
from src.db import SessionDep
from src.errors import ErrorCode, ErrorDetail
from src.schemas.common import PaginatedResponse
from src.schemas.pagination import PaginationParams
from src.schemas.visitor import VisitorCreate, VisitorPatch, VisitorResponse, VisitorUpdate
from src.services.visitor import get_visitor_service, VisitorService

router = APIRouter(
    tags=["visitors"],
    # GH #247 spec §3.7: wholly-private router — read guard at router level.
    dependencies=[Depends(require_permission("visitors:read"))],
)


@lru_cache
def _get_visitor_service() -> VisitorService:
    """Dependency factory returning a singleton VisitorService."""
    return get_visitor_service()


_ServiceDep = Annotated[VisitorService, Depends(_get_visitor_service)]

# GH #247 (spec §3.7): every mutating route carries visitors:write plus the
# CSRF fetch-metadata secondary line (verify_fetch_metadata).
_WRITE_GUARD = [
    Depends(require_permission("visitors:write")),
    Depends(verify_fetch_metadata),
]


async def _visitor_scoped_or_404(
    service: VisitorService,
    session: AsyncSession,
    visitor_id: str,
    scope: ScopeContext,
) -> None:
    """GH #263 T2 — shared owner gate for visitor point ops.

    ONE query with the EXISTS visibility predicate (visitor → visits →
    records → activities): a visitor without visits on the master's own
    records is invisible → the same 404 as missing (404-fast-path).
    """
    visitor = await service.get_scoped(
        db_session=session, id=visitor_id, master_key=scope.master_key
    )
    if not visitor:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISITOR_NOT_FOUND,
                message="Visitor not found",
            ).model_dump(),
        )


@router.get("", response_model=PaginatedResponse[VisitorResponse])
async def list_visitors(
    service: _ServiceDep,
    session: SessionDep,
    pagination: PaginationParams = Depends(),
    q: str | None = Query(None, min_length=2, max_length=100),
    # GH #263 T2: scope via visits → records → activities — a visitor
    # without the master's visits is invisible; ``q`` ANDs with the scope.
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> PaginatedResponse[VisitorResponse]:
    """Return all visitors, paginated.

    ``q`` (GH #212): case-insensitive substring on ``name`` OR exact id
    equality for a full UUID; ``total`` reflects the filtered count.
    len<2 / len>100 → 422 VALIDATION_ERROR.
    """
    return await service.list(
        db_session=session,
        page=pagination.page,
        per_page=pagination.per_page,
        q=q,
        master_key=scope.master_key,
    )


@router.get("/{visitor_id}", response_model=VisitorResponse)
async def get_visitor(
    visitor_id: str,
    service: _ServiceDep,
    session: SessionDep,
    # GH #263 T2: чужой посетитель → 404 (single scope-aware query).
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> VisitorResponse:
    """Return a single visitor by ID."""
    visitor = await service.get_scoped(
        db_session=session, id=visitor_id, master_key=scope.master_key
    )
    if not visitor:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISITOR_NOT_FOUND,
                message="Visitor not found",
            ).model_dump(),
        )
    return visitor


@router.post("", response_model=VisitorResponse, status_code=201,
             dependencies=_WRITE_GUARD)
async def create_visitor(
    data: VisitorCreate,
    service: _ServiceDep,
    session: SessionDep,
    # GH #263 T2: a master may create visitors only in the context of his
    # own records — the client must have a record to his activity
    # (чужой/невидимый клиент → 404; admin → unrestricted).
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> VisitorResponse:
    """Create a new visitor."""
    if not await service.client_is_scoped_visible(
        db_session=session, client_id=data.client_id, master_key=scope.master_key
    ):
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.CLIENT_NOT_FOUND,
                message="Client not found",
            ).model_dump(),
        )
    return await service.create(db_session=session, data=data)


@router.put("/{visitor_id}", response_model=VisitorResponse, dependencies=_WRITE_GUARD)
async def update_visitor(
    visitor_id: str,
    data: VisitorUpdate,
    service: _ServiceDep,
    session: SessionDep,
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> VisitorResponse:
    """Full-update a visitor by ID (PUT, not PATCH)."""
    await _visitor_scoped_or_404(service, session, visitor_id, scope)
    visitor = await service.update(db_session=session, id=visitor_id, data=data)
    if not visitor:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISITOR_NOT_FOUND,
                message="Visitor not found",
            ).model_dump(),
        )
    return visitor


@router.patch("/{visitor_id}", response_model=VisitorResponse, dependencies=_WRITE_GUARD)
async def patch_visitor(
    visitor_id: str,
    data: VisitorPatch,
    service: _ServiceDep,
    session: SessionDep,
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> VisitorResponse:
    """Partial-update a visitor by ID (PATCH)."""
    await _visitor_scoped_or_404(service, session, visitor_id, scope)
    visitor = await service.patch(db_session=session, id=visitor_id, data=data)
    if not visitor:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISITOR_NOT_FOUND,
                message="Visitor not found",
            ).model_dump(),
        )
    return visitor


@router.delete("/{visitor_id}", status_code=204, dependencies=_WRITE_GUARD)
async def delete_visitor(
    visitor_id: str,
    service: _ServiceDep,
    session: SessionDep,
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> None:
    """Delete a visitor (hard delete)."""
    await _visitor_scoped_or_404(service, session, visitor_id, scope)
    deleted = await service.delete(db_session=session, id=visitor_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.VISITOR_NOT_FOUND,
                message="Visitor not found",
            ).model_dump(),
        )
