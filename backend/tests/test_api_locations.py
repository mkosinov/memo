"""Tests for the Locations CRUD API endpoints."""

import pytest

from tests.conftest import query_db

pytestmark = pytest.mark.api

LOCATION_PAYLOAD = {
    "title": "Test Studio",
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
    """DELETE /api/v1/locations/{id} — unified delete contract (GH #345,
    one-to-one mirror of ``tags.py:216-300`` / #318 D2).

    Modes (spec §4.1): ``?dry_run=true`` pure preview (409 tree / 204
    clean / 404); bare DELETE and a body without ``expected`` → 422
    ``expected_state_required`` (the form check precedes the probe); body
    ``{resolutions?, expected}`` — the deferred-delete commit with the
    expected id-set subset verification (409 ``stale_dependencies`` on
    mismatch) → resolutions validation → ``resolve_delete`` → 204.

    Domain matrix (spec §4.4): ``activities`` is the ONLY non-auto dep —
    blocked → a successful commit with ``resolutions`` is unreachable;
    a clean or all-auto location (location_tags/photos) commits with
    ``{expected: {}}``.
    """

    # ── bare DELETE (no flag, no body) → 422 expected_state_required ─────

    def test_bare_delete_blocked_location_returns_422_row_alive(
        self, api_client, create_activity,
    ) -> None:
        """S6: bare DELETE on a location with activities → 422, row alive."""
        location_id = create_activity()["location_id"]

        resp = api_client.delete(f"/api/v1/locations/{location_id}")

        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"
        assert api_client.get(f"/api/v1/locations/{location_id}").status_code == 200

    def test_bare_delete_clean_location_returns_422(
        self, api_client, create_location,
    ) -> None:
        """S6: bare DELETE executes nowhere — even a clean location refuses."""
        location = create_location(title="loc-clean-bare")

        resp = api_client.delete(f"/api/v1/locations/{location['id']}")

        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"
        assert api_client.get(f"/api/v1/locations/{location['id']}").status_code == 200

    def test_bare_delete_unknown_id_returns_422_before_404(
        self, api_client,
    ) -> None:
        """S6: form check precedes the existence probe — 422, not 404."""
        resp = api_client.delete("/api/v1/locations/nonexistent-location-id")
        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"

    def test_delete_resolutions_body_without_expected_returns_422(
        self, api_client, create_location,
    ) -> None:
        """S6: resolutions-only body is the rejected legacy shape."""
        location = create_location(title="loc-res-only")

        resp = api_client.request(
            "DELETE", f"/api/v1/locations/{location['id']}",
            json={"resolutions": {"location_tags": "cascade"}},
        )

        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"
        assert api_client.get(f"/api/v1/locations/{location['id']}").status_code == 200

    def test_delete_unknown_keys_body_without_expected_returns_422(
        self, api_client, create_location,
    ) -> None:
        """S6: unknown-keys-only body has no ``expected`` — same 422."""
        location = create_location(title="loc-unknown-keys")

        resp = api_client.request(
            "DELETE", f"/api/v1/locations/{location['id']}",
            json={"bogus_key": "whatever"},
        )

        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"
        assert api_client.get(f"/api/v1/locations/{location['id']}").status_code == 200

    # ── ?dry_run=true — pure preview (never modifies rows) ────────────────

    def test_dry_run_blocked_location_returns_409_tree_row_alive(
        self, api_client, create_activity,
    ) -> None:
        """S6: dry-run on a location with activities → 409 has_dependencies.

        ``activities`` is a blocked non-auto node: counters only, NO items
        (spec §4.3 fixed boundary).
        """
        location_id = create_activity()["location_id"]

        resp = api_client.request(
            "DELETE", f"/api/v1/locations/{location_id}",
            params={"dry_run": "true"},
        )

        assert resp.status_code == 409
        body = resp.json()
        assert body["detail"] == "has_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert deps["activities"]["count"] == 1
        assert deps["activities"]["allowed_actions"] == []
        assert deps["activities"]["auto"] is False
        assert deps["activities"]["message"] is not None
        # §4.3: no items for the activities node (exclude_none omits it).
        assert "items" not in deps["activities"]
        # Row untouched.
        assert api_client.get(f"/api/v1/locations/{location_id}").status_code == 200

    def test_dry_run_all_auto_location_returns_409_tree_row_alive(
        self, api_client, create_location,
    ) -> None:
        """S2(б): dry-run on an all-auto location (location_tags + photos,
        NO activities) → 409 for informed consent; nothing is modified."""
        location = create_location(title="loc-all-auto")
        tag_id = api_client.post(
            "/api/v1/tags", json={"title": f"dry-lt-{location['id'][:8]}"}
        ).json()["id"]
        query_db(
            f"INSERT INTO location_tags (location_id, tag_id) "
            f"VALUES ('{location['id']}', '{tag_id}')"
        )
        photo_id = api_client.post(
            "/api/v1/photos",
            json={"filename": f"dry-loc-{location['id'][:8]}.jpg",
                  "location_id": location["id"]},
        ).json()["id"]

        resp = api_client.request(
            "DELETE", f"/api/v1/locations/{location['id']}",
            params={"dry_run": "true"},
        )

        assert resp.status_code == 409
        body = resp.json()
        assert body["detail"] == "has_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert "activities" not in deps
        assert deps["location_tags"]["count"] == 1
        assert deps["location_tags"]["allowed_actions"] == ["cascade"]
        assert deps["location_tags"]["auto"] is True  # parent perspective (#318 D1)
        assert deps["photos"]["count"] == 1
        assert deps["photos"]["allowed_actions"] == ["nullify"]
        # Nothing modified: location + join + photo link alive.
        assert api_client.get(f"/api/v1/locations/{location['id']}").status_code == 200
        assert query_db(
            f"SELECT location_id FROM photos WHERE id='{photo_id}'"
        )[0]["location_id"] == location["id"]
        assert query_db(f"SELECT * FROM location_tags WHERE location_id='{location['id']}'")

    def test_dry_run_clean_location_returns_204_and_row_alive(
        self, api_client, create_location,
    ) -> None:
        """S2(а): dry-run on a clean location → 204 WITHOUT deleting."""
        location = create_location(title="loc-preview-only")

        resp = api_client.request(
            "DELETE", f"/api/v1/locations/{location['id']}",
            params={"dry_run": "true"},
        )

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/locations/{location['id']}").status_code == 200

    def test_dry_run_unknown_location_returns_404(self, api_client) -> None:
        """S6: dry-run probes existence — missing location → 404."""
        resp = api_client.request(
            "DELETE", "/api/v1/locations/nonexistent-location-id",
            params={"dry_run": "true"},
        )
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "LOCATION_NOT_FOUND"

    def test_dry_run_with_resolutions_body_returns_422(
        self, api_client, create_location,
    ) -> None:
        """S6: dry_run + resolutions → 422; combo checked before the probe."""
        location = create_location(title="loc-combo")

        for location_id in (location["id"], "nonexistent-location-id"):
            resp = api_client.request(
                "DELETE", f"/api/v1/locations/{location_id}",
                params={"dry_run": "true"},
                json={"resolutions": {"location_tags": "cascade"}},
            )
            assert resp.status_code == 422, f"{location_id}: {resp.text}"
            assert resp.json()["detail"] == "dry_run_with_resolutions_forbidden"

        assert api_client.get(f"/api/v1/locations/{location['id']}").status_code == 200

    def test_dry_run_with_expected_only_body_silently_ignored(
        self, api_client, create_location,
    ) -> None:
        """Combinatorics: dry_run + expected-only body → preview proceeds."""
        location = create_location(title="loc-expected-only-preview")

        resp = api_client.request(
            "DELETE", f"/api/v1/locations/{location['id']}",
            params={"dry_run": "true"},
            json={"expected": {}},
        )

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/locations/{location['id']}").status_code == 200

    # ── body commit: existence + expected id-set verification ─────────────

    def test_commit_unknown_location_with_body_returns_404(
        self, api_client,
    ) -> None:
        """S6: nonexistent id WITH body → 404 (probe after the form)."""
        resp = api_client.request(
            "DELETE", "/api/v1/locations/nonexistent-location-id",
            json={"expected": {}},
        )
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "LOCATION_NOT_FOUND"

    def test_commit_clean_location_expected_empty_returns_204(
        self, api_client, create_location,
    ) -> None:
        """S2(а): clean path — ``{expected: {}}`` → 204 hard delete."""
        location = create_location(title="loc-commit-clean")

        resp = api_client.request(
            "DELETE", f"/api/v1/locations/{location['id']}", json={"expected": {}},
        )

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/locations/{location['id']}").status_code == 404

    def test_commit_all_auto_location_expected_empty_executes_204(
        self, api_client, create_location,
    ) -> None:
        """S2(б): all-auto deps (location_tags + photos) + commit
        ``{expected: {}}`` → 204. The tag join rows are cascaded, the photo
        survives with ``location_id IS NULL`` (auto-nullify, GH #211)."""
        location = create_location(title="loc-commit-all-auto")
        tag_id = api_client.post(
            "/api/v1/tags", json={"title": f"cx-lt-{location['id'][:8]}"}
        ).json()["id"]
        query_db(
            f"INSERT INTO location_tags (location_id, tag_id) "
            f"VALUES ('{location['id']}', '{tag_id}')"
        )
        photo_id = api_client.post(
            "/api/v1/photos",
            json={"filename": f"cx-loc-{location['id'][:8]}.jpg",
                  "location_id": location["id"]},
        ).json()["id"]

        resp = api_client.request(
            "DELETE", f"/api/v1/locations/{location['id']}", json={"expected": {}},
        )

        assert resp.status_code == 204, resp.text
        assert api_client.get(f"/api/v1/locations/{location['id']}").status_code == 404
        # Join rows cascaded, TAG row survives (independent entity).
        assert (
            query_db(f"SELECT * FROM location_tags WHERE location_id='{location['id']}'")
            == []
        )
        assert query_db(f"SELECT * FROM tags WHERE id='{tag_id}'")
        # Photo survives, unlinked (location_id IS NULL).
        rows = query_db(f"SELECT location_id FROM photos WHERE id='{photo_id}'")
        assert len(rows) == 1
        assert rows[0]["location_id"] is None

    def test_commit_appeared_activity_returns_409_stale(
        self, api_client, create_master, create_service, create_location,
    ) -> None:
        """S5: an activity that APPEARED after the (clean) dry-run window
        → 409 ``stale_dependencies`` — caught by the expected-subset check
        BEFORE the blocked-422 could fire."""
        from datetime import UTC, datetime, timedelta

        location = create_location(title="loc-race-appeared")

        # Mid-window race: an activity appears via the API.
        api_client.post("/api/v1/activities", json={
            "master_id": create_master()["id"],
            "service_id": create_service()["id"],
            "location_id": location["id"],
            "start": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
            "duration": 90, "capacity": 10, "is_private": False,
        })

        resp = api_client.request(
            "DELETE", f"/api/v1/locations/{location['id']}", json={"expected": {}},
        )

        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["detail"] == "stale_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert deps["activities"]["count"] == 1
        # Nothing deleted.
        assert api_client.get(f"/api/v1/locations/{location['id']}").status_code == 200

    def test_commit_disappeared_activity_subset_passes_204(
        self, api_client, create_activity,
    ) -> None:
        """S5: dep removed mid-window → subset semantics → 204 (delete
        less than confirmed is OK)."""
        activity = create_activity()
        location_id = activity["location_id"]

        # The confirmed activity dies first (its own deferred-delete commit).
        act_resp = api_client.request(
            "DELETE", f"/api/v1/activities/{activity['id']}",
            json={"expected": {}},
        )
        assert act_resp.status_code == 204, act_resp.text

        resp = api_client.request(
            "DELETE", f"/api/v1/locations/{location_id}",
            json={"expected": {"activities": [activity["id"]]}},
        )

        assert resp.status_code == 204, resp.text
        assert api_client.get(f"/api/v1/locations/{location_id}").status_code == 404

    def test_commit_blocked_location_any_body_returns_422(
        self, api_client, create_activity,
    ) -> None:
        """S6: blocked dep (activities) at any body → 422 'archive instead'.

        The expected-check passes (the activity IS confirmed) — the 422
        comes from the resolutions validation inside ``resolve_delete``.
        """
        activity = create_activity()
        location_id = activity["location_id"]

        resp = api_client.request(
            "DELETE", f"/api/v1/locations/{location_id}",
            json={"expected": {"activities": [activity["id"]]}},
        )

        assert resp.status_code == 422, resp.text
        # Row untouched.
        assert api_client.get(f"/api/v1/locations/{location_id}").status_code == 200

    def test_commit_stale_beats_blocked_resolutions_returns_409_not_422(
        self, api_client, create_activity,
    ) -> None:
        """Order pin (#285 D7 mirror): a stale expected → 409 even when
        the resolutions/blocked branch would also 422."""
        activity = create_activity()
        location_id = activity["location_id"]

        resp = api_client.request(
            "DELETE", f"/api/v1/locations/{location_id}",
            json={"expected": {}},  # stale: an activity exists on the server
        )

        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"] == "stale_dependencies"
        assert api_client.get(f"/api/v1/locations/{location_id}").status_code == 200

    def test_commit_unknown_body_keys_silently_ignored(
        self, api_client, create_location,
    ) -> None:
        """S6: unknown body keys (with ``expected`` present) ignored → 204."""
        location = create_location(title="loc-unknown-keys-commit")

        resp = api_client.request(
            "DELETE", f"/api/v1/locations/{location['id']}",
            json={"expected": {}, "bogus_key": "whatever"},
        )

        assert resp.status_code == 204, resp.text
        assert api_client.get(f"/api/v1/locations/{location['id']}").status_code == 404

    def test_commit_swapped_activity_id_returns_409(
        self, api_client, create_activity,
    ) -> None:
        """S5 rev6 mirror: a ghost id at an unchanged counter → 409
        (id-sets, not counters — the swap is caught)."""
        from datetime import UTC, datetime, timedelta
        from uuid import uuid4

        activity = create_activity()
        location_id = activity["location_id"]
        ghost = str(uuid4())

        # Swap: delete the confirmed activity, create another one at the
        # SAME location — the counter stays 1, the id-set does not match.
        act_resp = api_client.request(
            "DELETE", f"/api/v1/activities/{activity['id']}", json={"expected": {}},
        )
        assert act_resp.status_code == 204
        swapped = api_client.post("/api/v1/activities", json={
            "master_id": activity["master_id"],
            "service_id": activity["service_id"],
            "location_id": location_id,
            "start": (datetime.now(UTC) + timedelta(days=2)).isoformat(),
            "duration": 90, "capacity": 10, "is_private": False,
        })
        assert swapped.status_code == 201, swapped.text

        resp = api_client.request(
            "DELETE", f"/api/v1/locations/{location_id}",
            json={"expected": {"activities": [ghost]}},
        )

        assert resp.status_code == 409
        assert resp.json()["detail"] == "stale_dependencies"
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


class TestLocationAllEndpoint:
    """GET /api/v1/locations/all — bare array (GH #205 Task 2).

    Minimal smoke: returns a bare JSON array (not an envelope) containing
    created locations. Full generic contract lands in Task 4.
    """

    def test_all_returns_bare_array(self, api_client, create_location) -> None:
        created = create_location()
        resp = api_client.get("/api/v1/locations/all")
        assert resp.status_code == 200, f"GET /all failed: {resp.text}"
        body = resp.json()
        assert isinstance(body, list), "/all must return a bare array, not an envelope"
        assert any(item["id"] == created["id"] for item in body)


class TestLocationListSorting:
    """Server-side sorting on GET /api/v1/locations (#205 Task 3).

    sort_by whitelist: title, short_title, capacity, address, location_hint,
    description, archived, yandex_map_url, created_at (#172: ``name`` →
    ``title``). sort_order: asc (default) / desc. Unknown sort_by → 422
    (Literal validation).
    Default (sort_by=None): sort_order ASC, title ASC, id ASC (spec §4.4).
    """

    @staticmethod
    def _ids(resp) -> list[str]:
        assert resp.status_code == 200, f"list failed: {resp.text}"
        return [m["id"] for m in resp.json()["items"]]

    def test_sort_title_asc_desc(self, api_client, create_location) -> None:
        """sort_by=title → [title]; asc/desc both differ from default (sort_order)."""
        l1 = create_location(title="Zoo", sort_order=1)
        l2 = create_location(title="Apple", sort_order=0)
        l3 = create_location(title="Moon", sort_order=2)

        asc = self._ids(api_client.get("/api/v1/locations?sort_by=title&sort_order=asc"))
        assert asc.index(l2["id"]) < asc.index(l3["id"]) < asc.index(l1["id"])

        desc = self._ids(api_client.get("/api/v1/locations?sort_by=title&sort_order=desc"))
        assert desc.index(l1["id"]) < desc.index(l3["id"]) < desc.index(l2["id"])

    def test_sort_archived_asc_desc(self, api_client, create_location) -> None:
        """sort_by=archived → [is_active]; asc = archived-first, desc = active-first."""
        arch_a = create_location(title="ArchA", sort_order=0)
        active = create_location(title="Activ", sort_order=1)
        arch_b = create_location(title="ArchB", sort_order=2)
        _archive_location(arch_a["id"])
        _archive_location(arch_b["id"])

        asc = self._ids(api_client.get("/api/v1/locations?status=all&sort_by=archived&sort_order=asc"))
        assert asc.index(arch_a["id"]) < asc.index(active["id"])
        assert asc.index(arch_b["id"]) < asc.index(active["id"])

        desc = self._ids(api_client.get("/api/v1/locations?status=all&sort_by=archived&sort_order=desc"))
        assert desc.index(active["id"]) < desc.index(arch_a["id"])
        assert desc.index(active["id"]) < desc.index(arch_b["id"])

    @pytest.mark.parametrize("key", ["bogus", "name"])
    def test_sort_invalid_key_422(self, api_client, key) -> None:
        """sort_by=bogus / legacy sort_by=name (#172 rename) → 422 Literal validation."""
        resp = api_client.get(f"/api/v1/locations?sort_by={key}")
        assert resp.status_code == 422

    def test_default_order_locked_with_id_tiebreak(self, api_client, create_location) -> None:
        """Default: sort_order ASC, title ASC, id ASC. The id tiebreak is NEW.
        Two locations with same sort_order AND same title → id ASC decides.
        IDs set via query_db to reverse insertion order (RED- deterministic)."""
        l1 = create_location(title="Same", sort_order=0)
        l2 = create_location(title="Same", sort_order=0)
        l1_new = "ffffffff-ffff-ffff-ffff-ffffffffffff"
        l2_new = "00000000-0000-0000-0000-000000000000"
        query_db(f"UPDATE locations SET id='{l1_new}' WHERE id='{l1['id']}'")
        query_db(f"UPDATE locations SET id='{l2_new}' WHERE id='{l2['id']}'")

        ids = self._ids(api_client.get("/api/v1/locations"))
        assert ids == [l2_new, l1_new]  # id ASC: 000... < fff...


# ─── GH #232 Task 2: ?id= set narrowing — universal path (dictionary) ─────────


class TestLocationListIdFilter:
    """``GET /locations?id=X&id=Y`` — the universal ``ArchiveService`` line
    (GH #232 §3.1); locations are the dictionary representative."""

    def test_id_filter_returns_exactly_the_named_locations(
        self, api_client, create_location
    ) -> None:
        first = create_location(title="Uno")
        second = create_location(title="Dos")
        create_location(title="Tres")  # not named → must not surface

        resp = api_client.get(
            "/api/v1/locations",
            params=[("id", first["id"]), ("id", second["id"])],
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert sorted(loc["id"] for loc in body["items"]) == sorted(
            [first["id"], second["id"]]
        )
        assert body["total"] == 2
