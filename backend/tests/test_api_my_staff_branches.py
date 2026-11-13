"""#584 (spec §4.3) — staff branches ``/api/v1/my/master`` + ``/api/v1/my/admin``.

The former flat ``/my`` profile router re-homes as ONE branch router
mounted on TWO STATIC prefixes (a dynamic path parameter is banned — it
would shadow the sibling branches by registration order; static prefixes
make the order irrelevant and an unknown branch 404s naturally).

Branch admission is EXACTLY the whoami role list composition («допуск
ветки — в точности состав списка „кто я"», spec §4.3):

* ``/my/admin/*`` — role ``admin``;
* ``/my/master/*`` — role ``master`` OR a master section (a section-less
  role-master keeps the branch; a section reads regardless of its
  ``is_active`` — the whoami composition);
* no valid staff cookie (anonymous / client cookie only / a client token
  cross-presented under the staff cookie name) → 401 ``AUTH_UNAUTHORIZED``
  — the shared envelope;
* a valid staff cookie of the OTHER branch → 403 ``AUTH_FORBIDDEN``.

Response: ``MyStaffProfileResponse`` = the flat ``MyProfileResponse`` +
``{user_id, phone, email, permissions}``; the MASTER branch additionally
carries the master section projection and the login-shaped card snapshot
(``master``) — assembled by reusing ``_build_me_response`` (login itself
is untouched). ``POST …/avatar`` (the former ``/my/portrait``) keeps the
whole multipart upload contract.

CSRF (§9): every migrated mutation carries ``verify_fetch_metadata``
pinned EXPLICITLY PER ROUTE (PUT × 2 branches, avatar × 2 branches).

Spec: docs/specs/2026-11-12-adr015-my-namespace-584-design.md §4.3, §4.5, §9
Domain rules: docs/domain-rules/profile.md, docs/domain-rules/auth.md
"""

from __future__ import annotations

import secrets

import pytest

from src.auth.permissions import CLIENT_SESSION_COOKIE, SESSION_COOKIE
from tests.conftest import insert_user, query_db_params

pytestmark = pytest.mark.api

MASTER_BRANCH = "/api/v1/my/master"
ADMIN_BRANCH = "/api/v1/my/admin"

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64

#: The flat MyProfileResponse keys (GH #262 §4) + the #584 staff additions.
STAFF_PROFILE_KEYS = {
    "role",
    "has_staff",
    "has_master",
    "first_name",
    "last_name",
    "avatar_url",
    "specialties",
    "patronymic",
    "birth_date",
    "residence_address",
    "birth_place",
    "passport_series_number",
    "passport_issued_date",
    "passport_issued_by",
    "registration_address",
    "user_id",
    "phone",
    "email",
    "permissions",
    "master_section",
    "master",
}


# ─── world builders (the test_api_my_whoami direct-SQL pattern) ────────────────


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
    email: str | None = None,
) -> dict:
    """A staff-role account (passwordless — sessions are minted directly)."""
    staff_id = _staff_card(with_section) if with_card else None
    user = insert_user(phone, None, role=role, master_id=staff_id)
    if email is not None:
        query_db_params(
            "UPDATE users SET email = :email WHERE id = :user",
            {"email": email, "user": user["id"]},
        )
    return user


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


def _staff(api_client, phone: str, role: str, **kwargs):
    """Staff account + minted staff cookie on the shared client jar."""
    user = _staff_account(phone, role, **kwargs)
    return _jar(api_client, staff=_session_token(user["id"])), user


def _unauthorized_401(resp) -> None:
    assert resp.status_code == 401, resp.text
    assert resp.json()["detail"]["code"] == "AUTH_UNAUTHORIZED"


def _forbidden_403(resp) -> None:
    assert resp.status_code == 403, resp.text
    assert resp.json()["detail"]["code"] == "AUTH_FORBIDDEN"


# ─── §9 access matrix ──────────────────────────────────────────────────────────


