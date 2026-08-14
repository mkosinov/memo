"""Shared date-range helpers — technical mechanism shared by list services (#191)."""

from datetime import date, datetime, time


def day_range(
    date_from: date | None, date_to: date | None
) -> tuple[datetime | None, datetime | None]:
    """Convert inclusive YYYY-MM-DD bounds to an inclusive [from_dt, to_dt] datetime range.

    Whole-day inclusive semantics: date_from covers from 00:00:00, date_to covers
    through 23:59:59.999999 (datetime.combine idiom — same as client.py created_*;
    overflow-free, no year-9999 edge case).
    """
    from_dt = datetime.combine(date_from, time.min) if date_from is not None else None
    to_dt = datetime.combine(date_to, time.max) if date_to is not None else None
    return from_dt, to_dt
