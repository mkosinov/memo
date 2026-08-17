"""Tests for the Materials CRUD API endpoints."""

import pytest

from tests.conftest import query_db

pytestmark = pytest.mark.api


def _archive_material(material_id: str) -> None:
    """Archive a material row directly in the DB (sets is_active=0).

    DELETE /materials/{id} is now HARD (Task 2/3 of #207 — no row left to
    list under ?status=archived). The ``POST /archive`` endpoint (Task 11)
    is not wired yet, so tests that need an archived row go straight to the
    ``is_active`` column via ``query_db`` (mirrors what the future endpoint
    will do via ``ArchiveService.archive`` → ``repo.patch({is_active: False})``).
    """
    query_db(f"UPDATE materials SET is_active=0 WHERE id='{material_id}'")


def _create_material(api_client, title="Test Material", description="desc"):
    """Create a material via POST /api/v1/materials and return its JSON.

    Mirrors the ``_create_tag`` helper in ``test_api_services.py``.
    """
    resp = api_client.post(
        "/api/v1/materials", json={"title": title, "description": description}
    )
    assert resp.status_code == 201, f"create material failed: {resp.status_code}: {resp.text}"
    return resp.json()


class TestMaterialListStatusFilter:
    """GET /api/v1/materials?status={active|archived|all} archive filtering (GH #195).

    The default (no ``status`` or ``status=active``) returns only active rows.
    These tests exercise the archive capabilities plus query-param validation:

      - ``?status=archived`` → only is_active=False rows
      - ``?status=all`` → both active and archived rows
      - ``?status=active`` → same as default (only active rows)
      - ``?status=foo`` → 422 from FastAPI enum validation
    """

    def test_list_status_archived_returns_only_archived(self, api_client) -> None:
        """?status=archived hides active materials, surfaces archived ones."""
        active = _create_material(api_client, title="Active Mat")
        archived = _create_material(api_client, title="Archived Mat")
        _archive_material(archived["id"])

        resp = api_client.get("/api/v1/materials?status=archived")
        assert resp.status_code == 200, f"list failed: {resp.text}"
        body = resp.json()
        assert body["total"] == 1, f"expected 1 archived, got {body['total']}"
        assert len(body["items"]) == 1
        ids = [m["id"] for m in body["items"]]
        assert archived["id"] in ids
        assert active["id"] not in ids
        # Response schema exposes `archived` (inverted from is_active, #207 §3.1).
        assert body["items"][0]["archived"] is True

    def test_list_status_all_returns_both_active_and_archived(self, api_client) -> None:
        """?status=all returns every material regardless of is_active."""
        active = _create_material(api_client, title="Active All")
        archived = _create_material(api_client, title="Archived All")
        _archive_material(archived["id"])

        resp = api_client.get("/api/v1/materials?status=all")
        assert resp.status_code == 200, f"list failed: {resp.text}"
        body = resp.json()
        assert body["total"] == 2, f"expected 2 total, got {body['total']}"
        ids = [m["id"] for m in body["items"]]
        assert active["id"] in ids
        assert archived["id"] in ids

    def test_list_status_active_explicit_matches_default(self, api_client) -> None:
        """?status=active behaves the same as the default (no query param)."""
        active = _create_material(api_client, title="Active Explicit")
        archived = _create_material(api_client, title="Archived Explicit")
        _archive_material(archived["id"])

        explicit = api_client.get("/api/v1/materials?status=active").json()
        default = api_client.get("/api/v1/materials").json()
        assert explicit["total"] == 1
        assert default["total"] == 1
        assert explicit["items"][0]["id"] == active["id"]
        assert default["items"][0]["id"] == active["id"]

    def test_list_status_invalid_returns_422(self, api_client) -> None:
        """?status=foo (not a valid ArchiveStatus) → 422 from enum validation."""
        resp = api_client.get("/api/v1/materials?status=foo")
        assert resp.status_code == 422


class TestDeleteUnifiedRoute:
    """DELETE /api/v1/materials/{id} — unified dry-run (no body) + execute (with body).

    Spec: docs/specs/2026-08-15-delete-hard-delete-and-dependency-resolution-design.md
      * §2  — Change 1: body presence distinguishes dry-run vs execute.
      * §5/§14 — Material has ZERO FK deps: no-body DELETE is ALWAYS 204.
      * §6  — DELETE with resolutions body (executor = Task 10).
    """

    def test_delete_material_no_body_hard_deletes_204(self, api_client) -> None:
        """No body + zero deps → 204 hard delete; row physically gone (spec §2/§14)."""
        material = _create_material(api_client, title="To Delete")

        resp = api_client.delete(f"/api/v1/materials/{material['id']}")

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/materials/{material['id']}").status_code == 404

    def test_delete_material_with_body_executes_204(self, api_client) -> None:
        """With body ``{}`` + zero deps → 204 execute (Task 10 executor).

        Material has zero FK deps, so ``resolutions={}`` is the trivial case —
        the executor collects no deps, hard-deletes the row, commits.
        EXPECTED RED until Task 10 lands ``ArchiveService.resolve_delete``.
        """
        material = _create_material(api_client, title="To Delete With Body")

        resp = api_client.request(
            "DELETE", f"/api/v1/materials/{material['id']}", json={"resolutions": {}}
        )

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/materials/{material['id']}").status_code == 404

    def test_delete_nonexistent_material_no_body_returns_404(self, api_client) -> None:
        """No body + nonexistent id → 404 (service.delete returns False)."""
        resp = api_client.delete("/api/v1/materials/nonexistent-material-id")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "MATERIAL_NOT_FOUND"

    def test_delete_nonexistent_material_with_body_returns_404(self, api_client) -> None:
        """With body + nonexistent id → 404 (executor returns False).

        EXPECTED RED until Task 10 (resolve_delete missing → AttributeError today).
        """
        resp = api_client.request(
            "DELETE", "/api/v1/materials/nonexistent-material-id", json={"resolutions": {}}
        )
        assert resp.status_code == 404


