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
    """DELETE /api/v1/materials/{id} — unified delete contract (GH #345,
    one-to-one mirror of ``tags.py:216-300`` / #318 D2).

    Modes (spec §4.1): ``?dry_run=true`` pure preview (409 tree / 204
    clean / 404); bare DELETE and a body without ``expected`` → 422
    ``expected_state_required`` (the form check precedes the probe); body
    ``{resolutions?, expected}`` — the deferred-delete commit → 204.

    Domain matrix (spec §4.4): Material has NO non-auto deps (only the
    auto-cascade ``service_materials`` join) — no blocked state, the
    expected verification is always satisfied by ``{}``.
    """

    # ── bare DELETE (no flag, no body) → 422 expected_state_required ─────

    def test_bare_delete_clean_material_returns_422(
        self, api_client,
    ) -> None:
        """S6: bare DELETE executes nowhere — even a clean material refuses."""
        material = _create_material(api_client, title="mat-clean-bare")

        resp = api_client.delete(f"/api/v1/materials/{material['id']}")

        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"
        assert api_client.get(f"/api/v1/materials/{material['id']}").status_code == 200

    def test_bare_delete_linked_material_returns_422(
        self, api_client, create_service,
    ) -> None:
        """S6: bare DELETE on a linked material → 422, rows alive."""
        mat = _create_material(api_client, title="mat-linked-bare")
        create_service(materials=[{"material_id": mat["id"]}])

        resp = api_client.delete(f"/api/v1/materials/{mat['id']}")

        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"
        assert api_client.get(f"/api/v1/materials/{mat['id']}").status_code == 200

    def test_bare_delete_unknown_id_returns_422_before_404(
        self, api_client,
    ) -> None:
        """S6: form check precedes the existence probe — 422, not 404."""
        resp = api_client.delete("/api/v1/materials/nonexistent-material-id")
        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"

    def test_delete_resolutions_body_without_expected_returns_422(
        self, api_client,
    ) -> None:
        """S6: resolutions-only body is the rejected legacy shape."""
        material = _create_material(api_client, title="mat-res-only")

        resp = api_client.request(
            "DELETE", f"/api/v1/materials/{material['id']}",
            json={"resolutions": {"service_materials": "cascade"}},
        )

        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"
        assert api_client.get(f"/api/v1/materials/{material['id']}").status_code == 200

    def test_delete_unknown_keys_body_without_expected_returns_422(
        self, api_client,
    ) -> None:
        """S6: unknown-keys-only body has no ``expected`` — same 422."""
        material = _create_material(api_client, title="mat-unknown-keys")

        resp = api_client.request(
            "DELETE", f"/api/v1/materials/{material['id']}",
            json={"bogus_key": "whatever"},
        )

        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"
        assert api_client.get(f"/api/v1/materials/{material['id']}").status_code == 200

    # ── ?dry_run=true — pure preview (never modifies rows) ────────────────

    def test_dry_run_clean_material_returns_204_and_row_alive(
        self, api_client,
    ) -> None:
        """S2(а): dry-run on a clean material → 204 WITHOUT deleting."""
        material = _create_material(api_client, title="mat-preview-only")

        resp = api_client.request(
            "DELETE", f"/api/v1/materials/{material['id']}",
            params={"dry_run": "true"},
        )

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/materials/{material['id']}").status_code == 200

    def test_dry_run_linked_material_returns_409_tree_row_alive(
        self, api_client, create_service,
    ) -> None:
        """S2(б): dry-run on a linked material → 409 with the single
        auto-cascade node; nothing is modified."""
        mat = _create_material(api_client, title="mat-dry-linked")
        service = create_service(materials=[{"material_id": mat["id"]}])

        resp = api_client.request(
            "DELETE", f"/api/v1/materials/{mat['id']}",
            params={"dry_run": "true"},
        )

        assert resp.status_code == 409
        body = resp.json()
        assert body["detail"] == "has_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert deps["service_materials"]["count"] == 1
        assert deps["service_materials"]["allowed_actions"] == ["cascade"]
        assert deps["service_materials"]["auto"] is True
        # Dry-run modifies nothing: material + join rows + service alive.
        assert api_client.get(f"/api/v1/materials/{mat['id']}").status_code == 200
        assert (
            len(query_db(f"SELECT * FROM service_materials WHERE material_id='{mat['id']}'"))
            == 1
        )
        assert api_client.get(f"/api/v1/services/{service['id']}").status_code == 200

    def test_dry_run_unknown_material_returns_404(self, api_client) -> None:
        """S6: dry-run probes existence — missing material → 404."""
        resp = api_client.request(
            "DELETE", "/api/v1/materials/nonexistent-material-id",
            params={"dry_run": "true"},
        )
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "MATERIAL_NOT_FOUND"

    def test_dry_run_with_resolutions_body_returns_422(
        self, api_client,
    ) -> None:
        """S6: dry_run + resolutions → 422; combo checked before the probe."""
        material = _create_material(api_client, title="mat-combo")

        for material_id in (material["id"], "nonexistent-material-id"):
            resp = api_client.request(
                "DELETE", f"/api/v1/materials/{material_id}",
                params={"dry_run": "true"},
                json={"resolutions": {"service_materials": "cascade"}},
            )
            assert resp.status_code == 422, f"{material_id}: {resp.text}"
            assert resp.json()["detail"] == "dry_run_with_resolutions_forbidden"

        assert api_client.get(f"/api/v1/materials/{material['id']}").status_code == 200

    def test_dry_run_with_expected_only_body_silently_ignored(
        self, api_client,
    ) -> None:
        """Combinatorics: dry_run + expected-only body → preview proceeds."""
        material = _create_material(api_client, title="mat-expected-only")

        resp = api_client.request(
            "DELETE", f"/api/v1/materials/{material['id']}",
            params={"dry_run": "true"},
            json={"expected": {}},
        )

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/materials/{material['id']}").status_code == 200

    # ── body commit: existence + expected id-set verification ─────────────

    def test_commit_unknown_material_with_body_returns_404(
        self, api_client,
    ) -> None:
        """S6: nonexistent id WITH body → 404 (probe after the form)."""
        resp = api_client.request(
            "DELETE", "/api/v1/materials/nonexistent-material-id",
            json={"expected": {}},
        )
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "MATERIAL_NOT_FOUND"

    def test_commit_clean_material_expected_empty_returns_204(
        self, api_client,
    ) -> None:
        """S2(а): clean path — ``{expected: {}}`` → 204 hard delete."""
        material = _create_material(api_client, title="mat-commit-clean")

        resp = api_client.request(
            "DELETE", f"/api/v1/materials/{material['id']}", json={"expected": {}},
        )

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/materials/{material['id']}").status_code == 404

    def test_commit_linked_material_expected_empty_cascades_links_204(
        self, api_client, create_service,
    ) -> None:
        """S2(б): linked material + commit ``{expected: {}}`` → 204; the
        links cascade, the SERVICE survives with its materials emptied
        (GH #223 §7 — the join rows are the only casualty)."""
        mat = _create_material(api_client, title="mat-commit-linked")
        service = create_service(materials=[{"material_id": mat["id"]}])

        resp = api_client.request(
            "DELETE", f"/api/v1/materials/{mat['id']}", json={"expected": {}},
        )

        assert resp.status_code == 204
        # Material row hard-deleted.
        assert api_client.get(f"/api/v1/materials/{mat['id']}").status_code == 404
        # Join rows gone.
        assert (
            query_db(f"SELECT * FROM service_materials WHERE material_id='{mat['id']}'")
            == []
        )
        # Service survives with materials emptied.
        svc = api_client.get(f"/api/v1/services/{service['id']}")
        assert svc.status_code == 200
        assert svc.json()["materials"] == []

    def test_commit_unknown_body_keys_silently_ignored(
        self, api_client,
    ) -> None:
        """S6: unknown body keys (with ``expected`` present) ignored → 204."""
        material = _create_material(api_client, title="mat-unknown-keys-commit")

        resp = api_client.request(
            "DELETE", f"/api/v1/materials/{material['id']}",
            json={"expected": {}, "bogus_key": "whatever"},
        )

        assert resp.status_code == 204, resp.text
        assert api_client.get(f"/api/v1/materials/{material['id']}").status_code == 404


