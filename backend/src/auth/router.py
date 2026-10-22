"""Auth router — login / logout / me / change-password / password-setup.

login / logout / me are PUBLIC_ROUTES (spec §2.7): the API is default-deny
but these admit anonymous calls by design — ``me`` answers 401
``AUTH_UNAUTHORIZED`` for a missing/expired session so the frontend can
distinguish "no session" from "wrong password" (getMe resolves 401 →
guest, §4.1). ``change-password`` (#262 §4) is session-guarded and NOT
public (it mutates credentials).

The public password-setup pair (#348 spec §5/§7) — ``POST
/password-setup/validate`` (screen chooser) and ``POST
/password-setup`` (consume + set) — is ALSO public: the authority is
the one-time token itself (256-bit, spec §7). Invalid-token attempts on
either route feed the shared §3.4 per-IP failure counter (the login
counter — same 15-min window; a tripped IP is pre-gated to 429 before
any work, even for a valid token). The login null-guard (NULL
``password_hash`` → ordinary 401, ladder untouched) lives in
AuthService.login (#348 spec §4).

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

Spec: docs/specs/2026-09-08-auth-design.md §2.2, §3.6, §5;
docs/specs/2026-09-27-user-accounts-348-design.md §4, §5, §7
Domain rules: docs/domain-rules/auth.md (Sessions, Public Access,
«Одноразовая ссылка установки пароля»)
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select

from src.auth.passwords import PasswordPolicyError
from src.auth.permissions import (
    CLIENT_SESSION_COOKIE,
    SESSION_COOKIE,
    AuthedUser,
    require_session,
    verify_fetch_metadata,
    verify_origin,
)
from src.auth.service import (
    get_auth_service,
    ip_failure_gate,
    register_ip_failure,
)
from src.auth.session import ABSOLUTE_CAP
from src.core.config import settings
from src.db import SessionDep
from src.domain.errors import PhoneInvalidError
from src.domain.phones import validate_phone
from src.errors import ErrorCode, ErrorDetail
from src.models.client import Client
from src.models.staff import Staff
from src.models.user import User
from src.schemas.auth import (
    AuthMeResponse,
    AuthUser,
    ChangePasswordRequest,
    LoginRequest,
    MasterSnapshot,
    OtpRequestRequest,
    OtpRequestResponse,
    OtpVerifyRequest,
    PasswordSetupRequest,
    PasswordSetupValidateRequest,
    PasswordSetupValidateResponse,
)
from src.schemas.my import MyClientResponse
from src.usecases.otp_login import (
    InvalidOtpError,
    OtpTransportUnavailableError,
    request_otp_code,
    verify_otp_login,
)
from src.usecases.password_setup import (
    PasswordLinkInvalidError,
    set_password_by_link,
    validate_password_link,
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
    """Delete the presented session row(s) and clear the cookie. Idempotent.

    #499 (spec §4.2): the ONE logout for both session kinds — whichever
    cookie is presented, that session is revoked (both cookies → both
    rows die); a client-only logout never touches the staff session.
    Both cookies are always cleared client-side: a browser holding one
    kind has nothing left to keep, and clearing a cookie that was never
    set is a no-op. No cookie at all → still 204 (spec §3.6).
    """
    auth_service = get_auth_service()
    for cookie_name in (CLIENT_SESSION_COOKIE, SESSION_COOKIE):
        token = request.cookies.get(cookie_name)
        if token is not None:
            await auth_service.logout(db_session, token)

    resp = Response(status_code=204)
    resp.delete_cookie(key=CLIENT_SESSION_COOKIE, path="/")
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


# ─── public password setup (#348, spec §4/§5/§7) ──────────────────────────────


def _client_ip(request: Request) -> str:
    """The §3.4 per-IP counter identity for the anonymous setup routes."""
    return request.client.host if request.client else "unknown"


def _link_invalid() -> HTTPException:
    """422 — the ONE answer for unknown / expired / used / inactive."""
    return HTTPException(
        status_code=422,
        detail=ErrorDetail(
            code=ErrorCode.PASSWORD_LINK_INVALID,
            message="Ссылка недействительна или истекла",
        ).model_dump(),
    )


@router.post(
    "/password-setup/validate",
    response_model=PasswordSetupValidateResponse,
)
async def password_setup_validate(
    payload: PasswordSetupValidateRequest,
    request: Request,
    db_session: SessionDep,
) -> PasswordSetupValidateResponse:
    """Probe a setup link anonymously — 200 ``{"ok": true}`` / 422.

    The frontend's screen chooser (spec §6): ``ok=true`` → the password
    form, 422 → «Ссылка недействительна или истекла». One answer for
    unknown / expired / used / inactive-account tokens — the endpoint
    must not let anyone enumerate link states. Invalid-token attempts
    feed the shared per-IP failure counter (§3.4 extension, same
    15-min window as login).
    """
    lock = ip_failure_gate(_client_ip(request))
    if lock is not None:
        raise lock

    if not await validate_password_link(db_session, raw_token=payload.token):
        raise register_ip_failure(_client_ip(request)) or _link_invalid()
    return PasswordSetupValidateResponse(ok=True)


@router.post("/password-setup", status_code=204)
async def password_setup(
    payload: PasswordSetupRequest,
    request: Request,
    db_session: SessionDep,
) -> Response:
    """Consume a one-time link and set the account password → 204.

    The authority is the token itself (spec §7 — 256-bit, brute force
    is unrealistic; no other public surface appears). Delegates to the
    Task 2 scenario (policy BEFORE the transaction — the Argon2 hash
    is the fixed cost every path pays, timing parity; conditional
    consume, full ladder reset, session revocation — S8). Error
    contract: a policy failure answers 422 ``PASSWORD_POLICY`` (the
    answer is token-independent — it never reveals or touches the
    link, and does not feed the IP counter); an invalid token answers
    the single 422 ``PASSWORD_LINK_INVALID`` and counts on the shared
    per-IP failure counter (§3.4 extension — the only answer that
    reveals «token invalid» is also the counted one).
    """
    lock = ip_failure_gate(_client_ip(request))
    if lock is not None:
        raise lock

    try:
        await set_password_by_link(
            db_session=db_session,
            raw_token=payload.token,
            password=payload.password,
        )
    except PasswordPolicyError as exc:
        raise HTTPException(
            status_code=422,
            detail=ErrorDetail(
                code=ErrorCode.PASSWORD_POLICY,
                message=str(exc),
            ).model_dump(),
        ) from exc
    except PasswordLinkInvalidError as exc:
        raise register_ip_failure(_client_ip(request)) or _link_invalid() from exc
    return Response(status_code=204)


# ─── client OTP pair (#499, spec §4.2) ────────────────────────────────────────


def _phone_invalid(message: str) -> HTTPException:
    """422 ``PHONE_INVALID`` — the shared account-phone domain rule."""
    return HTTPException(
        status_code=422,
        detail=ErrorDetail(
            code=ErrorCode.PHONE_INVALID,
            message=message,
        ).model_dump(),
    )


def _transport_unavailable() -> HTTPException:
    """503 — no OTP transport configured (fail-closed, §4.2)."""
    return HTTPException(
        status_code=503,
        detail=ErrorDetail(
            code=ErrorCode.NOTIFY_TRANSPORT_UNAVAILABLE,
            message="Вход временно недоступен",
        ).model_dump(),
    )


def _invalid_otp() -> HTTPException:
    """401 — the ONE answer for wrong/expired/unknown/replayed codes."""
    return HTTPException(
        status_code=401,
        detail=ErrorDetail(
            code=ErrorCode.AUTH_INVALID_CREDENTIALS,
            message=InvalidOtpError.MESSAGE,
        ).model_dump(),
    )


@router.post(
    "/otp/request",
    status_code=202,
    response_model=OtpRequestResponse,
    response_model_exclude_none=True,
    dependencies=[Depends(verify_origin)],
)
async def otp_request(
    payload: OtpRequestRequest,
    request: Request,
    db_session: SessionDep,
) -> OtpRequestResponse:
    """Request a phone-verification code — ALWAYS 202 on a valid number.

    PUBLIC_ROUTE + Origin-vs-CORS line (#499 §4.2). Domain phone
    validation (422 ``PHONE_INVALID``); without a configured transport
    the endpoint is fail-closed 503 ``NOTIFY_TRANSPORT_UNAVAILABLE`` in
    EVERY environment (the code is neither written nor counted); a
    staff phone is silently skipped (no code, no send — the 202 is
    byte-identical, no enumeration oracle). ``dev_code`` appears only
    when the dev transport handled the send (exact ENV=development).
    """
    try:
        phone = validate_phone(payload.phone)
    except PhoneInvalidError as exc:
        raise _phone_invalid(str(exc)) from exc

    try:
        code = await request_otp_code(
            db_session,
            phone=phone,
            client_ip=_client_ip(request),
        )
    except OtpTransportUnavailableError as exc:
        raise _transport_unavailable() from exc

    if code is None:  # the silent staff skip — indistinguishable 202
        return OtpRequestResponse()
    return OtpRequestResponse(dev_code=code)


@router.post(
    "/otp/verify",
    response_model=MyClientResponse,
    dependencies=[Depends(verify_origin)],
)
async def otp_verify(
    payload: OtpVerifyRequest,
    request: Request,
    response: Response,
    db_session: SessionDep,
) -> MyClientResponse:
    """Verify the code → find-or-create the client account → client session.

    PUBLIC_ROUTE + Origin-vs-CORS line (#499 §4.2). The Task 2 verify
    (HMAC + TTL + attempt gates) absorbs the code ATOMICALLY with the
    §3 account flow (card find-or-create by exact phone — active cards,
    first active on duplicates; ``UserSettings`` in the same
    transaction; ``phone_is_confirmed=true``; concurrent verify on one
    new phone is idempotent) and the session row — one commit. Success
    sets the ``memo_client_session`` cookie (the login attributes, the
    #499 name) and answers ``{phone, name}``; any code refusal is the
    single 401 (429 when a gate tripped).
    """
    try:
        phone = validate_phone(payload.phone)
    except PhoneInvalidError as exc:
        raise _phone_invalid(str(exc)) from exc

    try:
        user, token = await verify_otp_login(
            db_session,
            phone=phone,
            code=payload.code,
            client_ip=_client_ip(request),
        )
    except InvalidOtpError as exc:
        raise _invalid_otp() from exc

    response.set_cookie(
        key=CLIENT_SESSION_COOKIE,
        value=token,
        max_age=int(ABSOLUTE_CAP.total_seconds()),
        httponly=True,
        samesite="lax",
        secure=settings.ENV == "production",
        path="/",
    )

    # The name comes from the linked card regardless of its archive flag
    # (the /my/client rule — the owner is the account, the card is data).
    name: str | None = None
    if user.client_id is not None:
        name = (
            await db_session.execute(
                select(Client.name).where(Client.id == user.client_id)
            )
        ).scalar_one_or_none()
    return MyClientResponse(phone=user.phone, name=name)
