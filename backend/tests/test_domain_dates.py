"""Unit tests for the shared day_range util (#191)."""

from datetime import date, datetime

from src.domain.dates import day_range


def test_day_range_both_bounds():
    from_dt, to_dt = day_range(date(2026, 8, 3), date(2026, 8, 9))
    assert from_dt == datetime(2026, 8, 3, 0, 0, 0)
    assert to_dt == datetime(2026, 8, 9, 23, 59, 59, 999999)


def test_day_range_from_only():
    from_dt, to_dt = day_range(date(2026, 8, 3), None)
    assert from_dt == datetime(2026, 8, 3, 0, 0, 0)
    assert to_dt is None


def test_day_range_to_only():
    from_dt, to_dt = day_range(None, date(2026, 8, 9))
    assert from_dt is None
    assert to_dt == datetime(2026, 8, 9, 23, 59, 59, 999999)


def test_day_range_none():
    assert day_range(None, None) == (None, None)


def test_day_range_year_9999_no_overflow():
    _, to_dt = day_range(None, date(9999, 12, 31))
    assert to_dt == datetime(9999, 12, 31, 23, 59, 59, 999999)