class TestBranchAdmission:
    def test_anonymous_401_both_branches(self, app, db_engine) -> None:
        from fastapi.testclient import TestClient

        anon = TestClient(app)
        _unauthorized_401(anon.get(MASTER_BRANCH))
        _unauthorized_401(anon.get(ADMIN_BRANCH))
        anon.close()

    def test_client_cookie_401_both_branches(self, api_client) -> None:
        """A client-only jar is not a staff session → the shared 401."""
        user = _client_account("+79995550301")
        _jar(api_client, client=_session_token(user["id"]))
        _unauthorized_401(api_client.get(MASTER_BRANCH))
        _unauthorized_401(api_client.get(ADMIN_BRANCH))

    def test_client_token_in_staff_cookie_401(self, api_client) -> None:
        """Cross-presented token: resolves, fails the staff role barrier →
        the SAME 401 (the require_client_session precedent, mirrored)."""
        user = _client_account("+79995550302")
        _jar(api_client, staff=_session_token(user["id"]))
        _unauthorized_401(api_client.get(MASTER_BRANCH))
        _unauthorized_401(api_client.get(ADMIN_BRANCH))

    def test_master_role_on_admin_branch_403(self, api_client) -> None:
        client, _user = _staff(
            api_client, "+79995550303", "master", with_section=True
        )
        _forbidden_403(client.get(ADMIN_BRANCH))

    def test_sectionless_master_keeps_master_branch_200(self, api_client) -> None:
        """«роль master, секции нет» — explicit role beats everything; the
        branch answers 200 (the station is reachable per spec §4.3)."""
        client, _user = _staff(
            api_client, "+79995550304", "master", with_section=False
        )
        resp = client.get(MASTER_BRANCH)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["has_master"] is False
        assert body["master_section"] is None

    def test_pure_admin_on_master_branch_403(self, api_client) -> None:
        """Cardless admin: no role=master, no section → 403 on /my/master."""
        client, _user = _staff(
            api_client, "+79995550305", "admin", with_card=False
        )
        _forbidden_403(client.get(MASTER_BRANCH))

    def test_admin_without_section_on_master_branch_403(self, api_client) -> None:
        """A card WITHOUT the masters extension is not a master either."""
        client, _user = _staff(
            api_client, "+79995550306", "admin", with_card=True,
            with_section=False,
        )
        _forbidden_403(client.get(MASTER_BRANCH))


# ─── §7 scenario 5a — combined admin+master on both branches ──────────────────


class TestCombinedAdminMaster:
    def test_both_branches_200_master_data_from_master_branch(
        self, api_client
    ) -> None:
        """5a: one account (role=admin + section) — both branches answer;
        the admin branch carries NO master section/snapshot, the master
        branch carries both."""
        client, user = _staff(
            api_client, "+79995550310", "admin", with_section=True,
            email="combo@example.com",
        )

        admin_resp = client.get(ADMIN_BRANCH)
        assert admin_resp.status_code == 200, admin_resp.text
        admin_body = admin_resp.json()
        assert admin_body["master_section"] is None
        assert admin_body["master"] is None

        master_resp = client.get(MASTER_BRANCH)
        assert master_resp.status_code == 200, master_resp.text
        body = master_resp.json()
        assert body["master_section"] == {
            "specialties": ["живопись", "керамика"],
            "color": "#5B8C7A",
        }
        assert body["master"] == {
            "first_name": "Мария",
            "last_name": "Иванова",
            "avatar_url": None,
        }
        # The account half is identical on both branches.
        assert admin_body["user_id"] == body["user_id"] == user["id"]
        assert admin_body["permissions"] == body["permissions"] == ["*"]
        assert body["email"] == "combo@example.com"


# ─── decision 2 (spec §2): role list == branch admission, one source ──────────


