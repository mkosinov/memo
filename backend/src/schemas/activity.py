"""Pydantic schemas for the activities domain."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ActivityBase(BaseModel):
    """Shared fields for activity creation and updates."""

    master_id: str
    service_id: str
    location_id: str
    start: datetime
    duration: int  # minutes
    capacity: int
    is_private: bool = False
    comment: str | None = None
    record_info: str | None = None


class ActivityCreate(ActivityBase):
    """Request schema for creating a new activity."""

    pass


class ActivityUpdate(ActivityBase):
    """Request schema for updating an activity (full replacement via PUT)."""

    pass


class ActivityPatch(BaseModel):
    """Request schema for partially updating an activity (PATCH) — all fields optional."""

    master_id: str | None = None
    service_id: str | None = None
    location_id: str | None = None
    start: datetime | None = None
    duration: int | None = None  # minutes
    capacity: int | None = None
    is_private: bool | None = None
    comment: str | None = None
    record_info: str | None = None


class ActivityResponse(ActivityBase):
    """Response schema with all activity fields including computed occupied."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    updated_at: datetime
    is_active: bool
    occupied: int = 0  # computed: count of Records for this activity
