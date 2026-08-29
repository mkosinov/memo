"""Pydantic schemas for photos."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from src.schemas.common import SortOrder
from src.schemas.pagination import PaginationParams

PhotoSortBy = Literal["filename", "is_public", "created_at"]

#: A photo is owned by at most ONE of these (GH #211 4-owner model;
#: enforced by ``ck_photos_single_owner`` at the DB level).
OWNER_FIELDS = ("client_id", "service_id", "activity_id", "location_id")


def _reject_multiple_owners(values: dict) -> dict:
    """``mode="before"`` validator: at most one non-null owner per payload."""
    owners = [f for f in OWNER_FIELDS if values.get(f) is not None]
    if len(owners) > 1:
        raise ValueError(f"photo may have at most one owner; got: {', '.join(owners)}")
    return values


class PhotoCreate(BaseModel):
    """Request schema for creating a photo."""

    filename: str
    client_id: str | None = None
    service_id: str | None = None
    activity_id: str | None = None
    location_id: str | None = None
    is_public: bool = False
    tag_ids: list[str] = []
    _owners = model_validator(mode="before")(_reject_multiple_owners)


class PhotoUpdate(BaseModel):
    """Request schema for updating a photo (full replacement via PUT).

    ``filename`` and ``is_public`` are required because they map to
    NOT NULL columns in the database.
    """

    filename: str
    client_id: str | None = None
    service_id: str | None = None
    activity_id: str | None = None
    location_id: str | None = None
    is_public: bool
    tag_ids: list[str] | None = None
    _owners = model_validator(mode="before")(_reject_multiple_owners)


class PhotoPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/photos/{id}).
    All fields optional. None means 'don't change'.

    No multiple-owner payload validator here: PATCH semantics need the
    MERGED field set (payload + stored row), so the check lives in the
    service (GH #211 Task 3).

    ``tag_ids``: if sent → hard-replace all tag links. If not sent → preserve existing.
    """

    filename: str | None = None
    client_id: str | None = None
    service_id: str | None = None
    activity_id: str | None = None
    location_id: str | None = None
    is_public: bool | None = None
    tag_ids: list[str] | None = None


class PhotoTagResponse(BaseModel):
    """Tag reference in photo response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    tag: str


class PhotoListParams(PaginationParams):
    """Query parameters for GET /api/v1/photos (#211).

    Injected as ``Annotated[PhotoListParams, Query()]`` (Query, not
    Depends: this model is the sole query-param carrier for the photos
    list handler — no scalar-param mixing; fastapi #12481).
    """

    q: str | None = Field(default=None, min_length=2, max_length=100)
    client_id: str | None = None
    location_id: str | None = None
    activity_id: str | None = None
    service_id: str | None = None
    tag_id: list[str] | None = Field(
        default=None,
        description="repeatable; AND semantics — photo must have ALL selected tags",
    )
    sort_by: PhotoSortBy = "created_at"
    sort_order: SortOrder = "desc"


class PhotoResponse(BaseModel):
    """Response schema for a photo."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    client_id: str | None = None
    service_id: str | None = None
    activity_id: str | None = None
    location_id: str | None = None
    is_public: bool = False
    tags: list[PhotoTagResponse] = []
    client_name: str | None = None
    created_at: datetime
    updated_at: datetime
