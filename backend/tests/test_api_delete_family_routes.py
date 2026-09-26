"""GH #324 Task 3 — the six DELETE routes' unified contract (smoke level).

Spec §4 order (security-blocker pin, panel rev1) — every route:

1. FORM checks first (no DB access): bare (no flag, no body) → 422
   ``expected_state_required``; ``?dry_run=true`` + ``resolutions`` body →
   422 ``dry_run_with_resolutions_forbidden``.
2. SCOPE-EXISTENCE PROBE — the existing ``*_scoped_or_404`` helpers
   (user_settings: probe-read + own-only 403) — BEFORE any tree building
   and before the dry_run/commit fork: foreign id → 404 in BOTH branches.
3. positions guard: probed row ``is_system`` → 422 ``POSITION_IS_SYSTEM``
   BEFORE the fork (both branches).
4. dry_run → 204 clean / 409 ``has_dependencies`` + tree (mirror tags).
5. commit ``{resolutions?, expected}`` → subset verification → executor
   → 204; appeared dep → 409 ``stale_dependencies`` + live tree.

Task 5 expands this into the full parametrized contract suite; these are
the per-route smokes that drove the implementation.
"""

import uuid as _uuid

import pytest

from tests.conftest import delete_settings_row, query_db, query_db_params

pytestmark = pytest.mark.api

_MISSING_ID = "00000000-0000-0000-0000-000000000000"


# ─── shared helpers ──────────────────────────────────────────────────────────


def _bare(client, url: str):
    return client.delete(url)


def _dry_run(client, url: str, json: dict | None = None):
    return client.request("DELETE", url, params={"dry_run": "true"}, json=json)


def _commit(client, url: str, json: dict):
    return client.request("DELETE", url, json=json)


def _assert_form_422s(client, url: str) -> None:
    """The two FORM rejections — checked before any DB access."""
    resp = _bare(client, url)
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"] == "expected_state_required"
    resp = _dry_run(client, url, {"resolutions": {"whatever": "cascade"}})
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"] == "dry_run_with_resolutions_forbidden"


