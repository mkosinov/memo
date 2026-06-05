"""Tests for application entrypoint and configuration."""


class TestRootEndpoint:
    """Root path should return 404 (no route registered)."""

    def test_root_returns_404(self, api_client) -> None:
        response = api_client.get("/")
        assert response.status_code == 404


class TestSettings:
    """Settings class should expose DATABASE_URL with a sensible default."""

    def test_settings_has_database_url_default(self) -> None:
        import os

        # Remove env var to test the default value
        original = os.environ.pop("DATABASE_URL", None)
        try:
            from src.core.config import Settings

            settings = Settings()
            assert settings.DATABASE_URL == "sqlite+aiosqlite:///./memo.db"
        finally:
            if original is not None:
                os.environ["DATABASE_URL"] = original

    def test_settings_reads_database_url_from_env(self) -> None:
        import os

        os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./custom.db"
        try:
            from src.core.config import Settings

            settings = Settings()
            assert settings.DATABASE_URL == "sqlite+aiosqlite:///./custom.db"
        finally:
            os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
