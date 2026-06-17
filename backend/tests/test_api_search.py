"""Tests for the Search API endpoints.

Covers /api/v1/search/visitors, /api/v1/search/services, /api/v1/search/activities.
"""

import pytest

pytestmark = pytest.mark.api


# ─── Visitor Search ────────────────────────────────────────────────────────────


class TestSearchVisitors:
    """Tests for GET /api/v1/search/visitors?q=..."""

    def test_empty_query_returns_empty(self, api_client) -> None:
        """No visitors in DB → empty array."""
        resp = api_client.get("/api/v1/search/visitors", params={"q": "test"})
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_matching_visitors(self, api_client, create_client) -> None:
        """Substring match returns matching visitors."""
        client = create_client()
        api_client.post(
            "/api/v1/visitors",
            json={"client_id": client["id"], "name": "Алиса Петрова", "age": 25},
        )
        api_client.post(
            "/api/v1/visitors",
            json={"client_id": client["id"], "name": "Борис Иванов", "age": 30},
        )

        resp = api_client.get("/api/v1/search/visitors", params={"q": "Алис"})
        assert resp.status_code == 200
        results = resp.json()
        assert len(results) == 1
        assert results[0]["name"] == "Алиса Петрова"

    def test_case_insensitive(self, api_client, create_client) -> None:
        """ILIKE makes search case-insensitive."""
        client = create_client()
        api_client.post(
            "/api/v1/visitors",
            json={"client_id": client["id"], "name": "Alice Smith", "age": 20},
        )

        resp = api_client.get("/api/v1/search/visitors", params={"q": "alice"})
        assert resp.status_code == 200
        results = resp.json()
        assert len(results) == 1
        assert results[0]["name"] == "Alice Smith"

    def test_limit_of_10(self, api_client, create_client) -> None:
        """At most 10 results returned."""
        client = create_client()
        for i in range(15):
            api_client.post(
                "/api/v1/visitors",
                json={
                    "client_id": client["id"],
                    "name": f"Visitor {i} Test",
                    "age": 20 + i,
                },
            )

        resp = api_client.get("/api/v1/search/visitors", params={"q": "Visitor"})
        assert resp.status_code == 200
        assert len(resp.json()) == 10

    def test_min_length_validation(self, api_client) -> None:
        """Empty query string rejected with 422."""
        resp = api_client.get("/api/v1/search/visitors", params={"q": ""})
        assert resp.status_code == 422

    def test_excludes_inactive_visitors(self, api_client, create_client) -> None:
        """Soft-deleted visitors excluded from search."""
        client = create_client()
        v1 = api_client.post(
            "/api/v1/visitors",
            json={"client_id": client["id"], "name": "Active Person", "age": 25},
        ).json()
        api_client.post(
            "/api/v1/visitors",
            json={
                "client_id": client["id"],
                "name": "Deleted Person",
                "age": 30,
            },
        )

        # Soft-delete the second visitor
        # We need to find the "Deleted Person" id
        all_resp = api_client.get("/api/v1/search/visitors", params={"q": "Deleted"})
        assert len(all_resp.json()) == 1
        deleted_id = all_resp.json()[0]["id"]
        api_client.delete(f"/api/v1/visitors/{deleted_id}")

        resp = api_client.get("/api/v1/search/visitors", params={"q": "Person"})
        results = resp.json()
        names = [r["name"] for r in results]
        assert "Deleted Person" not in names
        assert "Active Person" in names

    def test_response_shape(self, api_client, create_client) -> None:
        """Response contains id, name, age fields."""
        client = create_client()
        api_client.post(
            "/api/v1/visitors",
            json={"client_id": client["id"], "name": "Shape Check", "age": 25},
        )

        resp = api_client.get("/api/v1/search/visitors", params={"q": "Shape"})
        assert resp.status_code == 200
        item = resp.json()[0]
        assert "id" in item
        assert "name" in item
        assert "age" in item


# ─── Service Search ────────────────────────────────────────────────────────────


