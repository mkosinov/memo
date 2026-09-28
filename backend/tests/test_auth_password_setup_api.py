"""GH #348 Task 5 — the PUBLIC password-setup endpoints + passwordless login.

``POST /api/v1/auth/password-setup/validate`` and
``POST /api/v1/auth/password-setup`` (spec §5/§7,
docs/specs/2026-09-27-user-accounts-348-design.md; canon
docs/domain-rules/auth.md «Одноразовая ссылка установки пароля», Public
Access, Sessions):

* both routes are anonymous (``PUBLIC_ROUTES`` — the default-deny
  allowlist); the authority is the one-time token itself (spec §7);
* invalid-token attempts on EITHER route feed the shared §3.4 per-IP
  failure counter (the login counter — same 15-min window, threshold
  20 — NOT a new one); a tripped IP is pre-gated to 429
  ``AUTH_LOCKED_OUT`` before any work, even for a VALID token;
* validate answers 200 ``{"ok": true}`` only when the token exists, is
  unused, unexpired AND the account is active — every other outcome is
  the single 422 ``PASSWORD_LINK_INVALID`` (one answer for all four);
* setup → 204 (consume + hash + full ladder reset + session revocation
  — the Task 2 scenario), 422 ``PASSWORD_LINK_INVALID`` on reuse /
  expiry / inactive account (the token stays live — an archive never
  burns the link), 422 ``PASSWORD_POLICY`` on a weak password (the
  policy check runs before the token);
* login of a passwordless account (``password_hash`` NULL): the
  ORDINARY 401 ``AUTH_INVALID_CREDENTIALS`` (same as the unknown-phone
  branch — a distinct status would leak that the account exists without
  a password), no 500, the ladder is NOT fed (no brute-forceable
  secret), the in-memory phone+IP counters ARE bumped exactly like the
  unknown-phone branch.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from src.auth import service as service_module
from src.auth.service import IP_FAILURE_THRESHOLD
from src.errors import ErrorCode
from tests.conftest import insert_user, query_db, query_db_params

pytestmark = pytest.mark.api

VALIDATE = "/api/v1/auth/password-setup/validate"
SETUP = "/api/v1/auth/password-setup"
NEW_PASSWORD = "new-pass-123"

# Distinct per-test phones (users.phone is UNIQUE; reset_db truncates
# between tests so fixed values are fine within a test).
_PHONE = "+79990016701"


# ─── helpers ───────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _clear_failure_counters():
    """Isolate the module-level in-memory lockout store between tests."""
    service_module._FAILURE_COUNTERS.clear()
    yield
    service_module._FAILURE_COUNTERS.clear()


@pytest.fixture
def anon(app):
    """A fresh anonymous TestClient (no cookie jar)."""
    c = TestClient(app)
    yield c
    c.close()


def _digest(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _seed_token(user_id: str, raw: str, *, hours: int = 24, used: bool = False) -> str:
    """Insert a setup-token row for a RAW token; returns its digest."""
    used_expr = "datetime('now')" if used else "NULL"
    digest = _digest(raw)
    query_db_params(
        "INSERT INTO password_setup_tokens"
        " (token, user_id, expires_at, used_at, created_at)"
        f" VALUES (:t, :u, datetime('now', '+{hours} hours'), {used_expr},"
        " datetime('now'))",
        {"t": digest, "u": user_id},
    )
    return digest


def _expire(digest: str) -> None:
    query_db_params(
        "UPDATE password_setup_tokens SET expires_at = datetime('now', '-1 hour') WHERE token = :t",
        {"t": digest},
    )


def _deactivate(user_id: str) -> None:
    query_db_params("UPDATE users SET is_active = 0 WHERE id = :i", {"i": user_id})


def _strip_password(user_id: str) -> None:
    """#348: NULL the hash — the account becomes passwordless."""
    query_db_params("UPDATE users SET password_hash = NULL WHERE id = :i", {"i": user_id})


