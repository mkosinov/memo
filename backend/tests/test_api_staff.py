"""Tests for the staff/positions API + read-only masters view (GH #266 T4).

Covers the HTTP surface of the restructuring (spec «API (после)»,
domain-rules/staff.md):

* ``/api/v1/staff`` — full directory CRUD: paginated list (status/q/sort),
  bare ``/all``, get (incl. archived), create (card + master section +
  positions + account flag), PUT/PATCH (atomic), DELETE (GH #207 contract),
  archive/restore (D6 checkboxes).
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
        f"INSERT INTO tags (id, tag, created_at, updated_at) "
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


class TestStaffDelete:
    """DELETE /api/v1/staff/{id} — GH #207 contract on the staff matrix."""

    def test_delete_bare_no_body_204(self, api_client) -> None:
        created = api_client.post("/api/v1/staff", json=_create_payload()).json()
        resp = api_client.delete(f"/api/v1/staff/{created['id']}")
        assert resp.status_code == 204
        assert (
            api_client.get(f"/api/v1/staff/{created['id']}").status_code == 404
        )

    def test_delete_with_activities_no_body_409(self, api_client) -> None:
        from datetime import UTC, datetime, timedelta

        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()
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
            json={"name": "L", "address": "a", "capacity": 5},
        ).json()

        api_client.post(
            "/api/v1/activities",
            json={
                "master_id": created["id"],
                "service_id": service["id"],
                "location_id": location["id"],
                "start": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
                "duration": 90, "capacity": 10, "is_private": False,
            },
        )

        resp = api_client.delete(f"/api/v1/staff/{created['id']}")

        assert resp.status_code == 409
        body = resp.json()
        assert body["detail"] == "has_dependencies"
        entities = [d["entity"] for d in body["dependencies"]]
        assert "activities" in entities
        # row untouched
        assert (
            api_client.get(f"/api/v1/staff/{created['id']}").status_code == 200
        )

    def test_delete_with_activities_with_body_422(self, api_client) -> None:
        from datetime import UTC, datetime, timedelta

        created = api_client.post(
            "/api/v1/staff", json=_create_payload(master=MASTER_SECTION)
        ).json()
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
            json={"name": "L", "address": "a", "capacity": 5},
        ).json()
        api_client.post(
            "/api/v1/activities",
            json={
                "master_id": created["id"],
                "service_id": service["id"],
                "location_id": location["id"],
                "start": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
                "duration": 90, "capacity": 10, "is_private": False,
            },
        )

        resp = api_client.request(
            "DELETE",
            f"/api/v1/staff/{created['id']}",
            json={"resolutions": {}},
        )
        assert resp.status_code == 422

    def test_delete_cascades_user_masters_tags_positions(
        self, api_client
    ) -> None:
        pos_id = _seed_position()
        created = api_client.post(
            "/api/v1/staff",
            json=_create_payload(
                master=MASTER_SECTION, position_ids=[pos_id]
            ),
        ).json()
        user_id = str(_uuid.uuid4())
        query_db(
            f"INSERT INTO users (id, phone, password_hash, role, staff_id, "
            f"email_is_confirmed, phone_is_confirmed, is_active, created_at, updated_at) "
            f"VALUES ('{user_id}', '+79997778897', 'x', 'master', "
            f"'{created['id']}', 0, 0, 1, datetime('now'), datetime('now'))"
        )
        tag_id = _link_master_tag(created["id"])

        resp = api_client.request(
            "DELETE", f"/api/v1/staff/{created['id']}", json={"resolutions": {}}
        )

        assert resp.status_code == 204
        assert query_db(f"SELECT * FROM staff WHERE id='{created['id']}'") == []
        assert query_db(
            f"SELECT * FROM users WHERE id='{user_id}'"
        ) == []
        assert query_db(
            f"SELECT * FROM masters WHERE staff_id='{created['id']}'"
        ) == []
        assert query_db(
            f"SELECT * FROM master_tags WHERE master_id='{created['id']}'"
        ) == []
        assert query_db(
            f"SELECT * FROM staff_positions WHERE staff_id='{created['id']}'"
        ) == []
        # the tag dictionary row itself survives
        assert query_db(f"SELECT * FROM tags WHERE id='{tag_id}'")

    def test_delete_nonexistent_404(self, api_client) -> None:
        resp = api_client.delete("/api/v1/staff/nonexistent-id")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "STAFF_NOT_FOUND"


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
        resp = api_client.delete(f"/api/v1/positions/{created['id']}")
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
        resp = api_client.delete("/api/v1/positions/master")
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