class TestSearchServices:
    """Tests for GET /api/v1/search/services?q=..."""

    def test_empty_query_returns_empty(self, api_client) -> None:
        """No services in DB → empty array."""
        resp = api_client.get("/api/v1/search/services", params={"q": "test"})
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_matching_services(self, api_client, create_service) -> None:
        """Substring match returns matching services."""
        create_service(title="Картина маслом")
        create_service(title="Акварельный закат")

        resp = api_client.get("/api/v1/search/services", params={"q": "масло"})
        assert resp.status_code == 200
        results = resp.json()
        assert len(results) == 1
        assert results[0]["title"] == "Картина маслом"

    def test_case_insensitive(self, api_client, create_service) -> None:
        """ILIKE makes search case-insensitive."""
        create_service(title="Watercolor Workshop")

        resp = api_client.get("/api/v1/search/services", params={"q": "watercolor"})
        assert resp.status_code == 200
        assert len(resp.json()) == 1
        assert resp.json()[0]["title"] == "Watercolor Workshop"

    def test_limit_of_10(self, api_client, create_service) -> None:
        """At most 10 results returned."""
        for i in range(15):
            create_service(title=f"Service {i} Match")

        resp = api_client.get("/api/v1/search/services", params={"q": "Match"})
        assert resp.status_code == 200
        assert len(resp.json()) == 10

    def test_min_length_validation(self, api_client) -> None:
        """Empty query string rejected with 422."""
        resp = api_client.get("/api/v1/search/services", params={"q": ""})
        assert resp.status_code == 422

    def test_excludes_inactive_services(self, api_client, create_service) -> None:
        """Soft-deleted services excluded from search."""
        s1 = create_service(title="Active Workshop")
        s2 = create_service(title="Removed Workshop")

        # Soft-delete the second service
        api_client.delete(f"/api/v1/services/{s2['id']}")

        resp = api_client.get("/api/v1/search/services", params={"q": "Workshop"})
        titles = [r["title"] for r in resp.json()]
        assert "Removed Workshop" not in titles
        assert "Active Workshop" in titles

    def test_response_shape(self, api_client, create_service) -> None:
        """Response contains id, title fields."""
        create_service(title="Shape Check Service")

        resp = api_client.get("/api/v1/search/services", params={"q": "Shape"})
        assert resp.status_code == 200
        item = resp.json()[0]
        assert "id" in item
        assert "title" in item


# ─── Activity Search ───────────────────────────────────────────────────────────


class TestSearchActivities:
    """Tests for GET /api/v1/search/activities?q=..."""

    def test_empty_query_returns_empty(self, api_client) -> None:
        """No activities in DB → empty array."""
        resp = api_client.get("/api/v1/search/activities", params={"q": "test"})
        assert resp.status_code == 200
        assert resp.json() == []

    def test_search_by_service_title(self, api_client, create_activity) -> None:
        """Substring match on service title returns matching activities."""
        create_activity()  # creates master+service+location+activity

        # Get the service title from the created activity
        # The default service title is "Test Service N"
        resp = api_client.get("/api/v1/search/activities", params={"q": "Test Service"})
        assert resp.status_code == 200
        results = resp.json()
        assert len(results) >= 1
        # At least one result should have service_title containing "Test Service"
        assert any("Test Service" in r["service_title"] for r in results)

    def test_excludes_inactive_activities(self, api_client, create_activity) -> None:
        """Soft-deleted activities excluded from search."""
        activity = create_activity()

        # Soft-delete the activity
        api_client.delete(f"/api/v1/activities/{activity['id']}")

        resp = api_client.get("/api/v1/search/activities", params={"q": "Test Service"})
        ids = [r["id"] for r in resp.json()]
        assert activity["id"] not in ids

    def test_limit_of_10(self, api_client, create_activity) -> None:
        """At most 10 results returned."""
        # Each create_activity call creates a new service with title "Test Service N"
        # All match the search query "Test Service"
        for _ in range(12):
            create_activity()

        resp = api_client.get(
            "/api/v1/search/activities", params={"q": "Test Service"}
        )
        assert resp.status_code == 200
        assert len(resp.json()) <= 10

    def test_min_length_validation(self, api_client) -> None:
        """Empty query string rejected with 422."""
        resp = api_client.get("/api/v1/search/activities", params={"q": ""})
        assert resp.status_code == 422

    def test_response_shape(self, api_client, create_activity) -> None:
        """Response contains id, start, service_title fields."""
        create_activity()

        resp = api_client.get("/api/v1/search/activities", params={"q": "Test Service"})
        assert resp.status_code == 200
        results = resp.json()
        assert len(results) >= 1
        item = results[0]
        assert "id" in item
        assert "start" in item
        assert "service_title" in item