def _seed_session(user_id: str) -> None:
    query_db_params(
        "INSERT INTO sessions (token, user_id, created_at, last_extended_at,"
        " idle_deadline, absolute_deadline) VALUES (:t, :u, datetime('now'),"
        " datetime('now'), datetime('now', '+1 day'),"
        " datetime('now', '+20 days'))",
        {"t": f"sess-{uuid.uuid4().hex}", "u": user_id},
    )


def _seed_hard_lock(user_id: str) -> None:
    query_db_params(
        "UPDATE users SET failed_login_attempts = 2, lock_level = 3,"
        " locked_until = NULL WHERE id = :i",
        {"i": user_id},
    )


def _user_row(user_id: str) -> dict:
    rows = query_db(
        "SELECT password_hash, failed_login_attempts, lock_level,"
        f" locked_until FROM users WHERE id = '{user_id}'"
    )
    assert rows, "user row vanished"
    return rows[0]


def _token_row(digest: str) -> dict:
    rows = query_db(
        f"SELECT used_at, expires_at FROM password_setup_tokens WHERE token = '{digest}'"
    )
    assert rows, "token row vanished"
    return rows[0]


def _code(resp) -> str:
    return resp.json()["detail"]["code"]


# ─── POST /auth/password-setup/validate ────────────────────────────────────────


class TestValidateEndpoint:
    def test_live_token_200_ok(self, anon) -> None:
        user = insert_user(_PHONE, "x", role="master")
        _seed_token(user["id"], "raw-validate-live")

        resp = anon.post(VALIDATE, json={"token": "raw-validate-live"})

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"ok": True}

    def test_validate_never_consumes_the_link(self, api_client, anon) -> None:
        """The probe is a pure read — the link survives for the real setup
        (the conditional consume lives ONLY in set_password_by_link)."""
        user = insert_user(_PHONE, "x", role="master")
        issued = api_client.post(f"/api/v1/users/{user['id']}/password-link")
        assert issued.status_code == 200, issued.text
        raw = issued.json()["token"]

        probe = anon.post(VALIDATE, json={"token": raw})
        assert probe.status_code == 200, probe.text

        setup = anon.post(SETUP, json={"token": raw, "password": NEW_PASSWORD})
        assert setup.status_code == 204, setup.text

    def test_unknown_token_422_link_invalid(self, anon) -> None:
        user = insert_user(_PHONE, "x", role="master")
        _seed_token(user["id"], "raw-validate-live")

        resp = anon.post(VALIDATE, json={"token": "never-issued-token"})

        assert resp.status_code == 422, resp.text
        assert _code(resp) == ErrorCode.PASSWORD_LINK_INVALID.value

    def test_used_token_422(self, anon) -> None:
        user = insert_user(_PHONE, "x", role="master")
        _seed_token(user["id"], "raw-validate-used", used=True)

        resp = anon.post(VALIDATE, json={"token": "raw-validate-used"})

        assert resp.status_code == 422
        assert _code(resp) == ErrorCode.PASSWORD_LINK_INVALID.value

    def test_expired_token_422(self, anon) -> None:
        """Expiry is forced by redating the row (the scenario TTL parameter
        is covered by the usecase suite; here the HTTP contract is pinned)."""
        user = insert_user(_PHONE, "x", role="master")
        digest = _seed_token(user["id"], "raw-validate-expired", hours=1)
        _expire(digest)

        resp = anon.post(VALIDATE, json={"token": "raw-validate-expired"})

        assert resp.status_code == 422
        assert _code(resp) == ErrorCode.PASSWORD_LINK_INVALID.value

    async def test_expired_via_scenario_ttl_422(self, db_session, anon) -> None:
        """The plan's expiry path: the срок is substituted via the scenario
        parameter (negative ttl), never by clock tricks."""
        from datetime import timedelta

        from src.usecases.password_setup import issue_password_link

        user = insert_user(_PHONE, "x", role="master")
        link = await issue_password_link(
            None,
            db_session=db_session,
            user_id=user["id"],
            ttl=timedelta(seconds=-1),
        )
        assert link is not None

        resp = anon.post(VALIDATE, json={"token": link.raw_token})

        assert resp.status_code == 422
        assert _code(resp) == ErrorCode.PASSWORD_LINK_INVALID.value

    def test_inactive_account_422(self, anon) -> None:
        user = insert_user(_PHONE, "x", role="master")
        _seed_token(user["id"], "raw-validate-inactive")
        _deactivate(user["id"])

        resp = anon.post(VALIDATE, json={"token": "raw-validate-inactive"})

        assert resp.status_code == 422
        assert _code(resp) == ErrorCode.PASSWORD_LINK_INVALID.value

    def test_blank_token_422_schema(self, anon) -> None:
        resp = anon.post(VALIDATE, json={"token": ""})
        assert resp.status_code == 422

    def test_missing_token_422_schema(self, anon) -> None:
        resp = anon.post(VALIDATE, json={})
        assert resp.status_code == 422


