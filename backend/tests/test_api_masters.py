"""Tests for the Masters CRUD API endpoints."""

import pytest

from tests.conftest import query_db

pytestmark = pytest.mark.api


class TestMasterListStatusFilter:
    """GET /api/v1/masters?status={active|archived|all} archive filtering (GH #195).

    The default (no ``status`` or ``status=active``) returns only active rows.
    These tests exercise the archive capabilities plus query-param validation:

      - ``?status=archived`` → only is_active=False rows
      - ``?status=all`` → both active and archived rows
      - ``?status=active`` → same as default (only active rows)
      - ``?status=foo`` → 422 from FastAPI enum validation
    """

    def test_list_status_archived_returns_only_archived(
        self, api_client, create_master
    ) -> None:
        """?status=archived hides active masters, surfaces soft-deleted ones."""
        active = create_master()
        archived = create_master()
        api_client.delete(f"/api/v1/masters/{archived['id']}")

        resp = api_client.get("/api/v1/masters?status=archived")
        assert resp.status_code == 200, f"list failed: {resp.text}"
        body = resp.json()
        assert body["total"] == 1, f"expected 1 archived, got {body['total']}"
        assert len(body["items"]) == 1
        ids = [m["id"] for m in body["items"]]
        assert archived["id"] in ids
        assert active["id"] not in ids
        assert body["items"][0]["is_active"] is False

    def test_list_status_all_returns_both_active_and_archived(
        self, api_client, create_master
    ) -> None:
        """?status=all returns every master regardless of is_active."""
        active = create_master()
        archived = create_master()
        api_client.delete(f"/api/v1/masters/{archived['id']}")

        resp = api_client.get("/api/v1/masters?status=all")
        assert resp.status_code == 200, f"list failed: {resp.text}"
        body = resp.json()
        assert body["total"] == 2, f"expected 2 total, got {body['total']}"
        ids = [m["id"] for m in body["items"]]
        assert active["id"] in ids
        assert archived["id"] in ids

    def test_list_status_active_explicit_matches_default(
        self, api_client, create_master
    ) -> None:
        """?status=active behaves the same as the default (no query param)."""
        active = create_master()
        archived = create_master()
        api_client.delete(f"/api/v1/masters/{archived['id']}")

        explicit = api_client.get("/api/v1/masters?status=active").json()
        default = api_client.get("/api/v1/masters").json()
        assert explicit["total"] == 1
        assert default["total"] == 1
        assert explicit["items"][0]["id"] == active["id"]
        assert default["items"][0]["id"] == active["id"]

    def test_list_status_invalid_returns_422(self, api_client) -> None:
        """?status=foo (not a valid ArchiveStatus) → 422 from enum validation."""
        resp = api_client.get("/api/v1/masters?status=foo")
        assert resp.status_code == 422


