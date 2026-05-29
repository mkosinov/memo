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


class MasterCreate(MasterBase):
    """Request schema for creating a new master."""

    pass


class MasterUpdate(MasterBase):
    """Request schema for updating a master (full replacement via PUT)."""

    pass


class MasterResponse(MasterBase):
    """Response schema with all master fields."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    updated_at: datetime
    is_active: bool
