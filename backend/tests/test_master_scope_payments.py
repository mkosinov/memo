"""GH #263 T4 — payments scope: только оплаты своих записей.

Spec D5 (docs/specs/2026-09-10-master-role-design.md) + domain rules
«Master role (#263)» (docs/domain-rules/payments.md):

* у оплаты нет своей колонки мастера — скоуп только через
  payment → record → activity.master_id («всё через записи»);
* list отдаёт мастеру ТОЛЬКО оплаты своих записей; record_id-фильтр
  ANDится со скоупом (чужой record_id → пусто);
* точечные операции: свои — ок (мастер принимает оплату на месте),
  чужие → 404 (неразличимо с «не существует», 404-fast-path);
  PUT не может перепривязать оплату на чужую запись;
* GET /totals молча исключает чужие record_id перед агрегацией;
  все чужие → 200 {"totals": {}} (контракт ответа не меняется);
* admin → без скоупа: всё видно (regression-pinned).

The master session comes from the ``make_master`` conftest factory;
payments are seeded through the admin API.

Spec: docs/specs/2026-09-10-master-role-design.md
Domain rules: docs/domain-rules/payments.md (Master role #263)
"""

from __future__ import annotations

import uuid as _uuid

import pytest

from tests.conftest import query_db

pytestmark = pytest.mark.api


def _activity_payload(master_id: str, **overrides) -> dict:
    """Raw POST /activities payload bound to the given master key."""
    from datetime import UTC, datetime, timedelta

    svc = f"svc-{_uuid.uuid4().hex[:8]}"
    loc = f"loc-{_uuid.uuid4().hex[:8]}"
    return {
        "master_id": master_id,
        "service_id": svc,
        "location_id": loc,
        "start": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        "duration": 90,
        "capacity": 10,
        "is_private": False,
        **overrides,
    }


def _client_for(api_client, name: str) -> dict:
    """Unique client via the admin API (records need NOT NULL client_id)."""
    return api_client.post("/api/v1/clients", json={
        "name": name,
        "phone": f"+7999{_uuid.uuid4().hex[:7]}",
        "channel": "telegram",
    }).json()