class TestDeleteUnifiedRoute:
    """DELETE /api/v1/masters/{id} — unified dry-run (no body) + execute (with body).

    Spec: docs/specs/2026-08-15-delete-hard-delete-and-dependency-resolution-design.md
      * §2  — Change 1: body presence distinguishes dry-run vs execute.
      * §5  — 409 Conflict response (counters + sums only).
      * §6  — DELETE with resolutions body (executor = Task 10).
      * §14 — acceptance criteria.
    """

    def test_delete_master_with_activities_no_body_returns_409(
        self, api_client, create_activity
    ) -> None:
        """No body + blocking dep (activities) → 409 + dependency tree (spec §5).

        activities is a block dep (allowed_actions=[]); the master row is NOT
        deleted. Currently a bare hard-delete would FK-violate; the dry-run
        short-circuits to 409 before any write.
        """
        activity = create_activity()
        master_id = activity["master_id"]

        resp = api_client.delete(f"/api/v1/masters/{master_id}")

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
        # Row untouched (dry-run modifies nothing).
        assert api_client.get(f"/api/v1/masters/{master_id}").status_code == 200

    def test_delete_bare_master_no_body_returns_204_and_row_gone(
        self, api_client, create_master
    ) -> None:
        """No body + zero deps → 204 hard delete; row physically gone (spec §2)."""
        master = create_master()

        resp = api_client.delete(f"/api/v1/masters/{master['id']}")

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/masters/{master['id']}").status_code == 404

    def test_delete_nonexistent_master_no_body_returns_404(self, api_client) -> None:
        """No body + nonexistent id → 404 (service.delete returns False)."""
        resp = api_client.delete("/api/v1/masters/nonexistent-master-id")
        assert resp.status_code == 404
        body = resp.json()
        assert body["detail"]["code"] == "MASTER_NOT_FOUND"

    def test_delete_master_with_user_and_tags_with_body_executes_204(
        self, api_client, create_master, _user
    ) -> None:
        """With body ``{}`` + all-auto deps (user + tags, NO activities) → 204 execute.

        Auto deps (Master→users §4.1, master_tags) resolve automatically — an
        empty ``{}`` body opts into execute. EXPECTED RED until Task 10 lands
        ``ArchiveService.resolve_delete`` (AttributeError → 500 today).
        """
        master = create_master()
        # Link a User (auto-cascade per §4.1) and a tag (auto-cascade).
        query_db(
            f"UPDATE users SET master_id='{master['id']}' WHERE id='{_user['id']}'"
        )
        tag_resp = api_client.post(
            "/api/v1/tags", json={"tag": f"mt-{master['id'][:8]}"}
        )
        tag_id = tag_resp.json()["id"]
        query_db(
            f"INSERT INTO master_tags (master_id, tag_id) "
            f"VALUES ('{master['id']}', '{tag_id}')"
        )

        resp = api_client.request("DELETE", f"/api/v1/masters/{master['id']}", json={})

        assert resp.status_code == 204
        # Master + linked user + tag join physically gone (Task 10 executor).
        assert api_client.get(f"/api/v1/masters/{master['id']}").status_code == 404
        assert query_db(f"SELECT * FROM users WHERE id='{_user['id']}'") == []
        assert (
            query_db(
                f"SELECT * FROM master_tags WHERE master_id='{master['id']}'"
            )
            == []
        )

    def test_delete_nonexistent_master_with_body_returns_404(self, api_client) -> None:
        """With body + nonexistent id → 404 (executor returns False).

        EXPECTED RED until Task 10 (resolve_delete missing → 500 today).
        """
        resp = api_client.request(
            "DELETE", "/api/v1/masters/nonexistent-master-id", json={"users": "cascade"}
        )
        assert resp.status_code == 404

    def test_delete_master_with_user_and_tags_no_body_returns_409(
        self, api_client, create_master, _user
    ) -> None:
        """No body + Master→users (auto-cascade §4.1) + master_tags (auto) → 409.

        Both deps are AUTO (no user choice — server resolves them automatically
        per spec §6/§16), but the dry-run still surfaces them in the 409 tree
        for INFORMED CONSENT (the user sees the user row + tags will be hard
        deleted, §5). The user's ``resolutions`` body would be ``{}`` here —
        all-auto exec via the with-body path covered by a separate test.

        ``activities`` has count 0 (none seeded) so it is filtered out of the
        tree (§5: zero-count deps are skipped). The dry-run modifies no rows.
        """
        master = create_master()
        query_db(
            f"UPDATE users SET master_id='{master['id']}' WHERE id='{_user['id']}'"
        )
        tag_id = api_client.post(
            "/api/v1/tags", json={"tag": f"mt-{master['id'][:8]}"}
        ).json()["id"]
        query_db(
            f"INSERT INTO master_tags (master_id, tag_id) "
            f"VALUES ('{master['id']}', '{tag_id}')"
        )

        resp = api_client.delete(f"/api/v1/masters/{master['id']}")

        assert resp.status_code == 409
        body = resp.json()
        assert body["detail"] == "has_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        # users dep: auto-cascade (Change 2 §4.1) — shown for consent, no choice.
        assert "users" in deps
        assert deps["users"]["count"] == 1
        assert deps["users"]["allowed_actions"] == ["cascade"]
        # master_tags dep: auto-cascade join table.
        assert "master_tags" in deps
        assert deps["master_tags"]["count"] == 1
        assert deps["master_tags"]["allowed_actions"] == ["cascade"]
        # activities was filtered out (zero count). Row untouched.
        assert "activities" not in deps
        assert api_client.get(f"/api/v1/masters/{master['id']}").status_code == 200

    def test_delete_master_with_activities_with_body_returns_422_blocking(
        self, api_client, create_activity
    ) -> None:
        """With body + blocking dep (activities) → 422 'archive instead' (spec §6.4).

        ``activities`` has ``allowed_actions == []`` — DELETE with body is
        impossible while activities exist; only archive. The route catches
        ``BlockingDepsError`` (a ``ResolutionError`` subtype) → 422.
        """
        activity = create_activity()
        master_id = activity["master_id"]

        resp = api_client.request(
            "DELETE", f"/api/v1/masters/{master_id}", json={}
        )

        assert resp.status_code == 422
        # Row untouched.
        assert api_client.get(f"/api/v1/masters/{master_id}").status_code == 200
