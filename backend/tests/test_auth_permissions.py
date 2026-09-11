"""GH #247 §3.5/§3.7: permission matrix, AuthedUser, fetch-metadata guard, PUBLIC_ROUTES.

Pure unit tests — no DB, no app. Covers:
- ROLE_PERMISSIONS: admin holds only ``*``; master holds exactly the spec §3.5
  token set; keys are UserRole values; an unknown role yields no permissions;
- has_permission: the ``"*"`` wildcard and concrete tokens (nothing else);
- AuthedUser: the authenticated-principal dataclass carried by guards;
- verify_fetch_metadata: ``Sec-Fetch-Site: cross-site`` → 403 AUTH_FORBIDDEN,
  absent/same-site/same-origin/none headers pass;
- PUBLIC_ROUTES: exactly the spec §2.7 allowlist — no more, no less.

Spec: docs/specs/2026-09-08-auth-design.md (§2.4–2.7, §2.14–2.15, §3.5, §3.7)
Domain rules: docs/domain-rules/auth.md (Roles & Permissions, Public Access,
CSRF Posture)
"""

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from src.auth.permissions import (
    ROLE_PERMISSIONS,
    AuthedUser,
    has_permission,
    verify_fetch_metadata,
)
from src.auth.public import PUBLIC_ROUTES
from src.errors import ErrorCode
from src.models.enums import UserRole

pytestmark = pytest.mark.pure_unit

# The canonical master token list — spec §3.5, verbatim.
SPEC_MASTER_PERMISSIONS = {
    "records:read", "records:write",
    "visits:read", "visits:write",
    "visitors:read", "visitors:write",
    "masters:read", "locations:read", "services:read", "tags:read",
    "activities:read", "photos:read",
    "clients:read", "payments:read",
}


class TestRolePermissions:
    """ROLE_PERMISSIONS matrix — spec §3.5 (canonical token list)."""

    def test_keys_are_userrole_values(self) -> None:
        assert set(ROLE_PERMISSIONS) == {UserRole.ADMIN.value, UserRole.MASTER.value}

    def test_admin_holds_only_wildcard(self) -> None:
        assert ROLE_PERMISSIONS[UserRole.ADMIN.value] == {"*"}

    def test_master_set_matches_spec_exactly(self) -> None:
        """No more, no less than §3.5 — the matrix is the single source of truth."""
        assert ROLE_PERMISSIONS[UserRole.MASTER.value] == SPEC_MASTER_PERMISSIONS

    def test_admin_matches_every_concrete_permission(self) -> None:
        perms = ROLE_PERMISSIONS[UserRole.ADMIN.value]
        every_concrete = set(SPEC_MASTER_PERMISSIONS)
        every_concrete.update(
            {"payments:write", "materials:read", "materials:write",
             "clients:write", "masters:write", "user-settings:read"}
        )
        for perm in every_concrete:
            assert has_permission(perms, perm), perm

    def test_master_matches_records_write(self) -> None:
        perms = ROLE_PERMISSIONS[UserRole.MASTER.value]
        assert has_permission(perms, "records:write") is True

    def test_master_matches_payments_read(self) -> None:
        """User-approved: «мастеру надо видеть какие записи уже оплачены»."""
        perms = ROLE_PERMISSIONS[UserRole.MASTER.value]
        assert has_permission(perms, "payments:read") is True

    def test_master_lacks_payments_write(self) -> None:
        perms = ROLE_PERMISSIONS[UserRole.MASTER.value]
        assert has_permission(perms, "payments:write") is False

    def test_master_lacks_materials_read(self) -> None:
        perms = ROLE_PERMISSIONS[UserRole.MASTER.value]
        assert has_permission(perms, "materials:read") is False

    def test_unknown_role_has_no_permissions(self) -> None:
        """Defensive lookup pattern: a role missing from the matrix gets nothing."""
        assert "client" not in ROLE_PERMISSIONS
        assert ROLE_PERMISSIONS.get("client", set()) == set()
        assert has_permission(set(), "records:read") is False


class TestHasPermission:
    """The matcher is exactly ``"*" in perms or perm in perms`` — no other wildcards."""

    def test_wildcard_grants_any_permission(self) -> None:
        assert has_permission({"*"}, "anything:write") is True

    def test_exact_token_grants(self) -> None:
        assert has_permission({"records:read"}, "records:read") is True

    def test_other_token_denied(self) -> None:
        assert has_permission({"records:read"}, "records:write") is False

    def test_empty_denies(self) -> None:
        assert has_permission(set(), "records:read") is False

    def test_no_entity_wildcard_tier(self) -> None:
        """``records:*`` is NOT a wildcard — only the literal ``*`` is (G1b)."""
        assert has_permission({"records:*"}, "records:read") is False


