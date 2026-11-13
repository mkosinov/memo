"""#584 (spec §4.4) — settings under the «my» branches.

The former settings island ``/api/v1/user-settings`` (all methods,
schemas, own-only semantics) re-homes under the branches; there is NO
root ``/my/settings``:

* staff instance — ``/api/v1/my/master/settings`` and
  ``/api/v1/my/admin/settings``: the SAME account, the SAME rows (the
  branch is the audience address, not other data) behind the branch
  guards ``require_master_branch`` / ``require_admin_branch``;
* client instance — ``/api/v1/my/client/settings`` behind
  ``require_client_session`` (client-account rows are born with the
  account, #319; no UI consumer yet — a ready surface, spec §4.4).

Admission (spec §9 «Допуск веток»): a client cookie on the staff
branches → the shared 401 ``AUTH_UNAUTHORIZED``; a staff cookie on
``/my/client/settings`` → 401; a valid staff cookie of the other staff
branch → 403 ``AUTH_FORBIDDEN``. The old ``/api/v1/user-settings*``
surface is retired → 404 (probed under a live session — route
absence, not auth).

CSRF (§9): every migrated mutation (POST/PUT/PATCH/DELETE) carries
``verify_fetch_metadata`` pinned EXPLICITLY PER ROUTE, on every branch.

Spec: docs/specs/2026-11-12-adr015-my-namespace-584-design.md §4.4, §9
Domain rules: docs/domain-rules/user_settings.md, docs/domain-rules/auth.md
"""

from __future__ import annotations

import secrets

import pytest

from src.auth.permissions import CLIENT_SESSION_COOKIE, SESSION_COOKIE
from tests.conftest import (
    delete_settings_row,
    insert_user,
    query_db_params,
)

pytestmark = pytest.mark.api

MASTER_SETTINGS = "/api/v1/my/master/settings"
ADMIN_SETTINGS = "/api/v1/my/admin/settings"
CLIENT_SETTINGS = "/api/v1/my/client/settings"
OLD_ISLAND = "/api/v1/user-settings"

STAFF_BRANCHES = [MASTER_SETTINGS, ADMIN_SETTINGS]
ALL_BRANCHES = [MASTER_SETTINGS, ADMIN_SETTINGS, CLIENT_SETTINGS]

SETTINGS_PASSWORD = "my-set-pass-123"


# ─── world builders (the test_api_my_staff_branches direct-SQL pattern) ───────


def _staff_card(with_section: bool) -> str:
    """Direct-SQL staff card (+ optional masters extension) → staff_id."""
    staff_id = f"staff-{secrets.token_hex(8)}"
    query_db_params(
        "INSERT INTO staff (id, first_name, last_name, sort_order, is_active, "
        "created_at, updated_at) VALUES (:id, 'Мария', 'Иванова', 0, 1, "
        "datetime('now'), datetime('now'))",
        {"id": staff_id},
    )
    if with_section:
        query_db_params(
            "INSERT INTO masters (staff_id, specialty, color, is_active, "
            "created_at, updated_at) VALUES (:id, 'живопись, керамика', "
            "'#5B8C7A', 1, datetime('now'), datetime('now'))",
            {"id": staff_id},
        )
    return staff_id


def _staff_account(
    phone: str,
    role: str,
    *,
    with_card: bool = True,
    with_section: bool = False,
) -> dict:
    """A staff-role account (passwordless — sessions are minted directly)."""
    staff_id = _staff_card(with_section) if with_card else None
    return insert_user(phone, None, role=role, master_id=staff_id)


def _client_account(phone: str) -> dict:
    """A passwordless client-role account (the other cookie audience)."""
    return insert_user(phone, None, role="client")


def _session_token(user_id: str) -> str:
    """Mint a live session row directly (the #499 fixture pattern)."""
    token = secrets.token_urlsafe(32)
    query_db_params(
        "INSERT INTO sessions (token, user_id, created_at, last_extended_at, "
        "idle_deadline, absolute_deadline) VALUES "
        "(:t, :u, datetime('now'), datetime('now'), "
        "datetime('now', '+6 days'), datetime('now', '+29 days'))",
        {"t": token, "u": user_id},
    )
    return token


def _jar(api_client, staff: str | None = None, client: str | None = None):
    """Fresh jar carrying exactly the given session cookies (None = absent)."""
    api_client.cookies.clear()
    if staff is not None:
        api_client.cookies.set(SESSION_COOKIE, staff)
    if client is not None:
        api_client.cookies.set(CLIENT_SESSION_COOKIE, client)
    return api_client


