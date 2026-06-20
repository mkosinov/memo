"""Pydantic schemas for the records domain."""

from pydantic import BaseModel, ConfigDict

from src.models.enums import VisitStatus


class VisitItem(BaseModel):
    """Nested visit creation/update payload within a record.

    Supports two modes:
    - **Name-based** (for web frontend): provide ``name`` (+ optional ``age``).
      The service will find-or-create a Visitor by name + client_id.
    - **ID-based** (for admin/integration): provide ``visitor_id``.
      Links to an existing Visitor directly.
    """

    name: str | None = None
    age: int | None = None
    visitor_id: str | None = None
    price: int
    custom_price: int | None = None
    status: VisitStatus = VisitStatus.WAITING


class VisitResponse(BaseModel):
    """Response schema for a single visit."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    record_id: str
    visitor_id: str | None = None
    price: int
    custom_price: int | None = None
    status: str
    created_at: str
    updated_at: str
    is_active: bool


class RecordBase(BaseModel):
    """Shared fields for record creation and updates."""

    activity_id: str
    client_id: str | None = None
    status: str
    seats: int
    anonym_visits: int = 0
    comment: str | None = None
    custom_price: int | None = None


class RecordCreate(BaseModel):
    """Request schema for creating a new record with visits.

    Supports two modes:
    - **Phone-based** (for web frontend): provide ``phone``.
      The service will find-or-create a Client and Visitors automatically.
    - **Client-ID-based** (for admin/integration): provide ``client_id``.
      Links to an existing Client directly.
    """

    model_config = ConfigDict(extra="forbid")

    activity_id: str
    phone: str | None = None
    client_id: str | None = None
    anonym_visits: int = 0
    comment: str | None = None
    custom_price: int | None = None
    visits: list[VisitItem]  # seats = len(visits) + anonym_visits


class RecordUpdate(BaseModel):
    """Request schema for updating a record (full replacement via PUT)."""

    model_config = ConfigDict(extra="forbid")

    activity_id: str
    client_id: str | None = None
    anonym_visits: int = 0
    comment: str | None = None
    custom_price: int | None = None
    visits: list[VisitItem]  # full replacement


class RecordPatch(BaseModel):
    """Partial update for record. All fields optional."""

    model_config = ConfigDict(extra="forbid")

    anonym_visits: int | None = None
    comment: str | None = None
    custom_price: int | None = None
    visits: list[VisitItem] | None = None


class RecordResponse(RecordBase):
    """Response schema with all record fields including nested visits."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: str
    updated_at: str
    is_active: bool
    visits: list[VisitResponse] = []
