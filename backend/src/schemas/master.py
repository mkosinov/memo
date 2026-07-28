"""Pydantic schemas for the masters domain."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class MasterBase(BaseModel):
    """Shared fields for master creation and updates."""

    first_name: str
    last_name: str
    color: str  # hex color e.g. "#5B8C7A"
    position: str  # Position enum value
    specialty: str  # Specialty enum value
    avatar_url: str | None = None
    sort_order: int = 0


class MasterCreate(MasterBase):
    """Request schema for creating a new master."""

    pass


class MasterUpdate(MasterBase):
    """Request schema for updating a master (full replacement via PUT)."""

    is_active: bool = True


class MasterPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/masters/{id}).
    All fields optional. None means 'don't change'.
    """

    first_name: str | None = None
    last_name: str | None = None
    color: str | None = None
    position: str | None = None
    specialty: str | None = None
    avatar_url: str | None = None
    sort_order: int | None = None


class MasterResponse(MasterBase):
    """Response schema with all master fields."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    updated_at: datetime
    is_active: bool


class ReorderRequest(BaseModel):
    """Request body for reordering masters."""

    ids: list[str]
