"""Pydantic schemas for the positions dictionary (GH #266 D4).

Positions are a salary-side dictionary: built-ins carry fixed string ids
(``master``/``admin``, ``is_system=True`` — title editable, deletion
forbidden), user-defined ones get uuid ids and a free lifecycle. Not
archive-aware — no ``archived`` field.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from src.schemas.pagination import PaginationParams


class PositionListParams(PaginationParams):
    """Query parameters for GET /api/v1/positions (GH #371 §4.1).

    Positions have no filters of their own (spec §4.1 row «—») — the
    subclass carries ONLY the inherited brick fields (``page``/
    ``per_page`` and the ``id`` set filter, #232 — ``?id=`` starts
    working on positions). The class still exists so the route reads
    ONE model like every list (uniform entry, domain rule 8, #371);
    the fixed ``title ASC, id ASC`` fallback order stays at the route
    (no SortParams brick — #205 never reached the dictionary). Injected
    as ``Annotated[PositionListParams, Query()]``.
    """


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
