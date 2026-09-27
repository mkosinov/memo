"""#348 Task 2 — password setup link scenarios: issue + set.

``issue_password_link`` / ``set_password_by_link``
(``src/usecases/password_setup.py``, spec §4/§8
docs/specs/2026-09-27-user-accounts-348-design.md; canon
docs/domain-rules/auth.md «Одноразовая ссылка установки пароля»):

* issue — deactivated account → ``AccountDeactivatedError``; unknown
  user → ``None`` (route → 404); ONE transaction deletes ALL former
  tokens (live AND used) and inserts the new one (digest PK; the raw
  token never persists); TTL is a scenario parameter (default 24 h);
  ONE audit row ``password_link_issued`` (entity ``users``, author =
  the staged admin actor — no actor → no row, §4.1);
* set — password policy + Argon2 hash run BEFORE the first DB
  statement (every path pays the same Argon2 cost — timing parity);
  conditional consume (0 rows updated → ``PasswordLinkInvalidError``);
  deactivated account → the same error (rollback keeps the row state);
  success writes the hash, resets the WHOLE lockout ladder (including
  the hard level-3 lock), revokes every session; NO audit row (public
  call, no author).

Calling convention: selfless ``@transactional`` scenarios — leading
``None`` + keyword arguments (``usecases/user.py`` docstring).
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

import pytest

from src.auth.passwords import PasswordPolicyError, verify_password
from src.auth.session import new_session
from src.events import audit
from tests.conftest import insert_user, query_db, query_db_params

if TYPE_CHECKING:
    from collections.abc import Iterator

pytestmark = pytest.mark.integration


# ─── helpers ───────────────────────────────────────────────────────────────────


def _deactivate(user_id: str) -> None:
    query_db_params(
        "UPDATE users SET is_active = 0 WHERE id = :i", {"i": user_id}
    )


def _seed_hard_lock(user_id: str) -> None:
    """Ladder at the HARD level-3 lock (previously sqladmin-reset only)."""
    query_db_params(
        "UPDATE users SET failed_login_attempts = 2, lock_level = 3,"
        " locked_until = NULL WHERE id = :i",
        {"i": user_id},
    )


def _seed_token(
    user_id: str, digest: str, *, hours: int = 24, used: bool = False
) -> None:
    used_expr = "datetime('now')" if used else "NULL"
    query_db_params(
        "INSERT INTO password_setup_tokens"
        " (token, user_id, expires_at, used_at, created_at)"
        f" VALUES (:t, :u, datetime('now', '+{hours} hours'), {used_expr},"
        " datetime('now'))",
        {"t": digest, "u": user_id},
    )


def _expire_token(digest: str) -> None:
    query_db_params(
        "UPDATE password_setup_tokens"
        " SET expires_at = datetime('now', '-1 hour') WHERE token = :t",
        {"t": digest},
    )


def _token_rows() -> list[dict]:
    return query_db(
        "SELECT token, user_id, expires_at, used_at FROM password_setup_tokens"
    )


def _audit_rows() -> list[dict]:
    return query_db(
        "SELECT user_id, user_role, action, entity, entity_id, entity_label,"
        " changes FROM audit_logs ORDER BY rowid"
    )


def _ladder(user_id: str) -> dict:
    rows = query_db(
        "SELECT failed_login_attempts, lock_level, locked_until, password_hash"
        f" FROM users WHERE id = '{user_id}'"
    )
    assert rows, "user row vanished"
    return rows[0]


@pytest.fixture
def actor() -> Iterator[dict]:
    """A real users row + the staged audit actor (the §4.1 author slot)."""
    admin = insert_user("+79990007770", "x", role="admin")
    token = audit.set_actor(user_id=admin["id"], role="admin")
    yield admin
    audit.reset_actor(token)


# ─── issue_password_link ───────────────────────────────────────────────────────


class TestIssuePasswordLink:
    async def test_creates_single_live_token_and_returns_raw_plus_expiry(
        self, db_session
    ) -> None:
        from src.usecases.password_setup import issue_password_link

        user = insert_user("+79990008801", "x", role="master")
        before = datetime.utcnow()

        link = await issue_password_link(
            None, db_session=db_session, user_id=user["id"]
        )

        assert link is not None
        # 256-bit urlsafe raw token — long enough to be unguessable.
        assert len(link.raw_token) >= 32
        # Default TTL = 24 h (spec §4): expiry lands within (before+24h,
        # utcnow+24h+ε).
        assert before + timedelta(hours=24) <= link.expires_at
        assert link.expires_at <= datetime.utcnow() + timedelta(hours=24, seconds=5)

        rows = _token_rows()
        assert len(rows) == 1, f"expected exactly one token row, got {rows}"
        row = rows[0]
        # The DB stores the SHA-256 digest — the raw token never persists.
        assert row["token"] == hashlib.sha256(
            link.raw_token.encode()
        ).hexdigest()
        assert row["token"] != link.raw_token
        assert row["user_id"] == user["id"]
        assert row["used_at"] is None, "a freshly issued token must be live"

    async def test_ttl_is_a_scenario_parameter(self, db_session) -> None:
        from src.usecases.password_setup import issue_password_link

        user = insert_user("+79990008802", "x", role="master")
        before = datetime.utcnow()

        link = await issue_password_link(
            None, db_session=db_session, user_id=user["id"],
            ttl=timedelta(hours=2),
        )

        assert link is not None
        assert before + timedelta(hours=2) <= link.expires_at
        assert link.expires_at <= datetime.utcnow() + timedelta(hours=2, seconds=5)
        # The stored row carries the same custom expiry.
        row = _token_rows()[0]
        assert row["expires_at"] is not None

    async def test_reissue_deletes_all_former_tokens_including_used(
        self, db_session
    ) -> None:
        from src.usecases.password_setup import issue_password_link

        user = insert_user("+79990008803", "x", role="master")
        _seed_token(user["id"], "a" * 64)                      # live
        _seed_token(user["id"], "b" * 64, used=True)           # consumed

        link = await issue_password_link(
            None, db_session=db_session, user_id=user["id"]
        )
        assert link is not None

        rows = _token_rows()
        assert len(rows) == 1, (
            "re-issue must delete ALL former tokens (live and used) — "
            f"the table must not grow per account, got {rows}"
        )
        assert rows[0]["token"] == hashlib.sha256(
            link.raw_token.encode()
        ).hexdigest()

    async def test_deactivated_account_rejected_without_writes(
        self, db_session
    ) -> None:
        from src.usecases.password_setup import (
            AccountDeactivatedError,
            issue_password_link,
        )

        user = insert_user("+79990008804", "x", role="master")
        _deactivate(user["id"])
        _seed_token(user["id"], "c" * 64)

        with pytest.raises(AccountDeactivatedError):
            await issue_password_link(
                None, db_session=db_session, user_id=user["id"]
            )

        # No partial writes: the seeded token survives, no audit row.
        assert [r["token"] for r in _token_rows()] == ["c" * 64]
        assert _audit_rows() == []

    async def test_unknown_user_returns_none(self, db_session) -> None:
        from src.usecases.password_setup import issue_password_link

        link = await issue_password_link(
            None, db_session=db_session, user_id="no-such-user"
        )
        assert link is None
        assert _token_rows() == []

    async def test_audit_row_written_with_actor(self, db_session, actor) -> None:
        from src.usecases.password_setup import issue_password_link

        user = insert_user("+79990008805", "x", role="master")
        await issue_password_link(
            None, db_session=db_session, user_id=user["id"]
        )

        rows = _audit_rows()
        assert len(rows) == 1, f"exactly one journal row expected, got {rows}"
        row = rows[0]
        assert row["action"] == "password_link_issued"
        assert row["entity"] == "users"
        assert row["entity_id"] == user["id"]
        assert row["user_id"] == actor["id"], "author = the issuing admin"
        assert row["user_role"] == "admin"
        assert json.loads(row["changes"]) is None, (
            "action-only mark — no field snapshot"
        )
        assert row["entity_label"].startswith("Пользователь")

    async def test_no_audit_row_without_actor(self, db_session) -> None:
        """§4.1: no staged author → no journal row (the action stands)."""
        from src.usecases.password_setup import issue_password_link

        user = insert_user("+79990008806", "x", role="master")
        await issue_password_link(
            None, db_session=db_session, user_id=user["id"]
        )
        assert _audit_rows() == []
        assert _token_rows(), "the action itself must still run"


# ─── set_password_by_link ──────────────────────────────────────────────────────


class TestSetPasswordByLink:
    async def test_sets_password_consumes_token_resets_ladder_revokes_sessions(
        self, db_session
    ) -> None:
        from src.usecases.password_setup import issue_password_link, set_password_by_link

        user = insert_user("+79990008811", "x", role="master")
        _seed_hard_lock(user["id"])
        db_session.add(new_session(user["id"]))
        db_session.add(new_session(user["id"]))
        await db_session.commit()

        link = await issue_password_link(
            None, db_session=db_session, user_id=user["id"]
        )
        assert link is not None

        await set_password_by_link(
            None, db_session=db_session,
            raw_token=link.raw_token, password="  newpass-123  ",
        )

        # Password stored as a hash of the TRIMMED value.
        ladder = _ladder(user["id"])
        assert verify_password("newpass-123", ladder["password_hash"])
        # The WHOLE ladder resets — including the hard level-3 lock.
        assert ladder["failed_login_attempts"] == 0
        assert ladder["lock_level"] == 0
        assert ladder["locked_until"] is None
        # Token consumed exactly once.
        rows = _token_rows()
        assert len(rows) == 1 and rows[0]["used_at"] is not None
        # Every session of the user is revoked (S8).
        sessions = query_db(
            f"SELECT COUNT(*) AS c FROM sessions WHERE user_id = '{user['id']}'"
        )
        assert sessions[0]["c"] == 0

    async def test_token_is_one_time_only(self, db_session) -> None:
        from src.usecases.password_setup import (
            PasswordLinkInvalidError,
            issue_password_link,
            set_password_by_link,
        )

        user = insert_user("+79990008812", "x", role="master")
        link = await issue_password_link(
            None, db_session=db_session, user_id=user["id"]
        )
        assert link is not None

        await set_password_by_link(
            None, db_session=db_session,
            raw_token=link.raw_token, password="first-pass-1",
        )
        with pytest.raises(PasswordLinkInvalidError):
            await set_password_by_link(
                None, db_session=db_session,
                raw_token=link.raw_token, password="second-pass-2",
            )

    async def test_unknown_token_rejected(self, db_session) -> None:
        from src.usecases.password_setup import (
            PasswordLinkInvalidError,
            set_password_by_link,
        )

        with pytest.raises(PasswordLinkInvalidError):
            await set_password_by_link(
                None, db_session=db_session,
                raw_token="totally-unknown-token", password="some-pass-123",
            )

    async def test_expired_token_rejected(self, db_session) -> None:
        from src.usecases.password_setup import (
            PasswordLinkInvalidError,
            issue_password_link,
            set_password_by_link,
        )

        user = insert_user("+79990008813", "x", role="master")
        link = await issue_password_link(
            None, db_session=db_session, user_id=user["id"]
        )
        assert link is not None
        _expire_token(hashlib.sha256(link.raw_token.encode()).hexdigest())

        with pytest.raises(PasswordLinkInvalidError):
            await set_password_by_link(
                None, db_session=db_session,
                raw_token=link.raw_token, password="some-pass-123",
            )

    async def test_deactivated_account_rejected(self, db_session) -> None:
        from src.usecases.password_setup import (
            PasswordLinkInvalidError,
            issue_password_link,
            set_password_by_link,
        )

        user = insert_user("+79990008814", "x", role="master")
        link = await issue_password_link(
            None, db_session=db_session, user_id=user["id"]
        )
        assert link is not None
        _deactivate(user["id"])

        with pytest.raises(PasswordLinkInvalidError):
            await set_password_by_link(
                None, db_session=db_session,
                raw_token=link.raw_token, password="some-pass-123",
            )

        # The consume rolls back — an archive never burns the link: the
        # row keeps used_at IS NULL (a later reactivation finds it live).
        rows = _token_rows()
        assert len(rows) == 1 and rows[0]["used_at"] is None

    async def test_policy_violation_raises_and_keeps_token_live(
        self, db_session
    ) -> None:
        from src.usecases.password_setup import issue_password_link, set_password_by_link

        user = insert_user("+79990008815", "x", role="master")
        link = await issue_password_link(
            None, db_session=db_session, user_id=user["id"]
        )
        assert link is not None

        with pytest.raises(PasswordPolicyError):
            await set_password_by_link(
                None, db_session=db_session,
                raw_token=link.raw_token, password="short",
            )
        # The policy check runs BEFORE any DB work — the token is untouched.
        rows = _token_rows()
        assert len(rows) == 1 and rows[0]["used_at"] is None

    async def test_no_audit_row_even_with_actor_staged(
        self, db_session, actor
    ) -> None:
        """Public call → no author → no journal row (§8), even when an
        actor context happens to be staged around the scenario call."""
        from src.usecases.password_setup import issue_password_link, set_password_by_link

        user = insert_user("+79990008816", "x", role="master")
        link = await issue_password_link(
            None, db_session=db_session, user_id=user["id"]
        )
        assert link is not None
        before = _audit_rows()
        assert len(before) == 1, "the issue mark must be the only row so far"

        await set_password_by_link(
            None, db_session=db_session,
            raw_token=link.raw_token, password="some-pass-123",
        )
        assert _audit_rows() == before, (
            "public password setup must never journal (no author → no row)"
        )
