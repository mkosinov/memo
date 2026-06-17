"""Tests for search result Pydantic schemas — compact lookup responses."""

import pytest

from src.schemas.search import ActivitySearchResult, ServiceSearchResult, VisitorSearchResult

pytestmark = pytest.mark.unit


class TestVisitorSearchResult:
    """VisitorSearchResult should contain id, name, and optional age."""

    def test_visitor_search_result_all_fields(self):
        """VisitorSearchResult works with all fields provided."""
        vsr = VisitorSearchResult(id="v1", name="Alice", age=8)
        assert vsr.id == "v1"
        assert vsr.name == "Alice"
        assert vsr.age == 8

    def test_visitor_search_result_optional_age(self):
        """VisitorSearchResult accepts age=None."""
        vsr = VisitorSearchResult(id="v2", name="Bob", age=None)
        assert vsr.age is None

    def test_visitor_search_result_age_default_none(self):
        """VisitorSearchResult defaults age to None when omitted."""
        vsr = VisitorSearchResult(id="v3", name="Charlie")
        assert vsr.age is None


class TestServiceSearchResult:
    """ServiceSearchResult should contain id and title."""

    def test_service_search_result_all_fields(self):
        """ServiceSearchResult works with all fields provided."""
        ssr = ServiceSearchResult(id="s1", title="Pottery Workshop")
        assert ssr.id == "s1"
        assert ssr.title == "Pottery Workshop"


class TestActivitySearchResult:
    """ActivitySearchResult should contain id, start, and service_title."""

    def test_activity_search_result_all_fields(self):
        """ActivitySearchResult works with all fields provided."""
        asr = ActivitySearchResult(
            id="a1",
            start="2025-06-15T10:00:00",
            service_id="s1",
            service_title="Pottery Workshop",
        )
        assert asr.id == "a1"
        assert asr.start == "2025-06-15T10:00:00"
        assert asr.service_id == "s1"
        assert asr.service_title == "Pottery Workshop"
