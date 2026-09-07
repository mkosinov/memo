"""Pydantic schemas for materials."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field

# Sort whitelist for GET /api/v1/materials (#205 Task 3, spec §4.5).
MaterialSortBy = Literal["title", "description", "archived", "created_at"]


class MaterialBase(BaseModel):
    title: str
    description: str


class MaterialCreate(MaterialBase):
    pass


class MaterialUpdate(MaterialBase):
    """Request schema for updating a material (full replacement via PUT).

    ``is_active`` is NOT accepted (#178 closed by Task 5): it's a lifecycle
    flag owned by the archive/restore POST endpoints (Task 11). A stray
    ``is_active`` is rejected with 422 via ``extra="forbid"``.
    """

    model_config = ConfigDict(extra="forbid")


class MaterialPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/materials/{id}).

    All fields optional. None means 'don't change'. ``is_active`` is NOT
    accepted (#178 closed by Task 5): archive/restore is via the POST
    endpoints (Task 11). A stray ``is_active`` is rejected with 422 via
    ``extra="forbid"``.
    """

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    description: str | None = None


class MaterialResponse(MaterialBase):
    """Response schema with all material fields.

    ``is_active`` stays as the DB/ORM column but is ``exclude=True`` so it never
    serializes to JSON. The API exposes ``archived`` (inverted: ``archived = not
    is_active``, ``archived = true`` = in archive) via a computed field (#207 §3.1).

    ``used_in_services_count`` (GH #223 §6): number of NON-ARCHIVED services
    linked to the material — one canonical definition regardless of the
    request's ``status`` slice. Carries a Pydantic default (``= 0``) so
    generic ``GenericService``/``ArchiveService`` paths that don't run the
    ``MaterialService._attach_counts`` helper still validate (e.g. ``create``,
    which returns 0 by definition).
    """

    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: datetime
    updated_at: datetime
    is_active: bool = Field(..., exclude=True)
    used_in_services_count: int = 0

    @computed_field
    @property
    def archived(self) -> bool:
        return not self.is_active
