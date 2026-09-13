"""Pydantic schemas for the read-only masters view (GH #266 D8).

``/api/v1/masters`` became a VIEW over ``staff`` ⨝ ``masters`` (acting
masters only): the response keeps the wire fields schedule consumers read
— ``id`` (= staff_id), names, ``specialty``, ``color``, ``avatar_url``,
``sort_order`` — and drops the write-side fields (``position`` — the
positions M2M lives on the staff card now; ``archived`` — the list only
ever returns acting masters). No Create/Update/Patch/Reorder schemas:
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
    created_at: datetime
    updated_at: datetime
