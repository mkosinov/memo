"""Pydantic schemas for materials."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class MaterialBase(BaseModel):
    title: str
    description: str


class MaterialCreate(MaterialBase):
    pass


class MaterialUpdate(MaterialBase):
    pass


class MaterialPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/materials/{id}).

    All fields optional. None means 'don't change'.
    """

    title: str | None = None
    description: str | None = None


class MaterialResponse(MaterialBase):
    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: datetime
    updated_at: datetime
    is_active: bool
