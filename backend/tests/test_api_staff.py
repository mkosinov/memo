"""Tests for the staff/positions API + read-only masters view (GH #266 T4).

Covers the HTTP surface of the restructuring (spec «API (после)»,
domain-rules/staff.md):

* ``/api/v1/staff`` — full directory CRUD: paginated list (status/q/sort),
  bare ``/all``, get (incl. archived), create (card + master section +
  positions + account flag), PUT/PATCH (atomic), DELETE (GH #345 unified
  deferred-delete contract — dry_run preview / commit body with
  ``expected``), archive/restore (D6 checkboxes).
* ``/api/v1/positions`` — dictionary CRUD + ``is_system`` guard.
* ``/api/v1/masters`` — READ-ONLY view over staff+masters (``is_active``
  masters only; ``id`` = staff_id); no mutations, no ``/{id}``.
"""

import uuid as _uuid

import pytest

from tests.conftest import query_db

pytestmark = pytest.mark.api

MASTER_SECTION = {"specialty": "живопись", "color": "#5B8C7A"}


def _create_payload(**overrides) -> dict:
    payload = {"first_name": "Ольга", "last_name": "Иванова", **overrides}
    return payload


def _staff_flags(staff_id: str) -> tuple[int, int | None, int | None]:
    """(staff.is_active, masters.is_active, users.is_active) — DB truth."""
    staff = query_db(f"SELECT is_active FROM staff WHERE id='{staff_id}'")
    master = query_db(
        f"SELECT is_active FROM masters WHERE staff_id='{staff_id}'"
    )
    user = query_db(f"SELECT is_active FROM users WHERE staff_id='{staff_id}'")
    return (
        staff[0]["is_active"],
        master[0]["is_active"] if master else None,
        user[0]["is_active"] if user else None,
    )


def _seed_position(title: str = "СММ", **overrides) -> str:
    """Insert a dictionary row directly; return its id."""
    pos_id = overrides.pop("id", f"pos-{_uuid.uuid4().hex[:8]}")
    query_db(
        f"INSERT INTO positions (id, title, is_system, created_at, updated_at) "
        f"VALUES ('{pos_id}', '{title}', 0, datetime('now'), datetime('now'))"
    )
    return pos_id


def _link_master_tag(staff_id: str) -> str:
    """Link a tag to the master extension row (master_tags join)."""
    tag_id = f"tag-{_uuid.uuid4().hex[:8]}"
    query_db(
        f"INSERT INTO tags (id, title, created_at, updated_at) "
        f"VALUES ('{tag_id}', 't-{staff_id[:6]}', datetime('now'), datetime('now'))"
    )
    query_db(
        f"INSERT INTO master_tags (master_id, tag_id) "
        f"VALUES ('{staff_id}', '{tag_id}')"
    )
    return tag_id


