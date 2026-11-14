"""User settings API endpoints — under the «my» branches (GH #584,
ADR-015 spec §4.4).

The former settings island ``/api/v1/user-settings`` (all methods,
schemas, own-only semantics) re-homes as ONE branch router mounted on
STATIC prefixes; there is NO root ``/my/settings``:

* staff instance — ``/api/v1/my/master/settings`` and
  ``/api/v1/my/admin/settings``: the SAME account, the SAME rows (the
  branch is the audience address, not other data) behind the branch
  guards ``require_master_branch`` / ``require_admin_branch`` (spec
  §4.3 admission: 401 anonymous/client cookie, 403 wrong staff branch);
* client instance — ``/api/v1/my/client/settings`` behind
  ``require_client_session`` (client-account rows are born with the
  account, #319; no UI consumer yet — a ready surface, spec §4.4).

Own-only semantics (GH #247 spec §3.8) travel unchanged: GET/PUT/PATCH
take no ``user_id`` query param — the session user is the only
addressable user; POST takes the user from the session (GH #319);
DELETE by ``/{settings_id}`` resolves the row's ``user_id`` and rejects
non-owned rows with 403 ``AUTH_FORBIDDEN``.
"""

from collections.abc import Awaitable, Callable
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Response

from src.api.v1._delete_family import DryRunParam, form_rejection
from src.auth.permissions import (
    AuthedUser,
    require_admin_branch,
    require_client_session,
    require_master_branch,
    verify_fetch_metadata,
)
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


def _settings_branch(
    guard: Callable[..., Awaitable[AuthedUser]],
) -> APIRouter:
    """Build ONE settings branch router (spec §4.4: the same handlers
    under every branch prefix; the admission guard rides the closure)."""
    # GH #247 spec §3.8 (own-only): the session user is the only
    # addressable user — GET/PUT/PATCH take no ``user_id`` query param
    # anymore, and DELETE must resolve the row to enforce ownership.
    _branch_user = Annotated[AuthedUser, Depends(guard)]

    # Spec §9: mutating routes add the CSRF secondary line on top of the
    # router-level branch guard (pinned explicitly per route in
    # tests/test_api_my_settings_branches.py).
    _write_guard = [Depends(verify_fetch_metadata)]

    api = APIRouter(
        tags=["my"],
        # Spec §4.3/§4.4: the branch admission guard (401 anonymous /
        # client cookie, 403 wrong staff branch) applies to EVERY route.
        dependencies=[Depends(guard)],
    )

    @api.get("", response_model=UserSettingsResponse)
    async def get_settings(
        authed: _branch_user,
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

    @api.post("", response_model=UserSettingsResponse, status_code=201, dependencies=_write_guard)
    async def create_settings(
        authed: _branch_user,
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

    @api.put("", response_model=UserSettingsResponse, dependencies=_write_guard)
    async def update_settings(
        authed: _branch_user,
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

    @api.patch("", response_model=UserSettingsResponse, dependencies=_write_guard)
    async def patch_settings(
        authed: _branch_user,
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

    @api.delete("/{settings_id}", status_code=204, dependencies=_write_guard)
    async def delete_settings(
        settings_id: str,
        authed: _branch_user,
        service: _ServiceDep,
        session: SessionDep,
        body: Annotated[DeleteBody | None, Body()] = None,
        dry_run: DryRunParam = None,
    ) -> Response:
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
            return Response(status_code=204)  # preview only: a leaf never has dependencies.

        deleted = await service.delete(session, settings_id)
        if not deleted:
            raise _settings_not_found("Settings not found")
        return Response(status_code=204)  # the deferred-delete commit succeeded.

    return api


#: The THREE static mounts of the settings branches (spec §4.4) — same
#: handlers, audience-specific admission guards. No root ``/my/settings``.
master_settings_router = _settings_branch(require_master_branch)
admin_settings_router = _settings_branch(require_admin_branch)
client_settings_router = _settings_branch(require_client_session)
