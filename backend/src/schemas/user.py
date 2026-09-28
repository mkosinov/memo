"""Pydantic schemas for the users API vertical (GH #348 Task 4, spec §5).

The account response contract ``{id, phone, role, staff_id,
password_is_set, is_active}`` — the «Учётка» card shape served by the
admin-side phone edit. ``password_is_set`` is DERIVED from the stored
hash (NULL = passwordless account, #348): the source attribute rides as
an ``exclude=True`` field feeding a ``computed_field`` (the
``StaffResponse.archived`` precedent).

``UserPhonePatch`` is STRICT (``extra="forbid"`` — extra keys → 422) and
deliberately carries NO length constraints: the SHARED domain validator
(:func:`src.domain.phones.validate_phone`) owns the rule, so a blank or
overlong phone answers the domain code ``PHONE_INVALID`` instead of a
generic VALIDATION_ERROR (the ``MasterSection`` precedent for
service-owned validation).

``PasswordLinkResponse``: spec §5 — the raw token surfaces EXACTLY ONCE,
at issue; only its SHA-256 digest is stored, so no later response can
ever carry it again. The frontend assembles the URL from the page
origin (``{origin}/password-setup#token=…``) — the backend knows no
public address (spec §5, «Ссылку собирает фронт»).
"""

from __future__ import annotations

from datetime import datetime  # noqa: TC003 — runtime value in responses

from pydantic import BaseModel, ConfigDict, Field, computed_field


class UserPhonePatch(BaseModel):
    """``PATCH /api/v1/users/{id}`` body — ``{phone}``, strictly."""

    model_config = ConfigDict(extra="forbid")

    phone: str


class UserAccountResponse(BaseModel):
    """Account projection (spec §5): ``{id, phone, role, staff_id,
    password_is_set, is_active}``."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    phone: str
    role: str
    staff_id: str | None = None
    is_active: bool
    # Source attribute for the derived flag — never on the wire.
    password_hash: str | None = Field(exclude=True)

    @computed_field
    @property
    def password_is_set(self) -> bool:
        """True when the account has a password hash (NULL = passwordless)."""
        return self.password_hash is not None


class PasswordLinkResponse(BaseModel):
    """``POST /api/v1/users/{id}/password-link`` success body (spec §5)."""

    token: str
    expires_at: datetime
