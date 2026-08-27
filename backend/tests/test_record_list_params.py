"""Validation tests for RecordListParams (#191)."""

from datetime import date

import pytest
from pydantic import ValidationError

from src.schemas.record import RecordListParams


def test_defaults():
    p = RecordListParams()
    assert (p.page, p.per_page, p.sort_by, p.sort_order) == (1, 20, "date", "asc")
    assert p.status is None and p.client_id is None and p.activity_id is None


def test_invalid_status_rejected():
    with pytest.raises(ValidationError):
        RecordListParams(status="bogus")


def test_invalid_sort_by_rejected():
    with pytest.raises(ValidationError):
        RecordListParams(sort_by="nonexistent")


def test_invalid_sort_order_rejected():
    with pytest.raises(ValidationError):
        RecordListParams(sort_order="sideways")


@pytest.mark.parametrize("per_page", [0, 101])
def test_per_page_bounds(per_page):
    with pytest.raises(ValidationError):
        RecordListParams(per_page=per_page)


def test_page_bound():
    with pytest.raises(ValidationError):
        RecordListParams(page=0)


def test_garbage_date_rejected():
    with pytest.raises(ValidationError):
        RecordListParams(date_from="not-a-date")


def test_date_range_inverted_rejected():
    with pytest.raises(ValidationError, match="date_from"):
        RecordListParams(date_from=date(2026, 8, 9), date_to=date(2026, 8, 3))


def test_date_range_valid():
    p = RecordListParams(date_from=date(2026, 8, 3), date_to=date(2026, 8, 9))
    assert p.date_from == date(2026, 8, 3)


def test_q_default_none():
    p = RecordListParams()
    assert p.q is None


def test_q_valid_length():
    p = RecordListParams(q="ab")
    assert p.q == "ab"


@pytest.mark.parametrize("q", ["a", "", "x" * 101])
def test_q_bounds_rejected(q):
    with pytest.raises(ValidationError):
        RecordListParams(q=q)