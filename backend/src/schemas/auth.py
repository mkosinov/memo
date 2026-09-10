"""Pydantic schemas for the auth API — GH #247 §3.6.

Login/me response shape: ``{user, permissions, master?}`` where ``user``
carries the users.id UUID string (feeds user-settings) and ``master`` is
the linked master profile snapshot (``{first_name, last_name}``) when
``master_id`` is set, else ``null`` — the sidebar falls back to the phone
when ``master`` is null (a master user without a linked profile is valid).

Spec: docs/specs/2026-09-08-auth-design.md §3.6
"""

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    """``POST /api/v1/auth/login`` body."""

    phone: str = Field(min_length=1)
    password: str = Field(min_length=1)


class AuthUser(BaseModel):
    """The ``user`` object inside login/me responses (spec §3.6)."""

    id: str
    phone: str
    role: str
    master_id: str | None
    email: str | None


class MasterSnapshot(BaseModel):
    """Linked master profile snapshot — display only (spec §3.6)."""

    first_name: str
    last_name: str


class AuthMeResponse(BaseModel):
    """Login/me success body: ``{user, permissions, master?}``."""

    user: AuthUser
    permissions: list[str]
    master: MasterSnapshot | None = None
