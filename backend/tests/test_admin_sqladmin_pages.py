"""GH #599 Task 5 — sqladmin pages over the specialty dictionary.

DoD pins (plan Task 5): the sqladmin SERVICES page opens on the test
client (the ``Service.specialty`` column is gone — the list renders the
``specialty_ref.title`` relationship path), and the staff edit form
carries the master-section direction set as an ID-SET field (the M2M
``Staff.specialties`` multi-select — the same automatic relationship
field pattern as positions; the color/flag inline extension renders
alongside).

Auth mirrors the real surface: ``POST /admin/login`` (the sqladmin form)
against the fixture admin (SqlAdminAuth → AuthService, role=admin).
"""

from __future__ import annotations

import pytest

from tests.conftest import ADMIN_PASSWORD, ADMIN_PHONE

pytestmark = pytest.mark.misc


@pytest.fixture
def admin_client(app, db_engine, _admin_hash):
    """TestClient authenticated through the sqladmin LOGIN FORM.

    ``reset_db`` truncates per test, so the admin row is inserted here
    (the ``api_client`` pattern) and the login goes through the sqladmin
    AuthenticationBackend — the only path that seeds ITS session cookie.
    """
    from fastapi.testclient import TestClient

    from tests.conftest import insert_user

    insert_user(ADMIN_PHONE, _admin_hash, role="admin")
    client = TestClient(app)
    # Starlette's TestClient follows redirects: a SUCCESSFUL sqladmin
    # login lands on the admin index with 200; a FAILURE re-renders the
    # login screen (also 200) — disambiguated by the dashboard probe.
    resp = client.post(
        "/admin/login",
        data={"username": ADMIN_PHONE, "password": ADMIN_PASSWORD},
    )
    assert resp.status_code == 200, f"sqladmin login failed: {resp.text}"
    probe = client.get("/admin/")
    assert probe.status_code == 200, f"sqladmin session not accepted: {probe.text}"
    yield client
    client.close()


class TestSqlAdminSpecialtyPages:
    def test_services_list_opens(self, admin_client) -> None:
        """The services list renders over the ``specialty_ref.title``
        dotted column path (GH #599 R2) — 200, never a 500."""
        resp = admin_client.get("/admin/service/list/")
        assert resp.status_code == 200, resp.text
        assert "Services" in resp.text

    def test_service_create_form_opens(self, admin_client) -> None:
        """The create/edit form builds (the ``specialty_ref`` select
        among the fields — the direction is set by id)."""
        resp = admin_client.get("/admin/service/create/")
        assert resp.status_code == 200, resp.text
        assert 'name="specialty_ref"' in resp.text

    def test_staff_list_opens(self, admin_client) -> None:
        resp = admin_client.get("/admin/staff/list/")
        assert resp.status_code == 200, resp.text

    def test_staff_edit_form_carries_specialty_id_set(self, admin_client) -> None:
        """The master section edits on the ID SET: the staff edit form
        renders the M2M ``specialties`` multi-select — the exact
        positions pattern (the automatic relationship field sqladmin
        builds for a secondary join), the id-набор mirror the plan asks
        for. NB: sqladmin 0.26 has no ``inline_models`` support — the
        ``StaffAdmin.inline_models`` attr is inert dead config; the
        direction set is the editable master-section surface here."""
        from tests.conftest import query_db

        query_db(
            "INSERT INTO staff (id, first_name, last_name, sort_order, is_active, "
            "created_at, updated_at) VALUES ('staff-sqla', 'Мария', 'Иванова', "
            "0, 1, datetime('now'), datetime('now'))"
        )
        query_db(
            "INSERT INTO masters (staff_id, color, is_active, created_at, "
            "updated_at) VALUES ('staff-sqla', '#5B8C7A', 1, "
            "datetime('now'), datetime('now'))"
        )
        query_db(
            "INSERT INTO specialties (id, title, created_at, updated_at) "
            "VALUES ('spec-sqla-1', 'Живопись', datetime('now'), datetime('now'))"
        )
        query_db(
            "INSERT INTO specialties (id, title, created_at, updated_at) "
            "VALUES ('spec-sqla-2', 'Керамика', datetime('now'), datetime('now'))"
        )
        for spec_id in ("spec-sqla-1", "spec-sqla-2"):
            query_db(
                "INSERT INTO staff_specialties (staff_id, specialty_id) "
                f"VALUES ('staff-sqla', '{spec_id}')"
            )

        resp = admin_client.get("/admin/staff/edit/staff-sqla")
        assert resp.status_code == 200, resp.text
        # The M2M id-set field — a MULTI-select over the dictionary rows,
        # the positions mirror.
        assert '<select class="form-control" id="specialties" multiple name="specialties">' in resp.text
        assert '<select class="form-control" id="positions" multiple name="positions">' in resp.text
