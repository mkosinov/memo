"""Pydantic schemas for the visits domain."""

from pydantic import BaseModel, ConfigDict

from src.models.enums import VisitStatus


class VisitStatusUpdate(BaseModel):
    """Request schema for updating a visit's status."""

    status: VisitStatus


class VisitResponse(BaseModel):
    """Response schema for a single visit."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    record_id: str
    visitor_id: str
    price: int
    status: str
    created_at: str
    updated_at: str
    is_active: bool
