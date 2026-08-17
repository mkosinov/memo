"""Tests for the Locations CRUD API endpoints."""

import pytest

from tests.conftest import query_db

pytestmark = pytest.mark.api

LOCATION_PAYLOAD = {
    "name": "Test Studio",
    "address": "123 Art Street",
    "description": "A cozy studio for painting",
    "capacity": 10,
    "yandex_map_url": "https://yandex.ru/maps/test",
    "review_url": "https://example.com/review",
    "record_info": "Call +7-999-123-45-67",
    "image_url": "https://example.com/studio.jpg",
    "location_hint": "1 этаж, светлая студия с панорамными окнами",
}


def _archive_location(location_id: str) -> None:
    """Archive a location row directly in the DB (sets is_active=0).

    Mirrors the ``_archive_material`` helper (test_api_materials.py) and
    ``_archive_service`` (test_api_services.py): ``DELETE /locations/{id}`` is
    now HARD (#207 — leaves no row to list under ``?status=archived``).
    Status-filter tests touch the ``is_active`` column directly via
    ``query_db`` (the same write the ``POST /{id}/archive`` endpoint performs
    via ``ArchiveService.archive`` → ``repo.patch({is_active: False})`` in
    Task 11 — kept direct here to avoid coupling the filter test to the
    archive endpoint, which has its own coverage in
    ``TestArchiveRestoreEndpoints``).
    """
    query_db(f"UPDATE locations SET is_active=0 WHERE id='{location_id}'")


class TestLocationsCrud:
    """Create-edge-case extras for /api/locations (CRUD covered by contract)."""

    def test_create_location_without_location_hint(self, api_client) -> None:
        """POST /api/locations omitting location_hint defaults to None."""
        payload = {k: v for k, v in LOCATION_PAYLOAD.items() if k != "location_hint"}
        response = api_client.post("/api/v1/locations", json=payload)

        assert response.status_code == 201
        assert response.json()["location_hint"] is None


class TestLocationListStatusFilter:
    """GET /api/v1/locations?status={active|archived|all} archive filtering (GH #195).

    The default (no ``status`` or ``status=active``) returns only active rows.
    These tests exercise the archive capabilities plus query-param validation:

      - ``?status=archived`` → only is_active=False rows
      - ``?status=all`` → both active and archived rows
      - ``?status=active`` → same as default (only active rows)
      - ``?status=foo`` → 422 from FastAPI enum validation
    """

    def test_list_status_archived_returns_only_archived(
        self, api_client, create_location
    ) -> None:
        """?status=archived hides active locations, surfaces archived ones.

        #207 Task 13 Part B expanded: archival is via ``_archive_location``
        (DELETE is now hard — leaves no row to list under ``?status=archived``).
        """
        active = create_location()
        archived = create_location()
        _archive_location(archived["id"])

        resp = api_client.get("/api/v1/locations?status=archived")
        assert resp.status_code == 200, f"list failed: {resp.text}"
        body = resp.json()
        assert body["total"] == 1, f"expected 1 archived, got {body['total']}"
        assert len(body["items"]) == 1
        ids = [loc["id"] for loc in body["items"]]
        assert archived["id"] in ids
        assert active["id"] not in ids
        # #207 §3.1: `archived` is the inverted serialized field (True = in
        # archive); `is_active` itself never serializes (Field exclude=True).
        assert body["items"][0]["archived"] is True

    def test_list_status_all_returns_both_active_and_archived(
        self, api_client, create_location
    ) -> None:
        """?status=all returns every location regardless of is_active."""
        active = create_location()
        archived = create_location()
        _archive_location(archived["id"])

        resp = api_client.get("/api/v1/locations?status=all")
        assert resp.status_code == 200, f"list failed: {resp.text}"
        body = resp.json()
        assert body["total"] == 2, f"expected 2 total, got {body['total']}"
        ids = [loc["id"] for loc in body["items"]]
        assert active["id"] in ids
        assert archived["id"] in ids

    def test_list_status_active_explicit_matches_default(
        self, api_client, create_location
    ) -> None:
        """?status=active behaves the same as the default (no query param)."""
        active = create_location()
        archived = create_location()
        _archive_location(archived["id"])

        explicit = api_client.get("/api/v1/locations?status=active").json()
        default = api_client.get("/api/v1/locations").json()
        assert explicit["total"] == 1
        assert default["total"] == 1
        assert explicit["items"][0]["id"] == active["id"]
        assert default["items"][0]["id"] == active["id"]

    def test_list_status_invalid_returns_422(self, api_client) -> None:
        """?status=foo (not a valid ArchiveStatus) → 422 from enum validation."""
        resp = api_client.get("/api/v1/locations?status=foo")
        assert resp.status_code == 422


