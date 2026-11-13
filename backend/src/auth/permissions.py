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
from sqlalchemy import select
# ``Request`` MUST stay a runtime import (not TYPE_CHECKING): FastAPI
# resolves dependency signatures via get_type_hints at registration time.
from starlette.requests import Request

from src.core.config import settings
from src.db import db_manager
from src.errors import ErrorCode, ErrorDetail
from src.models.enums import UserRole
from src.models.master import Master
from src.models.user import User

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

# Canonical token list (spec §3.5 + GH #263 T1 delta). The #263 master
# gains payments:write / photos:write / clients:write — the per-master
# SCOPE (src/auth/scope.py, D5/D6/D7) cuts these down to «own»/create-only
# at the router layer; clients:write is create-only by router guards.
# No materials, no management writes. Admin = everything.
ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    UserRole.ADMIN.value: frozenset({"*"}),
    UserRole.MASTER.value: frozenset({
        "records:read", "records:write",
        "visits:read", "visits:write",
        "visitors:read", "visitors:write",
        "masters:read", "locations:read", "services:read", "tags:read",
        "activities:read", "photos:read", "photos:write",
        "clients:read", "clients:write",
        "payments:read", "payments:write",
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
    # #499 (spec §3): optional 1:1 client-card link — mirrors staff_id.
    # Defaults so existing principals/tests construct unchanged; the
    # client cabinet (GET /api/v1/my/client) and the #499 booking owner
    # resolve their card through it, never from request data.
    client_id: str | None = None


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


async def verify_origin(request: Request) -> None:
    """Login-CSRF line for the anonymous session-ISSUING routes (#499 §4.2).

    When the browser sends ``Origin`` (cross-origin fetches and all
    modern form posts), it must be in the CORS list — the same list the
    CORS middleware allows credentials for. A mismatch means a foreign
    page is driving the request: 403 before any code work (issuing a
    session must not be available to someone else's page). A missing
    header passes — non-browser clients and same-origin navigations
    (the JSON-only + CORS posture remains the primary line; anonymous
    routes are exempt from ``Sec-Fetch-Site``).
    """
    origin = request.headers.get("origin")
    if origin is None:
        return
    allowed = settings.CORS_ORIGINS
    if "*" not in allowed and origin not in allowed:
        raise HTTPException(
            status_code=403,
            detail=ErrorDetail(
                code=ErrorCode.AUTH_FORBIDDEN,
                message="Cross-origin request rejected",
            ).model_dump(),
        )


# ─── Session dependencies (T5) ─────────────────────────────────────────────────

#: Cookie name carrying the opaque session token (spec §2.2).
SESSION_COOKIE = "memo_session"

#: #499 (spec §4.3): client sessions ride the SAME session rows but a
#: SEPARATE cookie name — a client and a staff session coexist in one
#: browser without clobbering each other (site and admin share the API
#: origin). Same attributes as ``memo_session``; only the name differs.
CLIENT_SESSION_COOKIE = "memo_client_session"


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


async def resolve_authed(token: str | None) -> AuthedUser | None:
    """Resolve a session token into an ``AuthedUser``, or ``None``.

    The shared resolution core for ``require_session`` (strict: raises
    401 on miss) and, through it, ``get_optional_scope`` (#600: the
    scope seam rides the same ``require_session`` dependency via
    FastAPI's per-request cache — one resolve pair per request, the
    N+1 guard on the activities list keeps it honest). One
    session-cookie lookup shape, no drift between the consumers.

    GH #344 (spec §4.1): a successful resolve ALSO stages the request's
    audit actor (``user_id`` + ``role`` contextvar) — both guard paths
    flow through here, so the journal author is set on every guarded
    route with zero extra DB hits. The author comes only from the
    server-side session, never from request data. No author → the
    ``@transactional`` audit insertion is skipped (seeds/CLI/anonymous
    are not journaled, spec §12).
    """
    if token is None:
        return None
    # Lazy import: src.auth.service imports this module (AuthedUser +
    # ROLE_PERMISSIONS) — a module-level import would be circular.
    from src.auth.service import get_auth_service

    async with db_manager.async_session() as db_session:
        authed = await get_auth_service().resolve(db_session, token)
    if authed is not None:
        # LAZY import — cycle hazard: a top-level import would form
        # audit → scope → permissions → audit (mask_phone precedes the
        # actor here; see the WARNING in src/events/audit.py).
        from src.events.audit import set_actor

        # #584: the actor record carries a role LIST now — the classic
        # single-role guards stage a 1-tuple (their journal rows are
        # byte-identical with the pre-#584 behavior).
        set_actor(user_id=authed.id, roles=[authed.role])
    return authed


async def resolve_authed_pure(token: str | None) -> AuthedUser | None:
    """Resolve a session token WITHOUT staging the audit actor (#584 §6).

    The same resolution core as :func:`resolve_authed` (sliding window,
    lazy expiry, archived-account refusal) minus the journal side
    effect — resolve and journaling are separate seams now.
    ``resolve_authed`` keeps its inline staging for the classic guards
    and the optional-scope seam (their single-record behavior is
    unchanged); the combined whoami guard below resolves BOTH cookies
    through here and stages ONE actor record itself.
    """
    if token is None:
        return None
    # Lazy import: src.auth.service imports this module (AuthedUser +
    # ROLE_PERMISSIONS) — a module-level import would be circular.
    from src.auth.service import get_auth_service

    async with db_manager.async_session() as db_session:
        return await get_auth_service().resolve(db_session, token)


async def require_session(request: Request) -> AuthedUser:
    """Resolve the ``memo_session`` cookie into an ``AuthedUser``.

    401 ``AUTH_UNAUTHORIZED`` for a missing cookie, unknown token, or an
    expired/archived session — the frontend treats all three as "no
    session" and redirects to login (spec §5).

    #499 (spec §3): deliberately UNCHANGED — reads only ``memo_session``
    and checks no role; client-session separation lives in
    ``require_client_session`` below.
    """
    authed = await resolve_authed(request.cookies.get(SESSION_COOKIE))
    if authed is None:
        raise _unauthorized()
    return authed


async def require_client_session(request: Request) -> AuthedUser:
    """Resolve the ``memo_client_session`` cookie into a client principal.

    #499 (spec §3/§4.3): same session rows, same resolve core (sliding
    window, lazy expiry, archived-account refusal) — but ONLY the client
    cookie name is read (a staff ``memo_session`` is invisible here) and
    the resolved role must be ``client`` (a staff token copied into the
    client cookie name resolves, then fails the role barrier). Both
    cross-presentation shapes are the SAME 401 ``AUTH_UNAUTHORIZED`` as
    no session at all. The staff resolver above stays untouched.
    """
    authed = await resolve_authed(request.cookies.get(CLIENT_SESSION_COOKIE))
    if authed is None or authed.role != UserRole.CLIENT.value:
        raise _unauthorized()
    return authed


# ─── #584 (spec §4.1/§6) — combined whoami guard ───────────────────────────────


async def resolved_staff_roles(staff: AuthedUser) -> tuple[str, ...]:
    """The staff-side role composition for a RESOLVED staff principal (§4.1).

    * ``admin`` — the account role is admin;
    * ``master`` — the account role is master OR the account has a
      master section (``masters.staff_id`` via ``users.staff_id``); both
      entries may appear (an admin with a master section).

    The audience filter is upstream: only a resolved STAFF cookie
    reaches here. A client account under the staff cookie contributes
    nothing — its role matches no staff entry and it carries no staff
    card, hence no master section.
    """
    roles: list[str] = []
    if staff.role == UserRole.ADMIN.value:
        roles.append(UserRole.ADMIN.value)
    if staff.role == UserRole.MASTER.value or await _has_master_section(staff):
        roles.append(UserRole.MASTER.value)
    return tuple(roles)


async def _has_master_section(staff: AuthedUser) -> bool:
    """Does the account's staff card carry a ``masters`` extension row?"""
    if staff.staff_id is None:
        return False
    async with db_manager.async_session() as db_session:
        section = (
            await db_session.execute(
                select(Master.staff_id).where(Master.staff_id == staff.staff_id)
            )
        ).scalar_one_or_none()
    return section is not None


async def _account_email(user_id: str) -> str | None:
    """The primary account's ``email`` column (client accounts carry none)."""
    async with db_manager.async_session() as db_session:
        email = (
            await db_session.execute(
                select(User.email).where(User.id == user_id)
            )
        ).scalar_one_or_none()
    return email


@dataclass(frozen=True)
class WhoamiIdentities:
    """What the combined whoami guard resolved (#584, spec §4.1).

    ``roles`` is the full audience-filtered list, staff-side entries
    first (the staff-first order is the actor's primary-role invariant);
    ``primary`` is the staff account when its cookie resolved, else the
    client account — the single audit-actor and response identity.
    """

    staff: AuthedUser | None
    client: AuthedUser | None
    primary: AuthedUser
    roles: tuple[str, ...]
    email: str | None


async def require_any_session(request: Request) -> WhoamiIdentities:
    """The combined «кто я» guard (#584, spec §4.1/§6) — whoami ONLY.

    Two PURE resolves (``resolve_authed_pure`` — no actor staging inside
    the resolve), each reading only its own cookie name; the role list
    is composed with symmetric audience filters (a role enters the list
    only via a valid cookie of its own audience — cross-presented tokens
    resolve but contribute nothing). Empty list → the shared 401.

    Then exactly ONE actor record (decision 2026-11-13): the primary
    account — the staff one when its cookie resolved, else the client
    one — carrying the FULL resolved role list. The losing probe never
    creates its own record.
    """
    staff = await resolve_authed_pure(request.cookies.get(SESSION_COOKIE))
    client = await resolve_authed_pure(
        request.cookies.get(CLIENT_SESSION_COOKIE)
    )

    staff_side = await resolved_staff_roles(staff) if staff is not None else ()
    client_side = (
        (UserRole.CLIENT.value,)
        if client is not None and client.role == UserRole.CLIENT.value
        else ()
    )
    roles = staff_side + client_side
    if not roles:
        raise _unauthorized()

    # Primary account: staff-first (spec §4.1 — «сотрудника, если его
    # кука валидна, иначе клиентская»).
    primary = staff if staff is not None else client
    assert primary is not None  # a non-empty role list implies a resolve

    # LAZY import — same cycle hazard as in resolve_authed above.
    from src.events.audit import set_actor

    set_actor(user_id=primary.id, roles=roles)
    return WhoamiIdentities(
        staff=staff,
        client=client,
        primary=primary,
        roles=roles,
        email=await _account_email(primary.id),
    )


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


async def require_admin(
    authed: AuthedUser = Depends(require_session),
) -> AuthedUser:
    """Role check beyond the token matrix — admin ONLY.

    Needed where a token master now holds must still not grant a route:
    GH #263 D7 gives master ``clients:write`` as CREATE-ONLY, so the
    client mutation routes (PUT/PATCH/DELETE/archive/restore) are pinned
    to admin here instead of the token (they keep ``clients:write`` too —
    admin passes both).
    """
    if authed.role != UserRole.ADMIN.value:
        raise _forbidden()
    return authed