def _unauthorized_401(resp) -> None:
    assert resp.status_code == 401, resp.text
    assert resp.json()["detail"]["code"] == "AUTH_UNAUTHORIZED"


def _forbidden_403(resp) -> None:
    assert resp.status_code == 403, resp.text
    assert resp.json()["detail"]["code"] == "AUTH_FORBIDDEN"


# ─── §9 access matrix ──────────────────────────────────────────────────────────


class TestBranchAdmission:
    def test_anonymous_401_all_branches(self, app, db_engine) -> None:
        from fastapi.testclient import TestClient

        anon = TestClient(app)
        for branch in ALL_BRANCHES:
            _unauthorized_401(anon.get(branch))
        anon.close()

    def test_client_cookie_401_on_staff_branches(self, api_client) -> None:
        """DoD: a client-only jar is not a staff session → the shared 401."""
        user = _client_account("+79995550901")
        _jar(api_client, client=_session_token(user["id"]))
        for branch in STAFF_BRANCHES:
            _unauthorized_401(api_client.get(branch))

    def test_staff_cookie_401_on_client_branch(self, api_client) -> None:
        """DoD: a staff-only jar is not a client session → the shared 401."""
        user = _staff_account("+79995550902", "master", with_section=True)
        _jar(api_client, staff=_session_token(user["id"]))
        _unauthorized_401(api_client.get(CLIENT_SETTINGS))

    def test_client_token_in_staff_cookie_401(self, api_client) -> None:
        """Cross-presented token: resolves, fails the staff role barrier →
        the SAME 401 (the require_client_session precedent, mirrored)."""
        user = _client_account("+79995550903")
        _jar(api_client, staff=_session_token(user["id"]))
        for branch in STAFF_BRANCHES:
            _unauthorized_401(api_client.get(branch))

    def test_master_role_on_admin_settings_403(self, api_client) -> None:
        user = _staff_account("+79995550904", "master", with_section=True)
        _jar(api_client, staff=_session_token(user["id"]))
        _forbidden_403(api_client.get(ADMIN_SETTINGS))

    def test_admin_without_section_on_master_settings_403(
        self, api_client
    ) -> None:
        """A card WITHOUT the masters extension is not a master either."""
        user = _staff_account("+79995550905", "admin", with_section=False)
        _jar(api_client, staff=_session_token(user["id"]))
        _forbidden_403(api_client.get(MASTER_SETTINGS))


# ─── §4.4: both staff branches — the SAME account, the SAME rows ───────────────


class TestBothStaffBranchesSameRows:
    def test_combined_account_both_branches_200_same_row(
        self, api_client
    ) -> None:
        """DoD: role=admin + master section → both staff branches answer
        200 on ONE row (the branch is the audience address, not data)."""
        user = _staff_account("+79995550911", "admin", with_section=True)
        _jar(api_client, staff=_session_token(user["id"]))

        master_resp = api_client.get(MASTER_SETTINGS)
        admin_resp = api_client.get(ADMIN_SETTINGS)
        assert master_resp.status_code == 200, master_resp.text
        assert admin_resp.status_code == 200, admin_resp.text
        assert master_resp.json()["id"] == admin_resp.json()["id"]
        assert (
            master_resp.json()["user_id"]
            == admin_resp.json()["user_id"]
            == user["id"]
        )

    def test_write_via_master_read_via_admin_same_rows(
        self, api_client
    ) -> None:
        """A write through one staff branch is visible through the other —
        same rows, no per-branch copies."""
        user = _staff_account("+79995550912", "admin", with_section=True)
        _jar(api_client, staff=_session_token(user["id"]))

        put = api_client.put(MASTER_SETTINGS, json={"theme": "dark"})
        assert put.status_code == 200, put.text
        admin_view = api_client.get(ADMIN_SETTINGS)
        assert admin_view.status_code == 200, admin_view.text
        assert admin_view.json()["id"] == put.json()["id"]
        assert admin_view.json()["theme"] == "dark"


# ─── §4.4: the client instance — a ready surface ──────────────────────────────


