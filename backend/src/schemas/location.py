"""Pydantic schemas for the location domain."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field

# Sort whitelist for GET /api/v1/locations (#205 Task 3, spec §4.5; #172:
# ``name`` → ``title`` — thing-title canon).
LocationSortBy = Literal[
    "title", "short_title", "capacity", "address", "location_hint",
    "description", "archived", "yandex_map_url", "created_at",
]


class LocationBase(BaseModel):
    """Shared fields for location creation and updates."""

    title: str
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
    """Request schema for updating a location (full replacement via PUT).

    ``is_active`` is NOT accepted (#178 closed by Task 5): it's a lifecycle
    flag owned by the archive/restore POST endpoints (Task 11). A stray
    ``is_active`` is rejected with 422 via ``extra="forbid"``.
    """

    model_config = ConfigDict(extra="forbid")


class LocationPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/locations/{id}).

    All fields optional. None means 'don't change'. ``is_active`` is NOT
    accepted (#178 closed by Task 5): archive/restore is via the POST
    endpoints (Task 11). A stray ``is_active`` is rejected with 422 via
    ``extra="forbid"``.
    """

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
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


class LocationDeleteBody(BaseModel):
    """DELETE /api/v1/locations/{id} body — the deferred-delete commit
    state (GH #345 §4.1, mirror of ``TagDeleteBody`` / #318 D2).

    * ``expected`` — id-sets per non-auto FK entity. Location's only
      non-auto dep is ``activities`` (blocked — never confirmed by the
      user, but its id-set still participates in the race gate); the
      clean/all-auto path sends ``{}``.
    * ``resolutions`` — the user's cascade choices; for Location every
      non-block dep is AUTO (location_tags, photos), so a successful
      commit never needs them (the full branch is still honored).

    Both optional at the schema level: ``?dry_run=true`` needs no body,
    and the execute-path requirement (``expected`` mandatory) is
    enforced in the route branch so the preview stays body-free.
    Unknown body keys are ignored (family semantics §16).
    """

    resolutions: dict[str, str] | None = None
    expected: dict[str, list[str]] | None = None


class LocationResponse(LocationBase):
    """Response schema with all location fields.

    ``is_active`` stays as the DB/ORM column but is ``exclude=True`` so it never
    serializes to JSON. The API exposes ``archived`` (inverted: ``archived = not
    is_active``, ``archived = true`` = in archive) via a computed field (#207 §3.1).
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    updated_at: datetime
    is_active: bool = Field(..., exclude=True)

    # ``@computed_field`` over ``@property`` is pydantic's documented
    # pattern; mypy cannot type a decorator stacked on @property
    # (known limitation) — the pin is the honest suppression.
    @computed_field  # type: ignore[prop-decorator]
    @property
    def archived(self) -> bool:
        return not self.is_active


class ReorderRequest(BaseModel):
    """Request body for reordering locations."""

    ids: list[str]
