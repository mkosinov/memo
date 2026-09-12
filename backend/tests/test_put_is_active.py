"""Tests pinning that PUT endpoints REJECT the ``is_active`` field (422).

#207 §3.2 + §10 (auto-closes #178): ``is_active`` was removed from all Update
(PUT) schemas for the 5 archive-capable entities (Master/Location/Service/
Material/Client). Archive/restore is exclusively via the dedicated
``POST /{id}/archive`` + ``POST /{id}/restore`` endpoints (Task 11). A stray
``is_active`` in a PUT body is rejected with **422** via ``extra="forbid"`` on
the Update schema. The API now exposes ``archived`` (= ``not is_active``) on
the Response; ``is_active`` itself never serializes (``Field(exclude=True)``).

These are the **inverted** acceptance assertions (spec §14): they previously
asserted ``is_active`` round-trips via PUT for Master/Location/Material/
Service; now they assert PUT with ``is_active`` → 422 and the entity stays
active (a rejected PUT is atomic — no partial write reaches the DB). Client
coverage is added for parity (#201). Bare 422-status smoke checks live in
``test_update_rejects_is_active.py`` (Task 5); the archive/restore round-trip
moved to the ``TestArchiveRestoreEndpoints`` classes in each
``test_api_{entity}.py`` (Task 11).
"""

import pytest

pytestmark = pytest.mark.api


# ─── valid full-replace PUT payloads (no is_active) ──────────────────────────
# Each is a complete body for the entity's Update schema; archived/restore via
# POST endpoints, never via PUT.

STAFF_PUT = {
    "first_name": "Active",
    "last_name": "Master",
}

LOCATION_PUT = {
    "name": "Test Studio",
    "address": "Test Address",
    "capacity": 20,
}

MATERIAL_PUT = {
    "title": "Test Material",
    "description": "Test description",
}

SERVICE_PUT = {
    "title": "Test Service",
    "description": "Test",
    "image_url": "https://example.com/test.jpg",
    "specialty": "живопись",
    "min_age": 6,
    "max_age": 99,
    "duration": 90,
    "record_info": "info",
}

# ClientUpdate requires all 4 personal keys (value may be null, GH #201).
CLIENT_PUT = {
    "name": "John Smith",
    "phone": "+79991234567",
    "email": "john@example.com",
    "channel": "telegram",
}


class TestMasterPutRejectsIsActive:
    """PUT /api/v1/masters/{id} with is_active in the body → 422."""

    def test_put_master_with_is_active_false_rejected(self, api_client) -> None:
        """A stray is_active=False (old archive direction) → 422; master stays active."""
        master_id = api_client.post("/api/v1/staff", json=STAFF_PUT).json()["id"]

        resp = api_client.put(
            f"/api/v1/staff/{master_id}",
            json={**STAFF_PUT, "is_active": False},
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"

        # Rejection is atomic — no partial write; master is still active.
        after = api_client.get(f"/api/v1/staff/{master_id}").json()
        assert after["archived"] is False

    def test_put_master_with_is_active_true_rejected(self, api_client) -> None:
        """A stray is_active=True (old restore direction) → 422 too (both polarities)."""
        master_id = api_client.post("/api/v1/staff", json=STAFF_PUT).json()["id"]

        resp = api_client.put(
            f"/api/v1/staff/{master_id}",
            json={**STAFF_PUT, "is_active": True},
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"


class TestLocationPutRejectsIsActive:
    """PUT /api/v1/locations/{id} with is_active in the body → 422."""

    def test_put_location_with_is_active_rejected(self, api_client) -> None:
        loc_id = api_client.post("/api/v1/locations", json=LOCATION_PUT).json()["id"]

        resp = api_client.put(
            f"/api/v1/locations/{loc_id}",
            json={**LOCATION_PUT, "is_active": False},
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"

        after = api_client.get(f"/api/v1/locations/{loc_id}").json()
        assert after["archived"] is False


class TestMaterialPutRejectsIsActive:
    """PUT /api/v1/materials/{id} with is_active in the body → 422."""

    def test_put_material_with_is_active_rejected(self, api_client) -> None:
        material_id = api_client.post("/api/v1/materials", json=MATERIAL_PUT).json()["id"]

        resp = api_client.put(
            f"/api/v1/materials/{material_id}",
            json={**MATERIAL_PUT, "is_active": False},
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"

        after = api_client.get(f"/api/v1/materials/{material_id}").json()
        assert after["archived"] is False


class TestServicePutRejectsIsActive:
    """PUT /api/v1/services/{id} with is_active in the body → 422."""

    def test_put_service_with_is_active_rejected(self, api_client) -> None:
        service_id = api_client.post("/api/v1/services", json=SERVICE_PUT).json()["id"]

        resp = api_client.put(
            f"/api/v1/services/{service_id}",
            json={**SERVICE_PUT, "is_active": False},
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"

        after = api_client.get(f"/api/v1/services/{service_id}").json()
        assert after["archived"] is False


class TestClientPutRejectsIsActive:
    """PUT /api/v1/clients/{id} with is_active in the body → 422 (#201 parity)."""

    def test_put_client_with_is_active_rejected(self, api_client) -> None:
        client_id = api_client.post("/api/v1/clients", json=CLIENT_PUT).json()["id"]

        resp = api_client.put(
            f"/api/v1/clients/{client_id}",
            json={**CLIENT_PUT, "is_active": False},
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"

        after = api_client.get(f"/api/v1/clients/{client_id}").json()
        assert after["archived"] is False