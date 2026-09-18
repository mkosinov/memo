"""Pydantic schemas for the tags domain."""

from typing import Literal

from pydantic import BaseModel, ConfigDict

# Sort whitelist for GET /api/v1/tags (#205 Task 3, spec §4.5; #172: ``tag``
# → ``title`` — thing-title canon).
TagSortBy = Literal["title"]


class TagCreate(BaseModel):
    title: str


class TagPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/tags/{id}).

    All fields optional. None means 'don't change'.
    """

    title: str | None = None


class TagResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str
