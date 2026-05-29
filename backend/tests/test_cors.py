"""Tests for CORS middleware configuration."""

from fastapi.testclient import TestClient


class TestCorsHeaders:
    """CORS middleware must add appropriate headers to responses."""

    def test_options_request_returns_cors_headers(self) -> None:
        """OPTIONS preflight returns Access-Control-Allow-Origin and Allow-Methods."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.options(
                "/api/health",
                headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": "GET",
                },
            )

        assert response.status_code == 200
        assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:3000"
        assert "Access-Control-Allow-Methods" in response.headers

    def test_get_request_returns_cors_allow_origin(self) -> None:
        """GET responses include Access-Control-Allow-Origin header."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.get(
                "/api/health",
                headers={"Origin": "http://localhost:3000"},
            )

        assert response.status_code == 200
        assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:3000"

    def test_cors_allows_credentials(self) -> None:
        """CORS must allow credentials for cookie-based auth."""
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            response = client.options(
                "/api/health",
                headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": "GET",
                },
            )

        assert response.headers["Access-Control-Allow-Credentials"] == "true"