# ─── POST /auth/password-setup ─────────────────────────────────────────────────


class TestSetupEndpoint:
    def test_full_path_issue_setup_login(self, api_client, anon) -> None:
        """S1 end-to-end: admin issues → employee sets → employee logs in."""
        user = insert_user(_PHONE, "x", role="master")

        issued = api_client.post(f"/api/v1/users/{user['id']}/password-link")
        assert issued.status_code == 200, issued.text
        raw = issued.json()["token"]

        resp = anon.post(SETUP, json={"token": raw, "password": NEW_PASSWORD})
        assert resp.status_code == 204, resp.text

        # The token is consumed exactly once (digest row marked used).
        assert _token_row(_digest(raw))["used_at"] is not None

        # The owner can now log in with the new password.
        login = anon.post(
            "/api/v1/auth/login",
            json={"phone": _PHONE, "password": NEW_PASSWORD},
        )
        assert login.status_code == 200, login.text
        assert login.json()["user"]["id"] == user["id"]

    def test_setup_resets_ladder_and_revokes_sessions(self, anon) -> None:
        """Spec §4: consume + hash + WHOLE ladder reset (hard lock too) +
        every session revoked — one transaction."""
        user = insert_user(_PHONE, "x", role="master")
        _seed_hard_lock(user["id"])
        _seed_session(user["id"])
        _seed_session(user["id"])
        raw = "raw-setup-reset"
        _seed_token(user["id"], raw)

        resp = anon.post(SETUP, json={"token": raw, "password": NEW_PASSWORD})

        assert resp.status_code == 204, resp.text
        row = _user_row(user["id"])
        assert row["password_hash"] is not None
        assert row["failed_login_attempts"] == 0
        assert row["lock_level"] == 0
        assert row["locked_until"] is None
        sessions = query_db(f"SELECT COUNT(*) AS c FROM sessions WHERE user_id = '{user['id']}'")
        assert sessions[0]["c"] == 0

    def test_token_reuse_422(self, anon) -> None:
        user = insert_user(_PHONE, "x", role="master")
        raw = "raw-setup-reuse"
        _seed_token(user["id"], raw)

        first = anon.post(SETUP, json={"token": raw, "password": NEW_PASSWORD})
        assert first.status_code == 204, first.text

        second = anon.post(SETUP, json={"token": raw, "password": "another-pass-1"})
        assert second.status_code == 422
        assert _code(second) == ErrorCode.PASSWORD_LINK_INVALID.value

    def test_reuse_does_not_overwrite_first_password(self, anon) -> None:
        """The reuse attempt must not hijack the account: the FIRST
        password still logs in, the attacker's does not."""
        user = insert_user(_PHONE, "x", role="master")
        raw = "raw-setup-hijack"
        _seed_token(user["id"], raw)

        assert anon.post(SETUP, json={"token": raw, "password": NEW_PASSWORD}).status_code == 204
        assert (
            anon.post(SETUP, json={"token": raw, "password": "attacker-pass-1"}).status_code == 422
        )

        good = anon.post(
            "/api/v1/auth/login",
            json={"phone": _PHONE, "password": NEW_PASSWORD},
        )
        assert good.status_code == 200, good.text
        bad = anon.post(
            "/api/v1/auth/login",
            json={"phone": _PHONE, "password": "attacker-pass-1"},
        )
        assert bad.status_code == 401

    def test_expired_token_422(self, anon) -> None:
        user = insert_user(_PHONE, "x", role="master")
        digest = _seed_token(user["id"], "raw-setup-expired", hours=1)
        _expire(digest)

        resp = anon.post(SETUP, json={"token": "raw-setup-expired", "password": NEW_PASSWORD})

        assert resp.status_code == 422
        assert _code(resp) == ErrorCode.PASSWORD_LINK_INVALID.value
        # The password did NOT land for the expired link.
        assert _user_row(user["id"])["password_hash"] == "x"

    def test_inactive_account_422_and_token_stays_live(self, anon) -> None:
        user = insert_user(_PHONE, "x", role="master")
        digest = _seed_token(user["id"], "raw-setup-inactive")
        _deactivate(user["id"])

        resp = anon.post(SETUP, json={"token": "raw-setup-inactive", "password": NEW_PASSWORD})

        assert resp.status_code == 422
        assert _code(resp) == ErrorCode.PASSWORD_LINK_INVALID.value
        # An archive never burns the link — the row keeps used_at NULL.
        assert _token_row(digest)["used_at"] is None

    def test_policy_violation_422_and_token_live(self, anon) -> None:
        user = insert_user(_PHONE, "x", role="master")
        digest = _seed_token(user["id"], "raw-setup-policy")

        resp = anon.post(SETUP, json={"token": "raw-setup-policy", "password": "short"})

        assert resp.status_code == 422, resp.text
        assert _code(resp) == ErrorCode.PASSWORD_POLICY.value
        # Policy runs BEFORE the token — the link is untouched.
        assert _token_row(digest)["used_at"] is None
        assert _user_row(user["id"])["password_hash"] == "x"

    def test_error_shape_code_and_message(self, anon) -> None:
        """The 422 body is the ErrorDetail contract: {code, message}."""
        resp = anon.post(VALIDATE, json={"token": "no-such-token"})

        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert set(detail) == {"code", "message"}
        assert detail["code"] == ErrorCode.PASSWORD_LINK_INVALID.value
        assert detail["message"] == "Ссылка недействительна или истекла"

    def test_missing_password_422_schema(self, anon) -> None:
        resp = anon.post(SETUP, json={"token": "whatever"})
        assert resp.status_code == 422


