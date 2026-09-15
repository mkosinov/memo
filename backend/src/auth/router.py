"""Auth router — login / logout / me / change-password — GH #247 §3.6 (+ #262).

login / logout / me are PUBLIC_ROUTES (spec §2.7): the API is default-deny
but these admit anonymous calls by design — ``me`` answers 401
``AUTH_UNAUTHORIZED`` for a missing/expired session so the frontend can
distinguish "no session" from "wrong password" (getMe resolves 401 →
guest, §4.1). ``change-password`` (#262 §4) is session-guarded and NOT
public (it mutates credentials).

Cookie (spec §2.2): ``memo_session`` carries only the opaque token —
``HttpOnly``, ``SameSite=Lax``, ``Secure`` iff production, ``Path=/``,
``Max-Age`` = ABSOLUTE_CAP seconds (the row governs actual validity; a
stale cookie is simply not resolved). Login rotates: any token presented
in the request is deleted before the new session row is created (OWASP
session-id rotation — handled by AuthService.login via ``presented_token``).

Response shape: ``{user, permissions, master?}`` — ``user`` includes the
``users.id`` UUID string (feeds user-settings) and ``email``; ``master`` is
the linked card snapshot (``{first_name, last_name, avatar_url?}``) when a
``master_id`` is set, else ``null`` (spec §3.6; #262 added ``avatar_url``
and made the snapshot archive-independent).

Spec: docs/specs/2026-09-08-auth-design.md §2.2, §3.6, §5
Domain rules: docs/domain-rules/auth.md (Sessions)
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select

from src.auth.permissions import (
    SESSION_COOKIE,
    AuthedUser,
    require_session,
    verify_fetch_metadata,
)
from src.auth.passwords import PasswordPolicyError
from src.auth.service import get_auth_service
from src.auth.session import ABSOLUTE_CAP
from src.core.config import settings
from src.db import SessionDep
from src.errors import ErrorCode, ErrorDetail
from src.models.staff import Staff
from src.models.user import User
from src.schemas.auth import (
    AuthMeResponse,
    AuthUser,
    ChangePasswordRequest,
    LoginRequest,
    MasterSnapshot,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(tags=["auth"])


async def _build_me_response(
    db_session: AsyncSession, authed: AuthedUser
) -> AuthMeResponse:
    """Assemble ``{user, permissions, master?}`` for the principal.

    ``AuthedUser`` (the guard principal) deliberately carries no email and
    no master profile — those are display concerns of this router, fetched
    with one user ⟕ staff query. A linked card yields its name/avatar
    snapshot **regardless of the card's archive flag** (GH #262 Display
    rule, spec §4 — one's own name never blanks); no card at all resolves
    to ``master=None``: the sidebar then falls back to the phone (§4.5).
    """
    row = (
        await db_session.execute(
            select(User.email, Staff.first_name, Staff.last_name, Staff.avatar_url)
            .outerjoin(Staff, User.staff_id == Staff.id)
            .where(User.id == authed.id)
        )
    ).one_or_none()

    email = row.email if row is not None else None
    # GH #262 Display rule (spec §4): the snapshot reads the linked card's
    # name/avatar **regardless of its archive flag** — one's own name never
    # blanks (archived people keep the sidebar identity until the card
    # itself is deleted).
    master = (
        MasterSnapshot(
            first_name=row.first_name,
            last_name=row.last_name,
            avatar_url=row.avatar_url,
        )
        if row is not None and row.first_name is not None
        else None
    )

    return AuthMeResponse(
        user=AuthUser(
            id=authed.id,
            phone=authed.phone,
            role=authed.role,
            master_id=authed.staff_id,
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


@router.post(
    "/change-password",
    status_code=204,
    dependencies=[Depends(require_session), Depends(verify_fetch_metadata)],
)
async def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    db_session: SessionDep,
    authed: AuthedUser = Depends(require_session),
) -> Response:
    """Verify the current password; set the new one; revoke other sessions.

    Session-guarded (NOT a PUBLIC_ROUTE — #262 §4). 401
    ``AUTH_INVALID_CREDENTIALS`` on a wrong current password (timing
    parity via the login DUMMY_HASH pattern), 422 ``PASSWORD_POLICY``
    when the new one breaches the shared policy; 204 keeps the CURRENT
    session and deletes every other row of the user (D6).
    """
    try:
        await get_auth_service().change_password(
            db_session,
            user=authed,
            current_password=payload.current_password,
            new_password=payload.new_password,
            current_token=request.cookies.get(SESSION_COOKIE, ""),
        )
    except PasswordPolicyError as exc:
        raise HTTPException(
            status_code=422,
            detail=ErrorDetail(
                code=ErrorCode.PASSWORD_POLICY,
                message=str(exc),
            ).model_dump(),
        ) from exc
    return Response(status_code=204)
