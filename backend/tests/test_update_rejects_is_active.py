"""Task 5 (#207): PUT/PATCH must reject is_active — auto-closes #178.

After removing ``is_active`` from the ``XUpdate``/``XPatch`` Pydantic schemas for
the 5 archiveable entities (Master, Location, Service, Material, Client), a
PUT or PATCH whose body still carries ``is_active`` must respond **422**
(extra/unsupported field) instead of being silently applied. Archive/restore
is owned by the dedicated POST endpoints (Task 11); the lifecycle flag is no
longer a PUT/PATCH concern.

These are the NEW 422-asserting tests for Task 5. They assert ONLY the 422
status — they do NOT inspect the response body (Task 4 owns the Response
``archived`` rewrite; Task 13/14 own inverting the legacy acceptance assertions
in ``test_put_is_active.py`` / ``test_patch_is_active.py``).
"""

import pytest

pytestmark = pytest.mark.api

# ─── Creation payloads (the non-is_active personal/scalar fields) ─────────────
STAFF_CREATE = {
    "first_name": "Active",
    "last_name": "Master",
}

LOCATION_CREATE = {
    "name": "Test Studio",
    "address": "Test Address",
    "capacity": 20,
}

SERVICE_CREATE = {
    "title": "Test Service",
    "description": "Test",
    "image_url": "https://example.com/test.jpg",
    "specialty": "живопись",
    "min_age": 6,
    "max_age": 99,
    "duration": 90,
    "record_info": "info",
}

MATERIAL_CREATE = {
    "title": "Test Material",
    "description": "Test description",
}

# ClientUpdate lists the 4 personal keys as required-nullable (GH #201): a PUT
# must send all 4 keys (value may be null). Channel is the Channel enum.
CLIENT_CREATE = {
    "name": "John Smith",
    "phone": "+79991234567",
    "email": "john@example.com",
    "channel": "telegram",
}


# ─── PUT: full-replace payload + stray is_active → 422 ─────────────────────────


class TestPutRejectsIsActive:
    """PUT {entity}/{id} with ``is_active`` in the body → 422 (#178)."""

    def test_put_master_rejects_is_active(self, api_client) -> None:
        master_id = api_client.post("/api/v1/staff", json=STAFF_CREATE).json()["id"]
        resp = api_client.put(
            f"/api/v1/staff/{master_id}",
            json={**STAFF_CREATE, "is_active": True},
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"

    def test_put_location_rejects_is_active(self, api_client) -> None:
        loc_id = api_client.post("/api/v1/locations", json=LOCATION_CREATE).json()["id"]
        resp = api_client.put(
            f"/api/v1/locations/{loc_id}",
            json={**LOCATION_CREATE, "is_active": True},
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"

    def test_put_service_rejects_is_active(self, api_client) -> None:
        service_id = api_client.post("/api/v1/services", json=SERVICE_CREATE).json()["id"]
        resp = api_client.put(
            f"/api/v1/services/{service_id}",
            json={**SERVICE_CREATE, "is_active": True},
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"

    def test_put_material_rejects_is_active(self, api_client) -> None:
        material_id = api_client.post("/api/v1/materials", json=MATERIAL_CREATE).json()["id"]
        resp = api_client.put(
            f"/api/v1/materials/{material_id}",
            json={**MATERIAL_CREATE, "is_active": True},
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"

    def test_put_client_rejects_is_active(self, api_client) -> None:
        client_id = api_client.post("/api/v1/clients", json=CLIENT_CREATE).json()["id"]
        # ClientUpdate requires all 4 personal keys (value may be null). Add a
        # stray is_active → must still 422 (extra field), not 200.
        resp = api_client.put(
            f"/api/v1/clients/{client_id}",
            json={**CLIENT_CREATE, "is_active": True},
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"


# ─── PATCH: stray is_active → 422 ──────────────────────────────────────────────


class TestPatchRejectsIsActive:
    """PATCH {entity}/{id} with ``is_active`` in the body → 422 (#178)."""

    def test_patch_master_rejects_is_active(self, api_client) -> None:
        master_id = api_client.post("/api/v1/staff", json=STAFF_CREATE).json()["id"]
        resp = api_client.patch(
            f"/api/v1/staff/{master_id}", json={"is_active": True}
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"

    def test_patch_location_rejects_is_active(self, api_client) -> None:
        loc_id = api_client.post("/api/v1/locations", json=LOCATION_CREATE).json()["id"]
        resp = api_client.patch(
            f"/api/v1/locations/{loc_id}", json={"is_active": True}
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"

    def test_patch_service_rejects_is_active(self, api_client) -> None:
        service_id = api_client.post("/api/v1/services", json=SERVICE_CREATE).json()["id"]
        resp = api_client.patch(
            f"/api/v1/services/{service_id}", json={"is_active": True}
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"

    def test_patch_material_rejects_is_active(self, api_client) -> None:
        material_id = api_client.post("/api/v1/materials", json=MATERIAL_CREATE).json()["id"]
        resp = api_client.patch(
            f"/api/v1/materials/{material_id}", json={"is_active": True}
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"

    def test_patch_client_rejects_is_active(self, api_client) -> None:
        client_id = api_client.post("/api/v1/clients", json=CLIENT_CREATE).json()["id"]
        resp = api_client.patch(
            f"/api/v1/clients/{client_id}", json={"is_active": True}
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"