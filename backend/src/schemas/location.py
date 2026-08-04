"""Pydantic schemas for the location domain."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class LocationBase(BaseModel):
    """Shared fields for location creation and updates."""

    name: str
    short_title: str | None = None
    address: str | None = None
    description: str | None = None
    capacity: int
    yandex_map_url: str | None = None
    review_url: str | None = None
    record_info: str | None = None
    image_url: str | None = None
    location_hint: str | None = None
    sort_order: int = 0


class LocationCreate(LocationBase):
    """Request schema for creating a new location."""

    pass


class LocationUpdate(LocationBase):
    """Request schema for updating a location (full replacement via PUT)."""

    is_active: bool  # required on PUT — canonical full-replace (#178); PATCH sticky via LocationPatch


class LocationPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/locations/{id}).
    All fields optional. None means 'don't change'.
    """

    name: str | None = None
    short_title: str | None = None
    address: str | None = None
    description: str | None = None
    capacity: int | None = None
    yandex_map_url: str | None = None
    review_url: str | None = None
    record_info: str | None = None
    image_url: str | None = None
    location_hint: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class LocationResponse(LocationBase):
    """Response schema with all location fields."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    updated_at: datetime
    is_active: bool


class ReorderRequest(BaseModel):
    """Request body for reordering locations."""

    ids: list[str]
