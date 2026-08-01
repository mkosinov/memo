"""Pydantic schemas for photos."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class PhotoCreate(BaseModel):
    """Request schema for creating a photo."""
    filename: str
    visitor_id: str | None = None
    service_id: str | None = None
    activity_id: str | None = None
    is_public: bool = False
    tag_ids: list[str] = []


class PhotoUpdate(BaseModel):
    """Request schema for updating a photo (full replacement via PUT).

    ``filename`` and ``is_public`` are required because they map to
    NOT NULL columns in the database.
    """
    filename: str
    visitor_id: str | None = None
    service_id: str | None = None
    activity_id: str | None = None
    is_public: bool = False
    tag_ids: list[str] | None = None


class PhotoPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/photos/{id}).
    All fields optional. None means 'don't change'.

    ``tag_ids``: if sent → hard-replace all tag links. If not sent → preserve existing.
    """
    filename: str | None = None
    visitor_id: str | None = None
    service_id: str | None = None
    activity_id: str | None = None
    is_public: bool | None = None
    tag_ids: list[str] | None = None


class PhotoTagResponse(BaseModel):
    """Tag reference in photo response."""
    model_config = ConfigDict(from_attributes=True)
    
    id: str
    tag: str


class PhotoResponse(BaseModel):
    """Response schema for a photo."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    visitor_id: str | None = None
    service_id: str | None = None
    activity_id: str | None = None
    is_public: bool = False
    tags: list[PhotoTagResponse] = []
    created_at: datetime
    updated_at: datetime
