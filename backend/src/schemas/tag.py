"""Pydantic schemas for the tags domain."""

from pydantic import BaseModel, ConfigDict


class TagCreate(BaseModel):
    tag: str


class TagResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    tag: str
