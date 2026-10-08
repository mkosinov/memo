"""GH #414 §Экран входа: login account lookup — exact string → unique
reduction → unified refusal.

The login phone may arrive as a PhoneField compact («+79991112233») while
stored ``users.phone`` strings are exact-match unique and historically
free-form («+7 999 111-22-33», «89991112233», out-of-list «+1 …»). The
lookup therefore becomes (spec §Экран входа, «точечная правка бэкенда»):

1. exact string match (the indexed path — today's behavior, wins first);
2. if zero: linear scan over ACTIVE users comparing
   ``to_national_digits`` of BOTH sides (§Единая редукция цифр — the
   single existing rule, no second reduction);
3. exactly one match → login as that account; zero or several → refusal
   with the unified «Неверный телефон или пароль» (a reduction collision,
   incl. RU/KZ sharing +7, is closed by refusal — deterministically).

The §2.11/§3.4 security ladder must keep working on whichever account the
lookup resolves: locked → 429 before verify, wrong password feeds the
ladder, in-memory counters stay keyed by the TYPED string.

API-level tests through the shared ``api_client`` (test_auth_api.py
patterns: fresh cookie jar, direct-SQL user inserts, module-level Argon2
hashes, cleared failure counters).

Spec: docs/specs/2026-10-07-phone-field-country-selector-414-design.md
§Единая редукция цифр, §Экран входа, §Граничные случаи v1
Domain rules: docs/domain-rules/clients.md (Phone field, GH #414)
"""

from __future__ import annotations

import sqlite3

import pytest

from src.auth.passwords import hash_password
from src.errors import ErrorCode

pytestmark = pytest.mark.api

PASSWORD = "correct-horse-1"


# ─── Fixtures / helpers (test_auth_api.py patterns) ────────────────────────────


@pytest.fixture(autouse=True)
def _clear_failure_counters():
    """Isolate the module-level in-memory lockout store between tests."""
    from src.auth import service as service_module

    service_module._FAILURE_COUNTERS.clear()
    yield
    service_module._FAILURE_COUNTERS.clear()


@pytest.fixture
def anon_client(api_client):
    """The shared TestClient with a wiped cookie jar (anonymous view)."""
    api_client.cookies.clear()
    yield api_client
    api_client.cookies.clear()


@pytest.fixture(scope="module")
def _password_hashes():
    """Hash the shared password once (Argon2 is deliberately slow)."""
    return {"password": hash_password(PASSWORD)}


def _insert_user(
    phone: str,
    password_hash: str,
    role: str = "admin",
    is_active: bool = True,
) -> dict:
    """Direct-SQL user insert (conftest ``insert_user`` pattern; here with
    an ``is_active`` knob — the fallback must scan ACTIVE users only)."""
    import uuid as _uuid

    from tests.conftest import _TEST_DB_URL

    user_id = str(_uuid.uuid4())
    db_path = _TEST_DB_URL.replace("sqlite+aiosqlite:///", "")
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "INSERT INTO users (id, phone, password_hash, role, staff_id, "
            "email_is_confirmed, phone_is_confirmed, is_active, created_at, updated_at) "
            "VALUES (:id, :phone, :hash, :role, NULL, 0, 0, :active, "
            "datetime('now'), datetime('now'))",
            {
                "id": user_id, "phone": phone, "hash": password_hash,
                "role": role, "active": 1 if is_active else 0,
            },
        )
        conn.commit()
    finally:
        # Always release the connection — a leaked one holds the SQLite
        # lock and poisons every later test's reset_db.
        conn.close()
    return {"id": user_id, "phone": phone}


def _login(api_client, phone: str, password: str = PASSWORD):
    return api_client.post(
        "/api/v1/auth/login", json={"phone": phone, "password": password},
    )


def _assert_unified_refusal(resp) -> None:
    """401 + the single refusal code and message for every cause."""
    assert resp.status_code == 401, f"expected 401, got {resp.status_code}: {resp.text}"
    assert resp.json()["detail"]["code"] == ErrorCode.AUTH_INVALID_CREDENTIALS.value
    assert resp.json()["detail"]["message"] == "Неверный телефон или пароль"


# ─── path (1): exact string still wins ─────────────────────────────────────────


class TestExactMatchFirst:
    def test_exact_match_wins_over_reduction_collision(
        self, anon_client, _password_hashes,
    ) -> None:
        """The typed string equals user B verbatim while user A reduces to
        the same digits — path (1) serves the exact hit, no refusal."""
        legacy = _insert_user("+7 999 653-18-03", _password_hashes["password"])
        eight = _insert_user("89996531803", _password_hashes["password"])

        resp = _login(anon_client, "89996531803")
        assert resp.status_code == 200, resp.text
        assert resp.json()["user"]["id"] == eight["id"]
        assert resp.json()["user"]["id"] != legacy["id"]


