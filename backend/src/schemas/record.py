"""Pydantic schemas for the records domain."""

from pydantic import BaseModel, ConfigDict


class VisitItem(BaseModel):
    """Nested visit creation/update payload within a record."""

    visitor_id: str
    price: int
    status: str = "waiting"  # VisitStatus value


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


class RecordBase(BaseModel):
    """Shared fields for record creation and updates."""

    activity_id: str
    client_id: str | None = None
    status: str = "pending"  # RecordStatus value
    seats: int
    comment: str | None = None


class RecordCreate(BaseModel):
    """Request schema for creating a new record with visits."""

    activity_id: str
    client_id: str | None = None
    comment: str | None = None
    visits: list[VisitItem]  # seats = len(visits)


class RecordUpdate(BaseModel):
    """Request schema for updating a record (full replacement via PUT)."""

    activity_id: str
    client_id: str | None = None
    status: str
    comment: str | None = None
    visits: list[VisitItem]  # full replacement


class RecordResponse(RecordBase):
    """Response schema with all record fields including nested visits."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: str
    updated_at: str
    is_active: bool
    visits: list[VisitResponse] = []