class TestStaffCrud:
    """POST/GET/PUT/PATCH on /api/v1/staff — the composite card contract."""

    def test_create_plain_card(self, api_client) -> None:
        resp = api_client.post("/api/v1/staff", json=_create_payload())
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["first_name"] == "Ольга"
        assert body["last_name"] == "Иванова"
        assert body["master"] is None
        assert body["position_ids"] == []
        assert body["archived"] is False

    def test_create_with_master_section(self, api_client) -> None:
        resp = api_client.post(
            "/api/v1/staff",
            json=_create_payload(master=MASTER_SECTION),
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["master"]["specialty"] == "живопись"
        assert body["master"]["color"] == "#5B8C7A"
        assert body["master"]["archived"] is False
        # masters row exists with staff_id = card id
        rows = query_db(
            f"SELECT * FROM masters WHERE staff_id='{body['id']}'"
        )
        assert len(rows) == 1
        assert rows[0]["specialty"] == "живопись"

    def test_create_with_positions(self, api_client) -> None:
        pos_id = _seed_position("СММ")
        resp = api_client.post(
            "/api/v1/staff",
            json=_create_payload(position_ids=[pos_id]),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["position_ids"] == [pos_id]
        links = query_db(
            f"SELECT position_id FROM staff_positions "
            f"WHERE staff_id='{resp.json()['id']}'"
        )
        assert [row["position_id"] for row in links] == [pos_id]

    def test_create_with_unknown_position_returns_422(self, api_client) -> None:
        resp = api_client.post(
            "/api/v1/staff",
            json=_create_payload(position_ids=["no-such-position"]),
        )
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "POSITION_NOT_FOUND"

    def test_create_with_user_account(self, api_client) -> None:
        resp = api_client.post(
            "/api/v1/staff",
            json=_create_payload(
                master=MASTER_SECTION,
                create_user={"phone": "+79995556677", "password": "pw-master-1"},
            ),
        )
        assert resp.status_code == 201, resp.text
        users = query_db(
            "SELECT phone, role, staff_id FROM users "
            "WHERE phone='+79995556677'"
        )
        assert len(users) == 1
        assert users[0]["role"] == "master"  # card WITH master section
        assert users[0]["staff_id"] == resp.json()["id"]

    def test_create_user_without_master_section_gets_admin_role(
        self, api_client
    ) -> None:
        resp = api_client.post(
            "/api/v1/staff",
            json=_create_payload(
                create_user={"phone": "+79995556678", "password": "pw-admin-1"},
            ),
        )
        assert resp.status_code == 201, resp.text
        users = query_db(
            "SELECT role FROM users WHERE phone='+79995556678'"
        )
        assert users[0]["role"] == "admin"

    def test_get_includes_archived(self, api_client) -> None:
        created = api_client.post("/api/v1/staff", json=_create_payload()).json()
        query_db(
            f"UPDATE staff SET is_active=0 WHERE id='{created['id']}'"
        )
        resp = api_client.get(f"/api/v1/staff/{created['id']}")
        assert resp.status_code == 200
        assert resp.json()["archived"] is True

    def test_get_nonexistent_returns_404_staff_not_found(
        self, api_client
    ) -> None:
        resp = api_client.get("/api/v1/staff/nonexistent-id")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "STAFF_NOT_FOUND"

    def test_put_updates_card_and_sections_atomically(
        self, api_client
    ) -> None:
        pos_old = _seed_position("Старая")
        pos_new = _seed_position("Новая")
        created = api_client.post(
            "/api/v1/staff",
            json=_create_payload(
                master=MASTER_SECTION, position_ids=[pos_old]
            ),
        ).json()

        resp = api_client.put(
            f"/api/v1/staff/{created['id']}",
            json=_create_payload(
                first_name="Ольга2",
                master={"specialty": "керамика", "color": "#123456"},
                position_ids=[pos_new],
            ),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["first_name"] == "Ольга2"
        assert body["master"]["specialty"] == "керамика"
        assert body["master"]["color"] == "#123456"
        assert body["position_ids"] == [pos_new]
        links = query_db(
            f"SELECT position_id FROM staff_positions "
            f"WHERE staff_id='{created['id']}'"
        )
        assert [row["position_id"] for row in links] == [pos_new]

    def test_put_null_master_removes_section(self, api_client) -> None:
        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()
        resp = api_client.put(
            f"/api/v1/staff/{created['id']}",
            json=_create_payload(first_name="Имя", last_name="Фамилия"),
        )
        assert resp.status_code == 200
        assert resp.json()["master"] is None
        assert query_db(
            f"SELECT * FROM masters WHERE staff_id='{created['id']}'"
        ) == []

    def test_patch_partial_keeps_unsent_sections(self, api_client) -> None:
        pos_id = _seed_position("СММ")
        created = api_client.post(
            "/api/v1/staff",
            json=_create_payload(
                master=MASTER_SECTION, position_ids=[pos_id]
            ),
        ).json()

        resp = api_client.patch(
            f"/api/v1/staff/{created['id']}", json={"first_name": "Патч"}
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["first_name"] == "Патч"
        assert body["last_name"] == "Иванова"  # unsent → kept
        assert body["master"]["specialty"] == "живопись"  # kept
        assert body["position_ids"] == [pos_id]  # kept

    def test_patch_null_master_removes_section(self, api_client) -> None:
        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()
        resp = api_client.patch(
            f"/api/v1/staff/{created['id']}", json={"master": None}
        )
        assert resp.status_code == 200
        assert resp.json()["master"] is None

    def test_put_nonexistent_returns_404(self, api_client) -> None:
        resp = api_client.put(
            "/api/v1/staff/nonexistent-id",
            json=_create_payload(),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "STAFF_NOT_FOUND"

    def test_put_rejects_is_active(self, api_client) -> None:
        """Archive lifecycle is NOT settable via PUT (#178/#207 pattern)."""
        created = api_client.post("/api/v1/staff", json=_create_payload()).json()
        resp = api_client.put(
            f"/api/v1/staff/{created['id']}",
            json=_create_payload(is_active=False),
        )
        assert resp.status_code == 422

    def test_master_section_requires_specialty(self, api_client) -> None:
        resp = api_client.post(
            "/api/v1/staff",
            json=_create_payload(master={"specialty": "", "color": "#5B8C7A"}),
        )
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "SPECIALTY_REQUIRED"

    def test_master_section_requires_color(self, api_client) -> None:
        resp = api_client.post(
            "/api/v1/staff",
            json=_create_payload(master={"specialty": "живопись", "color": ""}),
        )
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "COLOR_REQUIRED"


class TestStaffList:
    """GET /api/v1/staff — pagination/status/q/sort (GH #205 → staff)."""

    def test_list_returns_paginated_envelope(self, api_client) -> None:
        api_client.post("/api/v1/staff", json=_create_payload())
        resp = api_client.get("/api/v1/staff")
        assert resp.status_code == 200
        body = resp.json()
        assert set(body) == {"items", "total", "page", "per_page"}
        assert body["total"] == 1
        assert body["items"][0]["first_name"] == "Ольга"

    def test_list_status_archived(self, api_client) -> None:
        api_client.post("/api/v1/staff", json=_create_payload())
        archived = api_client.post(
            "/api/v1/staff", json=_create_payload(first_name="Архив")
        ).json()
        query_db(f"UPDATE staff SET is_active=0 WHERE id='{archived['id']}'")

        resp = api_client.get("/api/v1/staff?status=archived")
        ids = [m["id"] for m in resp.json()["items"]]
        assert ids == [archived["id"]]
        assert resp.json()["items"][0]["archived"] is True

        resp_all = api_client.get("/api/v1/staff?status=all")
        assert resp_all.json()["total"] == 2

    def test_list_status_invalid_422(self, api_client) -> None:
        assert (
            api_client.get("/api/v1/staff?status=foo").status_code == 422
        )

    def test_list_search_by_first_name(self, api_client) -> None:
        api_client.post("/api/v1/staff", json=_create_payload())
        api_client.post(
            "/api/v1/staff", json=_create_payload(first_name="Живописец")
        )
        resp = api_client.get("/api/v1/staff?q=живопис")
        assert resp.status_code == 200
        assert resp.json()["total"] == 1
        assert resp.json()["items"][0]["first_name"] == "Живописец"

    def test_list_search_by_last_name(self, api_client) -> None:
        api_client.post("/api/v1/staff", json=_create_payload())
        api_client.post(
            "/api/v1/staff",
            json=_create_payload(last_name="Живописный", first_name="Иван"),
        )
        resp = api_client.get("/api/v1/staff?q=Живописный".lower())
        assert resp.status_code == 200
        assert resp.json()["total"] == 1
        assert resp.json()["items"][0]["last_name"] == "Живописный"

    def test_list_search_by_exact_uuid(self, api_client) -> None:
        created = api_client.post("/api/v1/staff", json=_create_payload()).json()
        resp = api_client.get(f"/api/v1/staff?q={created['id']}")
        assert resp.status_code == 200
        assert resp.json()["total"] == 1
        assert resp.json()["items"][0]["id"] == created["id"]

    def test_sort_by_specialty_via_join(self, api_client) -> None:
        """specialty sort: masters-extension LEFT JOIN, NULLs last."""
        no_master = api_client.post(
            "/api/v1/staff", json=_create_payload(first_name="НетМастера")
        ).json()
        painter = api_client.post(
            "/api/v1/staff",
            json=_create_payload(
                first_name="А", master={"specialty": "живопись", "color": "#111111"}
            ),
        ).json()

        resp = api_client.get("/api/v1/staff?sort_by=specialty&sort_order=asc")
        assert resp.status_code == 200
        ids = [m["id"] for m in resp.json()["items"]]
        # asc: painter (живопись) first; no-master section (NULL) LAST.
        assert ids.index(painter["id"]) < ids.index(no_master["id"])

    def test_sort_by_color_desc_nulls_last(self, api_client) -> None:
        no_master = api_client.post(
            "/api/v1/staff", json=_create_payload(first_name="НетМастера")
        ).json()
        red = api_client.post(
            "/api/v1/staff",
            json=_create_payload(
                first_name="Красный",
                master={"specialty": "с", "color": "#FF0000"},
            ),
        ).json()
        blue = api_client.post(
            "/api/v1/staff",
            json=_create_payload(
                first_name="Синий",
                master={"specialty": "с", "color": "#0000FF"},
            ),
        ).json()

        resp = api_client.get("/api/v1/staff?sort_by=color&sort_order=desc")
        ids = [m["id"] for m in resp.json()["items"]]
        # desc: FF0000 > 0000FF; NULL (no section) still LAST.
        assert ids.index(red["id"]) < ids.index(blue["id"])
        assert ids.index(no_master["id"]) > ids.index(blue["id"])

    def test_sort_by_specialty_desc_nulls_last(self, api_client) -> None:
        """specialty desc: «пустые — в конце» holds in BOTH directions (#266).

        always_nulls_last policy: cards without a master section (NULL
        specialty) sort after sectioned ones even on desc — the inverse
        of the canonical desc → nullslast is the same side here, so the
        pin is the BOTH-directions invariant together with the asc test.
        """
        no_master = api_client.post(
            "/api/v1/staff", json=_create_payload(first_name="НетМастера")
        ).json()
        sculptor = api_client.post(
            "/api/v1/staff",
            json=_create_payload(
                first_name="С", master={"specialty": "скульптура", "color": "#222222"}
            ),
        ).json()
        painter = api_client.post(
            "/api/v1/staff",
            json=_create_payload(
                first_name="Ж", master={"specialty": "живопись", "color": "#111111"}
            ),
        ).json()

        resp = api_client.get("/api/v1/staff?sort_by=specialty&sort_order=desc")
        assert resp.status_code == 200
        ids = [m["id"] for m in resp.json()["items"]]
        # desc: скульптура > живопись (reverse alpha); NULL still LAST.
        assert ids.index(sculptor["id"]) < ids.index(painter["id"])
        assert ids.index(no_master["id"]) > ids.index(painter["id"])

    def test_sort_by_color_asc_nulls_last(self, api_client) -> None:
        """color asc: «пустые — в конце» — nulls LAST on asc (#266).

        This is the direction where always_nulls_last DIVERGES from the
        canonical policy (asc → nullsfirst): a NULL color must NOT jump
        to the top.
        """
        no_master = api_client.post(
            "/api/v1/staff", json=_create_payload(first_name="НетМастера")
        ).json()
        blue = api_client.post(
            "/api/v1/staff",
            json=_create_payload(
                first_name="Синий", master={"specialty": "с", "color": "#0000FF"}
            ),
        ).json()
        red = api_client.post(
            "/api/v1/staff",
            json=_create_payload(
                first_name="Красный", master={"specialty": "с", "color": "#FF0000"}
            ),
        ).json()

        resp = api_client.get("/api/v1/staff?sort_by=color&sort_order=asc")
        assert resp.status_code == 200
        ids = [m["id"] for m in resp.json()["items"]]
        # asc: 0000FF < FF0000; NULL (no section) LAST, not first.
        assert ids.index(blue["id"]) < ids.index(red["id"])
        assert ids.index(no_master["id"]) > ids.index(red["id"])

    def test_sort_generic_garbage_key_422(self, api_client) -> None:
        """sort_by=bogus → 422: generic unknown key, not just the legacy
        ``position`` name (GH #367 — hard contract, no silent fallback)."""
        resp = api_client.get("/api/v1/staff?sort_by=bogus")
        assert resp.status_code == 422

    def test_sort_position_rejected_422(self, api_client) -> None:
        """position is EXCLUDED from the staff sort whitelist (M2M)."""
        resp = api_client.get("/api/v1/staff?sort_by=position")
        assert resp.status_code == 422

    def test_sort_name_asc_desc(self, api_client) -> None:
        z = api_client.post(
            "/api/v1/staff", json=_create_payload(first_name="Zed")
        ).json()
        a = api_client.post(
            "/api/v1/staff", json=_create_payload(first_name="Anna")
        ).json()
        asc = api_client.get("/api/v1/staff?sort_by=name&sort_order=asc")
        ids_asc = [m["id"] for m in asc.json()["items"]]
        assert ids_asc.index(a["id"]) < ids_asc.index(z["id"])
        desc = api_client.get("/api/v1/staff?sort_by=name&sort_order=desc")
        ids_desc = [m["id"] for m in desc.json()["items"]]
        assert ids_desc.index(z["id"]) < ids_desc.index(a["id"])

    def test_all_returns_bare_array(self, api_client) -> None:
        created = api_client.post("/api/v1/staff", json=_create_payload()).json()
        resp = api_client.get("/api/v1/staff/all")
        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, list)
        assert any(m["id"] == created["id"] for m in body)


class TestStaffArchiveRestore:
    """POST /staff/{id}/archive (D6 checkboxes) + /restore."""

    def test_archive_person_with_both_checkboxes_default(
        self, api_client
    ) -> None:
        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()
        query_db(
            f"INSERT INTO users (id, phone, password_hash, role, staff_id, "
            f"email_is_confirmed, phone_is_confirmed, is_active, created_at, updated_at) "
            f"VALUES ('{_uuid.uuid4()}', '+79997778899', 'x', 'master', "
            f"'{created['id']}', 0, 0, 1, datetime('now'), datetime('now'))"
        )

        resp = api_client.post(f"/api/v1/staff/{created['id']}/archive", json={})

        assert resp.status_code == 200, resp.text
        assert resp.json()["archived"] is True
        assert _staff_flags(created["id"]) == (0, 0, 0)

    def test_archive_respects_unchecked_master_flag(self, api_client) -> None:
        """S6: unchecked «архив мастера» — уволенный остаётся в расписании."""
        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()

        resp = api_client.post(
            f"/api/v1/staff/{created['id']}/archive",
            json={"archive_master": False},
        )

        assert resp.status_code == 200
        assert _staff_flags(created["id"]) == (0, 1, None)

    def test_archive_respects_unchecked_user_flag(self, api_client) -> None:
        """S6: unchecked «архив учётки» — вход остаётся разрешён."""
        created = api_client.post("/api/v1/staff", json=_create_payload()).json()
        query_db(
            f"INSERT INTO users (id, phone, password_hash, role, staff_id, "
            f"email_is_confirmed, phone_is_confirmed, is_active, created_at, updated_at) "
            f"VALUES ('{_uuid.uuid4()}', '+79997778898', 'x', 'admin', "
            f"'{created['id']}', 0, 0, 1, datetime('now'), datetime('now'))"
        )

        resp = api_client.post(
            f"/api/v1/staff/{created['id']}/archive",
            json={"archive_user": False},
        )

        assert resp.status_code == 200
        assert _staff_flags(created["id"]) == (0, None, 1)

    def test_restore_returns_person_only(self, api_client) -> None:
        """Restore = person flag only; master/user flags keep their state."""
        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()
        api_client.post(f"/api/v1/staff/{created['id']}/archive", json={})
        assert _staff_flags(created["id"]) == (0, 0, None)

        resp = api_client.post(f"/api/v1/staff/{created['id']}/restore")

        assert resp.status_code == 200
        assert resp.json()["archived"] is False
        # master flag stays archived (explicit toggle owns it)
        assert _staff_flags(created["id"]) == (1, 0, None)

    def test_archive_nonexistent_404(self, api_client) -> None:
        resp = api_client.post("/api/v1/staff/nonexistent-id/archive", json={})
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "STAFF_NOT_FOUND"

    def test_restore_nonexistent_404(self, api_client) -> None:
        resp = api_client.post("/api/v1/staff/nonexistent-id/restore")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "STAFF_NOT_FOUND"


def _seed_activity(api_client, master_id: str, service_id: str, location_id: str,
                   *, hours_from_now: int = 24) -> dict:
    """Create one activity via the API; return its JSON body."""
    from datetime import UTC, datetime, timedelta

    resp = api_client.post(
        "/api/v1/activities",
        json={
            "master_id": master_id,
            "service_id": service_id,
            "location_id": location_id,
            "start": (
                datetime.now(UTC) + timedelta(hours=hours_from_now)
            ).isoformat(),
            "duration": 90, "capacity": 10, "is_private": False,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _seed_service_and_location(api_client) -> tuple[str, str]:
    """The (service_id, location_id) pair an activity needs."""
    service = api_client.post(
        "/api/v1/services",
        json={
            "title": "S", "description": "D", "image_url": "http://x",
            "specialty": "s", "min_age": 6, "max_age": 99,
            "duration": 60, "record_info": "ri",
        },
    ).json()
    location = api_client.post(
        "/api/v1/locations",
        json={"title": "L", "address": "a", "capacity": 5},
    ).json()
    return service["id"], location["id"]


class TestStaffDelete:
    """DELETE /api/v1/staff/{id} — the unified deferred-delete contract
    (GH #345 §4.1, one-to-one mirror of the tags/records family).

    Modes (spec §4.1):
      * ``?dry_run=true`` — PURE preview: existence probe → missing → 404;
        ``collect_dependencies`` → empty → 204 WITHOUT deleting; non-empty
        → 409 + dependency tree. Never modifies rows; combined with a
        ``resolutions`` body → 422 ``dry_run_with_resolutions_forbidden``
        (checked before the probe).
      * No body, no flag → 422 ``expected_state_required`` — bare DELETE
        is abolished (the legacy execute-if-clean path is gone, S6).
      * Body ``{resolutions?, expected}`` — the deferred-delete commit:
        the ROUTE parses the form and maps 404/422; the subset
        verification + execution live INSIDE the ``delete_staff``
        scenario transaction (spec §4.5, mirror of ``delete_record``).

    Domain matrix (spec §4.4): ``activities`` is the ONLY non-auto dep —
    blocked via the masters extension row (Mode B «архивировать вместо»
    only; a blocked commit 422s at ANY body); users / masters /
    master_tags / staff_positions are AUTO (the clean/all-auto commit
    sends ``{expected: {}}`` → 204 with cascades).
    """

    # ── bare DELETE (no flag, no body) → 422 expected_state_required ─────

    def test_bare_delete_clean_card_returns_422_row_alive(
        self, api_client
    ) -> None:
        """S6: bare DELETE executes nowhere — even a clean card refuses."""
        created = api_client.post("/api/v1/staff", json=_create_payload()).json()

        resp = api_client.delete(f"/api/v1/staff/{created['id']}")

        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"
        assert (
            api_client.get(f"/api/v1/staff/{created['id']}").status_code == 200
        )

    def test_bare_delete_card_with_activities_returns_422_row_alive(
        self, api_client
    ) -> None:
        """S6: bare DELETE on a blocked card → 422 (form check first)."""
        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()
        service_id, location_id = _seed_service_and_location(api_client)
        _seed_activity(
            api_client, created["id"], service_id, location_id
        )

        resp = api_client.delete(f"/api/v1/staff/{created['id']}")

        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"
        assert (
            api_client.get(f"/api/v1/staff/{created['id']}").status_code == 200
        )

    def test_bare_delete_unknown_id_returns_422_before_404(
        self, api_client
    ) -> None:
        """S6: form check precedes the probe — 422, not 404."""
        resp = api_client.delete("/api/v1/staff/nonexistent-id")
        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"

    def test_delete_resolutions_body_without_expected_returns_422(
        self, api_client
    ) -> None:
        """S6: resolutions-only body is the rejected legacy shape."""
        created = api_client.post("/api/v1/staff", json=_create_payload()).json()

        resp = api_client.request(
            "DELETE",
            f"/api/v1/staff/{created['id']}",
            json={"resolutions": {}},
        )

        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"
        assert (
            api_client.get(f"/api/v1/staff/{created['id']}").status_code == 200
        )

    def test_delete_unknown_keys_body_without_expected_returns_422(
        self, api_client
    ) -> None:
        """S6: unknown-keys-only body has no ``expected`` — same 422."""
        created = api_client.post("/api/v1/staff", json=_create_payload()).json()

        resp = api_client.request(
            "DELETE",
            f"/api/v1/staff/{created['id']}",
            json={"bogus_key": "whatever"},
        )

        assert resp.status_code == 422
        assert resp.json()["detail"] == "expected_state_required"
        assert (
            api_client.get(f"/api/v1/staff/{created['id']}").status_code == 200
        )

    # ── ?dry_run=true — pure preview (never modifies rows) ────────────────

    def test_dry_run_blocked_card_returns_409_tree_row_alive(
        self, api_client
    ) -> None:
        """S6: dry-run on a card with activities → 409 has_dependencies.

        ``activities`` is a blocked non-auto node: counters only, NO items
        (spec §4.3 fixed boundary — blocked nodes are never confirmed, no
        item collectors for activities from the parent side).
        """
        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()
        service_id, location_id = _seed_service_and_location(api_client)
        _seed_activity(api_client, created["id"], service_id, location_id)

        resp = api_client.request(
            "DELETE",
            f"/api/v1/staff/{created['id']}",
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
        assert (
            api_client.get(f"/api/v1/staff/{created['id']}").status_code == 200
        )

    def test_dry_run_all_auto_card_returns_409_tree_row_alive(
        self, api_client
    ) -> None:
        """S2(б): dry-run on an all-auto card (masters ext + user +
        master_tags + staff_positions, NO activities) → 409 for informed
        consent; nothing is modified."""
        pos_id = _seed_position()
        created = api_client.post(
            "/api/v1/staff",
            json=_create_payload(
                master=MASTER_SECTION, position_ids=[pos_id]
            ),
        ).json()
        _seed_user(created["id"])
        tag_id = _link_master_tag(created["id"])

        resp = api_client.request(
            "DELETE",
            f"/api/v1/staff/{created['id']}",
            params={"dry_run": "true"},
        )

        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["detail"] == "has_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert "activities" not in deps  # zero-count dep is skipped
        assert deps["users"]["count"] == 1
        assert deps["users"]["auto"] is True
        assert deps["masters"]["count"] == 1
        assert deps["master_tags"]["count"] == 1
        assert deps["staff_positions"]["count"] == 1
        # Dry-run modifies nothing: card + children alive.
        assert (
            api_client.get(f"/api/v1/staff/{created['id']}").status_code == 200
        )
        assert query_db(
            f"SELECT * FROM master_tags WHERE tag_id='{tag_id}'"
        )

    def test_dry_run_clean_card_returns_204_and_row_alive(
        self, api_client
    ) -> None:
        """S2(а): dry-run on a clean card → 204 WITHOUT deleting."""
        created = api_client.post("/api/v1/staff", json=_create_payload()).json()

        resp = api_client.request(
            "DELETE",
            f"/api/v1/staff/{created['id']}",
            params={"dry_run": "true"},
        )

        assert resp.status_code == 204
        assert (
            api_client.get(f"/api/v1/staff/{created['id']}").status_code == 200
        )

    def test_dry_run_unknown_card_returns_404(self, api_client) -> None:
        """S6: dry-run probes existence — missing card → 404."""
        resp = api_client.request(
            "DELETE",
            "/api/v1/staff/nonexistent-id",
            params={"dry_run": "true"},
        )
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "STAFF_NOT_FOUND"

    def test_dry_run_with_resolutions_body_returns_422(
        self, api_client
    ) -> None:
        """S6: dry_run + resolutions → 422; combo checked before the probe."""
        created = api_client.post("/api/v1/staff", json=_create_payload()).json()

        for staff_id in (created["id"], "nonexistent-id"):
            resp = api_client.request(
                "DELETE",
                f"/api/v1/staff/{staff_id}",
                params={"dry_run": "true"},
                json={"resolutions": {"users": "cascade"}},
            )
            assert resp.status_code == 422, f"{staff_id}: {resp.text}"
            assert resp.json()["detail"] == "dry_run_with_resolutions_forbidden"

        assert (
            api_client.get(f"/api/v1/staff/{created['id']}").status_code == 200
        )

    def test_dry_run_with_expected_only_body_silently_ignored(
        self, api_client
    ) -> None:
        """Combinatorics: dry_run + expected-only body → preview proceeds."""
        created = api_client.post("/api/v1/staff", json=_create_payload()).json()

        resp = api_client.request(
            "DELETE",
            f"/api/v1/staff/{created['id']}",
            params={"dry_run": "true"},
            json={"expected": {}},
        )

        assert resp.status_code == 204
        assert (
            api_client.get(f"/api/v1/staff/{created['id']}").status_code == 200
        )

    # ── body commit: existence + expected id-set verification ─────────────

    def test_commit_unknown_card_with_body_returns_404(
        self, api_client
    ) -> None:
        """S6: nonexistent id WITH body → 404 (probe after the form)."""
        resp = api_client.request(
            "DELETE",
            "/api/v1/staff/nonexistent-id",
            json={"expected": {}},
        )
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "STAFF_NOT_FOUND"

    def test_commit_clean_card_expected_empty_returns_204(
        self, api_client
    ) -> None:
        """S2(а): clean path — ``{expected: {}}`` → 204 hard delete."""
        created = api_client.post("/api/v1/staff", json=_create_payload()).json()

        resp = api_client.request(
            "DELETE", f"/api/v1/staff/{created['id']}", json={"expected": {}},
        )

        assert resp.status_code == 204
        assert (
            api_client.get(f"/api/v1/staff/{created['id']}").status_code == 404
        )

    def test_commit_all_auto_card_expected_empty_cascades_204(
        self, api_client
    ) -> None:
        """S2(б): all-auto deps + commit ``{expected: {}}`` → 204 with the
        cascade: users / masters / master_tags / staff_positions die with
        the card; the tag and position DICTIONARY rows survive."""
        pos_id = _seed_position()
        created = api_client.post(
            "/api/v1/staff",
            json=_create_payload(
                master=MASTER_SECTION, position_ids=[pos_id]
            ),
        ).json()
        user_id = _seed_user(created["id"])
        tag_id = _link_master_tag(created["id"])

        resp = api_client.request(
            "DELETE", f"/api/v1/staff/{created['id']}", json={"expected": {}},
        )

        assert resp.status_code == 204, resp.text
        assert query_db(f"SELECT * FROM staff WHERE id='{created['id']}'") == []
        assert query_db(f"SELECT * FROM users WHERE id='{user_id}'") == []
        assert query_db(
            f"SELECT * FROM masters WHERE staff_id='{created['id']}'"
        ) == []
        assert query_db(
            f"SELECT * FROM master_tags WHERE master_id='{created['id']}'"
        ) == []
        assert query_db(
            f"SELECT * FROM staff_positions WHERE staff_id='{created['id']}'"
        ) == []
        # the tag and position dictionary rows themselves survive
        assert query_db(f"SELECT * FROM tags WHERE id='{tag_id}'")
        assert query_db(f"SELECT * FROM positions WHERE id='{pos_id}'")

    def test_commit_appeared_activity_returns_409_stale(
        self, api_client, create_service, create_location,
    ) -> None:
        """S5 (DoD race): an activity that APPEARED after the (clean)
        dry-run window → 409 ``stale_dependencies`` — the subset check
        inside the scenario transaction catches the race BEFORE the
        blocked-422 could fire (the (Staff,"activities") id-collector is
        the race gate, spec §4.3).

        "Clean at dialog time": a schedulable card necessarily carries
        the masters extension (an AUTO dep — informational row, never
        part of ``expected``), so the preview 409 tree holds only auto
        nodes and the confirmed state is ``{expected: {}}``.
        """
        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()

        # The dialog-time preview: only the AUTO masters row — nothing
        # the user confirms (auto nodes are exempt from expected).
        preview = api_client.request(
            "DELETE",
            f"/api/v1/staff/{created['id']}",
            params={"dry_run": "true"},
        )
        assert preview.status_code == 409, preview.text
        preview_deps = {
            d["entity"] for d in preview.json()["dependencies"]
        }
        assert "activities" not in preview_deps

        # Mid-window race: an activity appears via the API.
        _seed_activity(
            api_client,
            created["id"],
            create_service()["id"],
            create_location()["id"],
        )

        resp = api_client.request(
            "DELETE", f"/api/v1/staff/{created['id']}", json={"expected": {}},
        )

        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["detail"] == "stale_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        assert deps["activities"]["count"] == 1
        # Nothing deleted — card AND the racing activity alive.
        assert (
            api_client.get(f"/api/v1/staff/{created['id']}").status_code == 200
        )

    def test_commit_disappeared_activity_subset_passes_204(
        self, api_client
    ) -> None:
        """S5: dep removed mid-window → subset semantics → the confirmed
        commit proceeds; for staff the surviving path needs the activity
        gone (blocked otherwise), so the confirmed activity disappears
        via its own commit before the staff commit lands."""
        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()
        service_id, location_id = _seed_service_and_location(api_client)
        activity = _seed_activity(
            api_client, created["id"], service_id, location_id
        )

        # The confirmed activity dies first (its own deferred-delete commit).
        act_resp = api_client.request(
            "DELETE", f"/api/v1/activities/{activity['id']}",
            json={"expected": {}},
        )
        assert act_resp.status_code == 204, act_resp.text

        resp = api_client.request(
            "DELETE",
            f"/api/v1/staff/{created['id']}",
            json={"expected": {"activities": [activity["id"]]}},
        )

        assert resp.status_code == 204, resp.text
        assert (
            api_client.get(f"/api/v1/staff/{created['id']}").status_code == 404
        )

    def test_commit_blocked_card_any_body_returns_422(
        self, api_client
    ) -> None:
        """S6: blocked dep (activities) at any body → 422 'archive instead'.

        The expected-check passes (the activity IS confirmed) — the 422
        comes from the resolutions validation inside the scenario's core.
        """
        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()
        service_id, location_id = _seed_service_and_location(api_client)
        activity = _seed_activity(
            api_client, created["id"], service_id, location_id
        )

        resp = api_client.request(
            "DELETE",
            f"/api/v1/staff/{created['id']}",
            json={"expected": {"activities": [activity["id"]]}},
        )

        assert resp.status_code == 422, resp.text
        # Row untouched.
        assert (
            api_client.get(f"/api/v1/staff/{created['id']}").status_code == 200
        )

    def test_commit_stale_beats_blocked_resolutions_returns_409_not_422(
        self, api_client
    ) -> None:
        """Order pin (#285 D7 mirror): a stale expected → 409 even when
        the resolutions/blocked branch would also 422."""
        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()
        service_id, location_id = _seed_service_and_location(api_client)
        _seed_activity(api_client, created["id"], service_id, location_id)

        resp = api_client.request(
            "DELETE",
            f"/api/v1/staff/{created['id']}",
            json={"expected": {}},  # stale: an activity exists on the server
        )

        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"] == "stale_dependencies"
        assert (
            api_client.get(f"/api/v1/staff/{created['id']}").status_code == 200
        )

    def test_commit_unknown_body_keys_silently_ignored(
        self, api_client
    ) -> None:
        """S6: unknown body keys (with ``expected`` present) ignored → 204."""
        created = api_client.post("/api/v1/staff", json=_create_payload()).json()

        resp = api_client.request(
            "DELETE",
            f"/api/v1/staff/{created['id']}",
            json={"expected": {}, "bogus_key": "whatever"},
        )

        assert resp.status_code == 204, resp.text
        assert (
            api_client.get(f"/api/v1/staff/{created['id']}").status_code == 404
        )

    def test_commit_swapped_activity_id_returns_409(
        self, api_client
    ) -> None:
        """S5 rev6 mirror: a ghost id at an unchanged counter → 409
        (id-sets, not counters — the swap is caught)."""
        from uuid import uuid4

        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()
        service_id, location_id = _seed_service_and_location(api_client)
        activity = _seed_activity(
            api_client, created["id"], service_id, location_id
        )
        ghost = str(uuid4())

        # Swap: delete the confirmed activity, create another one on the
        # SAME master — the counter stays 1, the id-set does not match.
        act_resp = api_client.request(
            "DELETE", f"/api/v1/activities/{activity['id']}",
            json={"expected": {}},
        )
        assert act_resp.status_code == 204
        swapped = _seed_activity(
            api_client,
            created["id"],
            service_id,
            location_id,
            hours_from_now=48,
        )
        assert swapped["id"] != activity["id"]

        resp = api_client.request(
            "DELETE",
            f"/api/v1/staff/{created['id']}",
            json={"expected": {"activities": [ghost]}},
        )

        assert resp.status_code == 409
        assert resp.json()["detail"] == "stale_dependencies"
        assert (
            api_client.get(f"/api/v1/staff/{created['id']}").status_code == 200
        )

    def test_commit_expected_carries_all_ids_beyond_ten(
        self, api_client
    ) -> None:
        """>10 items pin (spec §4.2): ``expected`` carries ALL ids of the
        dependency tree, not the rendered top-10 rows.

        12 activities on one card; a commit confirming only the first 10
        id-sets → 409 ``stale_dependencies`` (ids 11–12 appeared from the
        check's point of view — mid-window race semantics).
        """
        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()
        service_id, location_id = _seed_service_and_location(api_client)
        activity_ids = [
            _seed_activity(
                api_client, created["id"], service_id, location_id,
                hours_from_now=24 + i,
            )["id"]
            for i in range(12)
        ]

        # Confirm only the first 10 → the remaining 2 are "new" → 409.
        partial = api_client.request(
            "DELETE",
            f"/api/v1/staff/{created['id']}",
            json={"expected": {"activities": activity_ids[:10]}},
        )
        assert partial.status_code == 409, partial.text
        assert partial.json()["detail"] == "stale_dependencies"
        assert (
            api_client.get(f"/api/v1/staff/{created['id']}").status_code == 200
        )


class TestNoStaffReorder:
    """PUT /reorder is NOT carried over from masters (spec «API (после)»)."""

    def test_reorder_route_absent(self, api_client) -> None:
        """No dedicated /reorder path operation exists on the staff router."""
        from src.main import create_app

        app = create_app()
        for route in app.routes:
            path = getattr(route, "path", "")
            if path == "/api/v1/staff/reorder":
                pytest.fail("PUT /api/v1/staff/reorder must not exist (spec D8)")


class TestPositionsCrud:
    """GET/POST/PUT/PATCH/DELETE /api/v1/positions + is_system guard."""

    def test_create_position(self, api_client) -> None:
        resp = api_client.post(
            "/api/v1/positions", json={"title": "СММ"}
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["title"] == "СММ"
        assert body["is_system"] is False

    def test_list_and_get(self, api_client) -> None:
        created = api_client.post(
            "/api/v1/positions", json={"title": "Методист"}
        ).json()
        listing = api_client.get("/api/v1/positions")
        assert listing.status_code == 200
        assert any(
            p["id"] == created["id"] for p in listing.json()["items"]
        )

        one = api_client.get(f"/api/v1/positions/{created['id']}")
        assert one.status_code == 200
        assert one.json()["title"] == "Методист"

    def test_all_returns_bare_array(self, api_client) -> None:
        created = api_client.post(
            "/api/v1/positions", json={"title": "Уборка"}
        ).json()
        resp = api_client.get("/api/v1/positions/all")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
        assert any(p["id"] == created["id"] for p in resp.json())

    def test_put_renames_title(self, api_client) -> None:
        created = api_client.post(
            "/api/v1/positions", json={"title": "Старое"}
        ).json()
        resp = api_client.put(
            f"/api/v1/positions/{created['id']}", json={"title": "Новое"}
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "Новое"

    def test_patch_renames_title(self, api_client) -> None:
        created = api_client.post(
            "/api/v1/positions", json={"title": "Старое"}
        ).json()
        resp = api_client.patch(
            f"/api/v1/positions/{created['id']}", json={"title": "Патч"}
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "Патч"

    def test_delete_user_defined_position(self, api_client) -> None:
        created = api_client.post(
            "/api/v1/positions", json={"title": "Временная"}
        ).json()
        resp = api_client.request(
            "DELETE", f"/api/v1/positions/{created['id']}", json={"expected": {}}
        )
        assert resp.status_code == 204
        assert (
            api_client.get(f"/api/v1/positions/{created['id']}").status_code
            == 404
        )

    def test_delete_system_position_422(self, api_client) -> None:
        query_db(
            "INSERT INTO positions (id, title, is_system, created_at, updated_at) "
            "VALUES ('master', 'Мастер', 1, datetime('now'), datetime('now'))"
        )
        resp = api_client.request(
            "DELETE", "/api/v1/positions/master", json={"expected": {}}
        )
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "POSITION_IS_SYSTEM"
        # row survives
        assert api_client.get("/api/v1/positions/master").status_code == 200

    def test_rename_system_position_allowed(self, api_client) -> None:
        query_db(
            "INSERT INTO positions (id, title, is_system, created_at, updated_at) "
            "VALUES ('master', 'Мастер', 1, datetime('now'), datetime('now'))"
        )
        resp = api_client.put(
            "/api/v1/positions/master", json={"title": "Ведущий мастер"}
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "Ведущий мастер"
        assert resp.json()["is_system"] is True

    def test_get_nonexistent_404(self, api_client) -> None:
        resp = api_client.get("/api/v1/positions/nonexistent")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "POSITION_NOT_FOUND"


class TestMastersReadOnly:
    """GET /api/v1/masters — read-only view over staff + masters (D8).

    Only ACTIVE masters (``masters.is_active = true``): id = staff_id,
    names, specialty, color, avatar_url, sort_order. No /{id}, no mutations.
    """

    def test_list_returns_active_masters_with_master_shape(
        self, api_client
    ) -> None:
        created = api_client.post(
            "/api/v1/staff",
            json=_create_payload(
                first_name="Мария",
                avatar_url="http://x/avatar.png",
                master=MASTER_SECTION,
            ),
        ).json()
        # a plain staff card (no master section) — S1: NOT in /masters
        api_client.post(
            "/api/v1/staff",
            json=_create_payload(first_name="СММ", last_name="БезМастера"),
        )

        resp = api_client.get("/api/v1/masters")

        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        item = body["items"][0]
        assert item["id"] == created["id"]
        assert item["first_name"] == "Мария"
        assert item["last_name"] == "Иванова"
        assert item["specialty"] == "живопись"
        assert item["color"] == "#5B8C7A"
        assert item["avatar_url"] == "http://x/avatar.png"
        assert "sort_order" in item

    def test_list_hides_archived_master_flag(self, api_client) -> None:
        """S2: заархивировали мастера — исчез из /masters."""
        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()
        query_db(
            f"UPDATE masters SET is_active=0 WHERE staff_id='{created['id']}'"
        )
        resp = api_client.get("/api/v1/masters")
        assert resp.json()["total"] == 0

    def test_all_returns_bare_array(self, api_client) -> None:
        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()
        resp = api_client.get("/api/v1/masters/all")
        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, list)
        assert [m["id"] for m in body] == [created["id"]]

    def test_all_over_limit_returns_422(self, api_client, db_engine) -> None:
        """>1000 masters → BareListLimitExceededError → 422 (#205 bare-list
        contract; GH #217 Task 2 — the router catches the function-side
        guard, same idiom as the 5 dictionary routers)."""
        import asyncio
        from datetime import UTC, datetime

        from sqlalchemy import insert
        from sqlalchemy.ext.asyncio import async_sessionmaker

        from src.models.master import Master
        from src.models.staff import Staff

        async def _seed() -> None:
            factory = async_sessionmaker(db_engine, expire_on_commit=False)
            now = datetime.now(UTC)
            staff_rows = [
                {
                    "id": f"{i:010d}-0000-4000-8000-000000000000",
                    "first_name": f"bulk-{i:05d}",
                    "last_name": "Master",
                    "is_active": True,
                    "sort_order": i,
                    "created_at": now,
                    "updated_at": now,
                }
                for i in range(1001)
            ]
            master_rows = [
                {
                    "staff_id": r["id"],
                    "specialty": "живопись",
                    "color": "#5B8C7A",
                    "is_active": True,
                    "created_at": now,
                    "updated_at": now,
                }
                for r in staff_rows
            ]
            async with factory() as session:
                await session.execute(insert(Staff), staff_rows)
                await session.execute(insert(Master), master_rows)
                await session.commit()

        asyncio.run(_seed())
        resp = api_client.get("/api/v1/masters/all")
        assert resp.status_code == 422
        assert "1000" in str(resp.json()["detail"])

    def test_get_by_id_removed(self, api_client) -> None:
        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()
        resp = api_client.get(f"/api/v1/masters/{created['id']}")
        assert resp.status_code == 404  # route removed

    def test_mutations_removed(self, api_client) -> None:
        for method in ("post", "put", "patch", "delete"):
            resp = getattr(api_client, method)("/api/v1/masters")
            assert resp.status_code == 405, method

        resp = api_client.put(
            "/api/v1/masters/reorder", json={"ids": []}
        )
        assert resp.status_code == 404  # reorder route removed

    def test_archived_person_with_active_master_still_listed(
        self, api_client
    ) -> None:
        """D3 штатный кейс: человек в архиве, мастер активен — в /masters."""
        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()
        query_db(f"UPDATE staff SET is_active=0 WHERE id='{created['id']}'")
        resp = api_client.get("/api/v1/masters")
        assert resp.json()["total"] == 1


class TestMastersArchivedVisibility:
    """GH #267 — ``status`` on GET /api/v1/masters/all + ``archived`` field.

    The bare /all list gains the ``status`` query param (active default /
    archived / all — same contract as locations/services /all). Every view
    row always carries ``archived: bool``; the paginated GET "" stays
    acting-only with ``archived`` always false.
    """

    def _create_master(self, api_client) -> dict:
        resp = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    def _archive(self, api_client, staff_id: str) -> None:
        resp = api_client.post(f"/api/v1/staff/{staff_id}/archive")
        assert resp.status_code == 200, resp.text

    def test_all_default_returns_active_only(self, api_client) -> None:
        acting = self._create_master(api_client)
        archived = self._create_master(api_client)
        self._archive(api_client, archived["id"])

        body = api_client.get("/api/v1/masters/all").json()

        assert [m["id"] for m in body] == [acting["id"]]
        assert all(m["archived"] is False for m in body)

    def test_all_status_all_includes_archived_with_flag(
        self, api_client
    ) -> None:
        acting = self._create_master(api_client)
        archived = self._create_master(api_client)
        self._archive(api_client, archived["id"])

        body = api_client.get(
            "/api/v1/masters/all", params={"status": "all"}
        ).json()

        by_id = {m["id"]: m for m in body}
        assert set(by_id) == {acting["id"], archived["id"]}
        assert by_id[acting["id"]]["archived"] is False
        assert by_id[archived["id"]]["archived"] is True

    def test_all_status_archived_returns_archived_only(
        self, api_client
    ) -> None:
        acting = self._create_master(api_client)
        archived = self._create_master(api_client)
        self._archive(api_client, archived["id"])

        body = api_client.get(
            "/api/v1/masters/all", params={"status": "archived"}
        ).json()

        assert [m["id"] for m in body] == [archived["id"]]
        assert all(m["archived"] is True for m in body)

    def test_all_invalid_status_rejected(self, api_client) -> None:
        resp = api_client.get("/api/v1/masters/all", params={"status": "foo"})
        assert resp.status_code == 422

    def test_paginated_list_unchanged_always_active_archived_false(
        self, api_client
    ) -> None:
        acting = self._create_master(api_client)
        archived = self._create_master(api_client)
        self._archive(api_client, archived["id"])

        body = api_client.get("/api/v1/masters").json()

        assert body["total"] == 1
        item = body["items"][0]
        assert item["id"] == acting["id"]
        assert "archived" in item
        assert item["archived"] is False


def _seed_user(staff_id: str, *, is_active: int = 1, phone: str | None = None) -> str:
    """Insert a linked users row directly; return its id."""
    user_id = f"{_uuid.uuid4()}"
    phone = phone or f"+7999{_uuid.uuid4().hex[:7]}"
    query_db(
        f"INSERT INTO users (id, phone, password_hash, role, staff_id, "
        f"email_is_confirmed, phone_is_confirmed, is_active, created_at, updated_at) "
        f"VALUES ('{user_id}', '{phone}', 'x', 'admin', "
        f"'{staff_id}', 0, 0, {is_active}, datetime('now'), datetime('now'))"
    )
    return user_id


class TestMasterSectionArchiveFlag:
    """GH #266 T8 Gap A — ``archived`` on the master-section payload.

    PUT/PATCH with ``master: {…, archived: true}`` flips the SCHEDULE flag
    (``masters.is_active = false``): the row is KEPT (D7 — history keeps
    name/color), /masters stops listing it. ``archived: false`` restores
    the acting state; absent (null) = don't touch the flag (upsert keeps
    an active section active, an archived one archived).
    """

    def test_put_archive_section_hides_from_masters_keeps_row(
        self, api_client
    ) -> None:
        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()

        resp = api_client.put(
            f"/api/v1/staff/{created['id']}",
            json=_create_payload(
                master={**MASTER_SECTION, "archived": True}
            ),
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["master"]["archived"] is True
        # row KEPT with specialty/color (D7) — only the flag flipped
        rows = query_db(
            f"SELECT specialty, color, is_active FROM masters "
            f"WHERE staff_id='{created['id']}'"
        )
        assert len(rows) == 1
        assert rows[0]["is_active"] == 0
        assert rows[0]["specialty"] == "живопись"
        assert rows[0]["color"] == "#5B8C7A"
        # /masters no longer lists the archived section
        assert api_client.get("/api/v1/masters").json()["total"] == 0

    def test_patch_archive_section(self, api_client) -> None:
        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()

        resp = api_client.patch(
            f"/api/v1/staff/{created['id']}",
            json={"master": {**MASTER_SECTION, "archived": True}},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["master"]["archived"] is True
        assert _staff_flags(created["id"])[1] == 0

    def test_put_archived_false_restores_schedule_flag(self, api_client) -> None:
        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()
        query_db(
            f"UPDATE masters SET is_active=0 WHERE staff_id='{created['id']}'"
        )

        resp = api_client.put(
            f"/api/v1/staff/{created['id']}",
            json=_create_payload(
                master={**MASTER_SECTION, "archived": False}
            ),
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["master"]["archived"] is False
        assert api_client.get("/api/v1/masters").json()["total"] == 1

    def test_upsert_without_archived_keeps_existing_flag(
        self, api_client
    ) -> None:
        """absent archived = don't touch: an archived row stays archived."""
        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()
        query_db(
            f"UPDATE masters SET is_active=0 WHERE staff_id='{created['id']}'"
        )

        resp = api_client.put(
            f"/api/v1/staff/{created['id']}",
            json=_create_payload(
                master={"specialty": "керамика", "color": "#123456"}
            ),
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["master"]["specialty"] == "керамика"
        assert resp.json()["master"]["archived"] is True  # flag untouched

    def test_create_with_archived_true_creates_inactive_section(
        self, api_client
    ) -> None:
        """Create + archived: the section is born archived (D5 payload)."""
        resp = api_client.post(
            "/api/v1/staff",
            json=_create_payload(
                master={**MASTER_SECTION, "archived": True}
            ),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["master"]["archived"] is True
        assert api_client.get("/api/v1/masters").json()["total"] == 0

    def test_archived_section_upsert_recreates_row_as_archived(
        self, api_client
    ) -> None:
        """No section yet + archived:true → the new row is born archived
        (upsert semantics; presence and the flag are independent)."""
        created = api_client.post(
            "/api/v1/staff", json=_create_payload()
        ).json()

        resp = api_client.put(
            f"/api/v1/staff/{created['id']}",
            json=_create_payload(
                master={**MASTER_SECTION, "archived": True}
            ),
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["master"]["archived"] is True
        assert _staff_flags(created["id"])[1] == 0


class TestStaffHasUser:
    """GH #266 T8 Gap B — ``has_user`` on StaffResponse (D6).

    «Наличие учётки» = a users ROW linked to the card exists (ANY
    is_active): the dismissal dialog's «Архивировать учётку» checkbox is
    only shown when an account exists at all — an already-archived
    account still counts (D6: the checkbox applies to the ACTIVE link).
    """

    def test_get_without_account_has_user_false(self, api_client) -> None:
        created = api_client.post(
            "/api/v1/staff", json=_create_payload()
        ).json()
        resp = api_client.get(f"/api/v1/staff/{created['id']}")
        assert resp.status_code == 200
        assert resp.json()["has_user"] is False

    def test_get_with_account_has_user_true(self, api_client) -> None:
        created = api_client.post(
            "/api/v1/staff",
            json=_create_payload(
                create_user={"phone": "+79995551100", "password": "pw-acc-1"}
            ),
        ).json()
        resp = api_client.get(f"/api/v1/staff/{created['id']}")
        assert resp.status_code == 200
        assert resp.json()["has_user"] is True

    def test_archived_account_still_counts_has_user_true(
        self, api_client
    ) -> None:
        created = api_client.post(
            "/api/v1/staff", json=_create_payload()
        ).json()
        _seed_user(created["id"], is_active=0)

        resp = api_client.get(f"/api/v1/staff/{created['id']}")

        assert resp.status_code == 200
        assert resp.json()["has_user"] is True

    def test_create_response_reports_has_user(self, api_client) -> None:
        resp = api_client.post(
            "/api/v1/staff",
            json=_create_payload(
                create_user={"phone": "+79995551101", "password": "pw-acc-2"}
            ),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["has_user"] is True

    def test_list_items_carry_has_user(self, api_client) -> None:
        with_acc = api_client.post(
            "/api/v1/staff",
            json=_create_payload(
                first_name="С",
                last_name="Сучёткой",
                create_user={"phone": "+79995551102", "password": "pw-acc-3"},
            ),
        ).json()
        api_client.post(
            "/api/v1/staff",
            json=_create_payload(first_name="Б", last_name="Безучётки"),
        )

        items = api_client.get("/api/v1/staff").json()["items"]

        by_name = {i["last_name"]: i for i in items}
        assert by_name["Сучёткой"]["has_user"] is True
        assert by_name["Безучётки"]["has_user"] is False
        assert with_acc["has_user"] is True


# ─── GH #232 Task 2: ?id= set narrowing — masters view representative ─────────


class TestMastersListIdFilter:
    """``GET /masters?id=X`` — typed IN-narrowing in ``MasterViewService``
    (GH #232 §3.1; representative of the masters view builder). The route
    injects ``Annotated[PaginationParams, Query()]`` so the repeated ``id``
    keys parse (the Depends()-model shape silently drops list fields)."""

    def test_id_filter_returns_exactly_the_named_masters(
        self, api_client
    ) -> None:
        m1 = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()
        m2 = api_client.post(
            "/api/v1/staff",
            json=_create_payload(
                master={**MASTER_SECTION, "color": "#123456"}
            ),
        ).json()
        # a NOT-named acting master — must disappear under the narrowing
        api_client.post(
            "/api/v1/staff",
            json=_create_payload(
                master={**MASTER_SECTION, "color": "#654321"}
            ),
        ).json()
        # a plain staff card (no master section) — never in /masters
        api_client.post("/api/v1/staff", json=_create_payload(first_name="СММ"))

        resp = api_client.get(
            "/api/v1/masters", params=[("id", m1["id"]), ("id", m2["id"])]
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert sorted(m["id"] for m in body["items"]) == sorted(
            [m1["id"], m2["id"]]
        )
        assert body["total"] == 2


class TestDeleteCascadesUserSettings:
    """GH #319 Task 3: «Каскад смерти» — настройки сносятся вместе с учёткой.

    Deleting a staff card with a linked account removes BOTH the ``User``
    row AND its ``UserSettings`` row (cascade death). Archive/dismissal
    does NOT touch settings (archive is not death).
    """

    def test_execute_mode_removes_user_and_settings(self, api_client) -> None:
        """Execute-mode (DELETE with body): staff card + user + settings →
        DB has NEITHER User NOR UserSettings after the delete."""
        created = api_client.post(
            "/api/v1/staff", json=_create_payload()
        ).json()
        user_id = str(_uuid.uuid4())
        settings_id = str(_uuid.uuid4())
        query_db(
            f"INSERT INTO users (id, phone, password_hash, role, staff_id, "
            f"email_is_confirmed, phone_is_confirmed, is_active, created_at, updated_at) "
            f"VALUES ('{user_id}', '+7999{_uuid.uuid4().int % 10**10:010d}', 'x', 'master', "
            f"'{created['id']}', 0, 0, 1, datetime('now'), datetime('now'))"
        )
        query_db(
            f"INSERT INTO user_settings (id, user_id, theme, language, "
            f"column_order_staff, column_order_locations, show_archived_masters, "
            f"show_archived_locations, created_at, updated_at) "
            f"VALUES ('{settings_id}', '{user_id}', 'dark', 'en', '[]', '[]', "
            f"1, 0, datetime('now'), datetime('now'))"
        )

        resp = api_client.request(
            "DELETE", f"/api/v1/staff/{created['id']}", json={"expected": {}}
        )

        assert resp.status_code == 204, resp.text
        assert query_db(f"SELECT * FROM users WHERE id='{user_id}'") == []
        assert query_db(
            f"SELECT * FROM user_settings WHERE id='{settings_id}'"
        ) == []

    def test_dry_run_shows_users_dep_unchanged(self, api_client) -> None:
        """Dry-run (``?dry_run=true``): the dependency tree still lists
        ``users`` (UserSettings is part of the users cascade, NOT a separate
        matrix entry). Shape unchanged (#319 pin carried onto the #345
        preview transport)."""
        created = api_client.post(
            "/api/v1/staff", json=_create_payload()
        ).json()
        user_id = str(_uuid.uuid4())
        query_db(
            f"INSERT INTO users (id, phone, password_hash, role, staff_id, "
            f"email_is_confirmed, phone_is_confirmed, is_active, created_at, updated_at) "
            f"VALUES ('{user_id}', '+7999{_uuid.uuid4().int % 10**10:010d}', 'x', 'master', "
            f"'{created['id']}', 0, 0, 1, datetime('now'), datetime('now'))"
        )
        query_db(
            f"INSERT INTO user_settings (id, user_id, theme, language, "
            f"column_order_staff, column_order_locations, show_archived_masters, "
            f"show_archived_locations, created_at, updated_at) "
            f"VALUES ('{str(_uuid.uuid4())}', '{user_id}', 'light', 'ru', '[]', '[]', "
            f"1, 0, datetime('now'), datetime('now'))"
        )

        resp = api_client.request(
            "DELETE",
            f"/api/v1/staff/{created['id']}",
            params={"dry_run": "true"},
        )

        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["detail"] == "has_dependencies"
        deps = {d["entity"]: d for d in body["dependencies"]}
        # users dep is present with count=1
        assert "users" in deps
        assert deps["users"]["count"] == 1
        assert deps["users"]["auto"] is True
        # UserSettings is NOT a separate dep (it rides the users cascade)
        assert "user_settings" not in deps

    def test_archive_does_not_touch_settings(self, api_client) -> None:
        """Archive/dismissal («увольнение-архив») does NOT touch settings —
        archive is not death."""
        created = api_client.post(
            "/api/v1/staff", json=_create_payload()
        ).json()
        user_id = str(_uuid.uuid4())
        settings_id = str(_uuid.uuid4())
        query_db(
            f"INSERT INTO users (id, phone, password_hash, role, staff_id, "
            f"email_is_confirmed, phone_is_confirmed, is_active, created_at, updated_at) "
            f"VALUES ('{user_id}', '+7999{_uuid.uuid4().int % 10**10:010d}', 'x', 'master', "
            f"'{created['id']}', 0, 0, 1, datetime('now'), datetime('now'))"
        )
        query_db(
            f"INSERT INTO user_settings (id, user_id, theme, language, "
            f"column_order_staff, column_order_locations, show_archived_masters, "
            f"show_archived_locations, created_at, updated_at) "
            f"VALUES ('{settings_id}', '{user_id}', 'dark', 'en', '[]', '[]', "
            f"1, 0, datetime('now'), datetime('now'))"
        )

        resp = api_client.post(
            f"/api/v1/staff/{created['id']}/archive", json={}
        )

        assert resp.status_code == 200, resp.text
        # Settings row SURVIVES archive
        rows = query_db(
            f"SELECT * FROM user_settings WHERE id='{settings_id}'"
        )
        assert len(rows) == 1
        assert rows[0]["user_id"] == user_id