class TestClientBranchSurface:
    def test_client_gets_own_settings_row(self, api_client) -> None:
        """The client's row is born with the account (#319) — GET returns
        it, own-only, no-store (the get-or-create #319 semantics)."""
        user = _client_account("+79995550921")
        client = _jar(api_client, client=_session_token(user["id"]))

        resp = client.get(CLIENT_SETTINGS)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["user_id"] == user["id"]
        assert body["theme"] == "light"
        assert resp.headers.get("Cache-Control") == "no-store"

    def test_client_patches_own_settings_row(self, api_client) -> None:
        """The surface is ready for a future consumer: PATCH works under
        the client session (no api-client method ships yet, spec §4.4)."""
        user = _client_account("+79995550922")
        client = _jar(api_client, client=_session_token(user["id"]))

        resp = client.patch(CLIENT_SETTINGS, json={"theme": "dark"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["theme"] == "dark"


# ─── old paths are gone (§4.4/§8 Behavioral Delta) ─────────────────────────────


class TestOldPathsGone:
    def test_old_island_404_all_methods(self, api_client) -> None:
        """``/api/v1/user-settings*`` is retired → 404 on every method,
        probed under a LIVE admin session (route absence, not auth)."""
        assert api_client.get(OLD_ISLAND).status_code == 404
        assert api_client.post(OLD_ISLAND, json={}).status_code == 404
        assert api_client.put(OLD_ISLAND, json={}).status_code == 404
        assert api_client.patch(OLD_ISLAND, json={}).status_code == 404
        assert (
            api_client.request(
                "DELETE", f"{OLD_ISLAND}/x", json={"expected": {}}
            ).status_code
            == 404
        )

    def test_no_root_my_settings_404(self, api_client) -> None:
        """Spec §4.4: корневого ``/my/settings`` нет — only the branches."""
        assert api_client.get("/api/v1/my/settings").status_code == 404

    def test_unknown_branch_settings_404(self, api_client) -> None:
        """Static prefixes: an unknown branch is no route at all."""
        assert api_client.get("/api/v1/my/other/settings").status_code == 404


# ─── §9 CSRF pins — verify_fetch_metadata EXPLICITLY PER ROUTE ─────────────────


def _admitted_session(api_client, branch: str, login_as, _my_hash: str):
    """(client, user_id) admitted to the branch under test.

    /my/admin → the fixture admin; /my/master → a section-bearing
    master login; /my/client → a directly minted client cookie.
    """
    if branch == ADMIN_SETTINGS:
        me = api_client.get("/api/v1/auth/me").json()["user"]["id"]
        return api_client, me
    if branch == MASTER_SETTINGS:
        phone = f"+7999{secrets.token_hex(7)}"
        staff_id = _staff_card(with_section=True)
        user = insert_user(
            phone, _my_hash, role="master", master_id=staff_id
        )
        return login_as(phone, SETTINGS_PASSWORD), user["id"]
    user = _client_account(f"+7999{secrets.token_hex(7)}")
    return _jar(api_client, client=_session_token(user["id"])), user["id"]


class TestCsrfPerRoute:
    """Every migrated mutation × every branch — cross-site is 403, a
    same-origin fetch passes (the positive control proves the 403 is
    the CSRF line, not a guard misfire)."""

    @pytest.mark.parametrize(
        "branch", ALL_BRANCHES, ids=["master", "admin", "client"]
    )
    @pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
    def test_mutation_cross_site_403(
        self, api_client, login_as, _my_hash, branch, method
    ) -> None:
        client, _uid = _admitted_session(api_client, branch, login_as, _my_hash)
        headers = {"sec-fetch-site": "cross-site"}
        if method == "DELETE":
            resp = client.request(
                "DELETE", f"{branch}/whatever-id",
                json={"expected": {}}, headers=headers,
            )
        else:
            resp = client.request(
                method, branch, json={"theme": "dark"}, headers=headers
            )
        _forbidden_403(resp)

    @pytest.mark.parametrize(
        "branch", ALL_BRANCHES, ids=["master", "admin", "client"]
    )
    @pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
    def test_mutation_same_site_passes(
        self, api_client, login_as, _my_hash, branch, method
    ) -> None:
        client, uid = _admitted_session(api_client, branch, login_as, _my_hash)
        headers = {"sec-fetch-site": "same-origin"}
        if method == "POST":
            delete_settings_row(uid)  # §5.5 anomaly pattern → a clean 201
            resp = client.post(branch, json={}, headers=headers)
            assert resp.status_code == 201, resp.text
            assert resp.json()["user_id"] == uid
        elif method in ("PUT", "PATCH"):
            resp = client.request(
                method, branch, json={"theme": "dark"}, headers=headers
            )
            assert resp.status_code == 200, resp.text
            assert resp.json()["theme"] == "dark"
        else:  # DELETE
            row_id = client.get(branch).json()["id"]
            resp = client.request(
                "DELETE", f"{branch}/{row_id}",
                json={"expected": {}}, headers=headers,
            )
            assert resp.status_code == 204, resp.text


@pytest.fixture(scope="module")
def _my_hash() -> str:
    """Hash the test password once per module (Argon2 is slow)."""
    from src.auth.passwords import hash_password

    return hash_password(SETTINGS_PASSWORD)