class TestDeleteExpectedPayloadAllIds:
    """>10 items pin (spec §4.2): ``expected`` carries ALL ids from the
    full dependency tree, not just the rendered top-10 rows.

    Material's only dep is the auto-cascade ``service_materials`` join —
    auto nodes never join the verification, so this pin lives on the
    Service entity (12 activities → a commit confirming ALL 12 id-sets
    must pass the subset check; one missing → 409). See
    ``tests/test_api_services.py::TestDeleteExpectedCarriesAllIds``.
    """

    def test_material_has_no_non_auto_expected_keys(self, api_client) -> None:
        """Material commit never needs a non-empty ``expected`` map."""
        material = _create_material(api_client, title="mat-expected-shape")
        resp = api_client.request(
            "DELETE", f"/api/v1/materials/{material['id']}", json={"expected": {}},
        )
        assert resp.status_code == 204


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


class TestMaterialListSorting:
    """Server-side sorting on GET /api/v1/materials (#205 Task 3).

    sort_by whitelist: title, description, archived, created_at.
    sort_order: asc/desc. Unknown → 422.
    Default (sort_by=None): title ASC, id ASC (spec §4.4 — NEW, was unspecified).
    """

    @staticmethod
    def _ids(resp) -> list[str]:
        assert resp.status_code == 200, f"list failed: {resp.text}"
        return [m["id"] for m in resp.json()["items"]]

    def test_sort_title_asc_desc(self, api_client) -> None:
        """sort_by=title → [title]; asc/desc both differ from insertion order."""
        m_z = _create_material(api_client, title="Zebra")   # inserted first
        m_a = _create_material(api_client, title="Apple")
        m_m = _create_material(api_client, title="Moon")

        asc = self._ids(api_client.get("/api/v1/materials?sort_by=title&sort_order=asc"))
        assert asc.index(m_a["id"]) < asc.index(m_m["id"]) < asc.index(m_z["id"])

        desc = self._ids(api_client.get("/api/v1/materials?sort_by=title&sort_order=desc"))
        assert desc.index(m_z["id"]) < desc.index(m_m["id"]) < desc.index(m_a["id"])

    def test_sort_archived_asc_desc(self, api_client) -> None:
        """sort_by=archived → [is_active]; asc = archived-first, desc = active-first."""
        arch_a = _create_material(api_client, title="ArchA")
        active = _create_material(api_client, title="Activ")
        arch_b = _create_material(api_client, title="ArchB")
        _archive_material(arch_a["id"])
        _archive_material(arch_b["id"])

        asc = self._ids(api_client.get("/api/v1/materials?status=all&sort_by=archived&sort_order=asc"))
        assert asc.index(arch_a["id"]) < asc.index(active["id"])
        assert asc.index(arch_b["id"]) < asc.index(active["id"])

        desc = self._ids(api_client.get("/api/v1/materials?status=all&sort_by=archived&sort_order=desc"))
        assert desc.index(active["id"]) < desc.index(arch_a["id"])
        assert desc.index(active["id"]) < desc.index(arch_b["id"])

    def test_sort_invalid_key_422(self, api_client) -> None:
        """sort_by=bogus → 422 from Literal validation."""
        resp = api_client.get("/api/v1/materials?sort_by=bogus")
        assert resp.status_code == 422

    def test_default_order_locked(self, api_client) -> None:
        """Default (no sort params): title ASC, id ASC (NEW per spec §4.4).
        Insertion order differs from title-ASC so the old unspecified DB
        order (insertion/rowid) would return a different sequence."""
        _create_material(api_client, title="Banana")  # inserted first
        _create_material(api_client, title="Apple")

        resp = api_client.get("/api/v1/materials")
        assert resp.status_code == 200
        titles = [m["title"] for m in resp.json()["items"]]
        assert titles == ["Apple", "Banana"]  # title ASC, not insertion order