class TestArchiveRestoreEndpoints:
    """POST /api/v1/materials/{id}/archive + POST /{id}/restore — Task 11 (#207 §2/§14).

    Both endpoints return HTTP 200 with the re-fetched body (``archived``
    computed from ``is_active``). Idempotent. ``?status=archived`` lists
    archived rows after ``POST /archive``.
    """

    ENTITY_PATH = "/api/v1/materials"
    NOT_FOUND_CODE = "MATERIAL_NOT_FOUND"

    def test_archive_returns_200_with_archived_true_and_db_is_active_false(
        self, api_client
    ) -> None:
        material = _create_material(api_client, title="To Archive")

        resp = api_client.post(f"{self.ENTITY_PATH}/{material['id']}/archive")

        assert resp.status_code == 200, f"archive failed: {resp.text}"
        body = resp.json()
        assert body["id"] == material["id"]
        assert body["archived"] is True
        rows = query_db(
            f"SELECT is_active FROM materials WHERE id='{material['id']}'"
        )
        assert rows[0]["is_active"] == 0

    def test_restore_returns_200_with_archived_false_and_db_is_active_true(
        self, api_client
    ) -> None:
        material = _create_material(api_client, title="To Restore")
        api_client.post(f"{self.ENTITY_PATH}/{material['id']}/archive")

        resp = api_client.post(f"{self.ENTITY_PATH}/{material['id']}/restore")

        assert resp.status_code == 200, f"restore failed: {resp.text}"
        body = resp.json()
        assert body["archived"] is False
        rows = query_db(
            f"SELECT is_active FROM materials WHERE id='{material['id']}'"
        )
        assert rows[0]["is_active"] == 1

    def test_archive_nonexistent_returns_404(self, api_client) -> None:
        resp = api_client.post(f"{self.ENTITY_PATH}/nonexistent-id/archive")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == self.NOT_FOUND_CODE

    def test_restore_nonexistent_returns_404(self, api_client) -> None:
        resp = api_client.post(f"{self.ENTITY_PATH}/nonexistent-id/restore")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == self.NOT_FOUND_CODE

    def test_archive_already_archived_is_idempotent_200(self, api_client) -> None:
        material = _create_material(api_client, title="Double Archive")
        first = api_client.post(f"{self.ENTITY_PATH}/{material['id']}/archive")
        assert first.status_code == 200

        second = api_client.post(f"{self.ENTITY_PATH}/{material['id']}/archive")

        assert second.status_code == 200
        assert second.json()["archived"] is True

    def test_restore_already_active_is_idempotent_200(self, api_client) -> None:
        material = _create_material(api_client, title="Double Restore")  # starts active

        resp = api_client.post(f"{self.ENTITY_PATH}/{material['id']}/restore")

        assert resp.status_code == 200
        assert resp.json()["archived"] is False

    def test_status_archived_returns_archived_row_after_archive_endpoint(
        self, api_client
    ) -> None:
        material = _create_material(api_client, title="Status Check")
        api_client.post(f"{self.ENTITY_PATH}/{material['id']}/archive")

        archived_list = api_client.get(f"{self.ENTITY_PATH}?status=archived").json()
        active_list = api_client.get(f"{self.ENTITY_PATH}?status=active").json()

        archived_ids = [m["id"] for m in archived_list["items"]]
        active_ids = [m["id"] for m in active_list["items"]]
        assert material["id"] in archived_ids
        assert material["id"] not in active_ids


class TestArchiveRestoreNoUserCascade:
    """Non-master entities MUST NOT touch the users table on archive/restore (#207 §4.2).

    Only Master cascades. Material has zero FK deps and no link to users —
    verify by creating a user (is_active=true) then asserting users.is_active
    is unchanged after archive/restore.
    """

    ENTITY_PATH = "/api/v1/materials"

    def test_archive_does_not_modify_users_is_active(
        self, api_client, _user
    ) -> None:
        material = _create_material(api_client, title="No User Touch Archive")

        resp = api_client.post(f"{self.ENTITY_PATH}/{material['id']}/archive")

        assert resp.status_code == 200
        rows = query_db(f"SELECT is_active FROM users WHERE id='{_user['id']}'")
        assert rows[0]["is_active"] == 1

    def test_restore_does_not_modify_users_is_active(
        self, api_client, _user
    ) -> None:
        material = _create_material(api_client, title="No User Touch Restore")
        api_client.post(f"{self.ENTITY_PATH}/{material['id']}/archive")

        resp = api_client.post(f"{self.ENTITY_PATH}/{material['id']}/restore")

        assert resp.status_code == 200
        rows = query_db(f"SELECT is_active FROM users WHERE id='{_user['id']}'")
        assert rows[0]["is_active"] == 1


class TestMaterialAllEndpoint:
    """GET /api/v1/materials/all — bare array (GH #205 Task 2).

    Minimal smoke: returns a bare JSON array (not an envelope) containing
    created materials. Full generic contract lands in Task 4.
    """

    def test_all_returns_bare_array(self, api_client) -> None:
        created = _create_material(api_client, title="All Endpoint Test")
        resp = api_client.get("/api/v1/materials/all")
        assert resp.status_code == 200, f"GET /all failed: {resp.text}"
        body = resp.json()
        assert isinstance(body, list), "/all must return a bare array, not an envelope"
        assert any(item["id"] == created["id"] for item in body)
