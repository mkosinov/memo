"""FastAPI router for payment CRUD endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db_session
from app.domain.payments.schemas import PaymentCreate, PaymentResponse, PaymentUpdate
from app.domain.payments.service import PaymentService

router = APIRouter(tags=["payments"])

_SessionDep = Annotated[AsyncSession, Depends(get_db_session)]


def _get_service(session: _SessionDep) -> PaymentService:
    """Dependency factory for PaymentService."""
    return PaymentService(session)


_ServiceDep = Annotated[PaymentService, Depends(_get_service)]


@router.get("", response_model=list[PaymentResponse])
async def list_payments(service: _ServiceDep) -> list[PaymentResponse]:
    """Return all active payments."""
    payments = await service.list_all()
    return [PaymentResponse.model_validate(p) for p in payments]


@router.get("/{payment_id}", response_model=PaymentResponse)
async def get_payment(payment_id: str, service: _ServiceDep) -> PaymentResponse:
    """Return a single payment by ID."""
    payment = await service.get_by_id(payment_id)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    return PaymentResponse.model_validate(payment)


@router.post("", response_model=PaymentResponse, status_code=201)
async def create_payment(data: PaymentCreate, service: _ServiceDep) -> PaymentResponse:
    """Create a new payment."""
    payment = await service.create(data)
    return PaymentResponse.model_validate(payment)


@router.put("/{payment_id}", response_model=PaymentResponse)
async def update_payment(
    payment_id: str,
    data: PaymentUpdate,
    service: _ServiceDep,
) -> PaymentResponse:
    """Full-update a payment by ID (PUT, not PATCH)."""
    payment = await service.update(payment_id, data)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    return PaymentResponse.model_validate(payment)


@router.delete("/{payment_id}", status_code=204)
async def delete_payment(payment_id: str, service: _ServiceDep) -> None:
    """Soft-delete a payment (set is_active=False)."""
    deleted = await service.delete(payment_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Payment not found")
