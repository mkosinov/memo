"""Single source of truth for record/visit status (mirrors packages/domain/src/visit_status.ts)."""
from enum import Enum
from typing import Sequence

from pydantic import BaseModel


class VisitStatus(str, Enum):
    WAITING = "waiting"
    VISITED = "visited"
    MISSED = "missed"
    CANCELLED = "cancelled"


# Record statuses that occupy a seat in an activity's capacity.
# "active record" = status IN these values (records are hard-deleted).
# cancelled/missed records do NOT occupy a seat.
ACTIVE_RECORD_STATUSES: tuple[str, ...] = (
    VisitStatus.WAITING.value,
    VisitStatus.VISITED.value,
)


# Minimal input model for the derivation function
class VisitItem(BaseModel):
    id: str
    status: VisitStatus


def compute_record_status(visits: Sequence[VisitItem]) -> VisitStatus:
    """Derives record status from its visits.

    Priority: any visited > all missed > all cancelled > waiting.
    Edge case: 0 visits -> waiting.
    """
    if not visits:
        return VisitStatus.WAITING
    if any(v.status == VisitStatus.VISITED for v in visits):
        return VisitStatus.VISITED
    if all(v.status == VisitStatus.MISSED for v in visits):
        return VisitStatus.MISSED
    if all(v.status == VisitStatus.CANCELLED for v in visits):
        return VisitStatus.CANCELLED
    return VisitStatus.WAITING
