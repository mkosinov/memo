"""GH #348 Task 4 — the users API vertical (spec §5/§7).

Two admin-only endpoints over the account scenarios of Tasks 2–3:

* ``PATCH /api/v1/users/{id}`` — body strictly ``{phone}`` (extra keys →
  422); success → ``200`` account ``{id, phone, role, staff_id,
  password_is_set, is_active}``; errors: 404 unknown account, 422
  ``PHONE_TAKEN`` / ``PHONE_INVALID``;
* ``POST /api/v1/users/{id}/password-link`` — ``200 {token, expires_at}``
  (the raw token shown once); errors: 404 unknown account, 422
  ``ACCOUNT_DEACTIVATED``.

Access (spec §7, S7): both under ``require_admin`` — master → 403,
anonymous → 401. The phone/audit/one-live-token semantics are covered by
the usecase suites (tests/usecases/test_user_phone.py,
test_password_setup.py); this file pins the HTTP contract only.
"""

import hashlib
import json
import uuid
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from src.auth.passwords import hash_password
from tests.conftest import ADMIN_PHONE, insert_user, query_db, query_db_params

pytestmark = pytest.mark.api

MASTER_PASSWORD = "master-pass-1"
_PHONE_A = "+79990001551"  # the account under edit
_PHONE_B = "+79990001552"  # the new phone


# ─── helpers ───────────────────────────────────────────────────────────────────


def _master_client(app, login_as) -> TestClient:
    """A logged-in master (role check target, S7)."""
    phone = f"+7999{uuid.uuid4().hex[:7]}"
    insert_user(phone, hash_password(MASTER_PASSWORD), role="master")
    return login_as(phone, MASTER_PASSWORD)


def _deactivate(user_id: str) -> None:
    query_db_params("UPDATE users SET is_active = 0 WHERE id = :id", {"id": user_id})


def _strip_password(user_id: str) -> None:
    """#348: NULL the hash — the account becomes passwordless."""
    query_db_params(
        "UPDATE users SET password_hash = NULL WHERE id = :id",
        {"id": user_id},
    )


def _admin_id() -> str:
    """The fixture admin's users.id (journal author of a guarded call)."""
    return query_db(f"SELECT id FROM users WHERE phone='{ADMIN_PHONE}'")[0]["id"]


_ACCOUNT_KEYS = {
    "id",
    "phone",
    "role",
    "staff_id",
    "password_is_set",
    "is_active",
}


# ─── Access (spec §7, S7: require_admin — master 403, anonymous 401) ──────────


class TestUsersAccess:
    def test_anonymous_gets_401(self, app) -> None:
        anon = TestClient(app)
        assert (
            anon.patch(f"/api/v1/users/{uuid.uuid4()}", json={"phone": _PHONE_B}).status_code == 401
        )
        assert anon.post(f"/api/v1/users/{uuid.uuid4()}/password-link").status_code == 401

    def test_master_gets_403_patch(self, app, login_as) -> None:
        master = _master_client(app, login_as)
        resp = master.patch(f"/api/v1/users/{uuid.uuid4()}", json={"phone": _PHONE_B})
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "AUTH_FORBIDDEN"

    def test_master_gets_403_password_link(self, app, login_as) -> None:
        master = _master_client(app, login_as)
        resp = master.post(f"/api/v1/users/{uuid.uuid4()}/password-link")
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "AUTH_FORBIDDEN"


# ─── PATCH /api/v1/users/{id} — the admin-side phone edit (S5) ────────────────