def _seed_payment(api_client, record_id: str, amount: int) -> dict:
    """Seed one payment via the admin API (admin has no scope)."""
    resp = api_client.post("/api/v1/payments", json={
        "record_id": record_id, "amount": amount, "method": "card",
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestPaymentScope:
    """Payments: scoped via payment → record → activity."""

    @pytest.fixture
    def two_payments(self, api_client, create_service, create_location, make_master):
        """Own + foreign record (on real second master), one payment each."""
        from src.auth.passwords import hash_password
        from tests.conftest import insert_master_user

        master = make_master()
        svc, loc = create_service(), create_location()
        foreign_staff = insert_master_user(
            f"+7999{_uuid.uuid4().hex[:7]}", hash_password("x")
        )["staff_id"]
        own_act = api_client.post("/api/v1/activities", json=_activity_payload(
            master["staff_id"], service_id=svc["id"], location_id=loc["id"],
        )).json()
        foreign_act = api_client.post("/api/v1/activities", json=_activity_payload(
            foreign_staff, service_id=svc["id"], location_id=loc["id"],
        )).json()
        own_client = _client_for(api_client, "Свой клиент оплат")
        foreign_client = _client_for(api_client, "Чужой клиент оплат")
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
        own_pay = _seed_payment(api_client, own_rec["id"], 500)
        foreign_pay = _seed_payment(api_client, foreign_rec["id"], 700)
        return {
            "master": master,
            "own": {"record": own_rec, "payment": own_pay},
            "foreign": {"record": foreign_rec, "payment": foreign_pay},
        }

    # ── List ───────────────────────────────────────────────────────────────

    def test_list_shows_only_own(self, two_payments) -> None:
        mc = two_payments["master"]["client"]
        resp = mc.get("/api/v1/payments")
        assert resp.status_code == 200, resp.text
        ids = [p["id"] for p in resp.json()["items"]]
        assert two_payments["own"]["payment"]["id"] in ids
        assert two_payments["foreign"]["payment"]["id"] not in ids
        assert resp.json()["total"] == 1

    def test_list_record_id_param_conjunctive(self, two_payments) -> None:
        """record_id filter ≠ own record → conjunctive AND → empty."""
        mc = two_payments["master"]["client"]
        resp = mc.get("/api/v1/payments", params={
            "record_id": two_payments["foreign"]["record"]["id"],
        })
        assert resp.status_code == 200
        assert resp.json()["items"] == []
        assert resp.json()["total"] == 0

    def test_empty_scope_master_sees_nothing(
        self, api_client, create_service, create_location, make_master,
    ) -> None:
        """Master WITHOUT a masters row: empty set — not the studio."""
        from src.auth.passwords import hash_password
        from tests.conftest import insert_master_user

        master = make_master(with_masters_row=False)
        svc, loc = create_service(), create_location()
        foreign_staff = insert_master_user(
            f"+7999{_uuid.uuid4().hex[:7]}", hash_password("x")
        )["staff_id"]
        act = api_client.post("/api/v1/activities", json=_activity_payload(
            foreign_staff, service_id=svc["id"], location_id=loc["id"],
        )).json()
        rec = api_client.post("/api/v1/records", json={
            "activity_id": act["id"],
            "client_id": _client_for(api_client, "Клиент пустого скоупа")["id"],
            "visits": [{"name": "Гость", "price": 100, "status": "waiting"}],
        }).json()
        _seed_payment(api_client, rec["id"], 300)

        resp = master["client"].get("/api/v1/payments")
        assert resp.status_code == 200
        assert resp.json()["items"] == []
        assert resp.json()["total"] == 0

    def test_admin_sees_all_regression(self, two_payments, api_client) -> None:
        resp = api_client.get("/api/v1/payments")
        assert resp.status_code == 200
        assert resp.json()["total"] == 2

    # ── Point get ──────────────────────────────────────────────────────────

    def test_foreign_get_404(self, two_payments) -> None:
        mc = two_payments["master"]["client"]
        pid = two_payments["foreign"]["payment"]["id"]
        resp = mc.get(f"/api/v1/payments/{pid}")
        assert resp.status_code == 404

    def test_own_get_200(self, two_payments) -> None:
        mc = two_payments["master"]["client"]
        pay = two_payments["own"]["payment"]
        resp = mc.get(f"/api/v1/payments/{pay['id']}")
        assert resp.status_code == 200
        assert resp.json()["id"] == pay["id"]

    # ── Create ─────────────────────────────────────────────────────────────

    def test_create_own_parent_201(self, two_payments) -> None:
        mc = two_payments["master"]["client"]
        own_rec = two_payments["own"]["record"]
        resp = mc.post("/api/v1/payments", json={
            "record_id": own_rec["id"], "amount": 150, "method": "cash",
        })
        assert resp.status_code == 201, resp.text
        assert resp.json()["record_id"] == own_rec["id"]

    def test_create_foreign_parent_404(self, two_payments) -> None:
        mc = two_payments["master"]["client"]
        foreign_rec = two_payments["foreign"]["record"]
        resp = mc.post("/api/v1/payments", json={
            "record_id": foreign_rec["id"], "amount": 150, "method": "cash",
        })
        assert resp.status_code == 404, resp.text
        rows = query_db(
            f"SELECT id FROM payments WHERE record_id='{foreign_rec['id']}'"
        )
        assert len(rows) == 1  # only the seeded payment, nothing added

    def test_create_admin_foreign_parent_still_201(
        self, two_payments, api_client,
    ) -> None:
        """Admin regression: no scope on create."""
        resp = api_client.post("/api/v1/payments", json={
            "record_id": two_payments["foreign"]["record"]["id"],
            "amount": 250, "method": "cash",
        })
        assert resp.status_code == 201, resp.text

    # ── PUT / PATCH ────────────────────────────────────────────────────────

    def test_own_put_ok(self, two_payments) -> None:
        mc = two_payments["master"]["client"]
        pay = two_payments["own"]["payment"]
        resp = mc.put(f"/api/v1/payments/{pay['id']}", json={
            "record_id": pay["record_id"], "amount": 999, "method": "cash",
        })
        assert resp.status_code == 200, resp.text
        assert resp.json()["amount"] == 999

    def test_own_patch_ok(self, two_payments) -> None:
        mc = two_payments["master"]["client"]
        pay = two_payments["own"]["payment"]
        resp = mc.patch(f"/api/v1/payments/{pay['id']}", json={"amount": 888})
        assert resp.status_code == 200, resp.text
        assert resp.json()["amount"] == 888

    def test_foreign_put_404(self, two_payments) -> None:
        mc = two_payments["master"]["client"]
        pay = two_payments["foreign"]["payment"]
        resp = mc.put(f"/api/v1/payments/{pay['id']}", json={
            "record_id": pay["record_id"], "amount": 666, "method": "cash",
        })
        assert resp.status_code == 404, resp.text
        rows = query_db(f"SELECT amount FROM payments WHERE id='{pay['id']}'")
        assert rows[0]["amount"] == 700  # untouched

    def test_foreign_patch_404(self, two_payments) -> None:
        mc = two_payments["master"]["client"]
        pay = two_payments["foreign"]["payment"]
        resp = mc.patch(f"/api/v1/payments/{pay['id']}", json={"amount": 666})
        assert resp.status_code == 404, resp.text
        rows = query_db(f"SELECT amount FROM payments WHERE id='{pay['id']}'")
        assert rows[0]["amount"] == 700  # untouched

    def test_put_reparent_foreign_record_404(self, two_payments) -> None:
        """PUT own payment with a FOREIGN record_id → 404 (new-target gate)."""
        mc = two_payments["master"]["client"]
        pay = two_payments["own"]["payment"]
        foreign_rec = two_payments["foreign"]["record"]
        resp = mc.put(f"/api/v1/payments/{pay['id']}", json={
            "record_id": foreign_rec["id"], "amount": 999, "method": "cash",
        })
        assert resp.status_code == 404, resp.text
        # The payment did NOT move.
        rows = query_db(f"SELECT record_id FROM payments WHERE id='{pay['id']}'")
        assert rows[0]["record_id"] == pay["record_id"]

    # ── Delete ─────────────────────────────────────────────────────────────

    def test_own_delete_204(self, two_payments) -> None:
        mc = two_payments["master"]["client"]
        pay = two_payments["own"]["payment"]
        resp = mc.delete(f"/api/v1/payments/{pay['id']}")
        assert resp.status_code == 204
        assert not query_db(f"SELECT id FROM payments WHERE id='{pay['id']}'")

    def test_foreign_delete_404(self, two_payments) -> None:
        mc = two_payments["master"]["client"]
        pay = two_payments["foreign"]["payment"]
        resp = mc.delete(f"/api/v1/payments/{pay['id']}")
        assert resp.status_code == 404
        assert query_db(f"SELECT id FROM payments WHERE id='{pay['id']}'")

    # ── Totals ─────────────────────────────────────────────────────────────

    def test_totals_excludes_foreign(self, two_payments) -> None:
        """Mixed request: чужие record_ids молча исключены из выдачи."""
        mc = two_payments["master"]["client"]
        own_rid = two_payments["own"]["record"]["id"]
        foreign_rid = two_payments["foreign"]["record"]["id"]
        resp = mc.get("/api/v1/payments/totals", params=[
            ("record_ids", own_rid), ("record_ids", foreign_rid),
        ])
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"totals": {own_rid: 500}}

    def test_totals_all_foreign_empty(self, two_payments) -> None:
        """All-foreign request → 200 with empty totals (shape unchanged)."""
        mc = two_payments["master"]["client"]
        foreign_rid = two_payments["foreign"]["record"]["id"]
        resp = mc.get("/api/v1/payments/totals", params=[
            ("record_ids", foreign_rid),
        ])
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"totals": {}}

    def test_totals_own_record_ok(self, two_payments) -> None:
        mc = two_payments["master"]["client"]
        own_rid = two_payments["own"]["record"]["id"]
        resp = mc.get("/api/v1/payments/totals", params=[
            ("record_ids", own_rid),
        ])
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"totals": {own_rid: 500}}

    def test_totals_admin_sees_all_regression(self, two_payments, api_client) -> None:
        own_rid = two_payments["own"]["record"]["id"]
        foreign_rid = two_payments["foreign"]["record"]["id"]
        resp = api_client.get("/api/v1/payments/totals", params=[
            ("record_ids", own_rid), ("record_ids", foreign_rid),
        ])
        assert resp.status_code == 200
        assert resp.json() == {"totals": {own_rid: 500, foreign_rid: 700}}