class TestDeleteUnifiedRoute:
    """DELETE /api/v1/locations/{id} — unified dry-run (no body) + execute (with body).

    Spec: docs/specs/2026-08-15-delete-hard-delete-and-dependency-resolution-design.md
      * §2  — Change 1: body presence distinguishes dry-run vs execute.
      * §5  — 409 Conflict response (counters + sums only).
      * §6  — DELETE with resolutions body (executor = Task 10).
      * §14 — acceptance criteria.
    """

    def test_delete_location_with_activities_no_body_returns_409(
        self, api_client, create_activity
    ) -> None:
        """No body + blocking dep (activities) → 409 + dependency tree (spec §5)."""
        activity = create_activity()
        location_id = activity["location_id"]

        resp = api_client.delete(f"/api/v1/locations/{location_id}")

        assert resp.status_code == 409
        body = resp.json()
        assert body["detail"] == "has_dependencies"
        entities = [d["entity"] for d in body["dependencies"]]
        assert "activities" in entities
        activities_dep = next(
            d for d in body["dependencies"] if d["entity"] == "activities"
        )
        assert activities_dep["count"] == 1
        assert activities_dep["allowed_actions"] == []
        assert activities_dep["message"] is not None
        # Row untouched.
        assert api_client.get(f"/api/v1/locations/{location_id}").status_code == 200

    def test_delete_bare_location_no_body_returns_204_and_row_gone(
        self, api_client, create_location
    ) -> None:
        """No body + zero deps → 204 hard delete; row physically gone (spec §2)."""
        location = create_location()

        resp = api_client.delete(f"/api/v1/locations/{location['id']}")

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/locations/{location['id']}").status_code == 404

    def test_delete_nonexistent_location_no_body_returns_404(self, api_client) -> None:
        """No body + nonexistent id → 404 (service.delete returns False)."""
        resp = api_client.delete("/api/v1/locations/nonexistent-location-id")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "LOCATION_NOT_FOUND"

    def test_delete_nonexistent_location_with_body_returns_404(self, api_client) -> None:
        """With body + nonexistent id → 404 (executor returns False).

        EXPECTED RED until Task 10 (resolve_delete missing → AttributeError today).
        """
        resp = api_client.request(
            "DELETE",
            "/api/v1/locations/nonexistent-location-id",
            json={"resolutions": {"location_tags": "cascade"}},
        )
        assert resp.status_code == 404

    def test_delete_location_with_tags_with_body_executes_204(
        self, api_client, create_location
    ) -> None:
        """With body ``{}`` + all-auto dep (location_tags) → 204 execute.

        ``location_tags`` is auto-cascade — the empty ``{}`` body opts into
        execute. EXPECTED RED until Task 10 lands ``ArchiveService.resolve_delete``
        (AttributeError → 500 today).
        """
        location = create_location()
        tag_id = api_client.post(
            "/api/v1/tags", json={"tag": f"lt-{location['id'][:8]}"}
        ).json()["id"]
        query_db(
            f"INSERT INTO location_tags (location_id, tag_id) "
            f"VALUES ('{location['id']}', '{tag_id}')"
        )

        resp = api_client.request(
            "DELETE", f"/api/v1/locations/{location['id']}", json={"resolutions": {}}
        )

        assert resp.status_code == 204
        # Location + tag join physically gone (Task 10 executor).
        assert api_client.get(f"/api/v1/locations/{location['id']}").status_code == 404
        assert (
            query_db(
                f"SELECT * FROM location_tags WHERE location_id='{location['id']}'"
            )
            == []
        )

    def test_delete_location_with_activities_with_body_returns_422_blocking(
        self, api_client, create_activity
    ) -> None:
        """With body + blocking dep (activities) → 422 'archive instead' (spec §6.4)."""
        activity = create_activity()
        location_id = activity["location_id"]

        resp = api_client.request(
            "DELETE", f"/api/v1/locations/{location_id}", json={"resolutions": {}}
        )

        assert resp.status_code == 422
        # Row untouched.
        assert api_client.get(f"/api/v1/locations/{location_id}").status_code == 200


