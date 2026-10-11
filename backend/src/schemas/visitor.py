"""Pydantic schemas for the visitors domain."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from src.schemas.pagination import PaginationParams


class VisitorListParams(PaginationParams):
    """Query parameters for GET /api/v1/visitors (GH #371 §4.1).

    Composed of the ``PaginationParams`` brick (``page``/``per_page`` and
    the ``id`` set filter, #232 — ``?id=`` starts working on visitors).
    The router's former scalar query sibling rides along 1:1: ``q``
    (2..100). The master scope is NOT a query field — it stays a
    ``Depends(get_scope)`` sibling (domain rule 8, #371: Depends beside
    a query model is legal). Injected as ``Annotated[VisitorListParams,
    Query()]`` — scalar query siblings are banned (fastapi PR #12481).
    """

    q: str | None = Field(default=None, min_length=2, max_length=100)


class VisitorBase(BaseModel):
    """Shared fields for visitor creation and updates."""

    name: str
    age: int | None = None


class VisitorCreate(VisitorBase):
    """Request schema for creating a new visitor."""

    client_id: str


class VisitorUpdate(VisitorBase):
    """Request schema for updating a visitor (full replacement via PUT)."""

    pass


class VisitorPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/visitors/{id}).
    All fields optional. None means 'don't change'.

    Note: client_id is NOT patchable — visitors cannot be reassigned
    to a different client.
    """

    name: str | None = None
    age: int | None = None


class VisitorResponse(VisitorBase):
    """Response schema with all visitor fields."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    client_id: str
    created_at: datetime
    updated_at: datetime
