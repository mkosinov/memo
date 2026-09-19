"""Pydantic schemas for the visits domain."""

from pydantic import BaseModel, ConfigDict, Field

from src.domain.visit_status import VisitStatus


class VisitBase(BaseModel):
    """Shared fields for visit create and update."""

    record_id: str
    visitor_id: str | None = None
    tariff_id: str | None = None
    price: int = Field(ge=0)
    custom_price: int | None = None
    status: VisitStatus = VisitStatus.WAITING


class VisitCreate(VisitBase):
    """Request schema for creating a new visit (POST /api/v1/visits)."""

    pass


class VisitUpdate(VisitBase):
    """Request schema for full-replace update (PUT /api/v1/visits/{id})."""

    pass


class VisitPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/visits/{id}).

    All fields optional. Null-policy: ``null`` on NOT NULL fields
    (``price``, ``status``) is ignored ("don't change"); ``null`` on
    nullable fields (``visitor_id``, ``tariff_id``, ``custom_price``) is
    applied and clears the field.
    """

    visitor_id: str | None = None
    tariff_id: str | None = None
    price: int | None = Field(default=None, ge=0)
    custom_price: int | None = None
    status: VisitStatus | None = None


class VisitStatusUpdate(BaseModel):
    """Request schema for updating a visit's status."""

    status: VisitStatus


class VisitResponse(BaseModel):
    """Response schema for a single visit."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    record_id: str
    visitor_id: str | None = None
    tariff_id: str | None = None
    price: int
    custom_price: int | None = None
    status: str
    created_at: str
    updated_at: str
