"""Pydantic schemas for the services domain."""

from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from src.models.enums import TariffAudience

# Sort whitelist for GET /api/v1/services (#205 Task 3, spec §4.5).
# ``material_hint`` removed by GH #223 Task 13 (spec §10) — retired field.
ServiceSortBy = Literal[
    "title", "duration", "age", "tariffs",
    "specialty", "archived", "created_at",
]


class TagResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str


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
    """Shared tariff fields (GH #284 Task 2).

    ``audience`` is typed by the ``TariffAudience`` enum (Task 1): absent →
    ``all`` (backward compat with pre-#284 clients), unknown string → 422
    instead of a silent junk write. Subclasses (Create/Update/Response)
    inherit it.
    """

    title: str
    description: str | None = None
    price: int
    audience: TariffAudience = TariffAudience.ALL


class TariffCreate(TariffBase):
    """Create-shape of a nested tariff.

    Deliberately has NO ``id`` (GH #357 spec §«Технические изменения» п.1):
    the identifier is not accepted at creation — a stray ``id`` in the
    payload is ignored (extra keys don't parse into the model).
    """


class TariffUpdate(TariffBase):
    """Update-shape of a nested tariff (GH #357 Task 1).

    ``id`` is the diff key on Service update: present → the row with this
    id is updated in place; absent → a new row is inserted. Duplicate ids
    inside one list are rejected on the parent Service schema (ambiguous
    diff key).
    """

    id: str | None = None


def _check_tariff_ids_unique(tariffs: list[TariffUpdate] | None) -> None:
    """Reject a repeated tariff ``id`` in one request list (GH #357 Task 1).

    A duplicate id is an ambiguous diff key (which row to UPDATE?), so the
    request is rejected at the schema level — FastAPI maps the pydantic
    ``ValueError`` to 422 ``VALIDATION_ERROR``. The message names the index
    of the offending (repeated) row, pydantic-``loc`` style (``tariffs[i]``).
    ``None`` ids never collide: two id-less rows are two INSERTs.
    """
    if not tariffs:
        return
    seen: set[str] = set()
    for index, tariff in enumerate(tariffs):
        if tariff.id is None:
            continue
        if tariff.id in seen:
            raise ValueError(
                f"tariffs[{index}]: duplicate tariff id '{tariff.id}'"
            )
        seen.add(tariff.id)


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

    ``tariffs`` rows carry an optional ``id`` — the diff key (GH #357):
    duplicate ids in one list are rejected with 422 (ambiguous diff key).
    """

    model_config = ConfigDict(extra="forbid")

    tariffs: list[TariffUpdate] = []
    tag_ids: list[str] = []
    materials: list[ServiceMaterialLinkIn] = []

    @model_validator(mode="after")
    def _tariff_ids_unique(self) -> Self:
        _check_tariff_ids_unique(self.tariffs)
        return self


class ServicePatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/services/{id}).

    All fields optional. None means 'don't change'.

    ``tag_ids``: if sent → hard-replace all tag links. If not sent → preserve existing.
    ``tariffs``: if sent → hard-replace all tariffs. If not sent → preserve existing.
    Rows carry an optional ``id`` diff key (GH #357): duplicate ids in one
    list are rejected with 422 (ambiguous diff key).
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
    tariffs: list[TariffUpdate] | None = None
    materials: list[ServiceMaterialLinkIn] | None = None

    @model_validator(mode="after")
    def _tariff_ids_unique(self) -> Self:
        _check_tariff_ids_unique(self.tariffs)
        return self


class ServiceDeleteBody(BaseModel):
    """DELETE /api/v1/services/{id} body — the deferred-delete commit
    state (GH #345 §4.1, mirror of ``TagDeleteBody`` / #318 D2).

    * ``expected`` — id-sets per non-auto FK entity. Service's only
      non-auto dep is ``activities`` (blocked — never confirmed by the
      user, but its id-set still participates in the race gate: an
      activity appearing mid-window on a "clean" service must 409, not
      fall through as a blocked-422); the clean/all-auto path sends
      ``{}``.
    * ``resolutions`` — the user's cascade choices; for Service every
      non-block dep is AUTO, so a successful commit never needs them
      (the full branch is still honored for API consumers and races).

    Both optional at the schema level: ``?dry_run=true`` needs no body,
    and the execute-path requirement (``expected`` mandatory) is
    enforced in the route branch so the preview stays body-free.
    Unknown body keys are ignored (family semantics §16).
    """

    resolutions: dict[str, str] | None = None
    expected: dict[str, list[str]] | None = None


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

    # ``@computed_field`` over ``@property`` is pydantic's documented
    # pattern; mypy cannot type a decorator stacked on @property
    # (known limitation) — the pin is the honest suppression.
    @computed_field  # type: ignore[prop-decorator]
    @property
    def archived(self) -> bool:
        return not self.is_active