class TestArchiveRestoreEndpoints:
    """POST /api/v1/locations/{id}/archive + POST /{id}/restore — Task 11 (#207 §2/§14).

    Both endpoints return HTTP 200 with the re-fetched body (``archived``
    computed from ``is_active``). Idempotent. ``?status=archived`` lists
    archived rows after ``POST /archive``.
    """

    ENTITY_PATH = "/api/v1/locations"
    NOT_FOUND_CODE = "LOCATION_NOT_FOUND"
    DB_TABLE = "locations"

    def test_archive_returns_200_with_archived_true_and_db_is_active_false(
        self, api_client, create_location
    ) -> None:
        location = create_location()

        resp = api_client.post(f"{self.ENTITY_PATH}/{location['id']}/archive")

        assert resp.status_code == 200, f"archive failed: {resp.text}"
        body = resp.json()
        assert body["id"] == location["id"]
        assert body["archived"] is True
        rows = query_db(
            f"SELECT is_active FROM locations WHERE id='{location['id']}'"
        )
        assert rows[0]["is_active"] == 0

    def test_restore_returns_200_with_archived_false_and_db_is_active_true(
        self, api_client, create_location
    ) -> None:
        location = create_location()
        api_client.post(f"{self.ENTITY_PATH}/{location['id']}/archive")

        resp = api_client.post(f"{self.ENTITY_PATH}/{location['id']}/restore")

        assert resp.status_code == 200, f"restore failed: {resp.text}"
        body = resp.json()
        assert body["archived"] is False
        rows = query_db(
            f"SELECT is_active FROM locations WHERE id='{location['id']}'"
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

    def test_archive_already_archived_is_idempotent_200(
        self, api_client, create_location
    ) -> None:
        location = create_location()
        first = api_client.post(f"{self.ENTITY_PATH}/{location['id']}/archive")
        assert first.status_code == 200

        second = api_client.post(f"{self.ENTITY_PATH}/{location['id']}/archive")

        assert second.status_code == 200
        assert second.json()["archived"] is True

    def test_restore_already_active_is_idempotent_200(
        self, api_client, create_location
    ) -> None:
        location = create_location()  # starts active

        resp = api_client.post(f"{self.ENTITY_PATH}/{location['id']}/restore")

        assert resp.status_code == 200
        assert resp.json()["archived"] is False

    def test_status_archived_returns_archived_row_after_archive_endpoint(
        self, api_client, create_location
    ) -> None:
        """After POST /archive, ?status=archived lists the row."""
        location = create_location()
        api_client.post(f"{self.ENTITY_PATH}/{location['id']}/archive")

        archived_list = api_client.get(f"{self.ENTITY_PATH}?status=archived").json()
        active_list = api_client.get(f"{self.ENTITY_PATH}?status=active").json()

        archived_ids = [m["id"] for m in archived_list["items"]]
        active_ids = [m["id"] for m in active_list["items"]]
        assert location["id"] in archived_ids
        assert location["id"] not in active_ids


class TestArchiveRestoreNoUserCascade:
    """Non-master entities MUST NOT touch the users table on archive/restore (#207 §4.2).

    Only Master cascades (Master = staff profile + linked User login account).
    Location/Service/Material/Client have no user link. Verify by creating a
    user (is_active=true), archiving/restoring the entity, and asserting
    users.is_active unchanged.
    """

    ENTITY_PATH = "/api/v1/locations"

    def test_archive_does_not_modify_users_is_active(
        self, api_client, create_location, _user
    ) -> None:
        location = create_location()

        resp = api_client.post(f"{self.ENTITY_PATH}/{location['id']}/archive")

        assert resp.status_code == 200
        # User is_active unchanged (only Master cascades).
        rows = query_db(f"SELECT is_active FROM users WHERE id='{_user['id']}'")
        assert rows[0]["is_active"] == 1

    def test_restore_does_not_modify_users_is_active(
        self, api_client, create_location, _user
    ) -> None:
        location = create_location()
        api_client.post(f"{self.ENTITY_PATH}/{location['id']}/archive")

        resp = api_client.post(f"{self.ENTITY_PATH}/{location['id']}/restore")

        assert resp.status_code == 200
        rows = query_db(f"SELECT is_active FROM users WHERE id='{_user['id']}'")
        assert rows[0]["is_active"] == 1
