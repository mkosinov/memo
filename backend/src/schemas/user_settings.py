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
    column_order_staff: list[str]
    column_order_locations: list[str]
    created_at: datetime
    updated_at: datetime


class UserSettingsCreate(BaseModel):
    """Request schema for creating user settings."""

    user_id: str
    theme: str = "light"
    language: str = "ru"
    column_order_staff: list[str] = []
    column_order_locations: list[str] = []


class UserSettingsUpdate(BaseModel):
    """Request schema for partially updating user settings — all fields optional.
    
    TODO: After frontend migration, PUT should use a strict schema with all fields
    required (full replacement semantics). For now, this all-optional schema is used
    by both PUT and PATCH for backward compatibility.
    """

    theme: str | None = None
    language: str | None = None
    column_order_staff: list[str] | None = None
    column_order_locations: list[str] | None = None


class UserSettingsPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/user-settings).
    
    All fields optional. None means 'don't change'.
    This is the semantically correct schema for PATCH (partial update).
    """

    theme: str | None = None
    language: str | None = None
    column_order_staff: list[str] | None = None
    column_order_locations: list[str] | None = None
