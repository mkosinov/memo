"""Tests for optional visitor_id in Visit model.

When creating records, visits can now be created without linking to a visitor.
This allows booking seats without knowing visitor names upfront.
"""

import pytest

pytestmark = pytest.mark.unit


class TestOptionalVisitorId:
    """Visits with no visitor_id should be creatable and return null visitor_id."""

    def test_create_record_with_no_visitor_id(self, api_client, create_activity, create_client) -> None:
        """POST /api/records with visits having no visitor_id nor name."""
        activity = create_activity()
        client = create_client()

        payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "comment": "Anonymous booking",
            "visits": [
                {"price": 1500, "status": "waiting"},
                {"price": 1500, "status": "waiting"},
                {"price": 1500, "status": "waiting"},
            ],
        }

        response = api_client.post("/api/v1/records", json=payload)

        assert response.status_code == 201
        body = response.json()
        assert body["seats"] == 3
        assert len(body["visits"]) == 3
        for visit in body["visits"]:
            assert visit["visitor_id"] is None
            assert visit["price"] == 1500

    def test_create_record_with_mixed_visits(self, api_client, create_activity, create_client) -> None:
        """POST /api/records with some visits linked, some anonymous."""
        activity = create_activity()
        client = create_client()

        # Create one visitor
        v1 = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Alice", "age": 28,
        }).json()

        payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "comment": "Mixed booking",
            "visits": [
                {"visitor_id": v1["id"], "price": 1500, "status": "waiting"},
                {"price": 2000, "status": "waiting"},
                {"price": 2000, "status": "waiting"},
            ],
        }

        response = api_client.post("/api/v1/records", json=payload)

        assert response.status_code == 201
        body = response.json()
        assert body["seats"] == 3
        assert len(body["visits"]) == 3
        # First visit has visitor_id
        assert body["visits"][0]["visitor_id"] == v1["id"]
        # Last two are anonymous
        assert body["visits"][1]["visitor_id"] is None
        assert body["visits"][2]["visitor_id"] is None

    def test_seats_equals_len_visits(self, api_client, create_activity, create_client) -> None:
        """Seats is always len(visits) regardless of visitor_id presence."""
        activity = create_activity()
        client = create_client()

        payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "visits": [
                {"price": 1000, "status": "waiting"},
                {"price": 1000, "status": "waiting"},
            ],
        }

        response = api_client.post("/api/v1/records", json=payload)
        assert response.status_code == 201
        assert response.json()["seats"] == 2

    def test_update_record_with_no_visitor_id(self, api_client, create_activity, create_client) -> None:
        """PUT /api/records replaces visits with anonymous ones."""
        activity = create_activity()
        client = create_client()

        # Create with a named visitor first
        v1 = api_client.post("/api/v1/visitors", json={
            "client_id": client["id"], "name": "Alice", "age": 28,
        }).json()

        create_payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "visits": [
                {"visitor_id": v1["id"], "price": 1500, "status": "waiting"},
            ],
        }
        create_resp = api_client.post("/api/v1/records", json=create_payload)
        record_id = create_resp.json()["id"]

        # Update with anonymous visits
        update_payload = {
            "activity_id": activity["id"],
            "client_id": client["id"],
            "status": "confirmed",
            "visits": [
                {"price": 2000, "status": "waiting"},
                {"price": 2000, "status": "waiting"},
            ],
        }

        response = api_client.put(f"/api/v1/records/{record_id}", json=update_payload)
        assert response.status_code == 200
        body = response.json()
        assert body["seats"] == 2
        assert len(body["visits"]) == 2
        for visit in body["visits"]:
            assert visit["visitor_id"] is None
