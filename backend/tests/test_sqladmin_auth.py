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

        # The session cookie now authorizes an admin page (follow the
        # trailing-slash redirect onto the list view)
        page = TestClient(admin_app).get("/admin/user/list/")
        assert page.status_code == 200, f"Authorized page failed: {page.status_code}"

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
