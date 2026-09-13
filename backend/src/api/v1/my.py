"""Self-service «Мои данные» API — GET/PUT /api/v1/my (GH #262 Task 1).

Own-data endpoints exactly like ``/auth/me``: guarded by
``require_session`` alone (NO permission token — the session user is the
only addressable user, D11: /me is the auth snapshot, /my is the
editable profile). PUT additionally carries ``verify_fetch_metadata``
(#247 decision 14 — every mutating route, incl. the future multipart
portrait upload of Task 2).
"""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends

from src.auth.permissions import AuthedUser, require_session, verify_fetch_metadata
from src.db import SessionDep
from src.schemas.my import MyProfileResponse, MyProfileUpdate
from src.services.profile import ProfileService, get_profile_service

router = APIRouter(
    tags=["my"],
    # Spec §4: both routes need a session; no permission token (own data).
    dependencies=[Depends(require_session)],
)

_WRITE_GUARD = [Depends(require_session), Depends(verify_fetch_metadata)]

_SessionUser = Annotated[AuthedUser, Depends(require_session)]


@lru_cache
def _get_service() -> ProfileService:
    """Dependency factory returning a singleton ProfileService."""
    return get_profile_service()


_ServiceDep = Annotated[ProfileService, Depends(_get_service)]


@router.get("", response_model=MyProfileResponse)
async def get_my_profile(
    authed: _SessionUser,
    service: _ServiceDep,
    session: SessionDep,
) -> MyProfileResponse:
    """Flat profile per spec §4 — read-only, never creates rows."""
    return await service.get(session, authed.id)


@router.put("", response_model=MyProfileResponse, dependencies=_WRITE_GUARD)
async def update_my_profile(
    authed: _SessionUser,
    data: MyProfileUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> MyProfileResponse:
    """Partial-update the flat profile (omitted = keep, ``null`` = clear).

    One transaction writes the staff-card half and the lazily created
    private half; on commit the existing ``staff`` SSE entity is emitted.
    """
    return await service.update(session, authed.id, data)
