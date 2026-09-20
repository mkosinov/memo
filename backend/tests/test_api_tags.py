"""Tests for the Tags CRUD API endpoints."""

import uuid as _uuid
from datetime import UTC, datetime

import pytest

from tests.conftest import query_db, query_db_params

pytestmark = pytest.mark.api


class TestTagAllEndpoint:
    """GET /api/v1/tags/all — bare array (GH #205 Task 2).

    Minimal smoke: returns a bare JSON array (not an envelope) containing
    created tags. Tags have no ``status`` param (non-archive, hard-delete
    only). Full generic contract lands in Task 4.
    """

    def test_all_returns_bare_array(self, api_client, create_tag) -> None:
        created = create_tag()
        resp = api_client.get("/api/v1/tags/all")
        assert resp.status_code == 200, f"GET /all failed: {resp.text}"
        body = resp.json()
        assert isinstance(body, list), "/all must return a bare array, not an envelope"
        assert any(item["id"] == created["id"] for item in body)


class TestTagListSorting:
    """Server-side sorting on GET /api/v1/tags (#205 Task 3).

    sort_by whitelist: title (only key — #172 renamed ``tag`` → ``title``).
    sort_order: asc/desc. Unknown → 422.
    Default (sort_by=None): title ASC, id ASC (spec §4.4).
    """

    @staticmethod
    def _ids(resp) -> list[str]:
        assert resp.status_code == 200, f"list failed: {resp.text}"
        return [t["id"] for t in resp.json()["items"]]

    def test_sort_title_asc_desc(self, api_client, create_tag) -> None:
        """sort_by=title → [title]; asc/desc both differ from insertion order."""
        t_z = create_tag(title="zebra")   # inserted first
        t_a = create_tag(title="apple")
        t_m = create_tag(title="moon")

        asc = self._ids(api_client.get("/api/v1/tags?sort_by=title&sort_order=asc"))
        assert asc.index(t_a["id"]) < asc.index(t_m["id"]) < asc.index(t_z["id"])

        desc = self._ids(api_client.get("/api/v1/tags?sort_by=title&sort_order=desc"))
        assert desc.index(t_z["id"]) < desc.index(t_m["id"]) < desc.index(t_a["id"])

    @pytest.mark.parametrize("key", ["bogus", "tag"])
    def test_sort_invalid_key_422(self, api_client, key) -> None:
        """sort_by=bogus / legacy sort_by=tag (#172 rename) → 422 Literal validation."""
        resp = api_client.get(f"/api/v1/tags?sort_by={key}")
        assert resp.status_code == 422

    def test_default_order_locked(self, api_client, create_tag) -> None:
        """Default (no sort params): title ASC, id ASC (NEW per spec §4.4).
        Insertion order differs from title-ASC so the old unspecified DB
        order (insertion/rowid) would return a different sequence."""
        create_tag(title="banana")  # inserted first
        create_tag(title="apple")

        resp = api_client.get("/api/v1/tags")
        assert resp.status_code == 200
        tags = [t["title"] for t in resp.json()["items"]]
        assert tags == ["apple", "banana"]  # title ASC, not insertion order


# ─── #318 Task 2: unified DELETE contract (records mirror) helpers ─────────────

_JOIN_TABLES: dict[str, str] = {
    # entity key in FK_MATRIX[Tag] → (join table, parent column)
    "service_tags": "services",
    "activity_tags": "activities",
    "master_tags": "masters",
    "location_tags": "locations",
    "client_tags": "clients",
    "visitor_tags": "visitors",
    "record_tags": "records",
    "photo_tags": "photos",
}
# parent-id column per join table (all two-column PKs)
_JOIN_OWNER_COL: dict[str, str] = {
    "service_tags": "service_id",
    "activity_tags": "activity_id",
    "master_tags": "master_id",  # = masters.staff_id (GH #266 retarget)
    "location_tags": "location_id",
    "client_tags": "client_id",
    "visitor_tags": "visitor_id",
    "record_tags": "record_id",
    "photo_tags": "photo_id",
}


def _join_row_counts(tag_id: str) -> dict[str, int]:
    """Current join-row count per tag dependency (direct SQL)."""
    counts = {}
    for entity in _JOIN_TABLES:
        counts[entity] = query_db(
            f"SELECT COUNT(*) AS c FROM {entity} WHERE tag_id='{tag_id}'"
        )[0]["c"]
    return counts


