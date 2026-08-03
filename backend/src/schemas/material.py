"""Pydantic schemas for materials."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class MaterialBase(BaseModel):
    title: str
    description: str


class MaterialCreate(MaterialBase):
    pass


class MaterialUpdate(MaterialBase):
    """Request schema for updating a material (full replacement via PUT)."""

    is_active: bool | None = None  # None = preserve stored value; sticky field (#184)


class MaterialPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/materials/{id}).

    All fields optional. None means 'don't change'.
    """

    title: str | None = None
    description: str | None = None
    is_active: bool | None = None


class MaterialResponse(MaterialBase):
    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: datetime
    updated_at: datetime
    is_active: bool
