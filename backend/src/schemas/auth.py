"""Pydantic schemas for the auth API — GH #247 §3.6 (+ #262 change-password).

Login/me response shape: ``{user, permissions, master?}`` where ``user``
carries the users.id UUID string (feeds user-settings) and ``master`` is
the linked card snapshot (``{first_name, last_name, avatar_url?}``) when
``master_id`` is set, else ``null`` — the sidebar falls back to the phone
when ``master`` is null (a master user without a linked profile is valid).

Spec: docs/specs/2026-09-08-auth-design.md §3.6
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class LoginRequest(BaseModel):
    """``POST /api/v1/auth/login`` body."""

    phone: str = Field(min_length=1)
    password: str = Field(min_length=1)


class ChangePasswordRequest(BaseModel):
    """``POST /api/v1/auth/change-password`` body (GH #262, spec §4).

    ``current_password`` is verified first (wrong → 401, domain rules);
    ``new_password`` follows the shared password policy (422 on breach).
    """

    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=1)


class AuthUser(BaseModel):
    """The ``user`` object inside login/me responses (spec §3.6)."""

    id: str
    phone: str
    role: str
    master_id: str | None
    email: str | None


class MasterSnapshot(BaseModel):
    """Linked staff card snapshot — display only (spec §3.6 + #262 §4).

    ``avatar_url`` (GH #262): the staff card portrait, served under
    ``/api/v1/files/avatar/…`` — ``null`` when the card has none. The
    snapshot is read from the card **regardless of its archive flag**
    (Display rule: one's own name/avatar never blanks).
    """

    first_name: str
    last_name: str
    avatar_url: str | None = None


class AuthMeResponse(BaseModel):
    """Login/me success body: ``{user, permissions, master?}``."""

    user: AuthUser
    permissions: list[str]
    master: MasterSnapshot | None = None


class PasswordSetupValidateRequest(BaseModel):
    """``POST /api/v1/auth/password-setup/validate`` body (#348 spec §5).

    Strict body (extra keys → 422). The token is the urlsafe raw value
    from the URL fragment — only its SHA-256 digest is ever stored.
    """

    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=1)


class PasswordSetupValidateResponse(BaseModel):
    """Validate success body — ``{"ok": true}`` (the screen chooser).

    Every non-live outcome is the single 422 ``PASSWORD_LINK_INVALID``
    (one answer for unknown / expired / used / inactive — the endpoint
    must not let anyone enumerate link states).
    """

    ok: bool = True


class PasswordSetupRequest(BaseModel):
    """``POST /api/v1/auth/password-setup`` body (#348 spec §5).

    Strict body (extra keys → 422). ``password`` carries no length
    constraints here: the SHARED password policy
    (:func:`src.auth.passwords.validate_password`) owns the rule, so a
    weak password answers the domain code ``PASSWORD_POLICY`` instead
    of a generic schema error (the ``UserPhonePatch`` precedent).
    """

    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=1)
    password: str = Field(min_length=1)


class OtpRequestRequest(BaseModel):
    """``POST /api/v1/auth/otp/request`` body (#499 §4.2).

    Strict body (extra keys → 422). ``phone`` carries no schema length
    bounds: the SHARED domain validator (:func:`src.domain.phones.validate_phone`)
    owns the rule, so a blank/overlong phone answers the domain code
    ``PHONE_INVALID`` instead of a generic schema error (the
    ``PasswordSetupRequest`` precedent).
    """

    model_config = ConfigDict(extra="forbid")

    phone: str


class OtpRequestResponse(BaseModel):
    """202 body of a code request — ``{}``, or ``{"dev_code": ...}``.

    ``dev_code`` surfaces ONLY when the dev transport handled the send
    (exact ``ENV == "development"``, §4.2); the endpoint serializes with
    ``exclude_none`` so the field is absent in every other shape — a
    staff phone (no code exists) and all non-dev environments.
    """

    dev_code: str | None = None


class OtpVerifyRequest(BaseModel):
    """``POST /api/v1/auth/otp/verify`` body (#499 §4.2).

    Strict body (extra keys → 422). ``phone`` — same domain-validator
    rule as the request body; ``code`` needs at least one character at
    the schema level (a present-but-wrong code is the unified 401, a
    missing/empty one is a malformed request).
    """

    model_config = ConfigDict(extra="forbid")

    phone: str
    code: str = Field(min_length=1)


class AuthMethodResponse(BaseModel):
    """One entry of the ``GET /api/v1/auth/methods`` registry (#593 §Реестр).

    ``available`` = the method's transport RESOLVER returned an object —
    never «the env var is non-empty»: an off, environment-gated or
    misconfigured transport is honestly unavailable, so the frontend
    picker never offers a method whose endpoints would 503. Future
    methods (Telegram/Max) join the ``Literal`` with their resolvers.
    """

    id: Literal["sms_otp", "call"]
    available: bool


class AuthCallInitiateRequest(BaseModel):
    """``POST /api/v1/auth/call/initiate`` body (#593 §Эндпоинты).

    Strict body (extra keys → 422). ``phone`` carries no schema bounds:
    the CANONICAL domain rule (:func:`src.domain.phones.validate_canonical_phone`)
    owns the validation, so a non-``+7XXXXXXXXXX`` value answers the
    domain code ``PHONE_INVALID`` (422 before gates and provider — a
    typo must not hide behind a 503; the ``OtpRequestRequest``
    precedent).
    """

    model_config = ConfigDict(extra="forbid")

    phone: str


class AuthCallInfo(BaseModel):
    """The check the client must complete — the ``call`` block (#593).

    ``phone`` — the number the CLIENT calls, strictly ``+7…`` (without
    the plus some operators reject the call, especially from abroad —
    a provider requirement); ``pretty`` — the display form for the call
    screen; ``expires_at`` — the window deadline (the add moment plus
    the client-side constant; the provider response carries no time).
    """

    phone: str
    pretty: str
    expires_at: datetime


class AuthCallInitiateResponse(BaseModel):
    """202 body of a callcheck initiate — ``{}`` or ``{handle, call}``.

    The silent staff skip answers the EMPTY object (serialized with
    ``exclude_none`` — the ``OtpRequestResponse`` parity: nothing was
    created, so nothing is surfaced; the 202 is indistinguishable from
    a real initiate at the response-shape level the spec fixes).
    """

    #: The RAW one-time status handle (uuid4-hex) — present ONLY in the
    #: response; the DB keeps just its pepper-keyed digest.
    handle: str | None = None
    call: AuthCallInfo | None = None


class AuthCallStatusRequest(BaseModel):
    """``POST /api/v1/auth/call/status`` body (#593 §Эндпоинты).

    Strict body (extra keys → 422). ``handle`` is the raw one-time
    handle the initiate handed out; only its digest is stored, and an
    invalid/consumed one answers the indistinguishable 404.
    """

    model_config = ConfigDict(extra="forbid")

    handle: str = Field(min_length=1)


class AuthCallStatusResponse(BaseModel):
    """The poll answer — ``{"status": "waiting" | "confirmed" | "expired"}``.

    The RAW handle and any provider detail never appear here (US-7); on
    ``confirmed`` the client session cookie rides the same response
    (set by the router AFTER the consume transaction committed).
    """

    status: Literal["waiting", "confirmed", "expired"]


class AuthCallDevDoneRequest(BaseModel):
    """``POST /api/v1/auth/call/dev-done`` body (#593 §Эндпоинты, дев-режим).

    The dev imitation of the client's call: flip the check the initiate
    created (resolved through the same one-time handle). Strict body
    (extra keys → 422).
    """

    model_config = ConfigDict(extra="forbid")

    handle: str = Field(min_length=1)
