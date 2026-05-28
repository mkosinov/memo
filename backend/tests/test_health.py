"""Tests for the /api/health endpoint (system domain)."""

from fastapi.testclient import TestClient


class TestHealthEndpoint:
    """GET /api/health must return status and DB connectivity info."""

    def test_health_returns_ok_with_db_connected(self) -> None:
        """Endpoint returns 200 with status=ok and db=connected."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.get("/api/health")

        assert response.status_code == 200
        body = response.json()
        assert body == {"status": "ok", "db": "connected"}

    def test_health_response_schema_fields(self) -> None:
        """Response body contains exactly 'status' and 'db' keys."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.get("/api/health")

        body = response.json()
        assert set(body.keys()) == {"status", "db"}
        assert body["status"] == "ok"
        assert body["db"] == "connected"

    def test_old_health_endpoint_removed(self) -> None:
        """The legacy /health route must no longer exist."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.get("/health")

        assert response.status_code == 404
