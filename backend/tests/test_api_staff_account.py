"""GH #348 Task 6 — the ``account`` block in the staff card response.

Spec §5: ``StaffResponse`` grows ``account: {phone, role, password_is_set,
is_active, link_expires_at} | null`` — the card's CURRENT account (ANY
``is_active``: an archived account is shown as archived, not dropped);
``has_user`` stays. ``link_expires_at`` is the expiry of the LIVE token
(``used_at IS NULL`` AND ``expires_at > now``) or ``null`` — used/expired
links carry no date.

This suite pins the HTTP contract of the serializer only; the phone edit,
link issue and public setup endpoints are covered by test_api_users.py /
test_auth_password_setup_api.py (Tasks 4-5).
"""

import hashlib
import uuid as _uuid
from datetime import datetime, timedelta

import pytest

from tests.conftest import insert_user, query_db_params

pytestmark = pytest.mark.api

_PHONE = "+79990016801"


# ─── helpers ───────────────────────────────────────────────────────────────────


def _make_card(api_client) -> str:
    resp = api_client.post(
        "/api/v1/staff", json={"first_name": "Ольга", "last_name": "Иванова"}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _link_account(staff_id: str, phone: str, *, is_active: bool = True) -> str:
    """Insert a users row bound to the card; return its id."""
    user = insert_user(phone, "x", role="master", master_id=staff_id)
    if not is_active:
        query_db_params(
            "UPDATE users SET is_active = 0 WHERE id = :id", {"id": user["id"]}
        )
    return user["id"]


def _seed_token(user_id: str, *, hours: float = 24, used: bool = False) -> str:
    """Insert a setup-token row (PK = digest of a random raw token)."""
    raw = _uuid.uuid4().hex
    digest = hashlib.sha256(raw.encode()).hexdigest()
    # SQLite modifier grammar: {+|-}N seconds — one sign, no "+-".
    seconds = int(hours * 3600)
    modifier = f"{seconds:+d} seconds"
    query_db_params(
        "INSERT INTO password_setup_tokens (token, user_id, expires_at, "
        "used_at, created_at) VALUES (:token, :uid, "
        "datetime('now', :exp), "
        + ("datetime('now')" if used else "NULL")
        + ", datetime('now'))",
        {
            "token": digest,
            "uid": user_id,
            "exp": modifier,
        },
    )
    return digest


# ─── the account block ─────────────────────────────────────────────────────────


class TestStaffAccountBlock:
    def test_no_account_null(self, api_client) -> None:
        staff_id = _make_card(api_client)

        resp = api_client.get(f"/api/v1/staff/{staff_id}")

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["account"] is None
        assert body["has_user"] is False

    def test_active_account_full_shape(self, api_client) -> None:
        staff_id = _make_card(api_client)
        user_id = _link_account(staff_id, _PHONE)

        resp = api_client.get(f"/api/v1/staff/{staff_id}")

        assert resp.status_code == 200, resp.text
        account = resp.json()["account"]
        assert account is not None
        assert set(account) == {
            "id",  # users.id — the users-vertical address key (#348 Task 7)
            "phone",
            "role",
            "password_is_set",
            "is_active",
            "link_expires_at",
        }
        assert account["id"] == user_id
        assert account["phone"] == _PHONE
        assert account["role"] == "master"
        assert account["password_is_set"] is True  # insert_user hash "x"
        assert account["is_active"] is True
        assert account["link_expires_at"] is None  # no token issued
        assert resp.json()["has_user"] is True

    def test_archived_account_reported_not_dropped(self, api_client) -> None:
        staff_id = _make_card(api_client)
        _link_account(staff_id, _PHONE, is_active=False)

        resp = api_client.get(f"/api/v1/staff/{staff_id}")

        assert resp.status_code == 200, resp.text
        account = resp.json()["account"]
        assert account is not None
        assert account["is_active"] is False
        assert resp.json()["has_user"] is True  # ANY row counts (T8)

    def test_live_token_expiry_carried(self, api_client) -> None:
        staff_id = _make_card(api_client)
        user_id = _link_account(staff_id, _PHONE)
        _seed_token(user_id, hours=24)

        resp = api_client.get(f"/api/v1/staff/{staff_id}")

        assert resp.status_code == 200, resp.text
        link_expires_at = resp.json()["account"]["link_expires_at"]
        assert link_expires_at is not None
        # The seeded expiry (now + 24 h) survives to the wire: within a
        # minute of the expected instant, ISO-shaped.
        expected = datetime.utcnow() + timedelta(hours=24)
        assert abs(
            datetime.fromisoformat(link_expires_at) - expected
        ) < timedelta(minutes=1)

    def test_used_token_null(self, api_client) -> None:
        staff_id = _make_card(api_client)
        user_id = _link_account(staff_id, _PHONE)
        _seed_token(user_id, used=True)

        resp = api_client.get(f"/api/v1/staff/{staff_id}")

        assert resp.status_code == 200, resp.text
        assert resp.json()["account"]["link_expires_at"] is None

    def test_expired_token_null(self, api_client) -> None:
        staff_id = _make_card(api_client)
        user_id = _link_account(staff_id, _PHONE)
        _seed_token(user_id, hours=-1)

        resp = api_client.get(f"/api/v1/staff/{staff_id}")

        assert resp.status_code == 200, resp.text
        assert resp.json()["account"]["link_expires_at"] is None

    def test_list_carries_account_block(self, api_client) -> None:
        """The paginated list and /all use the same assembly — one probe."""
        staff_id = _make_card(api_client)
        _link_account(staff_id, _PHONE)

        listed = api_client.get("/api/v1/staff").json()["items"]

        mine = next(s for s in listed if s["id"] == staff_id)
        assert mine["account"]["phone"] == _PHONE
        all_rows = api_client.get("/api/v1/staff/all").json()
        mine_all = next(s for s in all_rows if s["id"] == staff_id)
        assert mine_all["account"]["phone"] == _PHONE