@pytest.fixture
def busy_tag(api_client, create_tag, create_service, create_location,
             create_client, create_activity):
    """A tag linked to ALL 8 join tables (#318 S5 fixture).

    Creates parent rows via API factories where available and raw SQL
    for join inserts (join tables have no API of their own). ``master_tags``
    uses the staff-id retarget (GH #266): ``create_master`` returns a
    /masters-view dict whose ``id`` IS ``masters.staff_id``.
    """
    tag = create_tag(title=f"busy-{_uuid.uuid4().hex[:8]}")

    service = create_service()
    location = create_location()
    client = create_client()
    activity = create_activity()
    master = api_client.post("/api/v1/staff", json={
        "first_name": "Мастер", "last_name": "Теговый",
        "master": {"specialty": "живопись", "color": "#123456"},
    }).json()

    visitor = api_client.post("/api/v1/visitors", json={
        "client_id": client["id"], "name": "Теговый гость", "age": 30,
    }).json()

    record = api_client.post("/api/v1/records", json={
        "activity_id": activity["id"],
        "client_id": client["id"],
        "visits": [],
    }).json()

    # Photo: no factory — direct row (owner-less is allowed, #211).
    # created_at/updated_at supplied explicitly: ORM-level defaults don't
    # fire for raw SQL writes.
    photo_id = str(_uuid.uuid4())
    _now = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")
    query_db_params(
        "INSERT INTO photos (id, filename, is_public, created_at, updated_at) "
        "VALUES (:id, :filename, :is_public, :now, :now)",
        {"id": photo_id, "filename": "busy-tag.jpg", "is_public": 0, "now": _now},
    )

    # Link the tag to all 8 parents.
    links: dict[str, str] = {
        "service_tags": service["id"],
        "activity_tags": activity["id"],
        "master_tags": master["id"],
        "location_tags": location["id"],
        "client_tags": client["id"],
        "visitor_tags": visitor["id"],
        "record_tags": record["id"],
        "photo_tags": photo_id,
    }
    for entity, parent_id in links.items():
        query_db_params(
            f"INSERT INTO {entity} ({_JOIN_OWNER_COL[entity]}, tag_id) "
            f"VALUES (:parent_id, :tag_id)",
            {"parent_id": parent_id, "tag_id": tag["id"]},
        )

    return {"tag": tag, "parents": links, "photo_id": photo_id}


