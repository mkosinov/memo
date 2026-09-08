"""Pydantic schemas for the clients domain."""

from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, computed_field

from src.domain.phone_digits import to_national_digits
from src.models.enums import ArchiveStatus, Channel
from src.schemas.pagination import PaginationParams


class ClientBase(BaseModel):
    """Shared fields for client creation."""

    name: str | None = None
    phone: str | None = None
    email: str | None = None
    channel: Channel | None = None


class ClientCreate(ClientBase):
    """Request schema for creating a new client."""

    pass


class ClientUpdate(BaseModel):
    """Full-replace PUT schema (GH #201): all 4 personal keys required; explicit
    null = deliberate clear. Omitted key → 422. ``is_active`` is NOT accepted
    (#178 closed by Task 5): it's a lifecycle flag owned by the archive/restore
    POST endpoints (Task 11), and a stray ``is_active`` is rejected with 422 via
    ``extra="forbid"``. ``ClientCreate``/``ClientPatch`` unchanged."""

    model_config = ConfigDict(extra="forbid")

    name: str | None
    phone: str | None
    email: str | None
    channel: Channel | None


class ClientPatch(BaseModel):
    """Request schema for partial updates (PATCH). All fields optional.

    ``is_active`` is NOT accepted (#178 closed by Task 5): archive/restore is
    via the POST endpoints (Task 11). A stray ``is_active`` is rejected with
    422 via ``extra="forbid"``.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    phone: str | None = None
    email: str | None = None
    channel: Channel | None = None


class ClientResponse(BaseModel):
    """Response schema with all client fields.

    Uses ``str | None`` for ``channel`` (not the Channel enum) to tolerate
    any string already stored in the DB (e.g. 'instagram', 'vk', 'website'
    from before the enum was tightened). See issue #60.

    ``is_active`` stays as the DB/ORM column but is ``exclude=True`` so it never
    serializes to JSON. The API exposes ``archived`` (inverted: ``archived = not
    is_active``, ``archived = true`` = in archive) via a computed field (#207 §3.1).
    ``ClientWithStats`` inherits this computed field — the manual builder in
    ``list_clients_with_stats`` keeps passing ``is_active=row.is_active`` (the
    excluded field still accepts it as a constructor kwarg; ``archived`` derives).
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str | None = None
    phone: str | None = None
    email: str | None = None
    channel: str | None = None
    created_at: datetime
    updated_at: datetime
    is_active: bool = Field(..., exclude=True)

    @computed_field
    @property
    def archived(self) -> bool:
        return not self.is_active


class ClientWithStats(ClientResponse):
    """Response schema extending ClientResponse with aggregated metrics."""

    records_count: int = 0
    last_record: str | None = None
    total_paid: int = 0
    missed_records: int = 0


def _phone_param_digits(v: str | None) -> str | None:
    """GH #221 §4 query-value reduction + bounds: empty/missing → None (no
    filter); otherwise §3 national-digit reduction, then the 4-15-digit
    guard (ValueError → 422, mirroring the ``q`` Field bounds)."""
    if v is None or v == "":
        return None
    return _require_4_15_digits(to_national_digits(v))


def _require_4_15_digits(digits: str | None) -> str:
    """GH #221 §4 bounds guard for the ``phone`` param (after §3 reduction):
    4-15 digits, else ValueError → 422 (mirrors the ``q`` field bounds)."""
    if digits is None or not (4 <= len(digits) <= 15):
        raise ValueError("phone must contain 4-15 digits after stripping non-digits")
    return digits


class ClientListParams(PaginationParams):
    """Query parameters for GET /api/v1/clients with filtering, pagination, sorting.

    ``q`` (GH #212): renamed from ``search``; substring search over the
    ``ClientService.search_fields`` matrix (name/phone/email + full-UUID id).
    Length bounds live HERE (params-model field), so out-of-range q → 422.
    """

    q: str | None = Field(default=None, min_length=2, max_length=100)
    # GH #221 §4: digits-mode national-substring filter. Reduction+bounds as
    # a BeforeValidator (NOT @field_validator): the clients list is a
    # Depends() params model, and FastAPI 0.136 validates each query field
    # through its own TypeAdapter — field-level validators run there and map
    # ValueError → 422 VALIDATION_ERROR (like the `q` Field bounds), while a
    # model-level @field_validator only fires at model construction inside
    # solve_dependencies, uncaught → 500. BeforeValidator also reuses the
    # single §3 rule (to_national_digits) so query-side leading 7/8 of an
    # 11-digit query is stripped (query `89991234567` → bound `9991234567`),
    # matching the UDF applied to the stored side. Digits-only bound value →
    # the service needs no LIKE-wildcard escaping.
    phone: Annotated[str | None, BeforeValidator(_phone_param_digits)] = Field(
        default=None, description="GH #221: digits-mode national-substring filter"
    )
    status: ArchiveStatus = ArchiveStatus.ACTIVE
    created_from: date | None = None
    created_to: date | None = None
    updated_from: date | None = None
    updated_to: date | None = None
    min_records: int | None = None
    max_records: int | None = None
    min_paid: int | None = None
    max_paid: int | None = None
    missed_from: int | None = None
    missed_to: int | None = None
    sort_by: str = "name"
    sort_order: str = "asc"
