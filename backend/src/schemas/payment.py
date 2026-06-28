"""Pydantic schemas for the payments domain."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from src.models.enums import PaymentMethod


class PaymentBase(BaseModel):
    """Shared fields for payment creation and updates."""

    record_id: str
    amount: int = Field(gt=0)
    method: PaymentMethod | None = None


class PaymentCreate(PaymentBase):
    """Request schema for creating a new payment."""

    pass


class PaymentUpdate(PaymentBase):
    """Request schema for updating a payment (full replacement via PUT)."""

    pass


class PaymentPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/payments/{id}).

    All fields optional. None means 'don't change'.
    Setting ``amount: null`` is a no-op (stripped by the service via NOT_NULL_FIELDS).
    """

    amount: int | None = Field(default=None, gt=0)
    method: PaymentMethod | None = None


class PaymentResponse(PaymentBase):
    """Response schema with all payment fields."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    updated_at: datetime
    is_active: bool