class TestPatchUserPhone:
    def test_success_returns_account_shape(self, api_client) -> None:
        user = insert_user(_PHONE_A, "x", role="master")

        resp = api_client.patch(f"/api/v1/users/{user['id']}", json={"phone": _PHONE_B})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert set(body) == _ACCOUNT_KEYS, f"strict account shape: {body}"
        assert body["id"] == user["id"]
        assert body["phone"] == _PHONE_B
        assert body["role"] == "master"
        assert body["staff_id"] is None
        assert body["password_is_set"] is True  # hash present ("x")
        assert body["is_active"] is True
        # DB truth: the phone moved.
        stored = query_db(f"SELECT phone FROM users WHERE id='{user['id']}'")
        assert stored[0]["phone"] == _PHONE_B

    def test_phone_is_trimmed(self, api_client) -> None:
        user = insert_user(_PHONE_A, "x", role="master")

        resp = api_client.patch(
            f"/api/v1/users/{user['id']}",
            json={"phone": f"  {_PHONE_B}  "},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["phone"] == _PHONE_B

    def test_passwordless_account_reports_false(self, api_client) -> None:
        user = insert_user(_PHONE_A, "x", role="master")
        _strip_password(user["id"])  # #348: password_hash NULL

        resp = api_client.patch(f"/api/v1/users/{user['id']}", json={"phone": _PHONE_B})

        assert resp.status_code == 200, resp.text
        assert resp.json()["password_is_set"] is False

    def test_staff_linked_account_returns_staff_id(self, api_client) -> None:
        staff_id = f"staff-{uuid.uuid4().hex[:8]}"
        query_db_params(
            "INSERT INTO staff (id, first_name, last_name, sort_order, "
            "is_active, created_at, updated_at) VALUES (:id, 'Иван', "
            "'Иванов', 0, 1, datetime('now'), datetime('now'))",
            {"id": staff_id},
        )
        user = insert_user(_PHONE_A, "x", role="master", master_id=staff_id)

        resp = api_client.patch(f"/api/v1/users/{user['id']}", json={"phone": _PHONE_B})

        assert resp.status_code == 200, resp.text
        assert resp.json()["staff_id"] == staff_id

    def test_unknown_user_404(self, api_client) -> None:
        resp = api_client.patch("/api/v1/users/no-such-user", json={"phone": _PHONE_B})
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "USER_NOT_FOUND"

    def test_phone_taken_422(self, api_client) -> None:
        user = insert_user(_PHONE_A, "x", role="master")
        insert_user(_PHONE_B, "x", role="admin")  # the holder

        resp = api_client.patch(f"/api/v1/users/{user['id']}", json={"phone": _PHONE_B})

        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "PHONE_TAKEN"
        # The failed edit left the row untouched.
        stored = query_db(f"SELECT phone FROM users WHERE id='{user['id']}'")
        assert stored[0]["phone"] == _PHONE_A

    def test_blank_phone_422_phone_invalid(self, api_client) -> None:
        """Whitespace passes any schema check but is blank after trim —
        the shared domain validator rejects it (PHONE_INVALID)."""
        user = insert_user(_PHONE_A, "x", role="master")

        resp = api_client.patch(f"/api/v1/users/{user['id']}", json={"phone": "   "})

        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "PHONE_INVALID"

    def test_overlong_phone_422_phone_invalid(self, api_client) -> None:
        """21 chars after trim — the domain rule (1–20), not a generic
        schema error (the errors.py registry pins PHONE_INVALID to
        «blank or over 20 chars after trim»)."""
        user = insert_user(_PHONE_A, "x", role="master")

        resp = api_client.patch(
            f"/api/v1/users/{user['id']}",
            json={"phone": "+7" + "9" * 19},
        )

        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "PHONE_INVALID"

    def test_extra_keys_rejected_422(self, api_client) -> None:
        user = insert_user(_PHONE_A, "x", role="master")

        resp = api_client.patch(
            f"/api/v1/users/{user['id']}",
            json={"phone": _PHONE_B, "role": "admin"},
        )

        assert resp.status_code == 422

    def test_missing_phone_rejected_422(self, api_client) -> None:
        user = insert_user(_PHONE_A, "x", role="master")

        resp = api_client.patch(f"/api/v1/users/{user['id']}", json={})

        assert resp.status_code == 422


# ─── POST /api/v1/users/{id}/password-link — the admin-side issue (S3) ────────


class TestIssuePasswordLink:
    def test_success_returns_token_and_expiry(self, api_client) -> None:
        user = insert_user(_PHONE_A, "x", role="master")

        resp = api_client.post(f"/api/v1/users/{user['id']}/password-link")

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert set(body) == {"token", "expires_at"}, f"strict shape: {body}"
        assert isinstance(body["token"], str) and len(body["token"]) >= 32
        expires = datetime.fromisoformat(body["expires_at"])
        now = datetime.utcnow()
        assert now + timedelta(hours=23) < expires < now + timedelta(hours=25)
        # DB truth: ONE live token row; the digest is stored, never the raw.
        rows = query_db(
            "SELECT token, used_at, expires_at FROM password_setup_tokens "
            f"WHERE user_id='{user['id']}'"
        )
        assert len(rows) == 1
        assert rows[0]["used_at"] is None
        assert rows[0]["token"] == hashlib.sha256(body["token"].encode()).hexdigest()
        assert rows[0]["token"] != body["token"]

    def test_reissue_keeps_single_live_token(self, api_client) -> None:
        user = insert_user(_PHONE_A, "x", role="master")

        first = api_client.post(f"/api/v1/users/{user['id']}/password-link").json()
        second = api_client.post(f"/api/v1/users/{user['id']}/password-link").json()

        assert second["token"] != first["token"]
        rows = query_db(
            f"SELECT COUNT(*) AS c FROM password_setup_tokens WHERE user_id='{user['id']}'"
        )
        assert rows[0]["c"] == 1  # the former token is swept, not kept

    def test_unknown_user_404(self, api_client) -> None:
        resp = api_client.post("/api/v1/users/no-such-user/password-link")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "USER_NOT_FOUND"

    def test_deactivated_account_422(self, api_client) -> None:
        user = insert_user(_PHONE_A, "x", role="master")
        _deactivate(user["id"])

        resp = api_client.post(f"/api/v1/users/{user['id']}/password-link")

        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "ACCOUNT_DEACTIVATED"
        # Refused BEFORE any write — no token row for the account.
        rows = query_db(
            f"SELECT COUNT(*) AS c FROM password_setup_tokens WHERE user_id='{user['id']}'"
        )
        assert rows[0]["c"] == 0

    def test_issue_journals_audit_row(self, api_client) -> None:
        """Spec §8: the issue lands ONE action-only journal row, author =
        the issuing admin (staged by the session guard)."""
        user = insert_user(_PHONE_A, "x", role="master")

        resp = api_client.post(f"/api/v1/users/{user['id']}/password-link")

        assert resp.status_code == 200, resp.text
        rows = query_db("SELECT user_id, action, entity, entity_id, changes FROM audit_logs")
        assert len(rows) == 1, f"exactly one journal row expected: {rows}"
        row = rows[0]
        assert row["action"] == "password_link_issued"
        assert row["entity"] == "users"
        assert row["entity_id"] == user["id"]
        assert row["user_id"] == _admin_id()
        # Action-only mark — no field snapshot (stored as JSON 'null').
        assert json.loads(row["changes"]) is None
