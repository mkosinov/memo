"""Pydantic schemas for the auth API — GH #247 §3.6 (+ #262 change-password).

Login/me response shape: ``{user, permissions, master?}`` where ``user``
carries the users.id UUID string (feeds user-settings) and ``master`` is
the linked card snapshot (``{first_name, last_name, avatar_url?}``) when
``master_id`` is set, else ``null`` — the sidebar falls back to the phone
when ``master`` is null (a master user without a linked profile is valid).

Spec: docs/specs/2026-09-08-auth-design.md §3.6
"""

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
