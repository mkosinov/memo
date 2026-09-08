"""Pydantic schemas for the services domain."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field

# Sort whitelist for GET /api/v1/services (#205 Task 3, spec §4.5).
# ``material_hint`` removed by GH #223 Task 13 (spec §10) — retired field.
ServiceSortBy = Literal[
    "title", "duration", "age", "tariffs",
    "specialty", "archived", "created_at",
]


class TagResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    tag: str


class ServiceMaterialItem(BaseModel):
    """Nested material payload on ``ServiceResponse`` (GH #223 spec §4/§5).

    Built from association rows: the material's ``description`` travels with
    the link so clients render the ``note ?? description`` fallback without
    extra fetches. Ordered ``title ASC, id ASC`` (spec §3.3).
    """

    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str
    description: str
    note: str | None


class TariffBase(BaseModel):
    title: str
    description: str | None = None
    price: int


class TariffCreate(TariffBase):
    pass


class TariffUpdate(TariffBase):
    pass


class TariffResponse(TariffBase):
    model_config = ConfigDict(from_attributes=True)
    id: str
    service_id: str


class ServiceMaterialLinkIn(BaseModel):
    """Write-shape of one service→material link (GH #223 spec §4).

    ``note`` is optional: omitted/null → stored as NULL → display falls back
    to the material's ``description`` (spec §2 decision 3). Whitespace-only
    notes normalize to NULL server-side on write (spec §4).
    """

    material_id: str
    note: str | None = None


class ServiceBase(BaseModel):
    title: str
    description: str
    image_url: str
    specialty: str
    min_age: int
    max_age: int | None = None
    duration: int
    record_info: str


class ServiceCreate(ServiceBase):
    tariffs: list[TariffCreate] = []
    tag_ids: list[str] = []
    materials: list[ServiceMaterialLinkIn] = []


class ServiceUpdate(ServiceBase):
    """Request schema for updating a service (full replacement via PUT).

    ``is_active`` is NOT accepted (#178 closed by Task 5): it's a lifecycle
    flag owned by the archive/restore POST endpoints (Task 11). A stray
    ``is_active`` is rejected with 422 via ``extra="forbid"``.
    """

    model_config = ConfigDict(extra="forbid")

    tariffs: list[TariffCreate] = []
    tag_ids: list[str] = []
    materials: list[ServiceMaterialLinkIn] = []


class ServicePatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/services/{id}).

    All fields optional. None means 'don't change'.

    ``tag_ids``: if sent → hard-replace all tag links. If not sent → preserve existing.
    ``tariffs``: if sent → hard-replace all tariffs. If not sent → preserve existing.
    ``materials`` (GH #223 spec §4): absent/null → preserve existing links;
    sent (incl. ``[]``) → hard-replace; ``[]`` clears all — the same
    exclude_unset idiom as ``tag_ids``.

    ``is_active`` is NOT accepted (#178 closed by Task 5): archive/restore is
    via the POST endpoints (Task 11). A stray ``is_active`` is rejected with
    422 via ``extra="forbid"``.
    """

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    description: str | None = None
    image_url: str | None = None
    specialty: str | None = None
    min_age: int | None = None
    max_age: int | None = None
    duration: int | None = None
    record_info: str | None = None
    tag_ids: list[str] | None = None
    tariffs: list[TariffCreate] | None = None
    materials: list[ServiceMaterialLinkIn] | None = None


class ServiceResponse(ServiceBase):
    """Response schema for a service.

    ``is_active`` stays as the DB/ORM column but is ``exclude=True`` so it never
    serializes to JSON. The API exposes ``archived`` (inverted: ``archived = not
    is_active``, ``archived = true`` = in archive) via a computed field (#207 §3.1).
    """

    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: datetime
    updated_at: datetime
    is_active: bool = Field(..., exclude=True)
    tariffs: list[TariffResponse] = []
    tags: list[TagResponse] = []
    materials: list[ServiceMaterialItem] = []

    @computed_field
    @property
    def archived(self) -> bool:
        return not self.is_active
