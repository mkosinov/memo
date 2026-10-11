"""Pydantic schemas for the payments domain."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from src.models.enums import PaymentMethod
from src.schemas.pagination import PaginationParams


class PaymentBase(BaseModel):
    """Shared fields for payment creation and updates."""

    record_id: str
    amount: int = Field(gt=0)
    method: PaymentMethod | None = None


class PaymentCreate(PaymentBase):
    """Request schema for creating a new payment.

    ``created_at`` is optional: when provided, the payment uses the
    client-supplied timestamp; when omitted, the DB default (now) applies.
    """

    created_at: datetime | None = None


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


class PaymentListParams(PaginationParams):
    """Query parameters for GET /api/v1/payments (GH #371 §4.1).

    Composed of the ``PaginationParams`` brick (``page``/``per_page`` and
    the ``id`` set filter, #232 — ``?id=`` starts working on payments).
    The router's former scalar query sibling rides along 1:1:
    ``record_id`` (``str`` — the pre-conversion annotation, no UUID
    tightening: spec §4.1 keeps the annotations, scenario 8 wire
    parity). The master scope is NOT a query field — it stays a
    Depends sibling (``get_scope``; domain rule 8, #371). Injected as
    ``Annotated[PaymentListParams, Query()]`` — scalar query siblings
    are banned (fastapi PR #12481).
    """

    record_id: str | None = None


class PaymentTotalsParams(BaseModel):
    """Query parameters for GET /api/v1/payments/totals (GH #371 §4.2).

    The repeatable ``record_ids`` keys (plain strings — same as the scalar
    signature before the uniform conversion), capped at 200 (too_long →
    422). Injected as ``Annotated[PaymentTotalsParams, Query()]`` — no
    scalar query siblings (fastapi PR #12481; domain rule 8, #371).
    """

    record_ids: list[str] = Field(default_factory=list, max_length=200)


class PaymentTotalsResponse(BaseModel):
    """Response schema for the batch aggregate totals endpoint."""

    totals: dict[str, int]
