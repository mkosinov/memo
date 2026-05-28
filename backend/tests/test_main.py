"""Tests for application entrypoint and configuration."""

from fastapi.testclient import TestClient


class TestRootEndpoint:
    """Root path should return 404 (no route registered)."""

    def test_root_returns_404(self) -> None:
        from app.main import create_app

        app = create_app()
        client = TestClient(app)
        response = client.get("/")
        assert response.status_code == 404


class TestHealthEndpoint:
    """Health check must remain functional after lifespan wiring."""

    def test_health_returns_ok(self) -> None:
        from app.main import create_app

        app = create_app()
        client = TestClient(app)
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


class TestLifespan:
    """Lifespan must initialize and tear down the DB manager."""

    def test_db_manager_initialized_during_lifespan(self) -> None:
        import app.db.database as db_mod
        from app.main import create_app

        app = create_app()
        with TestClient(app) as client:
            # Inside lifespan context — manager should be set
            assert db_mod._manager is not None
            assert db_mod._manager.engine is not None
            # App should still respond
            assert client.get("/health").status_code == 200

    def test_db_manager_closed_after_lifespan(self) -> None:
        import app.db.database as db_mod
        from app.main import create_app

        app = create_app()
        with TestClient(app):
            manager_ref = db_mod._manager
            assert manager_ref is not None

        # After exiting lifespan, engine should be disposed
        assert manager_ref.engine is None  # type: ignore[union-attr]


class TestSettings:
    """Settings class should expose DATABASE_URL with a sensible default."""

    def test_settings_has_database_url_default(self) -> None:
        import os

        # Remove env var to test the default value
        original = os.environ.pop("DATABASE_URL", None)
        try:
            from app.core.config import Settings

            settings = Settings()
            assert settings.DATABASE_URL == "sqlite+aiosqlite:///./memo.db"
        finally:
            if original is not None:
                os.environ["DATABASE_URL"] = original

    def test_settings_reads_database_url_from_env(self) -> None:
        import os

        os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./custom.db"
        try:
            from app.core.config import Settings

            settings = Settings()
            assert settings.DATABASE_URL == "sqlite+aiosqlite:///./custom.db"
        finally:
            os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
