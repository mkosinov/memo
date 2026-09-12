"""Tests for SQLAdmin setup and registration."""

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.misc


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
        """Admin should have views for all models.

        GH #266: MasterAdmin (transitional) is replaced by StaffAdmin (the
        staff card + master-extension section) and PositionAdmin joins the
        dictionary views; the bare masters extension gets no standalone view
        (edited inline from the card).
        """
        from src.admin.setup import ALL_ADMIN_VIEWS

        expected_models = [
            "Staff", "Position", "Material", "User", "Location", "Service",
            "Tariff", "Tag", "Activity", "Client", "Visitor", "Photo",
            "Record", "Visit", "Payment",
        ]
        assert len(ALL_ADMIN_VIEWS) == 15

        registered_names = [view.name for view in ALL_ADMIN_VIEWS]
        for model_name in expected_models:
            assert model_name in registered_names, f"Missing admin view for {model_name}"

    def test_staff_admin_exposes_card_and_master_fields(self) -> None:
        """StaffAdmin lists the card columns (GH #266 Task 2): names,
        avatar, sort order + the archive flag; the master extension is
        edited inline (specialty/color/is_active)."""
        from src.admin.setup import StaffAdmin

        listed = {c.name for c in StaffAdmin.column_list}
        assert {"first_name", "last_name", "avatar_url", "is_active"} <= listed
        assert StaffAdmin.inline_models is not None and len(StaffAdmin.inline_models) > 0

    def test_staff_and_position_views_render(self) -> None:
        """Smoke: the new views mount and render (a redirect — login or
        trailing-slash normalize — not a 500 from a broken ModelView
        definition, e.g. a bad inline_models)."""
        from src.main import create_app

        app = create_app()
        client = TestClient(app, raise_server_exceptions=False)
        for path in ("/admin/staff/list/", "/admin/position/list/"):
            resp = client.get(path, follow_redirects=False)
            assert resp.status_code in (200, 302, 307), (
                f"{path} -> {resp.status_code}"
            )
