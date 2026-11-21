"""``GET /api/v1/my`` — «кто я» (#584, spec §4.1).

The combined whoami surface: BOTH session cookies are resolved (each
purely), the role list is composed per spec §4.1, and an empty list is
the shared 401. The guard (:func:`require_any_session`) owns the whole
check — including the single audit-actor record — so this router
deliberately carries NO router-level ``require_session`` dependency (the
staff guard would 401 a client-only request and double-stage the actor).

A separate router file, not a route inside ``my.py``: the profile
router's ``require_session`` dependency applies to every route mounted
in it, while whoami must accept either audience. Mounted under the same
``/api/v1/my`` prefix.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from src.auth.permissions import WhoamiIdentities, require_any_session
from src.schemas.my import MyWhoamiResponse

router = APIRouter(tags=["my"])

_Identities = Annotated[WhoamiIdentities, Depends(require_any_session)]


@router.get("", response_model=MyWhoamiResponse)
async def whoami(identities: _Identities) -> MyWhoamiResponse:
    """Account data + resolved roles (spec §4.1) — a pure mapping of the
    guard's result; the guard resolved everything, no queries here."""
    return MyWhoamiResponse(
        id=identities.primary.id,
        phone=identities.primary.phone,
        email=identities.email,
        roles=list(identities.roles),
    )