# ─── path (2): unique reduction → login ────────────────────────────────────────


class TestUniqueReductionMatch:
    def test_legacy_spelled_user_logs_in_with_compact(
        self, anon_client, _password_hashes,
    ) -> None:
        """Stored «+7 999 111-22-33» (legacy spelling), typed compact
        «+79991112233» — exact miss, one reduction match → 200."""
        user = _insert_user("+7 999 111-22-33", _password_hashes["password"])

        resp = _login(anon_client, "+79991112233")
        assert resp.status_code == 200, resp.text
        assert resp.json()["user"]["id"] == user["id"]

    def test_eight_prefix_typed_matches_seven_stored(
        self, anon_client, _password_hashes,
    ) -> None:
        """Stored compact «+79992223344», typed «89992223344» (11-digit
        leading 8) — both reduce to the same national digits → 200."""
        user = _insert_user("+79992223344", _password_hashes["password"])

        resp = _login(anon_client, "89992223344")
        assert resp.status_code == 200, resp.text
        assert resp.json()["user"]["id"] == user["id"]


# ─── path (2): zero matches → unified refusal ──────────────────────────────────


class TestZeroReductionMatches:
    def test_unknown_digits_401_unified_message(
        self, anon_client, _password_hashes,
    ) -> None:
        """Nobody reduces to the typed digits → the ordinary 401 with the
        single message (same shape as unknown phone today). The filler
        user's phone must dodge the conftest fixture admin (+79990000001)
        and the typed digits — users.phone is UNIQUE-exact."""
        _insert_user("+79990000071", _password_hashes["password"])

        _assert_unified_refusal(_login(anon_client, "+79995556677"))

    def test_non_digit_login_401(self, anon_client, _password_hashes) -> None:
        """Fully non-digital typed string reduces to None — the fallback
        must not crash nor None-match garbage-stored phones → 401."""
        _insert_user("звонить лично", _password_hashes["password"])

        _assert_unified_refusal(_login(anon_client, "abc"))

    def test_archived_same_digits_not_matched(
        self, anon_client, _password_hashes,
    ) -> None:
        """The fallback scans ACTIVE users only: an archived account with
        the same digits is not a match → 401, no login as a dead account."""
        _insert_user("+7 999 777-66-55", _password_hashes["password"], is_active=False)
        _insert_user("+79990000072", _password_hashes["password"])  # active, other digits

        _assert_unified_refusal(_login(anon_client, "+79997776655"))


# ─── path (2): several matches (collision) → unified refusal ───────────────────


class TestReductionCollision:
    def test_two_spellings_same_digits_401(
        self, anon_client, _password_hashes,
    ) -> None:
        """«+7 999 653-18-03» and «89996531803» both active; the typed
        compact equals neither verbatim → two reduction matches → 401."""
        _insert_user("+7 999 653-18-03", _password_hashes["password"])
        _insert_user("89996531803", _password_hashes["password"])

        _assert_unified_refusal(_login(anon_client, "+79996531803"))

    def test_ru_kz_shared_plus_seven_collision_401(
        self, anon_client, _password_hashes,
    ) -> None:
        """RU/KZ share the +7 code and the reduction does not separate
        them («+7 701 123-45-67» and «87011234567» — one key): the
        collision is closed by refusal (spec §Граничные случаи v1)."""
        _insert_user("+7 701 123-45-67", _password_hashes["password"])
        _insert_user("87011234567", _password_hashes["password"])

        _assert_unified_refusal(_login(anon_client, "+77011234567"))


# ─── ladder integration: the resolved account behaves like an exact one ────────


class TestLadderViaReductionPath:
    def test_wrong_password_via_reduction_feeds_ladder(
        self, anon_client, _password_hashes,
    ) -> None:
        """A reduction-resolved account is a first-class account: wrong
        passwords feed the §2.11 ladder — the 3rd failure trips rung 1
        (429 with Retry-After), typed digits stay the counter key."""
        _insert_user("+7 999 111-22-33", _password_hashes["password"])

        statuses = [
            _login(anon_client, "+79991112233", password="wrong-password").status_code
            for _ in range(3)
        ]
        assert statuses == [401, 401, 429], statuses

    def test_correct_password_after_reduction_lockout_still_429(
        self, anon_client, _password_hashes,
    ) -> None:
        """A locked reduction-resolved account is rejected even with the
        correct password (§2.11 — checked before the verify)."""
        _insert_user("+7 999 111-22-33", _password_hashes["password"])

        for _ in range(3):
            _login(anon_client, "+79991112233", password="wrong-password")

        resp = _login(anon_client, "+79991112233")  # correct password
        assert resp.status_code == 429, resp.text
        assert resp.json()["detail"]["code"] == ErrorCode.AUTH_LOCKED_OUT.value
        assert "retry-after" in resp.headers
