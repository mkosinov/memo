"""Staff branches of the «my» tree — ``/api/v1/my/master`` and
``/api/v1/my/admin`` (GH #584, ADR-015 spec §4.3).

The former flat ``/my`` profile router re-homed as ONE branch router
mounted on TWO STATIC prefixes. A dynamic ``{branch}`` path parameter is
banned (panel blocker, spec §4.3): it would shadow the sibling branches
by registration order — static prefixes make the mount order irrelevant
and an unknown branch 404s naturally.

Branch admission == the whoami role list composition, via the branch
guards in ``src/auth/permissions.py``:

* ``/my/admin`` — role ``admin``;
* ``/my/master`` — role ``master`` OR a master section;
* no valid staff cookie (anonymous, client-only, or a cross-presented
  client token) → the shared 401 ``AUTH_UNAUTHORIZED``;
* a valid staff cookie of the other branch → 403 ``AUTH_FORBIDDEN``.

Same handlers under both prefixes (a factory bakes the branch in as a
constant — no path parameter ever reaches the wire):

* ``GET  /api/v1/my/{master|admin}`` — ``MyStaffProfileResponse``: the
  flat ``MyProfileResponse`` + ``user_id``/``phone``/``email``/
  ``permissions`` (assembled by REUSING the login ``_build_me_response``
  builder — login itself unchanged); the master branch additionally
  carries the master section and the login-shaped card snapshot;
* ``PUT  /api/v1/my/{master|admin}`` — the #262 partial-update contract
  on the branch body (``MyProfileUpdate``; ``verify_fetch_metadata``
  preserved);
* ``POST /api/v1/my/{master|admin}/avatar`` — the multipart upload (the
  former ``/my/portrait``, renamed 2026-11-13; ``AvatarResponse``, the
  upload contract unchanged: 5 MB, JPEG/PNG/WebP by magic bytes).

Session-guarded, NO permission token — the session user is the only
addressable user (D11); mutating routes carry ``verify_fetch_metadata``
(#247 decision 14).
"""

from collections.abc import Awaitable, Callable
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile

from src.auth.permissions import (
    AuthedUser,
    require_admin_branch,
    require_master_branch,
    verify_fetch_metadata,
)
from src.auth.router import _build_me_response
from src.db import SessionDep
from src.domain.errors import (
    FileInvalidTypeError,
    FileTooLargeError,
    ProfileNoStaffCardError,
    ProfileOwnerNotFoundError,
)
from src.errors import ErrorCode, ErrorDetail
from src.schemas.my import (
    AvatarResponse,
    MyProfileUpdate,
    MyStaffProfileResponse,
)
from src.services.files import FilesService, get_files_service
from src.services.profile import ProfileService, get_profile_service

# Spec §4.3/§9: mutating routes add the CSRF secondary line on top of the
# router-level branch guard (pinned explicitly per route in
# tests/test_api_my_staff_branches.py).
_WRITE_GUARD = [Depends(verify_fetch_metadata)]


def _owner_gone(exc: ProfileOwnerNotFoundError) -> HTTPException:
    """401 — the session outlived its user row (deleted server-side).

    Same envelope the session guard emits for a dead session: the
    frontend's uniform 401 → /login redirect covers it.
    """
    return HTTPException(
        status_code=401,
        detail=ErrorDetail(
            code=ErrorCode.AUTH_UNAUTHORIZED,
            message="Требуется вход в систему",
        ).model_dump(),
    )


@lru_cache
def _get_service() -> ProfileService:
    """Dependency factory returning a singleton ProfileService."""
    return get_profile_service()


@lru_cache
def _get_files_service() -> FilesService:
    """Dependency factory returning a singleton FilesService."""
    return get_files_service()


_ServiceDep = Annotated[ProfileService, Depends(_get_service)]
_FilesDep = Annotated[FilesService, Depends(_get_files_service)]


def _error(status_code: int, code: ErrorCode, message: str) -> HTTPException:
    """Uniform envelope for the avatar error paths (413/415/422/401)."""
    return HTTPException(
        status_code=status_code,
        detail=ErrorDetail(code=code, message=message).model_dump(),
    )