# ─── shared per-IP failure counter (§3.4 extension, both routes) ───────────────


class TestPublicIpCounter:
    def test_invalid_attempts_on_both_routes_trip_shared_counter(self, anon) -> None:
        """19 mixed invalid attempts (validate + setup) → 422 each; the
        20th trips the shared per-IP gate → 429 AUTH_LOCKED_OUT."""
        user = insert_user(_PHONE, "x", role="master")
        raw = "raw-counter-mixed"
        _seed_token(user["id"], raw, used=True)  # valid digest, consumed

        statuses: list[int] = []
        last = None
        for i in range(20):
            if i % 2 == 0:
                last = anon.post(VALIDATE, json={"token": "bogus-token"})
            else:
                last = anon.post(SETUP, json={"token": raw, "password": NEW_PASSWORD})
            statuses.append(last.status_code)

        assert statuses[:19] == [422] * 19, statuses
        assert last is not None
        assert last.status_code == 429
        assert _code(last) == ErrorCode.AUTH_LOCKED_OUT.value
        assert "retry-after" in last.headers
        assert int(last.headers["retry-after"]) > 0

    def test_tripped_ip_pre_gates_valid_validate(self, anon) -> None:
        """The gate runs BEFORE the work: a tripped IP gets 429 even for
        a perfectly valid token."""
        user = insert_user(_PHONE, "x", role="master")
        _seed_token(user["id"], "raw-gate-valid")
        service_module._FAILURE_COUNTERS["ip:testclient"] = (
            IP_FAILURE_THRESHOLD,
            datetime.utcnow(),
        )

        resp = anon.post(VALIDATE, json={"token": "raw-gate-valid"})

        assert resp.status_code == 429
        assert _code(resp) == ErrorCode.AUTH_LOCKED_OUT.value

    def test_tripped_ip_pre_gates_setup_and_keeps_token_live(self, anon) -> None:
        user = insert_user(_PHONE, "x", role="master")
        digest = _seed_token(user["id"], "raw-gate-setup")
        service_module._FAILURE_COUNTERS["ip:testclient"] = (
            IP_FAILURE_THRESHOLD,
            datetime.utcnow(),
        )

        resp = anon.post(SETUP, json={"token": "raw-gate-setup", "password": NEW_PASSWORD})

        assert resp.status_code == 429
        # Rejected before the scenario — the token must stay live.
        assert _token_row(digest)["used_at"] is None

    def test_valid_attempts_do_not_reset_ip_counter(self, anon) -> None:
        """Login semantics carry over: a success never clears the IP
        counter (one valid token must not un-trip an in-progress spray)."""
        user = insert_user(_PHONE, "x", role="master")
        _seed_token(user["id"], "raw-counter-norest")
        service_module._FAILURE_COUNTERS["ip:testclient"] = (
            IP_FAILURE_THRESHOLD - 1,
            datetime.utcnow(),
        )

        ok = anon.post(VALIDATE, json={"token": "raw-counter-norest"})
        assert ok.status_code == 200, ok.text  # 19 < 20 → gate passes

        # The valid attempt did NOT reset: the next invalid one trips.
        invalid = anon.post(VALIDATE, json={"token": "bogus"})
        assert invalid.status_code == 429
        assert _code(invalid) == ErrorCode.AUTH_LOCKED_OUT.value


