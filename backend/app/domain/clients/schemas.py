"""Pydantic schemas for the clients domain."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ClientBase(BaseModel):
    """Shared fields for client creation and updates."""

    name: str
    phone: str
    email: str | None = None
    channel: str  # "phone", "email", "telegram", "whatsapp"


class ClientCreate(ClientBase):
    """Request schema for creating a new client."""

    pass


class ClientUpdate(ClientBase):
    """Request schema for updating a client (full replacement via PUT)."""

    pass


class ClientResponse(ClientBase):
    """Response schema with all client fields."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    updated_at: datetime
    is_active: bool
