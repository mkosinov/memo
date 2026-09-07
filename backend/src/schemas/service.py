"""Pydantic schemas for the services domain."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field

# Sort whitelist for GET /api/v1/services (#205 Task 3, spec §4.5).
ServiceSortBy = Literal[
    "title", "duration", "age", "material_hint", "tariffs",
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


class ServiceBase(BaseModel):
    title: str
    description: str
    image_url: str
    specialty: str
    min_age: int
    max_age: int | None = None
    duration: int
    record_info: str
    material_hint: str | None = None


class ServiceCreate(ServiceBase):
    tariffs: list[TariffCreate] = []
    tag_ids: list[str] = []


class ServiceUpdate(ServiceBase):
    """Request schema for updating a service (full replacement via PUT).

    ``is_active`` is NOT accepted (#178 closed by Task 5): it's a lifecycle
    flag owned by the archive/restore POST endpoints (Task 11). A stray
    ``is_active`` is rejected with 422 via ``extra="forbid"``.
    """

    model_config = ConfigDict(extra="forbid")

    tariffs: list[TariffCreate] = []
    tag_ids: list[str] = []


class ServicePatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/services/{id}).

    All fields optional. None means 'don't change'.

    ``tag_ids``: if sent → hard-replace all tag links. If not sent → preserve existing.
    ``tariffs``: if sent → hard-replace all tariffs. If not sent → preserve existing.

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
    material_hint: str | None = None
    tag_ids: list[str] | None = None
    tariffs: list[TariffCreate] | None = None


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
