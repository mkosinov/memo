"""Pydantic schemas for the visits domain."""

from pydantic import BaseModel, ConfigDict, Field

from src.domain.visit_status import VisitStatus
from src.schemas.pagination import PaginationParams


class VisitBase(BaseModel):
    """Shared fields for visit create and update."""

    record_id: str
    visitor_id: str | None = None
    tariff_id: str | None = None
    price: int = Field(ge=0)
    custom_price: int | None = None
    status: VisitStatus = VisitStatus.WAITING


class VisitCreate(VisitBase):
    """Request schema for creating a new visit (POST /api/v1/visits)."""

    pass


class VisitUpdate(VisitBase):
    """Request schema for full-replace update (PUT /api/v1/visits/{id})."""

    pass


class VisitPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/visits/{id}).

    All fields optional. Null-policy: ``null`` on NOT NULL fields
    (``price``, ``status``) is ignored ("don't change"); ``null`` on
    nullable fields (``visitor_id``, ``tariff_id``, ``custom_price``) is
    applied and clears the field.
    """

    visitor_id: str | None = None
    tariff_id: str | None = None
    price: int | None = Field(default=None, ge=0)
    custom_price: int | None = None
    status: VisitStatus | None = None


class VisitStatusUpdate(BaseModel):
    """Request schema for updating a visit's status."""

    status: VisitStatus


class VisitListParams(PaginationParams):
    """Query parameters for GET /api/v1/visits (GH #371 §4.1).

    Composed of the ``PaginationParams`` brick (``page``/``per_page`` and
    the ``id`` set filter, #232 — ``?id=`` starts working on visits via
    the §4.3 gap-2 service predicate). The router's former scalar query
    sibling rides along 1:1: ``record_id`` (``str`` — the pre-conversion
    annotation, no UUID tightening: spec §4.1 keeps the annotations,
    scenario 8 wire parity; same architect's decision as payments'
    identically-shaped ``record_id``, Task 3). The master scope is NOT a
    query field — it stays a Depends sibling (``get_scope``; domain rule
    8, #371). Injected as ``Annotated[VisitListParams, Query()]`` —
    scalar query siblings are banned (fastapi PR #12481).
    """

    record_id: str | None = None


class VisitResponse(BaseModel):
    """Response schema for a single visit."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    record_id: str
    visitor_id: str | None = None
    tariff_id: str | None = None
    price: int
    custom_price: int | None = None
    status: str
    created_at: str
    updated_at: str
