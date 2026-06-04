"""Pydantic schemas for the clients domain."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict

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
