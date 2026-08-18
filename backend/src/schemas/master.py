"""Pydantic schemas for the masters domain."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field

# Sort whitelist for GET /api/v1/masters (#205 Task 3, spec §4.5).
# Keys = exactly the sortable column keys the Masters table headers use.
MasterSortBy = Literal["name", "specialty", "position", "color", "avatar", "status"]


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
    """Request schema for updating a master (full replacement via PUT).

    ``is_active`` is NOT accepted (#178 closed by Task 5): it's a lifecycle
    flag owned by the archive/restore POST endpoints (Task 11). A stray
    ``is_active`` is rejected with 422 via ``extra="forbid"``.
    """

    model_config = ConfigDict(extra="forbid")


class MasterPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/masters/{id}).

    All fields optional. None means 'don't change'. ``is_active`` is NOT
    accepted (#178 closed by Task 5): archive/restore is via the POST
    endpoints (Task 11). A stray ``is_active`` is rejected with 422 via
    ``extra="forbid"``.
    """

    model_config = ConfigDict(extra="forbid")

    first_name: str | None = None
    last_name: str | None = None
    color: str | None = None
    position: str | None = None
    specialty: str | None = None
    avatar_url: str | None = None
    sort_order: int | None = None


class MasterResponse(MasterBase):
    """Response schema with all master fields.

    ``is_active`` stays as the DB/ORM column but is ``exclude=True`` so it never
    serializes to JSON. The API exposes ``archived`` (inverted: ``archived = not
    is_active``, ``archived = true`` = in archive) via a computed field (#207 §3.1).
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    updated_at: datetime
    is_active: bool = Field(..., exclude=True)

    @computed_field
    @property
    def archived(self) -> bool:
        return not self.is_active


class ReorderRequest(BaseModel):
    """Request body for reordering masters."""

    ids: list[str]
