"""Pydantic schemas for materials."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, computed_field


class MaterialBase(BaseModel):
    title: str
    description: str


class MaterialCreate(MaterialBase):
    pass


class MaterialUpdate(MaterialBase):
    """Request schema for updating a material (full replacement via PUT)."""

    is_active: bool  # required on PUT — canonical full-replace (#178); PATCH sticky via MaterialPatch


class MaterialPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/materials/{id}).

    All fields optional. None means 'don't change'.
    """

    title: str | None = None
    description: str | None = None
    is_active: bool | None = None


class MaterialResponse(MaterialBase):
    """Response schema with all material fields.

    ``is_active`` stays as the DB/ORM column but is ``exclude=True`` so it never
    serializes to JSON. The API exposes ``archived`` (inverted: ``archived = not
    is_active``, ``archived = true`` = in archive) via a computed field (#207 §3.1).
    """

    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: datetime
    updated_at: datetime
    is_active: bool = Field(..., exclude=True)

    @computed_field
    @property
    def archived(self) -> bool:
        return not self.is_active