def _branch_router(
    guard: Callable[..., Awaitable[AuthedUser]], *, master_branch: bool
) -> APIRouter:
    """Build ONE staff-branch router (spec §4.3: the same handlers under
    both static prefixes; the branch constant rides the closure)."""
    api = APIRouter(
        tags=["my"],
        # Spec §4.3: the branch admission guard (401 anonymous / 403
        # wrong-branch) applies to EVERY route of the branch.
        dependencies=[Depends(guard)],
    )

    async def _assemble(
        session: SessionDep, authed: AuthedUser, service: ProfileService
    ) -> MyStaffProfileResponse:
        """Branch profile assembly (spec §4.3 table).

        Reuses the login ``_build_me_response`` builder for the account
        half (user_id/phone/email/permissions) and the card snapshot;
        the master section rides ONLY the master branch. Login itself
        is untouched — the builder is read, not modified.
        """
        base = await service.get(session, authed.id)
        me = await _build_me_response(session, authed)
        section = (
            await service.get_master_section(session, authed.id)
            if master_branch
            else None
        )
        return MyStaffProfileResponse(
            **base.model_dump(),
            user_id=me.user.id,
            phone=me.user.phone,
            email=me.user.email,
            permissions=me.permissions,
            master_section=section,
            master=me.master if master_branch else None,
        )

    @api.get("", response_model=MyStaffProfileResponse)
    async def get_my_staff_profile(
        authed: Annotated[AuthedUser, Depends(guard)],
        service: _ServiceDep,
        session: SessionDep,
    ) -> MyStaffProfileResponse:
        """The staff profile + rights (spec §4.3): the flat #262 profile
        extended with the account half (the former ``/auth/me`` rights);
        master branch adds the section + snapshot."""
        return await _assemble(session, authed, service)

    @api.put(
        "", response_model=MyStaffProfileResponse, dependencies=_WRITE_GUARD
    )
    async def update_my_staff_profile(
        authed: Annotated[AuthedUser, Depends(guard)],
        data: MyProfileUpdate,
        service: _ServiceDep,
        session: SessionDep,
    ) -> MyStaffProfileResponse:
        """Partial-update the flat profile (omitted = keep, ``null`` = clear).

        One transaction writes the staff-card half and the lazily created
        private half; on commit the existing ``staff`` SSE entity is
        emitted. The response re-reads the branch shape (GET/PUT parity).
        """
        try:
            await service.update(session, authed.id, data)
        except ProfileOwnerNotFoundError as exc:
            raise _owner_gone(exc) from exc
        return await _assemble(session, authed, service)

    @api.post(
        "/avatar", response_model=AvatarResponse, dependencies=_WRITE_GUARD
    )
    async def upload_avatar(
        authed: Annotated[AuthedUser, Depends(guard)],
        request: Request,
        file: Annotated[UploadFile, File()],
        service: _ServiceDep,
        files: _FilesDep,
        session: SessionDep,
    ) -> AvatarResponse:
        """Avatar upload — multipart ``file`` (GH #262 Task 2; #584 renamed
        /portrait → /avatar, the contract unchanged).

        Order matters: the Content-Length precheck rejects impossible sizes
        BEFORE the body is read; then the service sniffs magic bytes and
        streams with a byte cap. On success the new file replaces the card's
        ``avatar_url`` and the previous OWN served file is deleted; if the
        DB write fails the freshly stored file is removed (no orphans).
        """
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                length = int(content_length)
            except ValueError as exc:
                raise _error(
                    422, ErrorCode.VALIDATION_ERROR, "Некорректный Content-Length"
                ) from exc
            if files.content_length_rejected(length):
                raise _error(
                    413, ErrorCode.FILE_TOO_LARGE, "Файл больше 5 МБ"
                )

        try:
            avatar_url = await files.save_avatar(file)
        except FileTooLargeError as exc:
            raise _error(413, ErrorCode.FILE_TOO_LARGE, "Файл больше 5 МБ") from exc
        except FileInvalidTypeError as exc:
            raise _error(
                415, ErrorCode.FILE_INVALID_TYPE, "Поддерживаются только JPEG, PNG и WebP"
            ) from exc

        try:
            old_url = await service.set_avatar(session, authed.id, avatar_url)
        except ProfileOwnerNotFoundError as exc:
            files.delete_served(avatar_url)
            raise _owner_gone(exc) from exc
        except ProfileNoStaffCardError as exc:
            files.delete_served(avatar_url)
            raise _error(
                422,
                ErrorCode.VALIDATION_ERROR,
                "Портрет привязан к карточке сотрудника",
            ) from exc
        except Exception:
            # DB write failed — the fresh file must not become an orphan.
            files.delete_served(avatar_url)
            raise

        files.delete_served(old_url)
        return AvatarResponse(avatar_url=avatar_url)

    return api


#: The TWO static mounts of the staff branch (spec §4.3) — same handlers,
#: branch-specific admission guards.
master_router = _branch_router(require_master_branch, master_branch=True)
admin_router = _branch_router(require_admin_branch, master_branch=False)
