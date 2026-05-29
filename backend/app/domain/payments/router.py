"""FastAPI router for payment CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.db import SessionDep
from app.domain.payments.schemas import PaymentCreate, PaymentResponse, PaymentUpdate
from app.domain.payments.service import get_payment_service
from app.domain.base import GenericService
from app.db.models.payment import Payment

router = APIRouter(tags=["payments"])


@lru_cache
def _get_payment_service() -> GenericService[Payment, PaymentCreate, PaymentUpdate]:
    """Dependency factory returning a singleton PaymentService."""
    return get_payment_service()


_ServiceDep = Annotated[GenericService[Payment, PaymentCreate, PaymentUpdate], Depends(_get_payment_service)]


@router.get("", response_model=list[PaymentResponse])
async def list_payments(
    service: _ServiceDep,
    session: SessionDep,
) -> list[PaymentResponse]:
    """Return all active payments."""
    payments = await service.list(db_session=session)
    return [PaymentResponse.model_validate(p) for p in payments]


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
    return PaymentResponse.model_validate(payment)


@router.post("", response_model=PaymentResponse, status_code=201)
async def create_payment(
    data: PaymentCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> PaymentResponse:
    """Create a new payment."""
    payment = await service.create(db_session=session, data=data)
    return PaymentResponse.model_validate(payment)


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
    return PaymentResponse.model_validate(payment)


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
