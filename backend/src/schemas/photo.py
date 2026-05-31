"""Pydantic schemas for photos."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class PhotoResponse(BaseModel):
    """Response schema for a photo."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    visitor_id: str | None = None
    service_id: str | None = None
    activity_id: str | None = None
    is_public: bool = False
    created_at: datetime
    updated_at: datetime
    is_active: bool