class TestWhoamiBranchSymmetry:
    """«Роль появляется в списке тогда и только тогда, когда одноимённая
    ветка ответит этому же запросу 200» — the invariant that keeps the
    whoami list and the branch guards from drifting apart."""

    @pytest.mark.parametrize(
        ("role", "with_card", "with_section"),
        [
            ("admin", False, False),   # cardless admin → [admin]
            ("admin", True, True),     # combined → [admin, master]
            ("master", True, False),   # sectionless → [master]
            ("master", True, True),    # clean master → [master]
            ("client", False, False),  # client jar → [client]
        ],
    )
    def test_role_list_matches_branch_admission(
        self, api_client, role, with_card, with_section
    ) -> None:
        suffix = f"{len(role)}{int(with_card)}{int(with_section)}"
        if role == "client":
            user = _client_account(f"+799955504{suffix}1")
            _jar(api_client, client=_session_token(user["id"]))
        else:
            user = _staff_account(
                f"+799955504{suffix}2", role,
                with_card=with_card, with_section=with_section,
            )
            _jar(api_client, staff=_session_token(user["id"]))

        whoami = api_client.get("/api/v1/my")
        assert whoami.status_code == 200, whoami.text
        roles = whoami.json()["roles"]

        admin_status = api_client.get(ADMIN_BRANCH).status_code
        master_status = api_client.get(MASTER_BRANCH).status_code
        assert ("admin" in roles) == (admin_status == 200)
        assert ("master" in roles) == (master_status == 200)
        # A role absent from the list is 403 (valid staff cookie, wrong
        # branch) or 401 (no staff cookie at all) — never a third shape.
        for status in (admin_status, master_status):
            assert status in (200, 401, 403)


# ─── MyStaffProfileResponse contract (spec §4.3 table) ─────────────────────────


class TestStaffProfileContract:
    def test_master_branch_shape_and_values(self, api_client) -> None:
        client, user = _staff(
            api_client, "+79995550320", "master", with_section=True,
            email="m@example.com",
        )
        resp = client.get(MASTER_BRANCH)
        assert resp.status_code == 200, resp.text
        body = resp.json()

        assert set(body.keys()) == STAFF_PROFILE_KEYS
        assert body["user_id"] == user["id"]
        assert body["phone"] == user["phone"]
        assert body["email"] == "m@example.com"
        # role master → the exact ROLE_PERMISSIONS token list, sorted.
        from src.auth.permissions import ROLE_PERMISSIONS

        assert body["permissions"] == sorted(ROLE_PERMISSIONS["master"])
        # The flat #262 profile half is intact.
        assert body["role"] == "master"
        assert body["has_staff"] is True
        assert body["has_master"] is True
        assert body["specialties"] == ["живопись", "керамика"]
        assert all(body[k] is None for k in (
            "patronymic", "birth_date", "residence_address", "birth_place",
            "passport_series_number", "passport_issued_date",
            "passport_issued_by", "registration_address",
        ))

    def test_admin_branch_permissions_and_null_master_fields(
        self, api_client
    ) -> None:
        """api_client IS a cardless admin: permissions=["*"], the master
        half empty — «половина профиля просто пустая» (§4.3)."""
        resp = api_client.get(ADMIN_BRANCH)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert set(body.keys()) == STAFF_PROFILE_KEYS
        assert body["permissions"] == ["*"]
        assert body["has_staff"] is False
        assert body["has_master"] is False
        assert body["master_section"] is None
        assert body["master"] is None
        assert body["email"] is None  # cardless fixture admin carries none

    def test_put_returns_the_branch_profile_shape(self, api_client) -> None:
        """PUT keeps the GET/PUT same-shape parity (#262) on the branch."""
        client, _user = _staff(
            api_client, "+79995550321", "master", with_section=True
        )
        resp = client.put(MASTER_BRANCH, json={"patronymic": "Петровна"})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert set(body.keys()) == STAFF_PROFILE_KEYS
        assert body["patronymic"] == "Петровна"
        assert body["master_section"] is not None
        assert body["master"] is not None


# ─── old flat paths are gone (§4.3/§4.5, Behavioral Delta §8) ─────────────────


class TestOldPathsGone:
    def test_portrait_404(self, api_client) -> None:
        """The former upload route is retired by the /avatar rename."""
        resp = api_client.post(
            "/api/v1/my/portrait",
            files={"file": ("p.jpg", JPEG, "application/octet-stream")},
        )
        assert resp.status_code == 404, resp.text

    def test_flat_put_my_405(self, api_client) -> None:
        """PUT /api/v1/my (the pre-#584 profile write) is retired: the path
        serves only the whoami GET → 405, never a profile write."""
        resp = api_client.put("/api/v1/my", json={})
        assert resp.status_code == 405, resp.text
        assert set(api_client.get("/api/v1/my").json()) == {
            "id", "phone", "email", "roles",
        }

    def test_unknown_branch_404(self, api_client) -> None:
        """Static prefixes: an unknown branch is no route at all (the
        panel blocker — no path parameter ever matches a neighbour)."""
        assert api_client.get("/api/v1/my/other").status_code == 404


