"""Role → permission matrix and pure permission helpers — GH #247 §3.5.

Roles & permissions live in code (no DB-driven RBAC): one matrix keyed by
``UserRole`` values, permissions are ``<entity>:read`` / ``<entity>:write``.
Admin holds the single literal ``"*"``. The matcher is exactly
``"*" in perms or perm in perms`` — no ``entity:*`` wildcard tier, no
server-side expansion (G1b simplification).

``require_session`` / ``require_permission`` live here too — added in T5,
once ``AuthService`` (T4) exists. This module ships only the pure parts.

Spec: docs/specs/2026-09-08-auth-design.md §3.5
Domain rules: docs/domain-rules/auth.md (Roles & Permissions)
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException
from starlette.requests import Request

from src.errors import ErrorCode, ErrorDetail
from src.models.enums import UserRole

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
    master_id: str | None
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
