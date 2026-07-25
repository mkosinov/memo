"""Pydantic schemas for the tags domain."""

from pydantic import BaseModel, ConfigDict


class TagCreate(BaseModel):
    tag: str


class TagPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/tags/{id}).

    All fields optional. None means 'don't change'.
    """

    tag: str | None = None


class TagResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    tag: str
