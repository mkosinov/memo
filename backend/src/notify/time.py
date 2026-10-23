"""Business wall clock for the notify subsystem (#482, spec §3.2).

``activity.start`` is stored as naive local business time, so the
"event is in the future" predicate and the ``fmt_dt`` render filter both
need a now() in the SAME interpretation: the wall clock of the explicit
``BUSINESS_TIMEZONE`` — never the server TZ. The repo's test contour
pins TZ=UTC and containers default to UTC; a bare naive ``datetime.now()``
would silently shift the past/future boundary by the zone difference
(panel finding, spec §8 family risk fixed in §3.2).
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from src.core.config import settings


def business_now() -> datetime:
    """Naive wall-clock time of the business zone (``BUSINESS_TIMEZONE``).

    Read from settings at call time — no caching beyond the settings
    object itself. Returns naive datetime to match how ``activity.start``
    is stored; compare directly (``activity.start > business_now()``).
    NOT for UTC instants (TTL, created/updated stamps, journal, audit) —
    for those use ``src/util/utc.py::utc_now()``.
    """
    return datetime.now(ZoneInfo(settings.BUSINESS_TIMEZONE)).replace(tzinfo=None)
