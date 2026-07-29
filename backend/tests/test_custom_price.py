"""Tests for Record.custom_price field.

custom_price is an optional manual price override:
- If set, it's used as the total price for the record.
- If not set (None), total is the sum of visit prices.
"""

import pytest

from tests.conftest import query_db

pytestmark = pytest.mark.unit


class TestCustomPriceCreate:
    """Test custom_price on record creation."""

    def test_create_record_with_custom_price(self, api_client, create_record) -> None:
        """POST /api/v1/records with custom_price stores it."""
        activity_resp = api_client.get("/api/v1/activities")
        # Use create_record factory which already creates a full chain
        record = create_record()

        # Update record with custom_price
        resp = api_client.put(f"/api/v1/records/{record['id']}", json={
            "activity_id": record["activity_id"],
            "client_id": record["client_id"],
            "comment": "VIP",
            "custom_price": 5000,
            "visits": record["visits"],
        })
        assert resp.status_code == 200, f"Update failed: {resp.text}"
        body = resp.json()
        assert body["custom_price"] == 5000

    def test_create_record_without_custom_price_returns_none(self, api_client, create_record) -> None:
        """POST /api/v1/records without custom_price → custom_price is null."""
        record = create_record()
        resp = api_client.get(f"/api/v1/records/{record['id']}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["custom_price"] is None

    def test_create_record_with_custom_price_zero(self, api_client, create_record) -> None:
        """custom_price=0 is a valid value (e.g., free event)."""
        record = create_record()
        resp = api_client.put(f"/api/v1/records/{record['id']}", json={
            "activity_id": record["activity_id"],
            "client_id": record["client_id"],
            "comment": "Free event",
            "custom_price": 0,
            "visits": record["visits"],
        })
        assert resp.status_code == 200, f"Update failed: {resp.text}"
        body = resp.json()
        assert body["custom_price"] == 0


class TestCustomPriceUpdate:
    """Test updating custom_price on existing records."""

    def test_update_record_set_custom_price(self, api_client, create_record) -> None:
        """PUT can set custom_price on an existing record."""
        record = create_record()
        assert record["custom_price"] is None  # starts null

        resp = api_client.put(f"/api/v1/records/{record['id']}", json={
            "activity_id": record["activity_id"],
            "client_id": record["client_id"],
            "custom_price": 7500,
            "visits": record["visits"],
        })
        assert resp.status_code == 200
        assert resp.json()["custom_price"] == 7500

    def test_update_record_clear_custom_price(self, api_client, create_record) -> None:
        """PUT with custom_price=None clears the override."""
        record = create_record()

        # Set it first
        api_client.put(f"/api/v1/records/{record['id']}", json={
            "activity_id": record["activity_id"],
            "client_id": record["client_id"],
            "custom_price": 5000,
            "visits": record["visits"],
        })

        # Now clear it
        resp = api_client.put(f"/api/v1/records/{record['id']}", json={
            "activity_id": record["activity_id"],
            "client_id": record["client_id"],
            "custom_price": None,
            "visits": record["visits"],
        })
        assert resp.status_code == 200
        assert resp.json()["custom_price"] is None


class TestCustomPriceDatabase:
    """Verify custom_price is stored correctly at the DB level."""

    def test_custom_price_persisted_in_db(self, api_client, create_record) -> None:
        """custom_price is stored as an integer column in the records table."""
        record = create_record()
        api_client.put(f"/api/v1/records/{record['id']}", json={
            "activity_id": record["activity_id"],
            "client_id": record["client_id"],
            "custom_price": 3000,
            "visits": record["visits"],
        })

        rows = query_db(f"SELECT custom_price FROM records WHERE id='{record['id']}'")
        assert len(rows) == 1
        assert rows[0]["custom_price"] == 3000

    def test_custom_price_none_stored_as_null(self, api_client, create_record) -> None:
        """custom_price=None is stored as NULL in the database."""
        record = create_record()
        rows = query_db(f"SELECT custom_price FROM records WHERE id='{record['id']}'")
        assert rows[0]["custom_price"] is None


class TestCustomPriceResponse:
    """Test that custom_price appears in list and get responses."""

    def test_list_records_includes_custom_price(self, api_client, create_record) -> None:
        """GET /api/v1/records returns custom_price in each record."""
        record = create_record()
        api_client.put(f"/api/v1/records/{record['id']}", json={
            "activity_id": record["activity_id"],
            "client_id": record["client_id"],
            "custom_price": 4200,
            "visits": record["visits"],
        })

        resp = api_client.get("/api/v1/records")
        assert resp.status_code == 200
        found = next(r for r in resp.json()["items"] if r["id"] == record["id"])
        assert found["custom_price"] == 4200

    def test_get_record_includes_custom_price(self, api_client, create_record) -> None:
        """GET /api/v1/records/{id} returns custom_price."""
        record = create_record()
        api_client.put(f"/api/v1/records/{record['id']}", json={
            "activity_id": record["activity_id"],
            "client_id": record["client_id"],
            "custom_price": 9900,
            "visits": record["visits"],
        })

        resp = api_client.get(f"/api/v1/records/{record['id']}")
        assert resp.status_code == 200
        assert resp.json()["custom_price"] == 9900
