"""Tests for CORS middleware configuration."""

import pytest

pytestmark = pytest.mark.misc


class TestCorsHeaders:
    """CORS middleware must add appropriate headers to responses."""

    def test_options_request_returns_cors_headers(self, api_client) -> None:
        """OPTIONS preflight returns Access-Control-Allow-Origin and Allow-Methods."""
        response = api_client.options(
            "/api/v1/health",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
            },
        )

        assert response.status_code == 200
        assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:3000"
        assert "Access-Control-Allow-Methods" in response.headers

    def test_get_request_returns_cors_allow_origin(self, api_client) -> None:
        """GET responses include Access-Control-Allow-Origin header."""
        response = api_client.get(
            "/api/v1/health",
            headers={"Origin": "http://localhost:3000"},
        )

        assert response.status_code == 200
        assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:3000"

    def test_cors_allows_credentials(self, api_client) -> None:
        """CORS must allow credentials for cookie-based auth."""
        response = api_client.options(
            "/api/v1/health",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
            },
        )

        assert response.headers["Access-Control-Allow-Credentials"] == "true"

    def test_cors_env_override(self, monkeypatch) -> None:
        """CORS_ORIGINS env var overrides defaults, splitting comma-separated values."""
        from fastapi.testclient import TestClient

        monkeypatch.setenv("CORS_ORIGINS", "http://example.com:3000,http://test.com:3000")

        # Re-create Settings from env to test parsing, patch the singleton
        from src.core.config import settings, Settings

        new_settings = Settings()
        monkeypatch.setattr(settings, "CORS_ORIGINS", new_settings.CORS_ORIGINS)

        from src.main import create_app

        app = create_app()
        with TestClient(app) as client:
            # Allowed origin — should pass
            response = client.options(
                "/api/v1/health",
                headers={
                    "Origin": "http://example.com:3000",
                    "Access-Control-Request-Method": "GET",
                },
            )
            assert response.status_code == 200
            assert response.headers["Access-Control-Allow-Origin"] == "http://example.com:3000"

            # Disallowed origin — should fail with 400
            response = client.options(
                "/api/v1/health",
                headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": "GET",
                },
            )
            assert response.status_code == 400
            assert "Access-Control-Allow-Origin" not in response.headers
