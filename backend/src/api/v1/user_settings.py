"""User settings API endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Response

from src.api.v1._delete_family import DryRunParam, form_rejection
from src.auth.permissions import AuthedUser, require_session, verify_fetch_metadata
from src.db import SessionDep
from src.errors import ErrorCode, ErrorDetail
from src.schemas.common import DeleteBody
from src.schemas.user_settings import (
    UserSettingsCreate,
    UserSettingsPatch,
    UserSettingsResponse,
    UserSettingsUpdate,
)
from src.services.user_settings import UserSettingsService, get_user_settings_service

router = APIRouter(
    tags=["user-settings"],
    # GH #247 spec §3.8: session required on every user-settings route.
    dependencies=[Depends(require_session)],
)

_WRITE_GUARD = [Depends(require_session), Depends(verify_fetch_metadata)]

# GH #247 spec §3.8 (own-only): the session user is the only addressable
# user — GET/PUT/PATCH take no ``user_id`` query param anymore, and DELETE
# must resolve the row to enforce ownership.
_SessionUser = Annotated[AuthedUser, Depends(require_session)]


@lru_cache
def _get_service() -> UserSettingsService:
    """Dependency factory returning a singleton UserSettingsService."""
    return get_user_settings_service()


_ServiceDep = Annotated[UserSettingsService, Depends(_get_service)]


def _settings_not_found(message: str) -> HTTPException:
    return HTTPException(
        status_code=404,
        detail=ErrorDetail(
            code=ErrorCode.SETTINGS_NOT_FOUND,
            message=message,
        ).model_dump(),
    )


@router.get("", response_model=UserSettingsResponse)
async def get_settings(
    authed: _SessionUser,
    service: _ServiceDep,
    session: SessionDep,
    response: Response,
) -> UserSettingsResponse:
    """Get the session user's settings — get-or-create (GH #319).

    A missing row is created with model defaults and written to the DB;
    GET never returns 404 for a live user. ``no-store``: the response
    depends on server-side row existence, not just the request.
    """
    result = await service.get_or_create_by_user_id(session, authed.id)
    response.headers["Cache-Control"] = "no-store"
    return result


@router.post("", response_model=UserSettingsResponse, status_code=201, dependencies=_WRITE_GUARD)
async def create_settings(
    authed: _SessionUser,
    data: UserSettingsCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> UserSettingsResponse:
    """Create new user settings (user from the session — GH #319).

    A ``user_id`` in the body is ignored: the row is always created for
    the session user.
    """
    payload = data.model_copy(update={"user_id": authed.id})
    return await service.create(session, payload)


@router.put("", response_model=UserSettingsResponse, dependencies=_WRITE_GUARD)
async def update_settings(
    authed: _SessionUser,
    data: UserSettingsUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> UserSettingsResponse:
    """Partial-update the session user's settings (own-only).

    TODO: PUT should use a strict schema with all fields required (full replacement
    semantics). Currently uses all-optional UserSettingsUpdate for backward compatibility
    with frontend that sends partial data. After frontend migration, create
    UserSettingsStrict schema with required fields and use it here.
    """
    result = await service.update_by_user_id(session, authed.id, data)
    if not result:
        raise _settings_not_found("No settings found for user")
    return result


@router.patch("", response_model=UserSettingsResponse, dependencies=_WRITE_GUARD)
async def patch_settings(
    authed: _SessionUser,
    data: UserSettingsPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> UserSettingsResponse:
    """Partial-update the session user's settings (PATCH, own-only).

    Uses UserSettingsPatch schema (all-optional) for semantic correctness.
    Same behavior as PUT — both use update_by_user_id() with exclude_unset.
    """
    result = await service.update_by_user_id(session, authed.id, data)
    if not result:
        raise _settings_not_found("No settings found for user")
    return result


@router.delete("/{settings_id}", status_code=204, dependencies=_WRITE_GUARD)
async def delete_settings(
    settings_id: str,
    authed: _SessionUser,
    service: _ServiceDep,
    session: SessionDep,
    body: Annotated[DeleteBody | None, Body()] = None,
    dry_run: DryRunParam = None,
) -> None:
    """Unified delete contract — dry-run flag / commit body (#324 §4,
    leaf subject — mirror of the records/tags routes #285/#318).

    Spec §3.8: resolve the row's ``user_id`` and reject non-owned rows
    with 403 ``AUTH_FORBIDDEN`` — the probe-read + ownership gate run
    FIRST in both branches (a foreign row is 403 before any tree work;
    a leaf has no tree anyway).

    * ``?dry_run=true`` — PURE preview: always 204 WITHOUT deleting
      (leaf — empty FK_MATRIX row); never modifies rows.
    * No body, no flag → 422 ``expected_state_required`` (rejected
      before any DB access; same for a resolutions-only body).
    * Body ``{expected}`` (leaf: ``{}``) — the deferred-delete commit →
      204 (the row is hard-deleted; the next read recreates defaults).
    """
    rejection = form_rejection(body, dry_run)
    if rejection is not None:
        return rejection

    # Probe-read + own-only gate — first line of BOTH branches (§4.2).
    row = await service.get_by_id(session, settings_id)
    if row is None:
        raise _settings_not_found("Settings not found")
    if row.user_id != authed.id:
        raise HTTPException(
            status_code=403,
            detail=ErrorDetail(
                code=ErrorCode.AUTH_FORBIDDEN,
                message="Недостаточно прав",
            ).model_dump(),
        )

    if dry_run:
        return  # 204 — preview only: a leaf never has dependencies.

    deleted = await service.delete(session, settings_id)
    if not deleted:
        raise _settings_not_found("Settings not found")
