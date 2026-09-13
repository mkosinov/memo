"""Tests pinning that PATCH endpoints REJECT the ``is_active`` field (422).

#207 §3.2 + §10 (auto-closes #178): ``is_active`` was removed from all Patch
schemas for the 5 archive-capable entities (Master/Location/Service/Material/
Client). Archive/restore is exclusively via the dedicated ``POST /{id}/archive``
+ ``POST /{id}/restore`` endpoints (Task 11). A stray ``is_active`` in a PATCH
body is rejected with **422** via ``extra="forbid"`` on the Patch schema. The
API now exposes ``archived`` (= ``not is_active``) on the Response; ``is_active``
itself never serializes (``Field(exclude=True)``).

These are the **inverted** acceptance assertions (spec §14): they previously
asserted ``is_active`` round-trips via PATCH for Master/Location/Material/
Service; now they assert PATCH with ``is_active`` → 422 and the entity stays
unchanged (a rejected PATCH is atomic — no partial write reaches the DB).
Client coverage is added for parity (#201). Bare 422-status smoke checks live
in ``test_update_rejects_is_active.py`` (Task 5); the archive/restore
round-trip moved to the ``TestArchiveRestoreEndpoints`` classes in each
``test_api_{entity}.py`` (Task 11).
"""

import pytest

pytestmark = pytest.mark.api


# ─── PATCH stray-model payloads — only ``is_active`` is sent (no real field), ─
# so the body would otherwise be a no-op patch. ``is_active`` must be the sole
# reason for the 422.

class TestPatchRejectsIsActive:
    """PATCH {entity}/{id} with ``is_active`` in the body → 422 for all 5
    archive-capable entities. A rejected PATCH is atomic: no is_active flip
    reaches the DB."""

    def test_patch_master_is_active_rejected_and_atomic(self, api_client) -> None:
        master_id = api_client.post("/api/v1/staff", json={
            "first_name": "Active", "last_name": "Master", "master": {"specialty": "живопись", "color": "#5B8C7A"},
        }).json()["id"]

        resp = api_client.patch(
            f"/api/v1/staff/{master_id}", json={"is_active": False}
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"

        # Atomicity: master is still active (no partial flip).
        get = api_client.get(f"/api/v1/staff/{master_id}").json()
        assert get["archived"] is False

    def test_patch_location_is_active_rejected_and_atomic(self, api_client) -> None:
        loc_id = api_client.post("/api/v1/locations", json={
            "name": "Active Studio", "capacity": 10,
        }).json()["id"]

        resp = api_client.patch(
            f"/api/v1/locations/{loc_id}", json={"is_active": False}
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"

        get = api_client.get(f"/api/v1/locations/{loc_id}").json()
        assert get["archived"] is False

    def test_patch_material_is_active_rejected_and_atomic(self, api_client) -> None:
        material_id = api_client.post("/api/v1/materials", json={
            "title": "Active Material", "description": "desc",
        }).json()["id"]

        resp = api_client.patch(
            f"/api/v1/materials/{material_id}", json={"is_active": False}
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"

        get = api_client.get(f"/api/v1/materials/{material_id}").json()
        assert get["archived"] is False

    def test_patch_service_is_active_rejected_and_atomic(self, api_client) -> None:
        service_id = api_client.post("/api/v1/services", json={
            "title": "Active Service", "description": "desc",
            "image_url": "https://example.com/s.jpg",
            "specialty": "живопись", "min_age": 6, "max_age": 99,
            "duration": 90, "record_info": "info",
        }).json()["id"]

        resp = api_client.patch(
            f"/api/v1/services/{service_id}", json={"is_active": False}
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"

        get = api_client.get(f"/api/v1/services/{service_id}").json()
        assert get["archived"] is False

    def test_patch_client_is_active_rejected_and_atomic(self, api_client) -> None:
        client_id = api_client.post("/api/v1/clients", json={
            "name": "John Smith",
            "phone": "+79991234567",
            "email": "john@example.com",
            "channel": "telegram",
        }).json()["id"]

        resp = api_client.patch(
            f"/api/v1/clients/{client_id}", json={"is_active": False}
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"

        get = api_client.get(f"/api/v1/clients/{client_id}").json()
        assert get["archived"] is False

    def test_patch_master_is_active_true_rejected_and_restores_via_endpoint(
        self, api_client
    ) -> None:
        """Restore direction: confirm the 422 fires for both polarities and the
        dedicated restore endpoint is the only way back from the archive.

        Replaces the deleted ``test_patch_master_is_active_true_restores``
        (round-trip via PATCH ``{is_active: True}`` after a PATCH
        ``{is_active: False}`` archive): the PUT/PATCH route is now closed for
        life-cycle state, so 422 fires regardless of polarity. Archive then
        restore via the dedicated endpoints to prove the new path.
        """
        master_id = api_client.post("/api/v1/staff", json={
            "first_name": "Toggle", "last_name": "Master", "master": {"specialty": "живопись", "color": "#5B8C7A"},
        }).json()["id"]

        # Archive via the dedicated endpoint (the only valid path now).
        archive_resp = api_client.post(f"/api/v1/staff/{master_id}/archive")
        assert archive_resp.status_code == 200
        assert archive_resp.json()["archived"] is True

        # PATCH {is_active: True} must 422 — PATCH no longer restores.
        resp = api_client.patch(
            f"/api/v1/staff/{master_id}", json={"is_active": True}
        )
        assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"

        # Atomicity: master stayed archived (no partial flip).
        assert api_client.get(f"/api/v1/staff/{master_id}").json()["archived"] is True

        # Restore only via the dedicated endpoint.
        restore_resp = api_client.post(f"/api/v1/staff/{master_id}/restore")
        assert restore_resp.status_code == 200
        assert restore_resp.json()["archived"] is False