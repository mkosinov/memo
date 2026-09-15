"""GH #263 T2 — server-side read scope over activities / records / visits / visitors.

Spec D1/D2 (docs/specs/2026-09-10-master-role-design.md) + domain rules
«Per-master data scoping» (docs/domain-rules/auth.md):

* «Всё через записи»: activity — own by ``activity.master_id``; record /
  visit / visitor — via the record's activity;
* lists show ONLY own rows; чужое by id → 404 (entity's own not-found
  code — indistinguishable from «не существует»);
* client-supplied filters AND the server scope conjunctively — a
  ``master_id`` filter ≠ own key yields an EMPTY result (never the
  other master's rows);
* чужое mutations → 404 (owner-check via the activity, one query —
  «чужое» timing ≈ «не существует»);
* admin → NO scope: everything visible, regression-pinned.

The master session comes from the ``make_master`` conftest factory: a
purpose-built staff card + masters row + users row, logged in over the
real ``/auth/login`` endpoint.

Spec: docs/specs/2026-09-10-master-role-design.md
Domain rules: docs/domain-rules/auth.md (Per-master data scoping #263)
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from tests.conftest import query_db

pytestmark = pytest.mark.api

TOMORROW = (datetime.now(UTC) + timedelta(days=1)).isoformat()


def _activity_payload(master_id: str, **overrides) -> dict:
    """Raw POST /activities payload bound to the given master key."""
    import uuid as _uuid

    svc = f"svc-{_uuid.uuid4().hex[:8]}"
    loc = f"loc-{_uuid.uuid4().hex[:8]}"
    # Service/location via the API requires the admin client — tests that
    # bind activities to the master's staff_id use make_master + admin
    # fixture together; here we only build the dict shape.
    return {
        "master_id": master_id,
        "service_id": svc,
        "location_id": loc,
        "start": TOMORROW,
        "duration": 90,
        "capacity": 10,
        "is_private": False,
        **overrides,
    }


class TestActivityScope:
    """Activities: list scoped by kwargs; чужой by id → 404."""

    def test_list_shows_only_own(
        self, api_client, create_service, create_location, make_master,
    ) -> None:
        master = make_master()
        svc, loc = create_service(), create_location()
        own = api_client.post("/api/v1/activities", json=_activity_payload(
            master["staff_id"], service_id=svc["id"], location_id=loc["id"],
        )).json()
        foreign = api_client.post("/api/v1/activities", json=_activity_payload(
            "staff-foreign-master", service_id=svc["id"], location_id=loc["id"],
        ))
        assert foreign.status_code == 422  # MASTER_NOT_ACTIVE — no masters row
        # Create the foreign master row so the activity is creatable.
        from src.auth.passwords import hash_password
        from tests.conftest import insert_master_user
        foreign_staff = insert_master_user("+79995551111", hash_password("x"))["staff_id"]
        foreign = api_client.post("/api/v1/activities", json=_activity_payload(
            foreign_staff, service_id=svc["id"], location_id=loc["id"],
        )).json()

        resp = master["client"].get("/api/v1/activities")
        assert resp.status_code == 200, resp.text
        ids = [a["id"] for a in resp.json()["items"]]
        assert own["id"] in ids
        assert foreign["id"] not in ids
        assert resp.json()["total"] == 1

    def test_foreign_get_by_id_404(
        self, api_client, create_service, create_location, make_master,
    ) -> None:
        from src.auth.passwords import hash_password
        from tests.conftest import insert_master_user
        master = make_master()
        svc, loc = create_service(), create_location()
        foreign_staff = insert_master_user("+79995551112", hash_password("x"))["staff_id"]
        foreign = api_client.post("/api/v1/activities", json=_activity_payload(
            foreign_staff, service_id=svc["id"], location_id=loc["id"],
        )).json()

        resp = master["client"].get(f"/api/v1/activities/{foreign['id']}")
        assert resp.status_code == 404

    def test_foreign_delete_404_owner_gate_first(
        self, api_client, create_service, create_location, make_master,
    ) -> None:
        """Scoped foreign delete → 404 (even though write perm is missing,
        the permission gate fires first — this pins the scope does not
        WEAKEN anything; the guard order is perm → scope)."""
        master = make_master()
        svc, loc = create_service(), create_location()
        own = api_client.post("/api/v1/activities", json=_activity_payload(
            master["staff_id"], service_id=svc["id"], location_id=loc["id"],
        )).json()
        # Master has no activities:write → DELETE own → 403 (permission layer).
        resp = master["client"].delete(f"/api/v1/activities/{own['id']}")
        assert resp.status_code == 403

    def test_own_get_ok_mutations_forbidden(
        self, api_client, create_service, create_location, make_master,
    ) -> None:
        """Own activity: readable; schedule writes stay admin-only (matrix)."""
        master = make_master()
        svc, loc = create_service(), create_location()
        own = api_client.post("/api/v1/activities", json=_activity_payload(
            master["staff_id"], service_id=svc["id"], location_id=loc["id"],
        )).json()

        resp = master["client"].get(f"/api/v1/activities/{own['id']}")
        assert resp.status_code == 200
        assert resp.json()["id"] == own["id"]
        # No activities:write in the master token — even own → 403 (not scope's job).
        resp = master["client"].patch(
            f"/api/v1/activities/{own['id']}", json={"capacity": 7},
        )
        assert resp.status_code == 403

    def test_empty_scope_master_sees_nothing(
        self, api_client, create_service, create_location, make_master,
    ) -> None:
        """Master WITHOUT a masters row: sees an empty set — not the studio."""
        master = make_master(with_masters_row=False)
        svc, loc = create_service(), create_location()
        api_client.post("/api/v1/activities", json=_activity_payload(
            "staff-anyone", service_id=svc["id"], location_id=loc["id"],
        ))

        resp = master["client"].get("/api/v1/activities")
        assert resp.status_code == 200
        assert resp.json()["items"] == []
        assert resp.json()["total"] == 0

    def test_admin_sees_all_regression(
        self, api_client, create_service, create_location,
    ) -> None:
        from src.auth.passwords import hash_password
        from tests.conftest import insert_master_user
        svc, loc = create_service(), create_location()
        staff_a = insert_master_user("+79995551114", hash_password("x"))["staff_id"]
        staff_b = insert_master_user("+79995551115", hash_password("x"))["staff_id"]
        api_client.post("/api/v1/activities", json=_activity_payload(
            staff_a, service_id=svc["id"], location_id=loc["id"],
        ))
        api_client.post("/api/v1/activities", json=_activity_payload(
            staff_b, service_id=svc["id"], location_id=loc["id"],
        ))
        resp = api_client.get("/api/v1/activities")
        assert resp.status_code == 200
        assert resp.json()["total"] == 2


def _client_for(api_client, name: str) -> dict:
    """Unique client via the admin API (visitor rows need NOT NULL client_id)."""
    import uuid as _uuid

    return api_client.post("/api/v1/clients", json={
        "name": name,
        "phone": f"+7999{_uuid.uuid4().hex[:7]}",
        "channel": "telegram",
    }).json()


class TestRecordScope:
    """Records: list/list_view scoped conjunctively; чужое → 404."""

    @pytest.fixture
    def two_records(self, api_client, create_service, create_location, make_master):
        """Own + foreign record; foreign built on a real second master."""
        from src.auth.passwords import hash_password
        from tests.conftest import insert_master_user

        master = make_master()
        svc, loc = create_service(), create_location()
        foreign_staff = insert_master_user("+79995551116", hash_password("x"))["staff_id"]
        own_act = api_client.post("/api/v1/activities", json=_activity_payload(
            master["staff_id"], service_id=svc["id"], location_id=loc["id"],
        )).json()
        foreign_act = api_client.post("/api/v1/activities", json=_activity_payload(
            foreign_staff, service_id=svc["id"], location_id=loc["id"],
        )).json()
        own_client = _client_for(api_client, "Свой клиент")
        foreign_client = _client_for(api_client, "Чужой клиент")
        own = api_client.post("/api/v1/records", json={
            "activity_id": own_act["id"],
            "client_id": own_client["id"],
            "comment": "own",
            "visits": [{"name": "Свой", "price": 100, "status": "waiting"}],
        }).json()
        foreign = api_client.post("/api/v1/records", json={
            "activity_id": foreign_act["id"],
            "client_id": foreign_client["id"],
            "comment": "foreign",
            "visits": [{"name": "Чужой", "price": 200, "status": "waiting"}],
        }).json()
        return {
            "master": master, "own": own, "foreign": foreign,
            "own_act": own_act, "foreign_act": foreign_act,
        }

    def test_list_shows_only_own(self, two_records) -> None:
        mc = two_records["master"]["client"]
        resp = mc.get("/api/v1/records")
        assert resp.status_code == 200, resp.text
        ids = [r["id"] for r in resp.json()["items"]]
        assert two_records["own"]["id"] in ids
        assert two_records["foreign"]["id"] not in ids
        assert resp.json()["total"] == 1

    def test_list_view_shows_only_own(self, two_records) -> None:
        mc = two_records["master"]["client"]
        resp = mc.get("/api/v1/records/view")
        assert resp.status_code == 200, resp.text
        ids = [r["id"] for r in resp.json()["items"]]
        assert two_records["own"]["id"] in ids
        assert two_records["foreign"]["id"] not in ids
        assert resp.json()["total"] == 1

    def test_client_master_filter_conjunctive(self, two_records) -> None:
        """Client-supplied master_id ANDs with the scope: ≠ own → empty."""
        mc = two_records["master"]["client"]
        own = two_records["own"]
        # Own key → own record still visible.
        resp = mc.get("/api/v1/records", params={
            "master_id": two_records["master"]["staff_id"],
        })
        assert [r["id"] for r in resp.json()["items"]] == [own["id"]]
        # Someone else's key → conjunctive AND matches nothing.
        resp = mc.get("/api/v1/records", params={"master_id": "staff-foreign"})
        assert resp.status_code == 200
        assert resp.json()["items"] == []
        assert resp.json()["total"] == 0

    def test_foreign_get_404(self, two_records) -> None:
        mc = two_records["master"]["client"]
        resp = mc.get(f"/api/v1/records/{two_records['foreign']['id']}")
        assert resp.status_code == 404

    def test_own_get_200(self, two_records) -> None:
        mc = two_records["master"]["client"]
        own = two_records["own"]
        resp = mc.get(f"/api/v1/records/{own['id']}")
        assert resp.status_code == 200
        assert resp.json()["id"] == own["id"]

    def test_foreign_update_404(self, two_records) -> None:
        mc = two_records["master"]["client"]
        foreign = two_records["foreign"]
        resp = mc.put(f"/api/v1/records/{foreign['id']}", json={
            "activity_id": foreign["activity_id"],
            "client_id": foreign["client_id"],
            "comment": "hijacked",
            "visits": [],
        })
        assert resp.status_code == 404
        # Untouched.
        assert api_client_get_comment(two_records) == "foreign"

    def test_foreign_delete_404(self, two_records) -> None:
        mc = two_records["master"]["client"]
        foreign = two_records["foreign"]
        resp = mc.delete(f"/api/v1/records/{foreign['id']}")
        assert resp.status_code == 404
        rows = query_db(
            f"SELECT id FROM records WHERE id='{foreign['id']}'"
        )
        assert rows, "foreign record must survive the scoped delete"

    def test_own_delete_204(self, two_records) -> None:
        mc = two_records["master"]["client"]
        own = two_records["own"]
        # Own record carries a visit → dry-run DELETE would 409; the
        # execute path (visit cascade — visits never block) → 204.
        resp = mc.request(
            "DELETE",
            f"/api/v1/records/{own['id']}",
            json={"resolutions": {"visits": "cascade"}},
        )
        assert resp.status_code == 204

    def test_admin_sees_all_regression(self, two_records, api_client) -> None:
        resp = api_client.get("/api/v1/records")
        assert resp.json()["total"] == 2
        resp = api_client.get("/api/v1/records/view")
        assert resp.json()["total"] == 2


def api_client_get_comment(two_records: dict) -> str | None:
    """Admin re-read of the foreign record's comment (untouched check)."""
    rows = query_db(
        "SELECT comment FROM records WHERE id="
        f"'{two_records['foreign']['id']}'"
    )
    return rows[0]["comment"] if rows else None


