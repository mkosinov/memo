"""GH #263 T1 — per-master scope context (``src/auth/scope.py``) + phone mask.

Spec D1/D3 (docs/specs/2026-09-10-master-role-design.md §D1, §Scope-слой):

* ``ScopeContext`` carries ``{user_id, role, master_key: str | None}``;
  ``master_key`` is not None ONLY for ``role=master`` with an existing
  masters row (one join users → staff → masters; key = ``masters.staff_id``,
  which is exactly what ``activities.master_id`` references post-#266);
* admin → context WITHOUT scope (``master_key=None`` = «no filter»);
* master WITHOUT a masters row → the EMPTY-scope sentinel — deliberately
  distinguishable from None so no consumer can ever render it as
  «no filter» (пустой скоуп ≠ отсутствие скоупа);
* an ARCHIVED masters row (``masters.is_active=False``) keeps the key
  alive — history stays visible when distribution is off (domain rules
  «Per-master data scoping»);
* ``mask_phone``: every digit except the LAST 4 → ``•`` in position,
  non-digit separators preserved as-is, fewer than 4 digits → fully
  masked, ``None`` → ``None``.

The ``get_scope`` FastAPI dependency is exercised end-to-end through a
throwaway probe route (the ``guarded_app`` pattern of test_auth_api.py):
a real login session resolves to the expected context on the wire.

Spec: docs/specs/2026-09-10-master-role-design.md
Domain rules: docs/domain-rules/auth.md (Per-master data scoping #263)
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from src.auth.permissions import AuthedUser
from src.auth.scope import (
    EMPTY_SCOPE_KEY,
    ScopeContext,
    mask_phone,
    resolve_scope,
)
from src.models.enums import UserRole
from tests.conftest import insert_user

# ─── mask_phone — pure table (no DB) ───────────────────────────────────────────


class TestMaskPhone:
    """Character-position rule: keep the last 4 digits, mask the rest."""

    @pytest.mark.parametrize(
        ("phone", "expected"),
        [
            # Canonical RU format — separators preserved, first 7 digits masked.
            ("+7 909 123-45-67", "+• ••• •••-45-67"),
            # Compact form: 11 digits → first 7 masked, tail 4567 visible.
            ("+79991234567", "+•••••••4567"),
            # Separators BETWEEN the visible tail are kept.
            ("45-67", "45-67"),
            # Last four DIGITS are visible regardless of separators.
            ("12-34-56-78", "••-••-56-78"),
            # Exactly 4 digits = the visible tail — nothing to mask.
            ("1234", "1234"),
            # Shorter than 4 digits → fully masked (separators stay).
            ("123", "•••"),
            ("12", "••"),
            ("1", "•"),
            ("", ""),
            # Fewer than 4 digits WITH separators → digits masked, chars kept.
            ("+7 9", "+• •"),
            # Non-digit garbage passes through untouched.
            ("abc-def", "abc-def"),
        ],
    )
    def test_table(self, phone: str, expected: str) -> None:
        assert mask_phone(phone) == expected

    def test_none_stays_none(self) -> None:
        assert mask_phone(None) is None

    def test_last_four_digits_identified_by_position_not_value(self) -> None:
        """Visibility is positional (last FOUR digits), not value-based."""
        # digits 000012345678 → last four = 6,7,8... wait: 12 digits, tail «5678».
        assert mask_phone("000012345678") == "••••••••5678"


# ─── ScopeContext shape (pure) ─────────────────────────────────────────────────


class TestScopeContext:
    def test_is_immutable(self) -> None:
        import dataclasses

        ctx = ScopeContext(user_id="u1", role="master", master_key="m1")
        with pytest.raises(dataclasses.FrozenInstanceError):
            ctx.master_key = "other"  # type: ignore[misc]

    def test_admin_context_is_unscoped(self) -> None:
        ctx = ScopeContext(user_id="u1", role=UserRole.ADMIN.value, master_key=None)
        assert ctx.is_scoped is False
        assert ctx.is_empty_scope is False

    def test_master_context_is_scoped(self) -> None:
        ctx = ScopeContext(user_id="u1", role=UserRole.MASTER.value, master_key="m1")
        assert ctx.is_scoped is True
        assert ctx.is_empty_scope is False

    def test_sentinel_is_empty_scope_not_unscoped(self) -> None:
        """The sentinel must never read as «no filter» (D1 safety rule)."""
        ctx = ScopeContext(
            user_id="u1",
            role=UserRole.MASTER.value,
            master_key=EMPTY_SCOPE_KEY,
        )
        assert ctx.is_scoped is False
        assert ctx.is_empty_scope is True
        assert ctx.master_key is not None  # never None → never «no filter»


# ─── resolve_scope — one join over real rows (DB) ──────────────────────────────


class TestResolveScope:
    async def test_admin_gets_unscoped_context(self, db_session) -> None:

        user = insert_user("+79995550001", "hash", role="admin")
        authed = AuthedUser(
            id=user["id"],
            phone=user["phone"],
            role=UserRole.ADMIN.value,
            staff_id=None,
            permissions=frozenset({"*"}),
        )
        scope = await resolve_scope(db_session, authed)
        assert scope == ScopeContext(
            user_id=user["id"],
            role="admin",
            master_key=None,
        )
        assert scope.master_key is None
        assert scope.is_scoped is False

    async def test_master_with_masters_row_gets_its_key(
        self,
        db_session,
    ) -> None:
        """master_key = masters.staff_id — the value activities.master_id holds."""
        from tests.test_auth_api import _query_db

        staff_id = "staff-scope-1"
        _query_db(
            "INSERT INTO staff (id, first_name, last_name, sort_order, "
            "is_active, created_at, updated_at) "
            "VALUES (:id, 'Скоуп', 'Мастеров', 0, 1, "
            "datetime('now'), datetime('now'))",
            {"id": staff_id},
        )
        _query_db(
            "INSERT INTO masters (staff_id, specialty, color, is_active, "
            "created_at, updated_at) VALUES (:id, 'живопись', '#5B8C7A', 1, "
            "datetime('now'), datetime('now'))",
            {"id": staff_id},
        )
        user = insert_user("+79995550002", "hash", role="master", master_id=staff_id)
        authed = AuthedUser(
            id=user["id"],
            phone=user["phone"],
            role=UserRole.MASTER.value,
            staff_id=staff_id,
            permissions=frozenset(),
        )
        scope = await resolve_scope(db_session, authed)
        assert scope.master_key == staff_id
        assert scope.is_scoped is True
        assert scope.is_empty_scope is False

    async def test_master_without_masters_row_gets_empty_sentinel(
        self,
        db_session,
    ) -> None:
        """Staff row exists but no masters extension → sentinel, NOT None."""
        from tests.test_auth_api import _query_db

        staff_id = "staff-scope-2"
        _query_db(
            "INSERT INTO staff (id, first_name, last_name, sort_order, "
            "is_active, created_at, updated_at) "
            "VALUES (:id, 'Не', 'Мастер', 0, 1, "
            "datetime('now'), datetime('now'))",
            {"id": staff_id},
        )
        user = insert_user("+79995550003", "hash", role="master", master_id=staff_id)
        authed = AuthedUser(
            id=user["id"],
            phone=user["phone"],
            role=UserRole.MASTER.value,
            staff_id=staff_id,
            permissions=frozenset(),
        )
        scope = await resolve_scope(db_session, authed)
        assert scope.master_key == EMPTY_SCOPE_KEY
        assert scope.master_key is not None  # never «no filter»
        assert scope.is_empty_scope is True

    async def test_master_without_staff_link_gets_empty_sentinel(
        self,
        db_session,
    ) -> None:

        user = insert_user("+79995550004", "hash", role="master", master_id=None)
        authed = AuthedUser(
            id=user["id"],
            phone=user["phone"],
            role=UserRole.MASTER.value,
            staff_id=None,
            permissions=frozenset(),
        )
        scope = await resolve_scope(db_session, authed)
        assert scope.master_key == EMPTY_SCOPE_KEY
        assert scope.is_empty_scope is True

    async def test_archived_masters_row_keeps_key_alive(self, db_session) -> None:
        """masters.is_active=False (distribution off) — history stays visible."""
        from tests.test_auth_api import _query_db

        staff_id = "staff-scope-3"
        _query_db(
            "INSERT INTO staff (id, first_name, last_name, sort_order, "
            "is_active, created_at, updated_at) "
            "VALUES (:id, 'Архив', 'Мастеров', 0, 1, "
            "datetime('now'), datetime('now'))",
            {"id": staff_id},
        )
        _query_db(
            "INSERT INTO masters (staff_id, specialty, color, is_active, "
            "created_at, updated_at) VALUES (:id, 'керамика', '#AA0000', 0, "
            "datetime('now'), datetime('now'))",
            {"id": staff_id},
        )
        user = insert_user("+79995550005", "hash", role="master", master_id=staff_id)
        authed = AuthedUser(
            id=user["id"],
            phone=user["phone"],
            role=UserRole.MASTER.value,
            staff_id=staff_id,
            permissions=frozenset(),
        )
        scope = await resolve_scope(db_session, authed)
        assert scope.master_key == staff_id  # key live — NOT the sentinel
        assert scope.is_scoped is True

    async def test_unknown_role_gets_empty_sentinel(self, db_session) -> None:
        """Defensive: a role outside the matrix must never get «no filter»."""

        user = insert_user("+79995550006", "hash", role="intern")
        authed = AuthedUser(
            id=user["id"],
            phone=user["phone"],
            role="intern",
            staff_id=None,
            permissions=frozenset(),
        )
        scope = await resolve_scope(db_session, authed)
        assert scope.master_key == EMPTY_SCOPE_KEY


# ─── get_scope dependency — wire smoke (real login → probe route) ─────────────


@pytest.fixture(scope="module")
def scope_app(app):
    """Mount a throwaway scope probe route (test_auth_api pattern)."""
    from fastapi import APIRouter, Depends

    from src.auth.scope import get_scope

    probe = APIRouter()

    @probe.get("/_scope_probe")
    async def _scope_probe(
        scope: ScopeContext = Depends(get_scope),  # noqa: B008 — FastAPI idiom
    ) -> dict:
        return {
            "user_id": scope.user_id,
            "role": scope.role,
            "master_key": scope.master_key,
        }

    app.include_router(probe, prefix="/api/v1")
    return app


@pytest.mark.api
class TestGetScopeWire:
    """The dependency resolves the login cookie into the scope context."""

    def test_anonymous_401(self, api_client, scope_app) -> None:
        api_client.cookies.clear()
        resp = api_client.get("/api/v1/_scope_probe")
        assert resp.status_code == 401
        api_client.cookies.clear()

    def test_admin_sees_no_scope(
        self,
        api_client,
        scope_app,
    ) -> None:
        resp = api_client.get("/api/v1/_scope_probe")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["role"] == "admin"
        assert body["master_key"] is None
        assert body["user_id"]  # real user id resolved from the session


class _ScopeProbeMaster:
    """Shared prep: master user + staff card (+ optional masters row)."""

    @staticmethod
    def make(db_has_masters_row: bool):
        from src.auth.passwords import hash_password
        from tests.test_auth_api import _query_db

        staff_id = "staff-probe-master"
        _query_db(
            "INSERT OR IGNORE INTO staff (id, first_name, last_name, "
            "sort_order, is_active, created_at, updated_at) "
            "VALUES (:id, 'Проба', 'Скопов', 0, 1, "
            "datetime('now'), datetime('now'))",
            {"id": staff_id},
        )
        if db_has_masters_row:
            _query_db(
                "INSERT OR IGNORE INTO masters (staff_id, specialty, color, "
                "is_active, created_at, updated_at) "
                "VALUES (:id, 'живопись', '#5B8C7A', 1, "
                "datetime('now'), datetime('now'))",
                {"id": staff_id},
            )
        phone = "+79995550007"
        insert_user(
            phone,
            hash_password("scope-probe-1"),
            role="master",
            master_id=staff_id,
        )
        return phone


def test_get_scope_master_with_row(app, api_client, scope_app) -> None:
    phone = _ScopeProbeMaster.make(db_has_masters_row=True)
    client = TestClient(app)
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"phone": phone, "password": "scope-probe-1"},
        ).status_code
        == 200
    )
    resp = client.get("/api/v1/_scope_probe")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["role"] == "master"
    assert body["master_key"] == "staff-probe-master"
    client.cookies.clear()


def test_get_scope_master_without_row_gets_sentinel(
    app,
    api_client,
    scope_app,
) -> None:
    phone = _ScopeProbeMaster.make(db_has_masters_row=False)
    client = TestClient(app)
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"phone": phone, "password": "scope-probe-1"},
        ).status_code
        == 200
    )
    resp = client.get("/api/v1/_scope_probe")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["master_key"] == EMPTY_SCOPE_KEY  # NOT null on the wire
    client.cookies.clear()
