"""Role → permission matrix and pure permission helpers — GH #247 §3.5.

Roles & permissions live in code (no DB-driven RBAC): one matrix keyed by
``UserRole`` values, permissions are ``<entity>:read`` / ``<entity>:write``.
Admin holds the single literal ``"*"``. The matcher is exactly
``"*" in perms or perm in perms`` — no ``entity:*`` wildcard tier, no
server-side expansion (G1b simplification).

``require_session`` / ``require_permission`` — the FastAPI dependencies T7
staples onto every guarded router (spec §3.5): the former resolves the
``memo_session`` cookie via ``AuthService`` and yields the ``AuthedUser``,
the latter layers the permission matcher on top. ``get_auth_service`` is
imported lazily inside ``require_session`` — ``service.py`` imports this
module, so a module-level import would be circular.

Spec: docs/specs/2026-09-08-auth-design.md §3.5
Domain rules: docs/domain-rules/auth.md (Roles & Permissions)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from fastapi import Depends, HTTPException
# ``Request`` MUST stay a runtime import (not TYPE_CHECKING): FastAPI
# resolves dependency signatures via get_type_hints at registration time.
from starlette.requests import Request

from src.db import db_manager
from src.errors import ErrorCode, ErrorDetail
from src.models.enums import UserRole

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

# Canonical token list (spec §3.5). Master (user-approved set, incl.
# payments:read — «мастеру надо видеть какие записи уже оплачены»):
# full working data (records, visits, visitors), read-only dictionaries
# (masters, locations, services, tags, activities, photos), read-only
# clients and payments. No materials, no management writes. Admin = everything.
ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    UserRole.ADMIN.value: frozenset({"*"}),
    UserRole.MASTER.value: frozenset({
        "records:read", "records:write",
        "visits:read", "visits:write",
        "visitors:read", "visitors:write",
        "masters:read", "locations:read", "services:read", "tags:read",
        "activities:read", "photos:read",
        "clients:read", "payments:read",
    }),
}


def has_permission(perms: frozenset[str] | set[str], perm: str) -> bool:
    """The whole matcher: ``"*"`` grants everything; otherwise exact membership.

    No ``entity:*`` wildcard tier — a token like ``records:*`` matches nothing
    (only the literal ``"*"`` is special).
    """
    return "*" in perms or perm in perms


@dataclass(frozen=True)
class AuthedUser:
    """Authenticated principal injected by the session guards (T5).

    ``permissions`` is the stored role set as-is (admin gets ``{"*"}``; the
    frontend ``can()`` handles the wildcard — spec §3.5).
    """

    id: str
    phone: str
    role: str
    # GH #266 D10: internal principal renamed master_id → staff_id (the
    # card FK); the /auth/me response shape is UNCHANGED (wire keeps
    # master_id until the frontend migrates).
    staff_id: str | None
    permissions: frozenset[str]


async def verify_fetch_metadata(request: Request) -> None:
    """CSRF secondary line (spec §2.14): reject cross-site browser fetches.

    A browser always sets ``Sec-Fetch-Site`` on requests from fetch/XHR/forms;
    ``cross-site`` means the request originates from another site's page.
    A missing header passes — legacy clients, tools, and tests (the primary
    CSRF line is JSON-only + CORS-with-credentials; this is the second line).
    """

    site = request.headers.get("sec-fetch-site")
    if site == "cross-site":
        raise HTTPException(
            status_code=403,
            detail=ErrorDetail(
                code=ErrorCode.AUTH_FORBIDDEN,
                message="Cross-site request rejected",
            ).model_dump(),
        )


# ─── Session dependencies (T5) ─────────────────────────────────────────────────

#: Cookie name carrying the opaque session token (spec §2.2).
SESSION_COOKIE = "memo_session"


def _unauthorized() -> HTTPException:
    """401 — no/expired session on a guarded route (spec §5)."""
    return HTTPException(
        status_code=401,
        detail=ErrorDetail(
            code=ErrorCode.AUTH_UNAUTHORIZED,
            message="Требуется вход в систему",
        ).model_dump(),
    )


def _forbidden() -> HTTPException:
    """403 — authenticated but lacking the required permission (spec §5)."""
    return HTTPException(
        status_code=403,
        detail=ErrorDetail(
            code=ErrorCode.AUTH_FORBIDDEN,
            message="Недостаточно прав",
        ).model_dump(),
    )


async def require_session(request: Request) -> AuthedUser:
    """Resolve the ``memo_session`` cookie into an ``AuthedUser``.

    401 ``AUTH_UNAUTHORIZED`` for a missing cookie, unknown token, or an
    expired/archived session — the frontend treats all three as "no
    session" and redirects to login (spec §5).
    """
    # Lazy import: src.auth.service imports this module (AuthedUser +
    # ROLE_PERMISSIONS) — a module-level import would be circular.
    from src.auth.service import get_auth_service

    token = request.cookies.get(SESSION_COOKIE)
    if token is None:
        raise _unauthorized()

    async with db_manager.async_session() as db_session:
        authed = await get_auth_service().resolve(db_session, token)
    if authed is None:
        raise _unauthorized()
    return authed


def require_permission(perm: str) -> Callable[..., Awaitable[AuthedUser]]:
    """Dependency factory: ``require_session`` + the permission matcher.

    ``Depends(require_permission("payments:write"))`` — anonymous → 401
    (from the session guard), authenticated-but-unauthorized → 403
    ``AUTH_FORBIDDEN`` (here).
    """
    async def _guard(
        authed: AuthedUser = Depends(require_session),
    ) -> AuthedUser:
        if not has_permission(authed.permissions, perm):
            raise _forbidden()
        return authed

    return _guard
