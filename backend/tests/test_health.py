"""Tests for the /api/health endpoint (system domain)."""


class TestHealthEndpoint:
    """GET /api/health must return status and DB connectivity info."""

    def test_health_returns_ok_with_db_connected(self, api_client) -> None:
        """Endpoint returns 200 with status=ok and db=connected."""
        response = api_client.get("/api/v1/health")

        assert response.status_code == 200
        body = response.json()
        assert body == {"status": "ok", "db": "connected"}

    def test_health_response_schema_fields(self, api_client) -> None:
        """Response body contains exactly 'status' and 'db' keys."""
        response = api_client.get("/api/v1/health")

        body = response.json()
        assert set(body.keys()) == {"status", "db"}
        assert body["status"] == "ok"
        assert body["db"] == "connected"

    def test_old_health_endpoint_removed(self, api_client) -> None:
        """The legacy /health route must no longer exist."""
        response = api_client.get("/health")

        assert response.status_code == 404
