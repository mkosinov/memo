"""Pydantic schemas for the user_settings domain."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserSettingsResponse(BaseModel):
    """Response schema with all user_settings fields."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    theme: str
    language: str
    column_order_masters: list[str]
    column_order_locations: list[str]
    created_at: datetime
    updated_at: datetime


class UserSettingsCreate(BaseModel):
    """Request schema for creating user settings."""

    user_id: str
    theme: str = "light"
    language: str = "ru"
    column_order_masters: list[str] = []
    column_order_locations: list[str] = []


class UserSettingsUpdate(BaseModel):
    """Request schema for partially updating user settings — all fields optional."""

    theme: str | None = None
    language: str | None = None
    column_order_masters: list[str] | None = None
    column_order_locations: list[str] | None = None
