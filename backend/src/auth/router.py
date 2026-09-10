"""Auth router — login / logout / me — GH #247 §3.6.

All three are PUBLIC_ROUTES (spec §2.7): the API is default-deny but these
admit anonymous calls by design — ``me`` answers 401 ``AUTH_UNAUTHORIZED``
for a missing/expired session so the frontend can distinguish "no session"
from "wrong password" (getMe resolves 401 → guest, §4.1).

Cookie (spec §2.2): ``memo_session`` carries only the opaque token —
``HttpOnly``, ``SameSite=Lax``, ``Secure`` iff production, ``Path=/``,
``Max-Age`` = ABSOLUTE_CAP seconds (the row governs actual validity; a
stale cookie is simply not resolved). Login rotates: any token presented
in the request is deleted before the new session row is created (OWASP
session-id rotation — handled by AuthService.login via ``presented_token``).

Response shape: ``{user, permissions, master?}`` — ``user`` includes the
``users.id`` UUID string (feeds user-settings) and ``email``; ``master`` is
the linked profile snapshot (``{first_name, last_name}``) when a live
``master_id`` is set, else ``null`` (spec §3.6).

Spec: docs/specs/2026-09-08-auth-design.md §2.2, §3.6, §5
Domain rules: docs/domain-rules/auth.md (Sessions)
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import and_, select

from src.auth.permissions import (
    SESSION_COOKIE,
    AuthedUser,
    require_session,
)
from src.auth.service import get_auth_service
from src.auth.session import ABSOLUTE_CAP
from src.core.config import settings
from src.db import SessionDep
from src.models.master import Master
from src.models.user import User
from src.schemas.auth import AuthMeResponse, AuthUser, LoginRequest, MasterSnapshot

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(tags=["auth"])


async def _build_me_response(
    db_session: AsyncSession, authed: AuthedUser
) -> AuthMeResponse:
    """Assemble ``{user, permissions, master?}`` for the principal.

    ``AuthedUser`` (the guard principal) deliberately carries no email and
    no master profile — those are display concerns of this router, fetched
    with one user ⟕ master query. An archived linked profile resolves to
    ``master=None``: the sidebar then falls back to the phone (spec §4.5).
    """
    row = (
        await db_session.execute(
            select(User.email, Master.first_name, Master.last_name)
            .outerjoin(
                Master,
                and_(User.master_id == Master.id, Master.is_active == True),  # noqa: E712
            )
            .where(User.id == authed.id)
        )
    ).one_or_none()

    email = row.email if row is not None else None
    master = (
        MasterSnapshot(first_name=row.first_name, last_name=row.last_name)
        if row is not None and row.first_name is not None
        else None
    )

    return AuthMeResponse(
        user=AuthUser(
            id=authed.id,
            phone=authed.phone,
            role=authed.role,
            master_id=authed.master_id,
            email=email,
        ),
        permissions=sorted(authed.permissions),
        master=master,
    )


@router.post("/login", response_model=AuthMeResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db_session: SessionDep,
) -> AuthMeResponse:
    """Verify phone + password; create a session and set the cookie."""
    client_ip = request.client.host if request.client else "unknown"
    presented_token = request.cookies.get(SESSION_COOKIE)

    auth_service = get_auth_service()
    authed, token = await auth_service.login(
        db_session,
        phone=payload.phone,
        password=payload.password,
        client_ip=client_ip,
        presented_token=presented_token,
    )

    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=int(ABSOLUTE_CAP.total_seconds()),
        httponly=True,
        samesite="lax",
        secure=settings.ENV == "production",
        path="/",
    )
    return await _build_me_response(db_session, authed)


@router.post("/logout", status_code=204)
async def logout(request: Request, db_session: SessionDep) -> Response:
    """Delete the session row and clear the cookie. Idempotent (spec §3.6)."""
    token = request.cookies.get(SESSION_COOKIE)
    if token is not None:
        await get_auth_service().logout(db_session, token)

    resp = Response(status_code=204)
    resp.delete_cookie(key=SESSION_COOKIE, path="/")
    return resp


@router.get("/me", response_model=AuthMeResponse)
async def me(
    db_session: SessionDep,
    authed: AuthedUser = Depends(require_session),
) -> AuthMeResponse:
    """Resolve the current session — 401 ``AUTH_UNAUTHORIZED`` when absent."""
    return await _build_me_response(db_session, authed)
