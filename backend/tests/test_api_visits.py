"""Tests for /api/v1/visits endpoints — Phase 0 (tariff_id round-trip)."""

import pytest

pytestmark = pytest.mark.api


class TestVisitTariffId:
    """Phase 0: tariff_id round-trip through Visit API."""

    def test_get_visit_includes_tariff_id(self, api_client, sample_visit_with_tariff) -> None:
        """Scenario 1: GET /api/v1/visits/{id} response includes tariff_id."""
        visit_id = sample_visit_with_tariff["visit_id"]
        response = api_client.get(f"/api/v1/visits/{visit_id}")
        assert response.status_code == 200
        data = response.json()
        assert "tariff_id" in data, f"'tariff_id' not in response: {list(data.keys())}"
        assert data["tariff_id"] == sample_visit_with_tariff["tariff_id"]

    def test_get_visit_tariff_id_null(self, api_client, sample_visit_no_tariff) -> None:
        """Scenario 4: Visit with no tariff returns tariff_id: null."""
        visit_id = sample_visit_no_tariff["visit_id"]
        response = api_client.get(f"/api/v1/visits/{visit_id}")
        assert response.status_code == 200
        data = response.json()
        assert "tariff_id" in data, f"'tariff_id' not in response: {list(data.keys())}"
        assert data["tariff_id"] is None