def _make_visitor(api_client, create_client, name="Гость") -> dict:
    client = create_client()
    resp = api_client.post(
        "/api/v1/visitors", json={"client_id": client["id"], "name": name, "age": 30}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_photo(api_client, tag_ids: list[str] | None = None) -> dict:
    payload: dict = {"filename": f"photo-{_uuid.uuid4().hex[:8]}.jpg"}
    if tag_ids:
        payload["tag_ids"] = tag_ids
    resp = api_client.post("/api/v1/photos", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_position(api_client, title: str = "СММ") -> dict:
    resp = api_client.post("/api/v1/positions", json={"title": title})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _link_position_to_staff(position_id: str) -> str:
    """Direct staff_positions link row → a busy position (no staff API)."""
    staff_id = f"staff-{_uuid.uuid4().hex[:8]}"
    query_db_params(
        "INSERT OR IGNORE INTO staff (id, first_name, last_name, "
        "sort_order, is_active, created_at, updated_at) "
        "VALUES (:id, 'Иван', 'Должностной', 0, 1, "
        "datetime('now'), datetime('now'))",
        {"id": staff_id},
    )
    query_db_params(
        "INSERT INTO staff_positions (staff_id, position_id) VALUES (:staff_id, :position_id)",
        {"staff_id": staff_id, "position_id": position_id},
    )
    return staff_id


def _409_tree_entities(resp) -> dict[str, dict]:
    """Parse a 409 dependencies array into {entity: node}."""
    body = resp.json()
    assert body["detail"] in ("has_dependencies", "stale_dependencies"), body
    return {d["entity"]: d for d in body["dependencies"]}


# ─── visits (leaf) ───────────────────────────────────────────────────────────


class TestVisitDeleteContract:
    """DELETE /api/v1/visits/{id} — leaf: dry_run always 204; commit
    ``{expected: {}}`` keeps the parent-record recompute (spec §4)."""

    def test_form_422s(self, api_client, create_record) -> None:
        visit_id = create_record()["visits"][0]["id"]
        _assert_form_422s(api_client, f"/api/v1/visits/{visit_id}")

    def test_form_precedes_probe_unknown_id(self, api_client) -> None:
        """Form check runs before the probe: unknown id still 422, not 404."""
        resp = _bare(api_client, "/api/v1/visits/nonexistent-id")
        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"

    def test_dry_run_always_204_row_alive(self, api_client, create_record) -> None:
        record = create_record()
        visit_id = record["visits"][0]["id"]
        resp = _dry_run(api_client, f"/api/v1/visits/{visit_id}")
        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/visits/{visit_id}").status_code == 200

    def test_dry_run_unknown_id_404(self, api_client) -> None:
        resp = _dry_run(api_client, f"/api/v1/visits/{_MISSING_ID}")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "VISIT_NOT_FOUND"

    def test_dry_run_foreign_id_404_before_tree(
        self, api_client, create_record, make_master
    ) -> None:
        """Scope probe FIRST — a scoped master gets 404 on a foreign visit
        (same as missing) in the dry_run branch, before any tree work."""
        visit_id = create_record()["visits"][0]["id"]  # admin-owned chain
        master = make_master()  # different staff — the visit is foreign
        resp = _dry_run(master["client"], f"/api/v1/visits/{visit_id}")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "VISIT_NOT_FOUND"

    def test_commit_expected_empty_204_recomputes_parent(self, api_client, create_record) -> None:
        record = create_record()
        visit_id = record["visits"][0]["id"]
        resp = _commit(api_client, f"/api/v1/visits/{visit_id}", json={"expected": {}})
        assert resp.status_code == 204, resp.text
        assert api_client.get(f"/api/v1/visits/{visit_id}").status_code == 404
        # Parent recompute preserved (spec §4: visit.py:179-180 semantics).
        updated = api_client.get(f"/api/v1/records/{record['id']}").json()
        assert updated["seats"] == record["seats"] - 1

    def test_commit_foreign_id_404(self, api_client, create_record, make_master) -> None:
        visit_id = create_record()["visits"][0]["id"]
        master = make_master()
        resp = _commit(master["client"], f"/api/v1/visits/{visit_id}", json={"expected": {}})
        assert resp.status_code == 404
        # Row untouched by the foreign attempt.
        assert api_client.get(f"/api/v1/visits/{visit_id}").status_code == 200


# ─── payments (leaf) ─────────────────────────────────────────────────────────


class TestPaymentDeleteContract:
    """DELETE /api/v1/payments/{id} — leaf, no recompute (spec §4)."""

    def _make(self, api_client, create_record) -> dict:
        record = create_record()
        resp = api_client.post(
            "/api/v1/payments",
            json={"record_id": record["id"], "amount": 1500, "method": "card"},
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    def test_form_422s(self, api_client, create_record) -> None:
        payment = self._make(api_client, create_record)
        _assert_form_422s(api_client, f"/api/v1/payments/{payment['id']}")

    def test_dry_run_always_204_row_alive(self, api_client, create_record) -> None:
        payment = self._make(api_client, create_record)
        resp = _dry_run(api_client, f"/api/v1/payments/{payment['id']}")
        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/payments/{payment['id']}").status_code == 200

    def test_dry_run_unknown_and_foreign_404(self, api_client, create_record, make_master) -> None:
        assert _dry_run(api_client, f"/api/v1/payments/{_MISSING_ID}").status_code == 404
        payment = self._make(api_client, create_record)
        master = make_master()
        resp = _dry_run(master["client"], f"/api/v1/payments/{payment['id']}")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "PAYMENT_NOT_FOUND"

    def test_commit_expected_empty_204(self, api_client, create_record) -> None:
        payment = self._make(api_client, create_record)
        resp = _commit(api_client, f"/api/v1/payments/{payment['id']}", json={"expected": {}})
        assert resp.status_code == 204, resp.text
        assert api_client.get(f"/api/v1/payments/{payment['id']}").status_code == 404


# ─── user_settings (leaf, own-only) ──────────────────────────────────────────


class TestUserSettingsDeleteContract:
    """DELETE /api/v1/user-settings/{id} — leaf; probe-read + own-only 403
    (spec §4.2) before the fork."""

    def _make(self, api_client) -> dict:
        """The session user's settings row.

        GH #319/#377 guarantee: every live user already HAS a row — POST
        would hit the unique constraint. Drop the guaranteed row first
        (the ``test_api_user_settings.py`` §5.5 anomaly pattern), then
        POST is a clean 201 again.
        """
        me = api_client.get("/api/v1/auth/me").json()["user"]["id"]
        delete_settings_row(me)
        resp = api_client.post("/api/v1/user-settings", json={"user_id": me})
        assert resp.status_code == 201, resp.text
        return resp.json()

    def test_form_422s(self, api_client) -> None:
        settings = self._make(api_client)
        _assert_form_422s(api_client, f"/api/v1/user-settings/{settings['id']}")

    def test_dry_run_204_row_alive(self, api_client) -> None:
        settings = self._make(api_client)
        resp = _dry_run(api_client, f"/api/v1/user-settings/{settings['id']}")
        assert resp.status_code == 204
        assert api_client.get("/api/v1/user-settings").status_code == 200

    def test_dry_run_unknown_id_404(self, api_client) -> None:
        resp = _dry_run(api_client, f"/api/v1/user-settings/{_MISSING_ID}")
        assert resp.status_code == 404

    def test_commit_expected_empty_204(self, api_client) -> None:
        settings = self._make(api_client)
        resp = _commit(
            api_client,
            f"/api/v1/user-settings/{settings['id']}",
            json={"expected": {}},
        )
        assert resp.status_code == 204, resp.text
        # GH #319/#377: GET is get-or-create — the committed row is gone
        # and a fresh defaults row comes back (a NEW id, never 404).
        recreated = api_client.get("/api/v1/user-settings")
        assert recreated.status_code == 200
        assert recreated.json()["id"] != settings["id"]

    def test_foreign_row_403_in_both_branches(self, api_client, login_as) -> None:
        """Own-only: another user's settings row → 403 AUTH_FORBIDDEN,
        probe+ownership BEFORE the fork (dry_run AND commit)."""
        from src.auth.passwords import hash_password
        from tests.conftest import insert_user

        settings = self._make(api_client)
        other = insert_user(
            f"+7999{_uuid.uuid4().int % 99999999:08d}",
            hash_password("other-pass-1"),
        )
        other_client = login_as(other["phone"], "other-pass-1")

        url = f"/api/v1/user-settings/{settings['id']}"
        resp = _dry_run(other_client, url)
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "AUTH_FORBIDDEN"
        resp = _commit(other_client, url, json={"expected": {}})
        assert resp.status_code == 403
        # Row survives the foreign attempts.
        assert api_client.get("/api/v1/user-settings").status_code == 200


# ─── photos (dependent: photo_tags) ──────────────────────────────────────────


class TestPhotoDeleteContract:
    """DELETE /api/v1/photos/{id} — tagged → dry_run 409 (node «Тег»);
    commit ``{expected: {photo_tags}}``; clean → leaf behavior (spec §4)."""

    def test_form_422s(self, api_client) -> None:
        photo = _make_photo(api_client)
        _assert_form_422s(api_client, f"/api/v1/photos/{photo['id']}")

    def test_dry_run_clean_204_row_alive(self, api_client) -> None:
        photo = _make_photo(api_client)
        resp = _dry_run(api_client, f"/api/v1/photos/{photo['id']}")
        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/photos/{photo['id']}").status_code == 200

    def test_dry_run_tagged_409_tree_row_alive(self, api_client, create_tag) -> None:
        tag = create_tag(title="фото-тег")
        photo = _make_photo(api_client, tag_ids=[tag["id"]])

        resp = _dry_run(api_client, f"/api/v1/photos/{photo['id']}")

        assert resp.status_code == 409
        deps = _409_tree_entities(resp)
        assert set(deps) == {"photo_tags"}
        node = deps["photo_tags"]
        assert node["relation"] == "Тег"
        assert node["count"] == 1
        assert node["allowed_actions"] == ["cascade"]
        assert node["items"] and node["items"][0]["id"] == tag["id"]
        # Preview modifies nothing.
        assert api_client.get(f"/api/v1/photos/{photo['id']}").status_code == 200

    def test_dry_run_unknown_and_foreign_404(self, api_client, make_master) -> None:
        assert _dry_run(api_client, f"/api/v1/photos/{_MISSING_ID}").status_code == 404
        photo = _make_photo(api_client)  # owner-less → invisible to a scoped master
        master = make_master()
        resp = _dry_run(master["client"], f"/api/v1/photos/{photo['id']}")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "PHOTO_NOT_FOUND"

    def test_commit_clean_expected_empty_204(self, api_client) -> None:
        photo = _make_photo(api_client)
        resp = _commit(api_client, f"/api/v1/photos/{photo['id']}", json={"expected": {}})
        assert resp.status_code == 204, resp.text
        assert api_client.get(f"/api/v1/photos/{photo['id']}").status_code == 404

    def test_commit_tagged_strips_links_tag_survives(self, api_client, create_tag) -> None:
        tag = create_tag(title="останься-тег")
        photo = _make_photo(api_client, tag_ids=[tag["id"]])

        resp = _commit(
            api_client,
            f"/api/v1/photos/{photo['id']}",
            json={
                "resolutions": {"photo_tags": "cascade"},
                "expected": {"photo_tags": [tag["id"]]},
            },
        )

        assert resp.status_code == 204, resp.text
        assert api_client.get(f"/api/v1/photos/{photo['id']}").status_code == 404
        # The tag dictionary row survives — only the link died.
        assert api_client.get(f"/api/v1/tags/{tag['id']}").status_code == 200
        assert query_db(f"SELECT * FROM photo_tags WHERE photo_id='{photo['id']}'") == []

    def test_commit_stale_dep_appeared_409(self, api_client, create_tag) -> None:
        """A link confirmed at dry-run time plus one that appeared after →
        subset violation → 409 stale_dependencies + live tree."""
        tag = create_tag(title="подтверждённый")
        photo = _make_photo(api_client, tag_ids=[tag["id"]])
        extra = create_tag(title="появившийся")
        query_db_params(
            "INSERT INTO photo_tags (photo_id, tag_id) VALUES (:p, :t)",
            {"p": photo["id"], "t": extra["id"]},
        )

        resp = _commit(
            api_client,
            f"/api/v1/photos/{photo['id']}",
            json={
                "resolutions": {"photo_tags": "cascade"},
                "expected": {"photo_tags": [tag["id"]]},  # misses `extra`
            },
        )

        assert resp.status_code == 409
        deps = _409_tree_entities(resp)
        assert deps["photo_tags"]["count"] == 2  # live tree
        # Nothing deleted.
        assert api_client.get(f"/api/v1/photos/{photo['id']}").status_code == 200


# ─── visitors (dependent: visits + visitor_tags) ─────────────────────────────


class TestVisitorDeleteContract:
    """DELETE /api/v1/visitors/{id} — with visits → dry_run 409 (node
    «Посещение»); commit ``{expected: {visits, visitor_tags}}``; clean →
    leaf (spec §4)."""

    def _visitor_with_visit(self, api_client, create_client, create_record) -> dict:
        visitor = _make_visitor(api_client, create_client, "С визитом")
        record = create_record(
            visits=[{"visitor_id": visitor["id"], "price": 1000, "status": "waiting"}]
        )
        assert record["visits"][0]["visitor_id"] == visitor["id"]
        return {"visitor": visitor, "record": record, "visit": record["visits"][0]}

    def test_form_422s(self, api_client, create_client) -> None:
        visitor = _make_visitor(api_client, create_client)
        _assert_form_422s(api_client, f"/api/v1/visitors/{visitor['id']}")

    def test_dry_run_clean_204_row_alive(self, api_client, create_client) -> None:
        visitor = _make_visitor(api_client, create_client)
        resp = _dry_run(api_client, f"/api/v1/visitors/{visitor['id']}")
        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/visitors/{visitor['id']}").status_code == 200

    def test_dry_run_with_visits_409_tree(self, api_client, create_client, create_record) -> None:
        made = self._visitor_with_visit(api_client, create_client, create_record)

        resp = _dry_run(api_client, f"/api/v1/visitors/{made['visitor']['id']}")

        assert resp.status_code == 409
        deps = _409_tree_entities(resp)
        assert set(deps) == {"visits"}
        node = deps["visits"]
        assert node["relation"] == "Посещение"
        assert node["count"] == 1
        assert node["allowed_actions"] == ["cascade"]
        assert node["items"][0]["id"] == made["visit"]["id"]
        # Preview modifies nothing.
        assert api_client.get(f"/api/v1/visitors/{made['visitor']['id']}").status_code == 200

    def test_dry_run_unknown_and_foreign_404(self, api_client, create_client, make_master) -> None:
        assert _dry_run(api_client, f"/api/v1/visitors/{_MISSING_ID}").status_code == 404
        visitor = _make_visitor(api_client, create_client)  # no visits → invisible
        master = make_master()
        resp = _dry_run(master["client"], f"/api/v1/visitors/{visitor['id']}")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "VISITOR_NOT_FOUND"

    def test_commit_with_visits_cascades_and_recomputes_records(
        self, api_client, create_client, create_record
    ) -> None:
        """Commit with resolutions+expected → visitor AND visits gone,
        join rows stripped, the parent record's seats/status recomputed."""
        made = self._visitor_with_visit(api_client, create_client, create_record)
        record_id = made["record"]["id"]
        seats_before = api_client.get(f"/api/v1/records/{record_id}").json()["seats"]
        assert seats_before == 1

        resp = _commit(
            api_client,
            f"/api/v1/visitors/{made['visitor']['id']}",
            json={
                "resolutions": {"visits": "cascade"},
                "expected": {"visits": [made["visit"]["id"]], "visitor_tags": []},
            },
        )

        assert resp.status_code == 204, resp.text
        assert api_client.get(f"/api/v1/visitors/{made['visitor']['id']}").status_code == 404
        assert query_db(f"SELECT * FROM visits WHERE id='{made['visit']['id']}'") == []
        # Parent record recomputed: the seat is freed.
        updated = api_client.get(f"/api/v1/records/{record_id}").json()
        assert updated["seats"] == seats_before - 1

    def test_commit_stale_visit_appeared_409(
        self, api_client, create_client, create_record
    ) -> None:
        made = self._visitor_with_visit(api_client, create_client, create_record)
        # A second visit appears mid-window — absent from expected.
        record2 = create_record(
            visits=[{"visitor_id": made["visitor"]["id"], "price": 500, "status": "waiting"}]
        )

        resp = _commit(
            api_client,
            f"/api/v1/visitors/{made['visitor']['id']}",
            json={
                "resolutions": {"visits": "cascade"},
                "expected": {"visits": [made["visit"]["id"]]},
            },
        )

        assert resp.status_code == 409
        deps = _409_tree_entities(resp)
        assert deps["visits"]["count"] == 2  # live tree
        assert api_client.get(f"/api/v1/visitors/{made['visitor']['id']}").status_code == 200
        assert query_db(f"SELECT * FROM records WHERE id='{record2['id']}'")


# ─── positions (dependent: staff_positions; is_system guard) ─────────────────


class TestPositionDeleteContract:
    """DELETE /api/v1/positions/{id} — busy → dry_run 409 (node «Сотрудник»);
    commit ``{expected: {staff_positions}}``; system → 422 BEFORE the fork
    (both branches) (spec §4)."""

    def test_form_422s(self, api_client) -> None:
        position = _make_position(api_client)
        _assert_form_422s(api_client, f"/api/v1/positions/{position['id']}")

    def test_dry_run_clean_204_row_alive(self, api_client) -> None:
        position = _make_position(api_client)
        resp = _dry_run(api_client, f"/api/v1/positions/{position['id']}")
        assert resp.status_code == 204
        assert api_client.get(f"/api/v1/positions/{position['id']}").status_code == 200

    def test_dry_run_busy_409_staff_node(self, api_client) -> None:
        position = _make_position(api_client)
        _link_position_to_staff(position["id"])

        resp = _dry_run(api_client, f"/api/v1/positions/{position['id']}")

        assert resp.status_code == 409
        deps = _409_tree_entities(resp)
        assert set(deps) == {"staff_positions"}
        node = deps["staff_positions"]
        assert node["relation"] == "Сотрудник"
        assert node["count"] == 1
        assert node["allowed_actions"] == ["cascade"]
        # Preview modifies nothing.
        assert api_client.get(f"/api/v1/positions/{position['id']}").status_code == 200

    def test_dry_run_unknown_id_404(self, api_client) -> None:
        resp = _dry_run(api_client, "/api/v1/positions/nonexistent-position")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "POSITION_NOT_FOUND"

    def test_system_position_422_before_fork(self, api_client) -> None:
        """is_system → 422 POSITION_IS_SYSTEM in BOTH branches — the guard
        runs BEFORE the dry_run/commit fork (spec §4.3)."""
        query_db_params(
            "INSERT INTO positions (id, title, is_system, created_at, updated_at) "
            "VALUES ('master', 'Мастер', 1, datetime('now'), datetime('now'))"
        )
        resp = _dry_run(api_client, "/api/v1/positions/master")
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "POSITION_IS_SYSTEM"
        resp = _commit(api_client, "/api/v1/positions/master", json={"expected": {}})
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "POSITION_IS_SYSTEM"
        assert api_client.get("/api/v1/positions/master").status_code == 200

    def test_commit_clean_expected_empty_204(self, api_client) -> None:
        position = _make_position(api_client)
        resp = _commit(
            api_client,
            f"/api/v1/positions/{position['id']}",
            json={"expected": {}},
        )
        assert resp.status_code == 204, resp.text
        assert api_client.get(f"/api/v1/positions/{position['id']}").status_code == 404

    def test_commit_busy_strips_links_staff_survives(self, api_client) -> None:
        position = _make_position(api_client)
        staff_id = _link_position_to_staff(position["id"])

        resp = _commit(
            api_client,
            f"/api/v1/positions/{position['id']}",
            json={
                "resolutions": {"staff_positions": "cascade"},
                "expected": {"staff_positions": [staff_id]},
            },
        )

        assert resp.status_code == 204, resp.text
        assert api_client.get(f"/api/v1/positions/{position['id']}").status_code == 404
        # The staff card survives — only the link died.
        assert query_db(f"SELECT * FROM staff WHERE id='{staff_id}'")
        assert query_db(f"SELECT * FROM staff_positions WHERE position_id='{position['id']}'") == []

    def test_commit_stale_holder_appeared_409(self, api_client) -> None:
        position = _make_position(api_client)
        _link_position_to_staff(position["id"])  # confirmed at dry-run time
        ghost = _link_position_to_staff(position["id"])  # appeared mid-window

        resp = _commit(
            api_client,
            f"/api/v1/positions/{position['id']}",
            json={
                "resolutions": {"staff_positions": "cascade"},
                "expected": {"staff_positions": [ghost]},  # misses the first
            },
        )

        assert resp.status_code == 409
        deps = _409_tree_entities(resp)
        assert deps["staff_positions"]["count"] == 2  # live tree
        assert api_client.get(f"/api/v1/positions/{position['id']}").status_code == 200
