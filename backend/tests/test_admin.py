"""Tests for SQLAdmin setup and registration."""

from fastapi.testclient import TestClient


class TestAdminEndpoint:
    """SQLAdmin should be mounted at /admin."""

    def test_admin_root_returns_200(self) -> None:
        """GET /admin should return 200 (admin dashboard)."""
        from src.main import create_app

        app = create_app()
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/admin")
        # SQLAdmin redirects /admin -> /admin/master (first model view)
        assert response.status_code in (200, 302, 307)


class TestAdminViewRegistration:
    """All ORM models must have admin views registered."""

    def test_all_model_views_registered(self) -> None:
        """Admin should have views for all models."""
        from src.admin.setup import ALL_ADMIN_VIEWS

        expected_models = [
            "Master", "Material", "User", "Location", "Service", "Tariff",
            "Tag", "Activity", "Client", "Visitor", "Photo",
            "Record", "Visit", "Payment",
        ]
        assert len(ALL_ADMIN_VIEWS) == 14

        registered_names = [view.name for view in ALL_ADMIN_VIEWS]
        for model_name in expected_models:
            assert model_name in registered_names, f"Missing admin view for {model_name}"