# ─── login of a passwordless account (null-guard, spec §4) ─────────────────────


class TestPasswordlessLogin:
    def test_null_hash_login_401_not_500(self, anon) -> None:
        user = insert_user(_PHONE, "x", role="master")
        _strip_password(user["id"])

        resp = anon.post(
            "/api/v1/auth/login",
            json={"phone": _PHONE, "password": "any-guess-1"},
        )

        assert resp.status_code == 401, resp.text
        assert _code(resp) == ErrorCode.AUTH_INVALID_CREDENTIALS.value

    def test_null_hash_login_does_not_feed_ladder(self, anon) -> None:
        """No brute-forceable secret → the ladder is never climbed. Seeded
        at 2/0 (one failure from rung 1): three attempts must leave it
        EXACTLY there — feeding it would lock a fresh passwordless
        account by mere probing."""
        user = insert_user(_PHONE, "x", role="master")
        _strip_password(user["id"])
        query_db_params(
            "UPDATE users SET failed_login_attempts = 2, lock_level = 0,"
            " locked_until = NULL WHERE id = :i",
            {"i": user["id"]},
        )

        for _ in range(3):
            resp = anon.post(
                "/api/v1/auth/login",
                json={"phone": _PHONE, "password": "any-guess-1"},
            )
            assert resp.status_code == 401, resp.text

        row = _user_row(user["id"])
        assert row["failed_login_attempts"] == 2, "the ladder must not move"
        assert row["lock_level"] == 0
        assert row["locked_until"] is None

    def test_null_hash_login_bumps_counters_like_unknown_phone(self, anon) -> None:
        """Both in-memory counters (phone + IP) are fed — the unknown-phone
        branch semantics, not a silent no-op."""
        user = insert_user(_PHONE, "x", role="master")
        _strip_password(user["id"])

        resp = anon.post(
            "/api/v1/auth/login",
            json={"phone": _PHONE, "password": "any-guess-1"},
        )
        assert resp.status_code == 401

        counters = service_module._FAILURE_COUNTERS
        assert counters.get(f"phone:{_PHONE}", (0, None))[0] == 1
        assert counters.get("ip:testclient", (0, None))[0] == 1