class TestAuthedUser:
    """The authenticated principal injected by session guards (T5 wires them)."""

    def test_fields_round_trip(self) -> None:
        user = AuthedUser(
            id="user-1",
            phone="+79990000001",
            role=UserRole.ADMIN.value,
            staff_id=None,
            permissions=frozenset({"*"}),
        )
        assert user.id == "user-1"
        assert user.phone == "+79990000001"
        assert user.role == "admin"
        assert user.staff_id is None
        assert user.permissions == frozenset({"*"})
        # D10: no master_id attr remains on the principal — the wire key
        # survives only in the /auth/me response builder.
        assert not hasattr(user, "master_id")

    def test_master_user_with_linked_profile(self) -> None:
        user = AuthedUser(
            id="user-2",
            phone="+79990000002",
            role=UserRole.MASTER.value,
            staff_id="staff-9",
            permissions=frozenset(SPEC_MASTER_PERMISSIONS),
        )
        assert user.staff_id == "staff-9"
        assert has_permission(user.permissions, "visits:write") is True


def _make_request(headers: dict[str, str]) -> Request:
    """Build a minimal Starlette Request with the given headers."""
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/v1/records",
        "headers": [
            (name.lower().encode(), value.encode())
            for name, value in headers.items()
        ],
        "query_string": b"",
    }
    return Request(scope)


class TestVerifyFetchMetadata:
    """CSRF secondary line (spec §2.14): reject cross-site fetches only."""

    async def test_cross_site_rejected_with_403_forbidden(self) -> None:
        with pytest.raises(HTTPException) as exc:
            await verify_fetch_metadata(_make_request({"sec-fetch-site": "cross-site"}))
        assert exc.value.status_code == 403
        detail = exc.value.detail
        assert detail["code"] == ErrorCode.AUTH_FORBIDDEN.value
        assert detail["message"]

    @pytest.mark.parametrize(
        "value",
        ["same-site", "same-origin", "none"],
    )
    async def test_non_cross_site_values_pass(self, value: str) -> None:
        await verify_fetch_metadata(_make_request({"sec-fetch-site": value}))  # no raise

    async def test_absent_header_passes(self) -> None:
        """Legacy clients/tools/tests send no Sec-Fetch-Site — they pass."""
        await verify_fetch_metadata(_make_request({}))  # no raise


class TestPublicRoutes:
    """PUBLIC_ROUTES — the whole anonymous allowlist (spec §2.7), exactly."""

    def test_equals_spec_allowlist_exactly(self) -> None:
        # T7 addition: ``GET /api/v1/photos/web`` — the public gallery the
        # spec §1 "live consumer" list keeps working (frontend/web
        # ``useGallery`` → anonymous ``GET /photos/web``); spec §2.7 wording
        # "(site + gallery)" names exactly this surface.
        assert PUBLIC_ROUTES == frozenset({
            ("GET", "/api/v1/health"),
            # GH #266 D8: /masters is read-only acting masters; GET /{id}
            # was removed with the mutations (allowlist entry gone too).
            ("GET", "/api/v1/masters"),
            ("GET", "/api/v1/locations"),
            ("GET", "/api/v1/locations/{id}"),
            ("GET", "/api/v1/services"),
            ("GET", "/api/v1/services/{id}"),
            ("GET", "/api/v1/tags"),
            ("GET", "/api/v1/tags/{id}"),
            ("GET", "/api/v1/activities"),
            ("GET", "/api/v1/activities/{id}"),
            ("GET", "/api/v1/photos"),
            ("GET", "/api/v1/photos/{id}"),
            ("GET", "/api/v1/photos/web"),
            ("POST", "/api/v1/records"),
            ("POST", "/api/v1/auth/login"),
            ("POST", "/api/v1/auth/logout"),
            ("GET", "/api/v1/auth/me"),
        })

    def test_events_sse_route_is_not_public(self) -> None:
        """GET /api/v1/events (GH #239) gets its own guard in T7 — not allowlisted."""
        assert ("GET", "/api/v1/events") not in PUBLIC_ROUTES
