"""GH #263 T3 — clients: per-master scope + contact mask + create-not-edit.

Spec D3/D4/D7 (docs/specs/2026-09-10-master-role-design.md) + domain rules
«Per-master data scoping» / «Master role (#263)» (docs/domain-rules/auth.md,
clients.md):

* List ``GET /clients`` (no ``?phone=``) under master — EXISTS-scope:
  the client has ≥1 record on the master's own activity («есть неархивная
  запись клиента к своей активности» — records are hard-delete, every
  existing row is non-archived);
* ``?phone=`` (digits-mode) and ``GET /clients/get?phone=`` — NO scope:
  search across ALL active studio clients (D4), masked response;
* ``GET /clients/{id}`` — own → 200 (masked), чужой → 404
  (indistinguishable from missing);
* Mask for role=master in EVERY client-bearing response (D3): both
  assembly points — generic ``ClientResponse`` path AND the manual
  ``ClientWithStats`` builder — plus the typeahead: ``phone`` →
  ``mask_phone`` (last 4 digits), ``email`` → ``null``; name/channel
  visible. Mutations are NEVER masked: the master creates a client with
  the full number (POST → 201 unmasked);
* Master mutations of an existing client (PUT/PATCH/DELETE/archive/
  restore) → 403 AUTH_FORBIDDEN (T1 admin guards, pinned here);
* admin → no scope, no mask — everything visible unmasked.

The master session comes from the ``make_master`` conftest factory.

Spec: docs/specs/2026-09-10-master-role-design.md (D3, D4, D7)
Domain rules: docs/domain-rules/auth.md, docs/domain-rules/clients.md
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from src.auth.scope import mask_phone
from tests.conftest import query_db

pytestmark = pytest.mark.api

TOMORROW = (datetime.now(UTC) + timedelta(days=1)).isoformat()


class TestClientScope:
    """List scope vs phone-search: «свои» vs «все активные» (D2/D4)."""

    @pytest.fixture
    def scoped_world(self, api_client, create_service, create_location, make_master):
        """Master + own/foreign activities + own/foreign clients.

        ``own_client`` carries a record on the master's own activity —
        that is exactly the client-visibility rule (EXISTS record → own
        activity). ``foreign_client`` has a record ONLY on a foreign
        activity; ``lonely_client`` has no records at all.
        """
        from src.auth.passwords import hash_password
        from tests.conftest import insert_master_user

        master = make_master()
        svc, loc = create_service(), create_location()
        foreign_staff = insert_master_user("+79995551301", hash_password("x"))["staff_id"]
        own_act = api_client.post("/api/v1/activities", json={
            "master_id": master["staff_id"],
            "service_id": svc["id"], "location_id": loc["id"],
            "start": TOMORROW, "duration": 90, "capacity": 10,
            "is_private": False,
        }).json()
        foreign_act = api_client.post("/api/v1/activities", json={
            "master_id": foreign_staff,
            "service_id": svc["id"], "location_id": loc["id"],
            "start": TOMORROW, "duration": 90, "capacity": 10,
            "is_private": False,
        }).json()

        def _client(name: str, phone: str, email: str) -> dict:
            resp = api_client.post("/api/v1/clients", json={
                "name": name, "phone": phone, "email": email,
                "channel": "telegram",
            })
            assert resp.status_code == 201, resp.text
            return resp.json()

        own_client = _client(
            "Свой клиент", "+79001112233", "own@example.com",
        )
        foreign_client = _client(
            "Чужой клиент", "+79004445566", "foreign@example.com",
        )
        lonely_client = _client(
            "Клиент без записей", "+79007778899", "lonely@example.com",
        )
        api_client.post("/api/v1/records", json={
            "activity_id": own_act["id"],
            "client_id": own_client["id"],
            "visits": [{"name": "Гость свой", "price": 100, "status": "waiting"}],
        }).raise_for_status()
        api_client.post("/api/v1/records", json={
            "activity_id": foreign_act["id"],
            "client_id": foreign_client["id"],
            "visits": [{"name": "Гость чужой", "price": 200, "status": "waiting"}],
        }).raise_for_status()
        return {
            "master": master,
            "own_client": own_client,
            "foreign_client": foreign_client,
            "lonely_client": lonely_client,
        }

    def test_list_scoped_only_own(self, scoped_world) -> None:
        """GET /clients without ?phone= — only clients with records on
        the master's own activities (stats assembly path)."""
        mc = scoped_world["master"]["client"]
        resp = mc.get("/api/v1/clients")
        assert resp.status_code == 200, resp.text
        ids = [c["id"] for c in resp.json()["items"]]
        assert scoped_world["own_client"]["id"] in ids
        assert scoped_world["foreign_client"]["id"] not in ids
        assert scoped_world["lonely_client"]["id"] not in ids
        assert resp.json()["total"] == 1

    def test_phone_search_finds_foreign_client(self, scoped_world) -> None:
        """?phone= (digits-mode) — NO scope: finds the foreign client
        across the whole studio (D4), masked response."""
        mc = scoped_world["master"]["client"]
        resp = mc.get("/api/v1/clients", params={"phone": "4445566"})
        assert resp.status_code == 200, resp.text
        items = resp.json()["items"]
        assert [c["id"] for c in items] == [scoped_world["foreign_client"]["id"]]

    def test_get_by_phone_finds_foreign_client(self, scoped_world) -> None:
        """GET /clients/get?phone= — NO scope: the typeahead endpoint
        searches all active clients; чужой found, not 404 (D4)."""
        mc = scoped_world["master"]["client"]
        resp = mc.get("/api/v1/clients/get", params={"phone": "+79004445566"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["id"] == scoped_world["foreign_client"]["id"]

    def test_empty_scope_list_empty_phone_search_still_works(
        self, api_client, create_service, create_location, make_master,
    ) -> None:
        """Master without a masters row: the plain list is EMPTY (never
        «the whole studio»), but phone search still reaches all clients."""
        master = make_master(with_masters_row=False)
        svc, loc = create_service(), create_location()
        from src.auth.passwords import hash_password
        from tests.conftest import insert_master_user

        other_staff = insert_master_user("+79995551303", hash_password("x"))["staff_id"]
        act_resp = api_client.post("/api/v1/activities", json={
            "master_id": other_staff,
            "service_id": svc["id"], "location_id": loc["id"],
            "start": TOMORROW, "duration": 90, "capacity": 10,
            "is_private": False,
        })
        assert act_resp.status_code == 201, act_resp.text
        act = act_resp.json()
        client_resp = api_client.post("/api/v1/clients", json={
            "name": "Кто-то", "phone": "+79019990011", "channel": "telegram",
        })
        assert client_resp.status_code == 201, client_resp.text
        client = client_resp.json()
        api_client.post("/api/v1/records", json={
            "activity_id": act["id"], "client_id": client["id"],
            "visits": [{"name": "Гость", "price": 100, "status": "waiting"}],
        }).raise_for_status()

        mc = master["client"]
        resp = mc.get("/api/v1/clients")
        assert resp.status_code == 200
        assert resp.json()["items"] == []
        assert resp.json()["total"] == 0
        # Phone search — across all clients, NOT scoped to the empty key.
        resp = mc.get("/api/v1/clients", params={"phone": "9990011"})
        assert resp.status_code == 200
        assert [c["id"] for c in resp.json()["items"]] == [client["id"]]


class TestClientMask:
    """D3 mask in EVERY client-bearing response for role=master."""

    @pytest.fixture
    def masked_world(self, api_client, create_service, create_location, make_master):
        """Master + one own client (record on own activity)."""
        master = make_master()
        svc, loc = create_service(), create_location()
        act_resp = api_client.post("/api/v1/activities", json={
            "master_id": master["staff_id"],
            "service_id": svc["id"], "location_id": loc["id"],
            "start": TOMORROW, "duration": 90, "capacity": 10,
            "is_private": False,
        })
        assert act_resp.status_code == 201, act_resp.text
        act = act_resp.json()
        client_resp = api_client.post("/api/v1/clients", json={
            "name": "Маскированный",
            "phone": "+7 909 123-45-67",
            "email": "mask@example.com",
            "channel": "telegram",
        })
        assert client_resp.status_code == 201, client_resp.text
        client = client_resp.json()
        api_client.post("/api/v1/records", json={
            "activity_id": act["id"], "client_id": client["id"],
            "visits": [{"name": "Гость", "price": 100, "status": "waiting"}],
        }).raise_for_status()
        return {"master": master, "client": client}

    def test_stats_list_masked(self, masked_world) -> None:
        """ClientWithStats path (manual builder): phone masked, email null;
        name/channel intact."""
        mc = masked_world["master"]["client"]
        resp = mc.get("/api/v1/clients")
        assert resp.status_code == 200, resp.text
        row = resp.json()["items"][0]
        assert row["phone"] == mask_phone("+7 909 123-45-67")
        assert row["email"] is None
        assert row["name"] == "Маскированный"
        assert row["channel"] == "telegram"

    def test_phone_search_list_masked(self, masked_world) -> None:
        """?phone= list path: masked despite being scope-free (D4)."""
        mc = masked_world["master"]["client"]
        resp = mc.get("/api/v1/clients", params={"phone": "1234567"})
        assert resp.status_code == 200, resp.text
        row = resp.json()["items"][0]
        assert row["phone"] == mask_phone("+7 909 123-45-67")
        assert row["email"] is None
        assert row["name"] == "Маскированный"

    def test_get_by_phone_masked(self, masked_world) -> None:
        """GET /clients/get?phone= typeahead: masked. The route is an
        EXACT-match lookup (domain rules clients.md) — the query carries
        the stored format."""
        mc = masked_world["master"]["client"]
        resp = mc.get("/api/v1/clients/get", params={"phone": "+7 909 123-45-67"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["phone"] == mask_phone("+7 909 123-45-67")
        assert resp.json()["email"] is None
        assert resp.json()["name"] == "Маскированный"

    def test_get_own_by_id_masked(self, masked_world) -> None:
        """GET /clients/{id} own → 200, masked."""
        mc = masked_world["master"]["client"]
        resp = mc.get(f"/api/v1/clients/{masked_world['client']['id']}")
        assert resp.status_code == 200, resp.text
        assert resp.json()["phone"] == mask_phone("+7 909 123-45-67")
        assert resp.json()["email"] is None

    def test_create_unmasked(self, masked_world) -> None:
        """POST /clients → 201 with the FULL phone (mutations are never
        masked — WYSIWYG #221)."""
        mc = masked_world["master"]["client"]
        resp = mc.post("/api/v1/clients", json={
            "name": "Новенький", "phone": "+79995556677",
            "email": "new@example.com", "channel": "telegram",
        })
        assert resp.status_code == 201, resp.text
        assert resp.json()["phone"] == "+79995556677"
        assert resp.json()["email"] == "new@example.com"

    def test_admin_unmasked_regression(self, masked_world, api_client) -> None:
        """Admin: no scope, no mask."""
        resp = api_client.get("/api/v1/clients")
        assert resp.status_code == 200
        row = next(
            c for c in resp.json()["items"]
            if c["id"] == masked_world["client"]["id"]
        )
        assert row["phone"] == "+7 909 123-45-67"
        assert row["email"] == "mask@example.com"


class TestClientPointGetScope:
    """GET /clients/{id}: свой → 200, чужой → 404 (404-fast-path)."""

    @pytest.fixture
    def two_clients(self, api_client, create_service, create_location, make_master):
        from src.auth.passwords import hash_password
        from tests.conftest import insert_master_user

        master = make_master()
        svc, loc = create_service(), create_location()
        foreign_staff = insert_master_user("+79995551302", hash_password("x"))["staff_id"]
        own_act = api_client.post("/api/v1/activities", json={
            "master_id": master["staff_id"],
            "service_id": svc["id"], "location_id": loc["id"],
            "start": TOMORROW, "duration": 90, "capacity": 10,
            "is_private": False,
        }).json()
        foreign_act = api_client.post("/api/v1/activities", json={
            "master_id": foreign_staff,
            "service_id": svc["id"], "location_id": loc["id"],
            "start": TOMORROW, "duration": 90, "capacity": 10,
            "is_private": False,
        }).json()
        own_client = api_client.post("/api/v1/clients", json={
            "name": "Точечный свой", "phone": "+79110001122",
            "channel": "telegram",
        }).json()
        foreign_client = api_client.post("/api/v1/clients", json={
            "name": "Точечный чужой", "phone": "+79110003344",
            "channel": "telegram",
        }).json()
        api_client.post("/api/v1/records", json={
            "activity_id": own_act["id"], "client_id": own_client["id"],
            "visits": [{"name": "Гость", "price": 100, "status": "waiting"}],
        }).raise_for_status()
        api_client.post("/api/v1/records", json={
            "activity_id": foreign_act["id"], "client_id": foreign_client["id"],
            "visits": [{"name": "Гость", "price": 200, "status": "waiting"}],
        }).raise_for_status()
        return {"master": master, "own": own_client, "foreign": foreign_client}

    def test_own_get_200(self, two_clients) -> None:
        mc = two_clients["master"]["client"]
        resp = mc.get(f"/api/v1/clients/{two_clients['own']['id']}")
        assert resp.status_code == 200, resp.text
        assert resp.json()["id"] == two_clients["own"]["id"]

    def test_foreign_get_404(self, two_clients) -> None:
        mc = two_clients["master"]["client"]
        resp = mc.get(f"/api/v1/clients/{two_clients['foreign']['id']}")
        assert resp.status_code == 404

    def test_missing_get_404(self, two_clients) -> None:
        mc = two_clients["master"]["client"]
        resp = mc.get("/api/v1/clients/00000000-0000-0000-0000-000000000000")
        assert resp.status_code == 404

    def test_admin_foreign_get_200_regression(self, two_clients, api_client) -> None:
        resp = api_client.get(f"/api/v1/clients/{two_clients['foreign']['id']}")
        assert resp.status_code == 200


class TestClientMutationGuards:
    """D7 pinned: POST → 201; existing-client mutations → 403 (T1 guards)."""

    @pytest.fixture
    def guard_world(self, api_client, create_service, create_location, make_master):
        master = make_master()
        svc, loc = create_service(), create_location()
        act = api_client.post("/api/v1/activities", json={
            "master_id": master["staff_id"],
            "service_id": svc["id"], "location_id": loc["id"],
            "start": TOMORROW, "duration": 90, "capacity": 10,
            "is_private": False,
        }).json()
        client = api_client.post("/api/v1/clients", json={
            "name": "Под охраной", "phone": "+79220001122",
            "email": "guard@example.com", "channel": "telegram",
        }).json()
        api_client.post("/api/v1/records", json={
            "activity_id": act["id"], "client_id": client["id"],
            "visits": [{"name": "Гость", "price": 100, "status": "waiting"}],
        }).raise_for_status()
        return {"master": master, "client": client}

    def test_master_post_201(self, guard_world) -> None:
        resp = guard_world["master"]["client"].post("/api/v1/clients", json={
            "name": "Мастер-клиент", "phone": "+79221113344",
            "channel": "telegram",
        })
        assert resp.status_code == 201, resp.text

    def test_master_patch_403(self, guard_world) -> None:
        cid = guard_world["client"]["id"]
        resp = guard_world["master"]["client"].patch(
            f"/api/v1/clients/{cid}", json={"name": "Взлом"}
        )
        assert resp.status_code == 403
        assert query_db(f"SELECT name FROM clients WHERE id='{cid}'")[0]["name"] == "Под охраной"

    def test_master_put_403(self, guard_world) -> None:
        cid = guard_world["client"]["id"]
        resp = guard_world["master"]["client"].put(
            f"/api/v1/clients/{cid}",
            json={"name": None, "phone": None, "email": None, "channel": None},
        )
        assert resp.status_code == 403

    def test_master_delete_403(self, guard_world) -> None:
        resp = guard_world["master"]["client"].delete(
            f"/api/v1/clients/{guard_world['client']['id']}"
        )
        assert resp.status_code == 403

    def test_master_archive_403(self, guard_world) -> None:
        resp = guard_world["master"]["client"].post(
            f"/api/v1/clients/{guard_world['client']['id']}/archive"
        )
        assert resp.status_code == 403

    def test_master_restore_403(self, guard_world) -> None:
        resp = guard_world["master"]["client"].post(
            f"/api/v1/clients/{guard_world['client']['id']}/restore"
        )
        assert resp.status_code == 403
