"""FastAPI router for payment CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from src.db import SessionDep
from src.schemas.payment import PaymentCreate, PaymentResponse, PaymentUpdate
from src.services.generic import GenericService
from src.services.payment import get_payment_service

router = APIRouter(tags=["payments"])


@lru_cache
def _get_payment_service() -> GenericService[PaymentCreate, PaymentUpdate, PaymentResponse]:
    """Dependency factory returning a singleton PaymentService."""
    return get_payment_service()


_ServiceDep = Annotated[GenericService[PaymentCreate, PaymentUpdate, PaymentResponse], Depends(_get_payment_service)]


@router.get("", response_model=list[PaymentResponse])
async def list_payments(
    service: _ServiceDep,
    session: SessionDep,
    record_id: str | None = None,
) -> list[PaymentResponse]:
    """Return all active payments, optionally filtered by record_id."""
    filters = {}
    if record_id:
        filters["record_id"] = record_id
    return await service.list(db_session=session, **filters)


@router.get("/{payment_id}", response_model=PaymentResponse)
async def get_payment(
    payment_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> PaymentResponse:
    """Return a single payment by ID."""
    payment = await service.get(db_session=session, id=payment_id)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    return payment


@router.post("", response_model=PaymentResponse, status_code=201)
async def create_payment(
    data: PaymentCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> PaymentResponse:
    """Create a new payment."""
    return await service.create(db_session=session, data=data)


@router.put("/{payment_id}", response_model=PaymentResponse)
async def update_payment(
    payment_id: str,
    data: PaymentUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> PaymentResponse:
    """Full-update a payment by ID (PUT, not PATCH)."""
    payment = await service.update(db_session=session, id=payment_id, data=data)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    return payment


@router.delete("/{payment_id}", status_code=204)
async def delete_payment(
    payment_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> None:
    """Soft-delete a payment (set is_active=False)."""
    deleted = await service.delete(db_session=session, id=payment_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Payment not found")
