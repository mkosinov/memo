"""Pydantic schemas for the clients domain."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from src.models.enums import Channel


class ClientBase(BaseModel):
    """Shared fields for client creation and updates."""

    name: str | None = None
    phone: str | None = None
    email: str | None = None
    channel: Channel | None = None


class ClientCreate(ClientBase):
    """Request schema for creating a new client."""

    pass


class ClientUpdate(ClientBase):
    """Request schema for updating a client (full replacement via PUT)."""

    pass


class ClientPatch(BaseModel):
    """Request schema for partial updates (PATCH). All fields optional."""

    name: str | None = None
    phone: str | None = None
    email: str | None = None
    channel: Channel | None = None


class ClientResponse(ClientBase):
    """Response schema with all client fields."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    updated_at: datetime
    is_active: bool


class ClientWithStats(ClientResponse):
    """Response schema extending ClientResponse with aggregated metrics."""

    visits_count: int = 0
    last_visit: str | None = None
    total_paid: int = 0
    missed_visits: int = 0


class ClientListParams(BaseModel):
    """Query parameters for GET /api/v1/clients with filtering, pagination, sorting."""

    page: int = 1
    per_page: int = Field(default=20, le=100)
    search: str | None = None
    is_active: bool | None = None
    created_from: date | None = None
    created_to: date | None = None
    updated_from: date | None = None
    updated_to: date | None = None
    min_visits: int | None = None
    max_visits: int | None = None
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
