"""Pydantic schemas for the records domain."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from src.domain.visit_status import VisitStatus
from src.schemas.pagination import PaginationParams


class VisitItem(BaseModel):
    """Nested visit creation/update payload within a record.

    Supports two modes:
    - **Name-based** (for web frontend): provide ``name`` (+ optional ``age``).
      The service will find-or-create a Visitor by name + client_id.
    - **ID-based** (for admin/integration): provide ``visitor_id``.
      Links to an existing Visitor directly.
    """

    name: str | None = None
    age: int | None = None
    visitor_id: str | None = None
    tariff_id: str | None = None
    price: int
    custom_price: int | None = None
    status: VisitStatus = VisitStatus.WAITING


class VisitResponse(BaseModel):
    """Response schema for a single visit."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    record_id: str
    visitor_id: str | None = None
    tariff_id: str | None = None
    price: int
    custom_price: int | None = None
    status: str
    created_at: str
    updated_at: str


class RecordBase(BaseModel):
    """Shared fields for record creation and updates."""

    activity_id: str
    client_id: str | None = None
    status: str
    seats: int
    comment: str | None = None
    custom_price: int | None = None


class RecordCreate(BaseModel):
    """Request schema for creating a new record with visits.

    Supports two modes:
    - **Phone-based** (for web frontend): provide ``phone``.
      The service will find-or-create a Client and Visitors automatically.
    - **Client-ID-based** (for admin/integration): provide ``client_id``.
      Links to an existing Client directly.
    """

    model_config = ConfigDict(extra="forbid")

    activity_id: str
    phone: str | None = None
    client_id: str | None = None
    comment: str | None = None
    custom_price: int | None = None
    visits: list[VisitItem]  # seats = len(visits)


class RecordUpdate(BaseModel):
    """Request schema for updating a record (full replacement via PUT)."""

    model_config = ConfigDict(extra="forbid")

    activity_id: str
    client_id: str | None = None
    comment: str | None = None
    custom_price: int | None = None
    visits: list[VisitItem]  # full replacement


class RecordPatch(BaseModel):
    """Partial update for record. All fields optional."""

    model_config = ConfigDict(extra="forbid")

    comment: str | None = None
    custom_price: int | None = None
    visits: list[VisitItem] | None = None


class RecordDeleteBody(BaseModel):
    """DELETE /api/v1/records/{id} body — the deferred-delete commit state (#285 rev7).

    Every real deletion must declare the dependency state the caller saw at
    dry-run time (spec §3 D1/D9a):

    * ``expected`` — id-sets per FK entity (rev6: ids, not counters — the
      check also catches a swapped dependency at an unchanged counter);
      clean path sends ``{}``.
    * ``resolutions`` — the user's cascade choices (§6); cascade commits
      send ``{"visits": "cascade", "payments": "cascade"}`` alongside
      ``expected``.

    Both optional at the schema level: ``?dry_run=true`` needs no body, and
    the execute-path requirement (``expected`` mandatory) is enforced in
    the route branch so the preview stays body-free.
    """

    resolutions: dict[str, str] | None = None
    expected: dict[str, list[str]] | None = None


class RecordResponse(RecordBase):
    """Response schema with all record fields including nested visits."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: str
    updated_at: str
    visits: list[VisitResponse] = []


class RecordViewResponse(RecordResponse):
    """RecordResponse + denormalized display fields for the records table (GH #213).

    Sourced from correlated scalar subqueries with NO ``is_active`` filter —
    archived clients/masters/services/locations resolve their names (US-3,
    photos ``client_name`` precedent); FK-dangling rows yield ``None``.
    ``activity_start`` / ``is_private`` come from the already INNER-joined
    Activity (direct columns). ``paid`` is ``COALESCE(SUM(Payment.amount), 0)``
    — payments are hard-deleted, no inactive filter (payments.md).
    """

    client_name: str | None = None
    # ISO string, byte-identical to ActivityResponse.start serialization —
    # the frontend parseActivityStart slices the raw string (§4 parity pin).
    activity_start: str | None = None
    service_title: str | None = None
    master_name: str | None = None  # «Фамилия Имя» — displayMasterName parity
    location_name: str | None = None
    master_color: str | None = None
    is_private: bool = False
    paid: int = 0


RecordSortBy = Literal[
    "date", "client", "service", "master", "location",
    "guests", "status", "total", "payment",
]
RecordSortOrder = Literal["asc", "desc"]


class RecordListParams(PaginationParams):
    """Query parameters for GET /api/v1/records with filtering, pagination, sorting (#191).

    Injected as ``Annotated[RecordListParams, Query()]`` (Query, not Depends: this model is the sole query-param carrier for the records endpoint — no scalar-param mixing; Depends-with-model is discouraged upstream).
    """

    client_id: str | None = None
    activity_id: str | None = None
    date_from: date | None = None
    date_to: date | None = None
    location_id: str | None = None
    service_id: str | None = None
    master_id: str | None = None
    status: VisitStatus | None = None
    sort_by: RecordSortBy = "date"
    sort_order: RecordSortOrder = "asc"
    q: str | None = Field(default=None, min_length=2, max_length=100)

    @model_validator(mode="after")
    def _check_date_range(self) -> "RecordListParams":
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError("date_from must be on or before date_to")
        return self