class TestTagDeleteUnifiedRoute:
    """DELETE /api/v1/tags/{id} — unified delete contract (GH #318 D2,
    one-to-one mirror of records.py:322-364 / #285 rev7-rev9).

    Modes:
      * ``?dry_run=true`` — PURE preview: collect_dependencies → empty →
        204 WITHOUT deleting; non-empty → 409 + dependency tree (counters
        + items); missing → 404. Never modifies rows; combined with a
        resolutions body → 422 dry_run_with_resolutions_forbidden
        (checked before the probe).
      * No body, no flag → 422 ``expected_state_required`` — bare DELETE
        is abolished (silent unlinking is impossible, S4).
      * Body ``{resolutions?, expected}`` — the deferred-delete commit:
        existence → collect deps → expected id-set verification (subset
        semantics; all 8 Tag deps are NON-auto — no exemptions) →
        resolutions validation → resolve_delete → 204. Missing → 404.

    All 8 tag deps are cascade + non-auto (D1): ``expected`` must carry
    every confirmed id-set, ``resolutions`` must name every non-zero dep.
    """

    # ── bare DELETE (no flag, no body) → 422 expected_state_required ─────

    def test_bare_delete_busy_tag_returns_422_row_alive(
        self, api_client, busy_tag,
    ) -> None:
        """S4: bare DELETE on an occupied tag → 422, tag AND links alive."""
        tag_id = busy_tag["tag"]["id"]

        resp = api_client.delete(f"/api/v1/tags/{tag_id}")

        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"
        # Tag alive, links untouched (the legacy silent-unlink path is gone).
        assert api_client.get(f"/api/v1/tags/{tag_id}").status_code == 200
        assert all(c == 1 for c in _join_row_counts(tag_id).values())

    def test_bare_delete_clean_tag_returns_422(
        self, api_client, create_tag,
    ) -> None:
        """S4: bare DELETE executes nowhere — even a clean tag refuses."""
        tag = create_tag(title="clean-tag")

        resp = api_client.delete(f"/api/v1/tags/{tag['id']}")

        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"
        assert api_client.get(f"/api/v1/tags/{tag['id']}").status_code == 200

    def test_bare_delete_unknown_id_returns_422_before_404(
        self, api_client,
    ) -> None:
        """S6: form check precedes the existence probe — 422, not 404."""
        resp = api_client.delete("/api/v1/tags/nonexistent-tag-id")
        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"

    def test_delete_resolutions_body_without_expected_returns_422(
        self, api_client, busy_tag,
    ) -> None:
        """S6: resolutions-only body is the rejected legacy shape."""
        tag_id = busy_tag["tag"]["id"]

        resp = api_client.request(
            "DELETE", f"/api/v1/tags/{tag_id}",
            json={"resolutions": {"service_tags": "cascade"}},
        )

        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"
        assert api_client.get(f"/api/v1/tags/{tag_id}").status_code == 200

    # ── ?dry_run=true — pure preview (never modifies rows) ────────────────

    def test_dry_run_busy_tag_returns_409_tree_row_alive(
        self, api_client, busy_tag,
    ) -> None:
        """S8: dry-run on an occupied tag → 409 has_dependencies + tree.

        The tree carries counters AND items (D6) for all 8 non-auto deps;
        neither the tag row nor any link row is modified.
        """
        tag_id = busy_tag["tag"]["id"]
        before = _join_row_counts(tag_id)

        resp = api_client.request(
            "DELETE", f"/api/v1/tags/{tag_id}", params={"dry_run": "true"},
        )

        assert resp.status_code == 409
        body = resp.json()
        assert body["detail"] == "has_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert set(deps) == set(_JOIN_TABLES), "all 8 deps in the tree"
        for entity in _JOIN_TABLES:
            assert deps[entity]["count"] == 1, entity
            assert deps[entity]["allowed_actions"] == ["cascade"], entity
            assert deps[entity]["auto"] is False, entity
            # D6: items one-liners — id is the PARENT id, not the join row.
            items = deps[entity]["items"]
            assert items is not None and len(items) == 1, entity
            assert items[0]["id"] == busy_tag["parents"][entity], entity
            assert items[0]["label"], f"{entity}: non-empty label"
        # PII boundary (D6): no phones in any label.
        for d in deps.values():
            for item in d["items"] or []:
                assert "+7" not in item["label"]
        # Tag alive, all counters unchanged.
        assert api_client.get(f"/api/v1/tags/{tag_id}").status_code == 200
        assert _join_row_counts(tag_id) == before

    def test_dry_run_clean_tag_returns_204_and_row_alive(
        self, api_client, create_tag,
    ) -> None:
        """S8: dry-run on a clean tag → 204 WITHOUT deleting; row alive."""
        tag = create_tag(title="preview-only")

        resp = api_client.request(
            "DELETE", f"/api/v1/tags/{tag['id']}", params={"dry_run": "true"},
        )

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/tags/{tag['id']}").status_code == 200

    def test_dry_run_unknown_tag_returns_404(self, api_client) -> None:
        """S8: dry-run probes existence — missing tag → 404 TAG_NOT_FOUND."""
        resp = api_client.request(
            "DELETE", "/api/v1/tags/nonexistent-tag-id",
            params={"dry_run": "true"},
        )
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "TAG_NOT_FOUND"

    def test_dry_run_with_resolutions_body_returns_422(
        self, api_client, create_tag,
    ) -> None:
        """S6: dry_run + resolutions → 422; combo checked before the probe."""
        tag = create_tag(title="combo-tag")

        for tag_id in (tag["id"], "nonexistent-tag-id"):
            resp = api_client.request(
                "DELETE", f"/api/v1/tags/{tag_id}",
                params={"dry_run": "true"},
                json={"resolutions": {"service_tags": "cascade"}},
            )
            assert resp.status_code == 422, f"{tag_id}: {resp.text}"
            assert resp.json()["detail"] == "dry_run_with_resolutions_forbidden"

        assert api_client.get(f"/api/v1/tags/{tag['id']}").status_code == 200

    def test_dry_run_with_expected_only_body_silently_ignored(
        self, api_client, create_tag,
    ) -> None:
        """Combinatorics: dry_run + expected-only body → preview proceeds."""
        tag = create_tag(title="expected-only-preview")

        resp = api_client.request(
            "DELETE", f"/api/v1/tags/{tag['id']}",
            params={"dry_run": "true"},
            json={"expected": {}},
        )

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/tags/{tag['id']}").status_code == 200

    # ── body commit: existence + expected id-set verification ─────────────

    def test_commit_unknown_tag_with_body_returns_404(
        self, api_client,
    ) -> None:
        """S6: nonexistent id WITH body → 404 (probe after the form)."""
        resp = api_client.request(
            "DELETE", "/api/v1/tags/nonexistent-tag-id",
            json={"expected": {}},
        )
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "TAG_NOT_FOUND"

    def test_commit_clean_tag_expected_empty_returns_204(
        self, api_client, create_tag,
    ) -> None:
        """Clean path: {"expected": {}} → 204 hard delete; tag gone."""
        tag = create_tag(title="commit-clean")

        resp = api_client.request(
            "DELETE", f"/api/v1/tags/{tag['id']}", json={"expected": {}},
        )

        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/tags/{tag['id']}").status_code == 404

    def test_commit_full_resolutions_and_expected_strips_all_links(
        self, api_client, busy_tag,
    ) -> None:
        """S5: all-8 resolutions + expected id-sets → 204; links stripped,
        parent rows intact (incl. photo_tags / visitor_tags / master_tags)."""
        tag_id = busy_tag["tag"]["id"]
        parents = busy_tag["parents"]

        resp = api_client.request(
            "DELETE", f"/api/v1/tags/{tag_id}",
            json={
                "resolutions": {e: "cascade" for e in _JOIN_TABLES},
                "expected": {e: [pid] for e, pid in parents.items()},
            },
        )

        assert resp.status_code == 204, resp.text
        assert api_client.get(f"/api/v1/tags/{tag_id}").status_code == 404
        # All join rows stripped.
        assert all(c == 0 for c in _join_row_counts(tag_id).values())
        # Parent rows intact — including the owner-less photo. Masters PK
        # is staff_id (GH #266 extension table) — the stored id IS staff_id.
        for entity, parent_id in parents.items():
            table = _JOIN_TABLES[entity]  # entity key → parent table
            pk_col = "staff_id" if table == "masters" else "id"
            assert query_db(
                f"SELECT * FROM {table} WHERE {pk_col}='{parent_id}'"
            ), f"{entity} parent must survive"

    def test_commit_partial_expected_appeared_dep_returns_409(
        self, api_client, busy_tag,
    ) -> None:
        """S10: expected covers only some deps → 409 stale_dependencies.

        All 8 Tag deps are non-auto — a dep present on the server but
        absent from ``expected`` is a mid-window race; nothing deleted.
        """
        tag_id = busy_tag["tag"]["id"]
        parents = busy_tag["parents"]
        partial = {
            "service_tags": [parents["service_tags"]],
            "activity_tags": [parents["activity_tags"]],
        }

        resp = api_client.request(
            "DELETE", f"/api/v1/tags/{tag_id}",
            json={
                "resolutions": {e: "cascade" for e in _JOIN_TABLES},
                "expected": partial,
            },
        )

        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["detail"] == "stale_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert deps["service_tags"]["count"] == 1
        # Nothing deleted — tag and links alive.
        assert api_client.get(f"/api/v1/tags/{tag_id}").status_code == 200
        assert all(c == 1 for c in _join_row_counts(tag_id).values())

    def test_commit_swapped_id_same_counter_returns_409(
        self, api_client, busy_tag,
    ) -> None:
        """S10 rev6: ghost id at an unchanged counter → 409 (id-sets,
        not counters)."""
        tag_id = busy_tag["tag"]["id"]
        ghost = str(_uuid.uuid4())

        resp = api_client.request(
            "DELETE", f"/api/v1/tags/{tag_id}",
            json={
                "resolutions": {e: "cascade" for e in _JOIN_TABLES},
                "expected": {
                    "service_tags": [ghost],
                    "activity_tags": [ghost],
                    "master_tags": [ghost],
                    "location_tags": [ghost],
                    "client_tags": [ghost],
                    "visitor_tags": [ghost],
                    "record_tags": [ghost],
                    "photo_tags": [ghost],
                },
            },
        )

        assert resp.status_code == 409
        assert resp.json()["detail"] == "stale_dependencies"
        assert api_client.get(f"/api/v1/tags/{tag_id}").status_code == 200

    def test_commit_dep_disappeared_subset_passes_204(
        self, api_client, busy_tag,
    ) -> None:
        """S10: dep removed mid-window → subset → 204 (delete less is OK).

        expected claims the service link; by commit time the link is gone
        (tag unlinked from the service directly in the DB). The rest is
        confirmed and matches.
        """
        tag_id = busy_tag["tag"]["id"]
        parents = busy_tag["parents"]
        query_db_params(
            "DELETE FROM service_tags WHERE tag_id=:tag_id",
            {"tag_id": tag_id},
        )

        resp = api_client.request(
            "DELETE", f"/api/v1/tags/{tag_id}",
            json={
                "resolutions": {e: "cascade" for e in _JOIN_TABLES},
                "expected": {e: [pid] for e, pid in parents.items()},
            },
        )

        assert resp.status_code == 204, resp.text
        assert api_client.get(f"/api/v1/tags/{tag_id}").status_code == 404

    # ── resolutions validation (family semantics, S6) ──────────────────────

    def test_commit_busy_tag_missing_resolution_returns_422(
        self, api_client, busy_tag,
    ) -> None:
        """Occupied dep without an action → 422; unknown keys ignored —
        so resolutions naming ONE of 8 deps still misses the other 7."""
        tag_id = busy_tag["tag"]["id"]

        resp = api_client.request(
            "DELETE", f"/api/v1/tags/{tag_id}",
            json={
                "resolutions": {"service_tags": "cascade"},
                "expected": {
                    e: [pid] for e, pid in busy_tag["parents"].items()
                },
            },
        )

        assert resp.status_code == 422, resp.text
        # Row untouched.
        assert api_client.get(f"/api/v1/tags/{tag_id}").status_code == 200

    def test_commit_invalid_action_returns_422(
        self, api_client, busy_tag,
    ) -> None:
        """Occupied dep with an action outside allowed_actions → 422.

        Full 8-dep expected + resolutions where one action is bogus
        ("nullify" is not allowed for tag join deps — cascade only).
        """
        tag_id = busy_tag["tag"]["id"]
        resolutions = {e: "cascade" for e in _JOIN_TABLES}
        resolutions["client_tags"] = "nullify"  # not in allowed_actions

        resp = api_client.request(
            "DELETE", f"/api/v1/tags/{tag_id}",
            json={
                "resolutions": resolutions,
                "expected": {
                    e: [pid] for e, pid in busy_tag["parents"].items()
                },
            },
        )

        assert resp.status_code == 422, resp.text
        assert api_client.get(f"/api/v1/tags/{tag_id}").status_code == 200
        assert all(c == 1 for c in _join_row_counts(tag_id).values())

    def test_commit_unknown_body_keys_silently_ignored(
        self, api_client, create_tag,
    ) -> None:
        """S6: unknown body keys ignored → 204 (family semantics §16)."""
        tag = create_tag(title="unknown-keys")

        resp = api_client.request(
            "DELETE", f"/api/v1/tags/{tag['id']}",
            json={"expected": {}, "bogus_key": "whatever"},
        )

        assert resp.status_code == 204, resp.text
        assert api_client.get(f"/api/v1/tags/{tag['id']}").status_code == 404

    # ── stale check runs BEFORE resolutions validation (order pin) ────────

    def test_stale_beats_invalid_resolutions_returns_409_not_422(
        self, api_client, busy_tag,
    ) -> None:
        """Order pin (#285 D7 mirror): a stale expected → 409 even when
        resolutions would also be invalid."""
        tag_id = busy_tag["tag"]["id"]

        resp = api_client.request(
            "DELETE", f"/api/v1/tags/{tag_id}",
            json={
                "resolutions": {"service_tags": "cascade"},  # incomplete
                "expected": {},  # stale: 8 deps exist on the server
            },
        )

        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"] == "stale_dependencies"
        assert api_client.get(f"/api/v1/tags/{tag_id}").status_code == 200
