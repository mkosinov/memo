"""Pydantic schemas for the visitors domain."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class VisitorBase(BaseModel):
    """Shared fields for visitor creation and updates."""

    name: str
    age: int | None = None


class VisitorCreate(VisitorBase):
    """Request schema for creating a new visitor."""

    client_id: str


class VisitorUpdate(VisitorBase):
    """Request schema for updating a visitor (full replacement via PUT)."""

    pass


class VisitorResponse(VisitorBase):
    """Response schema with all visitor fields."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    client_id: str
    created_at: datetime
    updated_at: datetime
    is_active: bool
