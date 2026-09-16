"""FastAPI router for payment CRUD endpoints."""

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
from src.schemas.payment import PaymentCreate, PaymentPatch, PaymentResponse, PaymentTotalsResponse, PaymentUpdate
from src.services.payment import PaymentService, get_payment_service, get_payment_totals

router = APIRouter(
    tags=["payments"],
    # GH #247 spec §3.7: wholly-private router — read guard at router level.
    dependencies=[Depends(require_permission("payments:read"))],
)


@lru_cache
def _get_payment_service() -> PaymentService:
    """Dependency factory returning a singleton PaymentService."""
    return get_payment_service()


_ServiceDep = Annotated[PaymentService, Depends(_get_payment_service)]

# GH #247 (spec §3.7): every mutating route carries payments:write plus the
# CSRF fetch-metadata secondary line (verify_fetch_metadata).
_WRITE_GUARD = [
    Depends(require_permission("payments:write")),
    Depends(verify_fetch_metadata),
]


async def _payment_scoped_or_404(
    service: PaymentService,
    session: AsyncSession,
    payment_id: str,
    scope: ScopeContext,
) -> None:
    """GH #263 T4 — shared point-op owner gate for payment mutations.

    ONE scope-aware query (payment → record → activity; у оплаты нет
    своей колонки мастера); a scoped master whose payment is foreign
    gets the same 404 as a missing payment (404-fast-path). Admin
    (``master_key=None``) passes untouched.
    """
    payment = await service.get_scoped(
        db_session=session, id=payment_id, master_key=scope.master_key
    )
    if not payment:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.PAYMENT_NOT_FOUND,
                message="Payment not found",
            ).model_dump(),
        )


async def _record_scoped_or_404(
    service: PaymentService,
    session: AsyncSession,
    record_id: str,
    scope: ScopeContext,
) -> None:
    """GH #263 T4 — parent-record owner gate (create / PUT re-target).

    ONE query (record → activity); чужая запись → the same 404 as a
    missing parent. Admin (``master_key=None``) passes untouched.
    """
    parent = await service.get_record_scoped(
        db_session=session, record_id=record_id, master_key=scope.master_key
    )
    if not parent:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.RECORD_NOT_FOUND,
                message="Parent record not found",
            ).model_dump(),
        )


@router.get("", response_model=PaginatedResponse[PaymentResponse])
async def list_payments(
    service: _ServiceDep,
    session: SessionDep,
    pagination: PaginationParams = Depends(),
    record_id: str | None = None,
    # GH #263 T4: scope via payment → record → activity («всё через
    # записи»); conjunctive with the record_id param. Admin → no filter.
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> PaginatedResponse[PaymentResponse]:
    """Return payments visible to the caller, optionally filtered by record_id."""
    return await service.list(
        db_session=session, page=pagination.page, per_page=pagination.per_page,
        record_id=record_id, master_key=scope.master_key,
    )


@router.get("/totals", response_model=PaymentTotalsResponse)
async def get_payment_totals_route(
    session: SessionDep,
    record_ids: Annotated[list[str], Query(max_length=200)] = [],
    # GH #263 T4: чужие record_ids молча исключены перед агрегацией
    # (все чужие → 200 {"totals": {}}); admin → без фильтрации.
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> PaymentTotalsResponse:
    """Return per-record payment sums for a list of record IDs."""
    totals = await get_payment_totals(
        db_session=session, record_ids=record_ids, master_key=scope.master_key
    )
    return PaymentTotalsResponse(totals=totals)


@router.get("/{payment_id}", response_model=PaymentResponse)
async def get_payment(
    payment_id: str,
    service: _ServiceDep,
    session: SessionDep,
    # GH #263 T4: чужой платёж → 404 (single scope-aware query).
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> PaymentResponse:
    """Return a single payment by ID."""
    payment = await service.get_scoped(
        db_session=session, id=payment_id, master_key=scope.master_key
    )
    if not payment:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.PAYMENT_NOT_FOUND,
                message="Payment not found",
            ).model_dump(),
        )
    return payment


@router.post("", response_model=PaymentResponse, status_code=201,
             dependencies=_WRITE_GUARD)
async def create_payment(
    data: PaymentCreate,
    service: _ServiceDep,
    session: SessionDep,
    # GH #263 T4: a master may accept payments only on his own records —
    # the parent record's activity must be his (чужая → 404, same code
    # as «родитель не найден»).
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> PaymentResponse:
    """Create a new payment."""
    if scope.master_key is not None:
        await _record_scoped_or_404(service, session, data.record_id, scope)
    return await service.create(db_session=session, data=data)


@router.put("/{payment_id}", response_model=PaymentResponse, dependencies=_WRITE_GUARD)
async def update_payment(
    payment_id: str,
    data: PaymentUpdate,
    service: _ServiceDep,
    session: SessionDep,
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> PaymentResponse:
    """Full-update a payment by ID (PUT, not PATCH)."""
    await _payment_scoped_or_404(service, session, payment_id, scope)
    # GH #263 T4-quality: PUT re-parents the payment — the NEW record_id
    # must be inside the master's scope (PaymentPatch carries no
    # record_id, so PATCH cannot re-parent and needs no gate).
    if scope.master_key is not None and data.record_id:
        await _record_scoped_or_404(service, session, data.record_id, scope)
    payment = await service.update(db_session=session, id=payment_id, data=data)
    if not payment:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.PAYMENT_NOT_FOUND,
                message="Payment not found",
            ).model_dump(),
        )
    return payment


@router.patch("/{payment_id}", response_model=PaymentResponse, dependencies=_WRITE_GUARD)
async def patch_payment(
    payment_id: str,
    data: PaymentPatch,
    service: _ServiceDep,
    session: SessionDep,
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> PaymentResponse:
    """Partial-update a payment (PATCH)."""
    await _payment_scoped_or_404(service, session, payment_id, scope)
    payment = await service.patch(db_session=session, id=payment_id, data=data)
    if not payment:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.PAYMENT_NOT_FOUND,
                message="Payment not found",
            ).model_dump(),
        )
    return payment


@router.delete("/{payment_id}", status_code=204, dependencies=_WRITE_GUARD)
async def delete_payment(
    payment_id: str,
    service: _ServiceDep,
    session: SessionDep,
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> None:
    """Hard-delete a payment (physically remove the row)."""
    await _payment_scoped_or_404(service, session, payment_id, scope)
    deleted = await service.delete(db_session=session, id=payment_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.PAYMENT_NOT_FOUND,
                message="Payment not found",
            ).model_dump(),
        )
