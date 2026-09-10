"""sqladmin login + UserAdmin password form — GH #247 T9 (spec §2.8, §3.9).

The main test app never mounts admin (ENV=testing, main.py:182-183), so these
tests build a DEDICATED FastAPI app with ``setup_admin`` and exercise:

* Settings.SECRET_KEY — production fail-fast vs dev-default resolution;
* SqlAdminAuth — unauthenticated /admin/ redirects to the stock login,
  admin-role form login passes, master/wrong-password/inactive are rejected;
* UserAdmin — password_hash renders as a write-only PasswordField with the
  policy hint, and on_model_change applies create/edit password semantics.

Direct ModelView method calls (no browser) for the form semantics, per the
G2-corrected plan.
"""

import asyncio
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.requests import Request
from wtforms import PasswordField

from src.auth.passwords import (
    PASSWORD_POLICY_HINT_RU,
    PasswordPolicyError,
    hash_password,
    verify_password,
)
from src.auth.service import _FAILURE_COUNTERS
from tests.conftest import insert_user, query_db

pytestmark = pytest.mark.misc

ADMIN_PW = "admin-pass-123"
MASTER_PW = "master-pass-123"


def _unique_phone() -> str:
    return f"+7999{uuid.uuid4().hex[:7]}"


@pytest.fixture(autouse=True)
def _reset_failure_counters():
    """Isolate the in-memory §3.4 throttle counters per test."""
    _FAILURE_COUNTERS.clear()
    yield
    _FAILURE_COUNTERS.clear()


# ─── Settings.SECRET_KEY (spec §2.8) ──────────────────────────────────────────


class TestSecretKeySettings:
    def test_production_empty_secret_key_fails_fast(self) -> None:
        from src.core.config import Settings

        with pytest.raises(ValidationError):
            Settings(_env_file=None, ENV="production", SECRET_KEY="")

    def test_dev_empty_secret_key_resolves_to_dev_constant(self) -> None:
        from src.core.config import Settings

        s = Settings(_env_file=None, ENV="development", SECRET_KEY="")
        assert s.SECRET_KEY == "dev-sqladmin-secret"

    def test_testing_empty_secret_key_resolves_to_dev_constant(self) -> None:
        from src.core.config import Settings

        s = Settings(_env_file=None, ENV="testing", SECRET_KEY="")
        assert s.SECRET_KEY == "dev-sqladmin-secret"

    def test_explicit_secret_key_is_kept(self) -> None:
        from src.core.config import Settings

        s = Settings(_env_file=None, ENV="production", SECRET_KEY="real-key")
        assert s.SECRET_KEY == "real-key"


# ─── Dedicated app with sqladmin mounted ──────────────────────────────────────


@pytest.fixture(scope="module")
def admin_pair():
    """(FastAPI app, sqladmin Admin) — admin mounted, unlike the main test app."""
    from src.admin.setup import setup_admin

    app = FastAPI()
    admin = setup_admin(app)
    return app, admin


@pytest.fixture(scope="module")
def admin_app(admin_pair):
    return admin_pair[0]


@pytest.fixture(scope="module")
def user_admin_view(admin_pair):
    """The UserAdmin ModelView INSTANCE as wired into the admin (session_maker set)."""
    from src.admin.setup import UserAdmin

    admin = admin_pair[1]
    for view in admin._views:
        if isinstance(view, UserAdmin):
            return view
    raise AssertionError("UserAdmin view not registered in admin")


def _fake_request() -> Request:
    """Minimal pass-through Request for direct on_model_change calls."""
    return Request({"type": "http", "method": "POST", "headers": [], "query_string": b""})


# ─── SqlAdminAuth login flow (spec §3.9) ──────────────────────────────────────


class TestSqlAdminLogin:
    def test_unauthenticated_admin_redirects_to_login(self, admin_app) -> None:
        client = TestClient(admin_app, follow_redirects=False)
        resp = client.get("/admin/")
        assert resp.status_code == 302, f"Expected redirect, got {resp.status_code}"
        assert "/admin/login" in resp.headers["location"]

    def test_admin_role_login_passes_and_grants_access(self, admin_app) -> None:
        phone = _unique_phone()
        insert_user(phone, hash_password(ADMIN_PW), role="admin")

        client = TestClient(admin_app, follow_redirects=False)
        resp = client.post("/admin/login", data={"username": phone, "password": ADMIN_PW})
        assert resp.status_code == 302, f"Admin login failed: {resp.status_code}"
        assert "/admin/login" not in resp.headers["location"]

        # SAME client (holds the sqladmin session cookie) — an admin page
        # must render, not redirect back to the login
        page = client.get("/admin/user/list/")
        assert page.status_code in (200, 307), (
            f"Authorized page failed: {page.status_code}"
        )
        if page.status_code == 307:
            assert "/admin/login" not in page.headers["location"]
        followed = TestClient(admin_app, cookies=client.cookies)
        final = followed.get("/admin/user/list/")
        assert final.status_code == 200, f"List view failed: {final.status_code}"

    def test_master_role_login_rejected(self, admin_app) -> None:
        phone = _unique_phone()
        insert_user(phone, hash_password(MASTER_PW), role="master")

        client = TestClient(admin_app, follow_redirects=False)
        resp = client.post("/admin/login", data={"username": phone, "password": MASTER_PW})
        assert resp.status_code == 400, f"Master should be rejected: {resp.status_code}"

    def test_wrong_password_rejected(self, admin_app) -> None:
        phone = _unique_phone()
        insert_user(phone, hash_password(ADMIN_PW), role="admin")

        client = TestClient(admin_app, follow_redirects=False)
        resp = client.post(
            "/admin/login", data={"username": phone, "password": "wrong-pass-1"}
        )
        assert resp.status_code == 400, f"Wrong password should 400: {resp.status_code}"

    def test_inactive_admin_rejected(self, admin_app) -> None:
        phone = _unique_phone()
        insert_user(phone, hash_password(ADMIN_PW), role="admin")
        query_db(f"UPDATE users SET is_active = 0 WHERE phone = '{phone}'")

        client = TestClient(admin_app, follow_redirects=False)
        resp = client.post("/admin/login", data={"username": phone, "password": ADMIN_PW})
        assert resp.status_code == 400, f"Inactive should be rejected: {resp.status_code}"