class TestUsedInServicesCount:
    """``used_in_services_count`` — canonical usage counter (GH #223 §6).

    One canonical definition: number of **non-archived** services linked to
    the material, regardless of the request's ``status`` slice (the counter
    describes the material, not the requested list). Computed on list / all /
    get / mutation returns via one shared aggregate (no N+1).
    """

    def test_two_linked_active_services_count_2(self, api_client, create_service) -> None:
        """Material linked from two active services → count 2 on GET /{id}."""
        mat = _create_material(api_client, title="Акварель")
        create_service(materials=[{"material_id": mat["id"]}])
        create_service(materials=[{"material_id": mat["id"]}])

        resp = api_client.get(f"/api/v1/materials/{mat['id']}")

        assert resp.status_code == 200
        assert resp.json()["used_in_services_count"] == 2

    def test_count_includes_list_all_and_get(self, api_client, create_service) -> None:
        """The same counter surfaces on list, /all and get paths."""
        mat = _create_material(api_client, title="Гуашь")
        create_service(materials=[{"material_id": mat["id"]}])

        listed = api_client.get("/api/v1/materials").json()
        assert next(m for m in listed["items"] if m["id"] == mat["id"])[
            "used_in_services_count"
        ] == 1

        bare = api_client.get("/api/v1/materials/all").json()
        assert next(m for m in bare if m["id"] == mat["id"])[
            "used_in_services_count"
        ] == 1

        single = api_client.get(f"/api/v1/materials/{mat['id']}").json()
        assert single["used_in_services_count"] == 1

    def test_archiving_linked_service_decrements_count(
        self, api_client, create_service
    ) -> None:
        """Counter decrements when a linked service is archived (spec §11)."""
        mat = _create_material(api_client, title="Пастель")
        s1 = create_service(materials=[{"material_id": mat["id"]}])
        create_service(materials=[{"material_id": mat["id"]}])
        assert api_client.get(f"/api/v1/materials/{mat['id']}").json()[
            "used_in_services_count"
        ] == 2

        resp = api_client.post(f"/api/v1/services/{s1['id']}/archive")

        assert resp.status_code == 200, f"archive service failed: {resp.text}"
        assert api_client.get(f"/api/v1/materials/{mat['id']}").json()[
            "used_in_services_count"
        ] == 1

    def test_no_links_count_0(self, api_client) -> None:
        """Material with no links → 0; create response itself returns 0."""
        created = _create_material(api_client, title="Ничейный")
        assert created["used_in_services_count"] == 0

        resp = api_client.get(f"/api/v1/materials/{created['id']}")
        assert resp.json()["used_in_services_count"] == 0

    def test_count_identical_across_status_slices(
        self, api_client, create_service
    ) -> None:
        """Canonical definition: archived material shows the same counter as
        in the active list (§6 — counter describes the material, not the slice)."""
        mat = _create_material(api_client, title="Архивный материал")
        create_service(materials=[{"material_id": mat["id"]}])
        create_service(materials=[{"material_id": mat["id"]}])
        _archive_material(mat["id"])

        active = api_client.get("/api/v1/materials?status=active").json()
        archived = api_client.get("/api/v1/materials?status=archived").json()
        all_rows = api_client.get("/api/v1/materials?status=all").json()

        def _count(body: dict) -> int | None:
            return next(
                (m["used_in_services_count"] for m in body["items"] if m["id"] == mat["id"]),
                None,
            )

        assert _count(archived) == 2
        assert _count(active) is None  # not in the active slice
        assert _count(all_rows) == 2

    def test_update_patch_and_archive_restore_returns_carry_count(
        self, api_client, create_service
    ) -> None:
        """PUT/PATCH + POST archive|restore responses re-attach the counter."""
        mat = _create_material(api_client, title="Масло")
        create_service(materials=[{"material_id": mat["id"]}])

        put = api_client.put(
            f"/api/v1/materials/{mat['id']}",
            json={"title": "Масло", "description": "обновлено"},
        )
        assert put.status_code == 200, f"PUT failed: {put.text}"
        assert put.json()["used_in_services_count"] == 1

        patch = api_client.patch(
            f"/api/v1/materials/{mat['id']}", json={"title": "Масло про"}
        )
        assert patch.status_code == 200, f"PATCH failed: {patch.text}"
        assert patch.json()["used_in_services_count"] == 1

        archive = api_client.post(f"/api/v1/materials/{mat['id']}/archive")
        assert archive.status_code == 200, f"archive failed: {archive.text}"
        assert archive.json()["used_in_services_count"] == 1

        restore = api_client.post(f"/api/v1/materials/{mat['id']}/restore")
        assert restore.status_code == 200, f"restore failed: {restore.text}"
        assert restore.json()["used_in_services_count"] == 1
