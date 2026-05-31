"""Pydantic schemas for the location domain."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class LocationBase(BaseModel):
    """Shared fields for location creation and updates."""

    name: str
    address: str | None = None
    description: str | None = None
    capacity: int
    yandex_map_url: str | None = None
    review_url: str | None = None
    record_info: str | None = None
    image_url: str | None = None
    location_hint: str | None = None


class LocationCreate(LocationBase):
    """Request schema for creating a new location."""

    pass


class LocationUpdate(LocationBase):
    """Request schema for updating a location (full replacement via PUT)."""

    pass


class LocationResponse(LocationBase):
    """Response schema with all location fields."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    updated_at: datetime
    is_active: bool