# ─── UserAdmin form (spec §3.9) ────────────────────────────────────────────────


class TestUserAdminForm:
    def test_password_hash_renders_as_password_field(self, user_admin_view) -> None:
        form_cls = asyncio.run(user_admin_view.scaffold_form())
        field = form_cls().password_hash
        assert isinstance(field, PasswordField), (
            f"password_hash must render as PasswordField, got {type(field)}"
        )

    def test_password_help_text_is_policy_hint(self, user_admin_view) -> None:
        form_cls = asyncio.run(user_admin_view.scaffold_form())
        assert form_cls().password_hash.description == PASSWORD_POLICY_HINT_RU

    def test_blank_password_passes_form_validation(self, user_admin_view) -> None:
        """Regression (review blocker): a blank password must NOT trip the
        sqladmin auto-added InputRequired — otherwise the spec's "edit:
        blank = unchanged" path is unreachable (the lockout-reset flow
        edits a user and saves without a new password). Required-ness on
        CREATE is enforced in on_model_change instead."""
        class _FormDict(dict):
            """Minimal multidict shim wtforms needs (``getlist``)."""

            def getlist(self, key: str) -> list[str]:
                return [self[key]] if key in self else []

        form_cls = asyncio.run(user_admin_view.scaffold_form())
        form = form_cls(
            formdata=_FormDict(
                {"phone": _unique_phone(), "role": "admin", "password_hash": ""}
            )
        )
        assert form.validate(), f"Blank password must validate on edit: {form.errors}"

    def test_blank_password_edit_route_preserves_hash(self, admin_app) -> None:
        """Regression: full POST to the UserAdmin edit route with a blank
        password — 302 redirect (save) and password_hash unchanged in DB."""
        phone = _unique_phone()
        user = insert_user(phone, hash_password("old-password-123"), role="admin")
        old_hash = query_db(
            f"SELECT password_hash FROM users WHERE id = '{user['id']}'"
        )[0]["password_hash"]

        client = TestClient(admin_app, follow_redirects=False)
        resp = client.post("/admin/login", data={"username": phone, "password": "old-password-123"})
        assert resp.status_code == 302

        resp = client.post(
            f"/admin/user/edit/{user['id']}",
            data={"phone": phone, "role": "admin", "password_hash": ""},
            follow_redirects=False,
        )
        assert resp.status_code == 302, (
            f"Blank-password edit must save, got {resp.status_code}: {resp.text[:300]}"
        )

        new_hash = query_db(
            f"SELECT password_hash FROM users WHERE id = '{user['id']}'"
        )[0]["password_hash"]
        assert new_hash == old_hash, "Blank edit must leave password_hash unchanged"


class TestUserAdminOnModelChange:
    def test_create_hashes_plaintext_password(self, user_admin_view) -> None:
        from src.models.user import User

        data = {"phone": _unique_phone(), "password_hash": "  plaintext-secret-1  ", "role": "admin"}
        model = User(phone=data["phone"], password_hash="x", role="admin")

        asyncio.run(user_admin_view.on_model_change(data, model, True, _fake_request()))

        assert data["password_hash"] != "plaintext-secret-1"
        assert data["password_hash"].startswith("$argon2")
        assert verify_password("plaintext-secret-1", data["password_hash"])

    def test_create_blank_password_raises_policy_error(self, user_admin_view) -> None:
        from src.models.user import User

        data = {"phone": _unique_phone(), "password_hash": "", "role": "admin"}
        model = User(phone=data["phone"], password_hash="x", role="admin")

        with pytest.raises(PasswordPolicyError):
            asyncio.run(user_admin_view.on_model_change(data, model, True, _fake_request()))

    def test_create_short_password_raises_policy_error(self, user_admin_view) -> None:
        from src.models.user import User

        data = {"phone": _unique_phone(), "password_hash": "short", "role": "admin"}
        model = User(phone=data["phone"], password_hash="x", role="admin")

        with pytest.raises(PasswordPolicyError):
            asyncio.run(user_admin_view.on_model_change(data, model, True, _fake_request()))

    def test_edit_blank_password_leaves_hash_unchanged(self, user_admin_view) -> None:
        from src.models.user import User

        old_hash = hash_password("old-password-123")
        data = {"phone": _unique_phone(), "password_hash": "", "role": "admin"}
        model = User(phone=data["phone"], password_hash=old_hash, role="admin")

        asyncio.run(user_admin_view.on_model_change(data, model, False, _fake_request()))

        # Blank edit: key removed so _set_attributes skips the column entirely
        assert "password_hash" not in data
        assert model.password_hash == old_hash

    def test_edit_filled_password_rehashes(self, user_admin_view) -> None:
        from src.models.user import User

        old_hash = hash_password("old-password-123")
        data = {"phone": _unique_phone(), "password_hash": "new-password-123", "role": "admin"}
        model = User(phone=data["phone"], password_hash=old_hash, role="admin")

        asyncio.run(user_admin_view.on_model_change(data, model, False, _fake_request()))

        assert data["password_hash"] != old_hash
        assert verify_password("new-password-123", data["password_hash"])
