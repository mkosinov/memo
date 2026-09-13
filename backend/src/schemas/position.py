"""Pydantic schemas for the positions dictionary (GH #266 D4).

Positions are a salary-side dictionary: built-ins carry fixed string ids
(``master``/``admin``, ``is_system=True`` — title editable, deletion
forbidden), user-defined ones get uuid ids and a free lifecycle. Not
archive-aware — no ``archived`` field.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PositionBase(BaseModel):
    """Shared fields for position creation and updates."""

    title: str = Field(min_length=1, max_length=100)


class PositionCreate(PositionBase):
    """Request schema for creating a position (always user-defined)."""

    pass


class PositionUpdate(PositionBase):
    """Request schema for full update via PUT — title only (D4).

    ``is_system`` is NOT accepted: the built-in flag is owned by the
    dictionary, never by the client.
    """

    model_config = ConfigDict(extra="forbid")


class PositionPatch(BaseModel):
    """Request schema for partial update (PATCH) — all fields optional."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=100)


class PositionResponse(PositionBase):
    """Response schema for a dictionary row."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    is_system: bool
    created_at: datetime
    updated_at: datetime
