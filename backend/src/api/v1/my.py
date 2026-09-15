"""Self-service «Мои данные» API — GET/PUT /api/v1/my (GH #262 Task 1)
+ multipart portrait upload POST /api/v1/my/portrait (Task 2).

Own-data endpoints exactly like ``/auth/me``: guarded by
``require_session`` alone (NO permission token — the session user is the
only addressable user, D11: /me is the auth snapshot, /my is the
editable profile). Mutating routes additionally carry
``verify_fetch_metadata`` (#247 decision 14).
"""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile

from src.auth.permissions import AuthedUser, require_session, verify_fetch_metadata
from src.db import SessionDep
from src.domain.errors import (
    FileInvalidTypeError,
    FileTooLargeError,
    ProfileNoStaffCardError,
    ProfileOwnerNotFoundError,
)
from src.errors import ErrorCode, ErrorDetail
from src.schemas.my import MyProfileResponse, MyProfileUpdate, PortraitResponse
from src.services.files import FilesService, get_files_service
from src.services.profile import ProfileService, get_profile_service

router = APIRouter(
    tags=["my"],
    # Spec §4: both routes need a session; no permission token (own data).
    dependencies=[Depends(require_session)],
)

_WRITE_GUARD = [Depends(require_session), Depends(verify_fetch_metadata)]

_SessionUser = Annotated[AuthedUser, Depends(require_session)]


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
    """Uniform envelope for the portrait error paths (413/415/422/401)."""
    return HTTPException(
        status_code=status_code,
        detail=ErrorDetail(code=code, message=message).model_dump(),
    )


@router.get("", response_model=MyProfileResponse)
async def get_my_profile(
    authed: _SessionUser,
    service: _ServiceDep,
    session: SessionDep,
) -> MyProfileResponse:
    """Flat profile per spec §4 — read-only, never creates rows."""
    try:
        return await service.get(session, authed.id)
    except ProfileOwnerNotFoundError as exc:
        raise _owner_gone(exc) from exc


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
    try:
        return await service.update(session, authed.id, data)
    except ProfileOwnerNotFoundError as exc:
        raise _owner_gone(exc) from exc


@router.post(
    "/portrait", response_model=PortraitResponse, dependencies=_WRITE_GUARD
)
async def upload_portrait(
    authed: _SessionUser,
    request: Request,
    file: Annotated[UploadFile, File()],
    service: _ServiceDep,
    files: _FilesDep,
    session: SessionDep,
) -> PortraitResponse:
    """Avatar upload — multipart ``file`` (GH #262 Task 2, spec §3.4).

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
    return PortraitResponse(avatar_url=avatar_url)