class TestVisitScope:
    """Visits: scoped via visit → record → activity."""

    @pytest.fixture
    def two_visits(self, api_client, create_service, create_location, make_master):
        from src.auth.passwords import hash_password
        from tests.conftest import insert_master_user

        master = make_master()
        svc, loc = create_service(), create_location()
        foreign_staff = insert_master_user("+79995551117", hash_password("x"))["staff_id"]
        own_act = api_client.post("/api/v1/activities", json=_activity_payload(
            master["staff_id"], service_id=svc["id"], location_id=loc["id"],
        )).json()
        foreign_act = api_client.post("/api/v1/activities", json=_activity_payload(
            foreign_staff, service_id=svc["id"], location_id=loc["id"],
        )).json()
        own_client = _client_for(api_client, "Свой клиент визитов")
        foreign_client = _client_for(api_client, "Чужой клиент визитов")
        own_rec = api_client.post("/api/v1/records", json={
            "activity_id": own_act["id"],
            "client_id": own_client["id"],
            "visits": [{"name": "Свой гость", "price": 100, "status": "waiting"}],
        }).json()
        foreign_rec = api_client.post("/api/v1/records", json={
            "activity_id": foreign_act["id"],
            "client_id": foreign_client["id"],
            "visits": [{"name": "Чужой гость", "price": 200, "status": "waiting"}],
        }).json()
        return {
            "master": master,
            "own": {"record": own_rec, "visit": own_rec["visits"][0]},
            "foreign": {"record": foreign_rec, "visit": foreign_rec["visits"][0]},
        }

    def test_list_shows_only_own(self, two_visits) -> None:
        mc = two_visits["master"]["client"]
        resp = mc.get("/api/v1/visits")
        assert resp.status_code == 200, resp.text
        ids = [v["id"] for v in resp.json()["items"]]
        assert two_visits["own"]["visit"]["id"] in ids
        assert two_visits["foreign"]["visit"]["id"] not in ids
        assert resp.json()["total"] == 1

    def test_list_with_foreign_record_id_param_empty(self, two_visits) -> None:
        """record_id filter ≠ own record → conjunctive AND → empty."""
        mc = two_visits["master"]["client"]
        resp = mc.get("/api/v1/visits", params={
            "record_id": two_visits["foreign"]["record"]["id"],
        })
        assert resp.status_code == 200
        assert resp.json()["items"] == []

    def test_foreign_get_404(self, two_visits) -> None:
        mc = two_visits["master"]["client"]
        resp = mc.get(f"/api/v1/visits/{two_visits['foreign']['visit']['id']}")
        assert resp.status_code == 404

    def test_own_get_200(self, two_visits) -> None:
        mc = two_visits["master"]["client"]
        vid = two_visits["own"]["visit"]["id"]
        resp = mc.get(f"/api/v1/visits/{vid}")
        assert resp.status_code == 200
        assert resp.json()["id"] == vid

    def test_foreign_update_status_404(self, two_visits) -> None:
        mc = two_visits["master"]["client"]
        vid = two_visits["foreign"]["visit"]["id"]
        resp = mc.put(f"/api/v1/visits/{vid}/status", json={"status": "visited"})
        assert resp.status_code == 404
        rows = query_db(f"SELECT status FROM visits WHERE id='{vid}'")
        assert rows[0]["status"] == "waiting"

    def test_foreign_delete_404(self, two_visits) -> None:
        mc = two_visits["master"]["client"]
        vid = two_visits["foreign"]["visit"]["id"]
        resp = mc.delete(f"/api/v1/visits/{vid}")
        assert resp.status_code == 404
        assert query_db(f"SELECT id FROM visits WHERE id='{vid}'")

    def test_own_patch_status_ok(self, two_visits) -> None:
        mc = two_visits["master"]["client"]
        vid = two_visits["own"]["visit"]["id"]
        resp = mc.put(f"/api/v1/visits/{vid}/status", json={"status": "visited"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "visited"

    def test_admin_sees_all_regression(self, two_visits, api_client) -> None:
        resp = api_client.get("/api/v1/visits")
        assert resp.json()["total"] == 2


class TestVisitorScope:
    """Visitors: invisible without visits on the master's records."""

    @pytest.fixture
    def two_visitors(self, api_client, create_service, create_location, make_master):
        from src.auth.passwords import hash_password
        from tests.conftest import insert_master_user

        master = make_master()
        svc, loc = create_service(), create_location()
        foreign_staff = insert_master_user("+79995551118", hash_password("x"))["staff_id"]
        own_act = api_client.post("/api/v1/activities", json=_activity_payload(
            master["staff_id"], service_id=svc["id"], location_id=loc["id"],
        )).json()
        foreign_act = api_client.post("/api/v1/activities", json=_activity_payload(
            foreign_staff, service_id=svc["id"], location_id=loc["id"],
        )).json()
        own_client = _client_for(api_client, "Свой клиент посетителей")
        foreign_client = _client_for(api_client, "Чужой клиент посетителей")
        own_rec = api_client.post("/api/v1/records", json={
            "activity_id": own_act["id"],
            "client_id": own_client["id"],
            "visits": [{"name": "Свой посетитель", "price": 100, "status": "waiting"}],
        }).json()
        foreign_rec = api_client.post("/api/v1/records", json={
            "activity_id": foreign_act["id"],
            "client_id": foreign_client["id"],
            "visits": [{"name": "Чужой посетитель", "price": 200, "status": "waiting"}],
        }).json()
        own_visitor_id = own_rec["visits"][0]["visitor_id"]
        foreign_visitor_id = foreign_rec["visits"][0]["visitor_id"]
        assert own_visitor_id and foreign_visitor_id
        return {
            "master": master,
            "own": {"record": own_rec, "visitor_id": own_visitor_id},
            "foreign": {"record": foreign_rec, "visitor_id": foreign_visitor_id},
        }

    def test_list_shows_only_own(self, two_visitors) -> None:
        mc = two_visitors["master"]["client"]
        resp = mc.get("/api/v1/visitors")
        assert resp.status_code == 200, resp.text
        ids = [v["id"] for v in resp.json()["items"]]
        assert two_visitors["own"]["visitor_id"] in ids
        assert two_visitors["foreign"]["visitor_id"] not in ids
        assert resp.json()["total"] == 1

    def test_foreign_get_404(self, two_visitors) -> None:
        mc = two_visitors["master"]["client"]
        resp = mc.get(f"/api/v1/visitors/{two_visitors['foreign']['visitor_id']}")
        assert resp.status_code == 404

    def test_foreign_patch_404(self, two_visitors) -> None:
        mc = two_visitors["master"]["client"]
        vid = two_visitors["foreign"]["visitor_id"]
        resp = mc.patch(f"/api/v1/visitors/{vid}", json={"name": "Взлом"})
        assert resp.status_code == 404
        rows = query_db(f"SELECT name FROM visitors WHERE id='{vid}'")
        assert rows[0]["name"] == "Чужой посетитель"

    def test_foreign_delete_404(self, two_visitors) -> None:
        mc = two_visitors["master"]["client"]
        vid = two_visitors["foreign"]["visitor_id"]
        resp = mc.delete(f"/api/v1/visitors/{vid}")
        assert resp.status_code == 404
        assert query_db(f"SELECT id FROM visitors WHERE id='{vid}'")

    def test_own_patch_ok(self, two_visitors) -> None:
        mc = two_visitors["master"]["client"]
        vid = two_visitors["own"]["visitor_id"]
        resp = mc.patch(f"/api/v1/visitors/{vid}", json={"age": 30})
        assert resp.status_code == 200, resp.text
        assert resp.json()["age"] == 30

    def test_visitor_without_own_visits_invisible(
        self, api_client, create_service, create_location, make_master,
    ) -> None:
        """A visitor with visits ONLY on foreign records is invisible."""
        from src.auth.passwords import hash_password
        from tests.conftest import insert_master_user

        master = make_master()
        svc, loc = create_service(), create_location()
        foreign_staff = insert_master_user("+79995551119", hash_password("x"))["staff_id"]
        foreign_act = api_client.post("/api/v1/activities", json=_activity_payload(
            foreign_staff, service_id=svc["id"], location_id=loc["id"],
        )).json()
        hidden_client = _client_for(api_client, "Невидимый клиент")
        foreign_rec = api_client.post("/api/v1/records", json={
            "activity_id": foreign_act["id"],
            "client_id": hidden_client["id"],
            "visits": [{"name": "Невидимка", "price": 200, "status": "waiting"}],
        }).json()
        hidden_id = foreign_rec["visits"][0]["visitor_id"]
        mc = master["client"]
        resp = mc.get(f"/api/v1/visitors/{hidden_id}")
        assert resp.status_code == 404
        resp = mc.get("/api/v1/visitors")
        assert [v["id"] for v in resp.json()["items"]] == []

    def test_admin_sees_all_regression(self, two_visitors, api_client) -> None:
        resp = api_client.get("/api/v1/visitors")
        assert resp.json()["total"] == 2
