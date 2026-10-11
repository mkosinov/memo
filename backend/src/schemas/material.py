"""Pydantic schemas for materials."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field

from src.models.enums import ArchiveStatus
from src.schemas.common import SortParams
from src.schemas.pagination import PaginationParams

# Sort whitelist for GET /api/v1/materials (#205 Task 3, spec §4.5).
MaterialSortBy = Literal["title", "description", "archived", "created_at"]


class MaterialListParams(SortParams[MaterialSortBy], PaginationParams):
    """Query parameters for GET /api/v1/materials (GH #371 §4.1).

    Composed of the live bricks: ``SortParams[MaterialSortBy]`` (mechanics
    #367 — no fixed default here, the ``sort_by=None`` fallback order
    stays at the route) + ``PaginationParams`` (``page``/``per_page`` and
    the ``id`` set filter, #232). The router's former scalar query
    siblings ride along 1:1: ``status`` (ACTIVE default), ``q`` (2..100).
    Injected as ``Annotated[MaterialListParams, Query()]`` — scalar query
    siblings are banned (fastapi PR #12481; domain rule 8, #371).
    """

    status: ArchiveStatus = ArchiveStatus.ACTIVE
    q: str | None = Field(default=None, min_length=2, max_length=100)


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


class MaterialDeleteBody(BaseModel):
    """DELETE /api/v1/materials/{id} body — the deferred-delete commit
    state (GH #345 §4.1, mirror of ``TagDeleteBody`` / #318 D2).

    * ``expected`` — id-sets per non-auto FK entity. Material has NO
      non-auto deps (only the auto-cascade ``service_materials`` join),
      so ``{}`` is always the correct payload; the field is still
      mandatory on the execute path (bare DELETE → 422).
    * ``resolutions`` — never needed (the only dep is AUTO); the full
      branch is still honored for API consumers and races.

    Both optional at the schema level: ``?dry_run=true`` needs no body,
    and the execute-path requirement (``expected`` mandatory) is
    enforced in the route branch so the preview stays body-free.
    Unknown body keys are ignored (family semantics §16).
    """

    resolutions: dict[str, str] | None = None
    expected: dict[str, list[str]] | None = None


class MaterialResponse(MaterialBase):
    """Response schema with all material fields.

    ``is_active`` stays as the DB/ORM column but is ``exclude=True`` so it never
    serializes to JSON. The API exposes ``archived`` (inverted: ``archived = not
    is_active``, ``archived = true`` = in archive) via a computed field (#207 §3.1).

    ``used_in_services_count`` (GH #223 §6): number of NON-ARCHIVED services
    linked to the material — one canonical definition regardless of the
    request's ``status`` slice. Carries a Pydantic default (``= 0``) so
    generic ``GenericService``/``ArchiveService`` paths that don't run the
    material service module's ``_attach_counts`` helper still validate
    (e.g. ``create``, which returns 0 by definition).
    """

    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: datetime
    updated_at: datetime
    is_active: bool = Field(..., exclude=True)
    used_in_services_count: int = 0

    # ``@computed_field`` over ``@property`` is pydantic's documented
    # pattern; mypy cannot type a decorator stacked on @property
    # (known limitation) — the pin is the honest suppression.
    @computed_field  # type: ignore[prop-decorator]
    @property
    def archived(self) -> bool:
        return not self.is_active
