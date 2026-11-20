"""Pydantic schemas for the read-only masters view (GH #266 D8).

``/api/v1/masters`` became a VIEW over ``staff`` ⨝ ``masters``: the
response keeps the wire fields schedule consumers read — ``id`` (=
staff_id), names, ``specialty``, ``color``, ``avatar_url``,
``sort_order`` — and drops the write-side fields (``position`` — the
positions M2M lives on the staff card now). ``archived`` (GH #267)
mirrors ``masters.is_active``; the paginated list stays acting-only
(always false there), while bare ``/all`` with ``status=all|archived``
can return archived rows. No Create/Update/Patch/Reorder schemas:
there are no mutations on this router.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class MasterViewResponse(BaseModel):
    """Response schema of the read-only masters view (D8 wire shape)."""

    model_config = ConfigDict(from_attributes=True)

    id: str  # = staff_id (master extension PK)
    first_name: str
    last_name: str
    specialty: str
    color: str
    avatar_url: str | None = None
    sort_order: int
    archived: bool  # = not masters.is_active (GH #267)
    created_at: datetime
    updated_at: datetime


class MasterPublicResponse(BaseModel):
    """Public masters dictionary item — deliberately NOT
    MasterViewResponse (ADR-015, #606 spec §3.1).

    Audience schema for the anonymous showcase dictionary
    ``GET /api/v1/public/masters``: exactly the 5 showcase fields
    («имя, специальность, фото») — ``avatar_url`` is the only nullable
    one (mirrors the staff contract). Everything else (``color``,
    ``sort_order``, ``archived``, timestamps) never leaves through this
    schema; archived masters are excluded server-side on the route.
    #599 note: ``specialty`` stays a plain string — that workstream
    changes the VALUE source, not the type (spec §3.5).
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    first_name: str
    last_name: str
    specialty: str
    avatar_url: str | None = None
