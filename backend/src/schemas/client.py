"""Pydantic schemas for the clients domain."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from src.models.enums import ArchiveStatus, Channel


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
    """Full-replace PUT schema (GH #201): all 5 keys required; explicit null =
    deliberate clear. Omitted key → 422. `ClientCreate`/`ClientPatch` unchanged."""

    name: str | None
    phone: str | None
    email: str | None
    channel: Channel | None
    is_active: bool


class ClientPatch(BaseModel):
    """Request schema for partial updates (PATCH). All fields optional."""

    name: str | None = None
    phone: str | None = None
    email: str | None = None
    channel: Channel | None = None
    is_active: bool | None = None  # None = preserve stored value; sticky field (#184)


class ClientResponse(BaseModel):
    """Response schema with all client fields.

    Uses ``str | None`` for ``channel`` (not the Channel enum) to tolerate
    any string already stored in the DB (e.g. 'instagram', 'vk', 'website'
    from before the enum was tightened). See issue #60.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str | None = None
    phone: str | None = None
    email: str | None = None
    channel: str | None = None
    created_at: datetime
    updated_at: datetime
    is_active: bool


class ClientWithStats(ClientResponse):
    """Response schema extending ClientResponse with aggregated metrics."""

    records_count: int = 0
    last_record: str | None = None
    total_paid: int = 0
    missed_records: int = 0


class ClientListParams(BaseModel):
    """Query parameters for GET /api/v1/clients with filtering, pagination, sorting."""

    page: int = Field(default=1, ge=1)
    per_page: int = Field(default=20, ge=1, le=100)
    search: str | None = None
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


class ClientListResponse(BaseModel):
    """Paginated response for client listing with stats."""

    items: list[ClientWithStats]
    total: int
    page: int
    per_page: int