# ─── avatar on both branches (multipart contract re-homed) ─────────────────────


class TestAvatarBranches:
    def test_master_avatar_upload(self, api_client) -> None:
        client, _user = _staff(
            api_client, "+79995550330", "master", with_section=True
        )
        resp = client.post(
            f"{MASTER_BRANCH}/avatar",
            files={"file": ("p.jpg", JPEG, "application/octet-stream")},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert set(body.keys()) == {"avatar_url"}
        assert body["avatar_url"].startswith("/api/v1/files/avatar/")

    def test_admin_avatar_upload(self, api_client) -> None:
        """api_client (cardless admin) — the 422 card-bound refusal proves
        the route exists and the upload path runs under the admin prefix."""
        resp = api_client.post(
            f"{ADMIN_BRANCH}/avatar",
            files={"file": ("p.jpg", JPEG, "application/octet-stream")},
        )
        assert resp.status_code == 422, resp.text

    def test_avatar_wrong_branch_403(self, api_client) -> None:
        """The branch guard covers mutations, not just the GET."""
        client, _user = _staff(
            api_client, "+79995550331", "master", with_section=True
        )
        resp = client.post(
            f"{ADMIN_BRANCH}/avatar",
            files={"file": ("p.jpg", JPEG, "application/octet-stream")},
        )
        _forbidden_403(resp)


# ─── §9 CSRF pins — verify_fetch_metadata EXPLICITLY PER ROUTE ─────────────────


class TestCsrfPerRoute:
    @pytest.mark.parametrize(
        "branch", [MASTER_BRANCH, ADMIN_BRANCH], ids=["master", "admin"]
    )
    def test_put_profile_cross_site_403(self, api_client, login_as, _my_hash,
                                        branch) -> None:
        client = _branch_admin_or_master(login_as, _my_hash, branch)
        resp = client.put(
            branch, json={"patronymic": "X"},
            headers={"sec-fetch-site": "cross-site"},
        )
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == "AUTH_FORBIDDEN"

    @pytest.mark.parametrize(
        "branch", [MASTER_BRANCH, ADMIN_BRANCH], ids=["master", "admin"]
    )
    def test_put_profile_same_site_passes(self, api_client, login_as,
                                          _my_hash, branch) -> None:
        """Positive control: same-origin fetch goes through — the 403 above
        is the CSRF line, not a guard misfire."""
        client = _branch_admin_or_master(login_as, _my_hash, branch)
        resp = client.put(
            branch, json={"patronymic": "X"},
            headers={"sec-fetch-site": "same-origin"},
        )
        assert resp.status_code == 200, resp.text

    @pytest.mark.parametrize(
        "branch", [MASTER_BRANCH, ADMIN_BRANCH], ids=["master", "admin"]
    )
    def test_avatar_cross_site_403(self, api_client, login_as, _my_hash,
                                   branch) -> None:
        client = _branch_admin_or_master(login_as, _my_hash, branch)
        resp = client.post(
            f"{branch}/avatar",
            files={"file": ("p.jpg", JPEG, "application/octet-stream")},
            headers={"sec-fetch-site": "cross-site"},
        )
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == "AUTH_FORBIDDEN"


def _branch_admin_or_master(login_as, _my_hash, branch: str):
    """A login that belongs to the branch under test.

    /my/admin → a cardless admin; /my/master → a section-bearing master.
    (Argon2 hashes come from the module fixture of test_api_my.py — this
    module declares its own below.)
    """
    phone = f"+7999{secrets.token_hex(7)}"
    if branch == ADMIN_BRANCH:
        insert_user(phone, _my_hash, role="admin")
    else:
        staff_id = _staff_card(with_section=True)
        insert_user(phone, _my_hash, role="master", master_id=staff_id)
    return login_as(phone, "my-pass-123")


@pytest.fixture(scope="module")
def _my_hash() -> str:
    """Hash the test password once per module (Argon2 is slow)."""
    from src.auth.passwords import hash_password

    return hash_password("my-pass-123")
