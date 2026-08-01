"""User settings API endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from src.db import SessionDep
from src.errors import ErrorCode, ErrorDetail
from src.schemas.user_settings import (
    UserSettingsCreate,
    UserSettingsPatch,
    UserSettingsResponse,
    UserSettingsUpdate,
)
from src.services.user_settings import UserSettingsService, get_user_settings_service

router = APIRouter(tags=["user-settings"])


@lru_cache
def _get_service() -> UserSettingsService:
    """Dependency factory returning a singleton UserSettingsService."""
    return get_user_settings_service()


_ServiceDep = Annotated[UserSettingsService, Depends(_get_service)]


@router.get("", response_model=UserSettingsResponse)
async def get_settings(
    user_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> UserSettingsResponse:
    """Find settings by user_id."""
    result = await service.get_by_user_id(session, user_id)
    if not result:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.SETTINGS_NOT_FOUND,
                message="No settings found for user",
            ).model_dump(),
        )
    return result


@router.post("", response_model=UserSettingsResponse, status_code=201)
async def create_settings(
    data: UserSettingsCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> UserSettingsResponse:
    """Create new user settings."""
    return await service.create(session, data)


@router.put("", response_model=UserSettingsResponse)
async def update_settings(
    user_id: str,
    data: UserSettingsUpdate,
    service: _ServiceDep,
    session: SessionDep,
) -> UserSettingsResponse:
    """Partial-update settings by user_id.
    
    TODO: PUT should use a strict schema with all fields required (full replacement
    semantics). Currently uses all-optional UserSettingsUpdate for backward compatibility
    with frontend that sends partial data. After frontend migration, create
    UserSettingsStrict schema with required fields and use it here.
    """
    result = await service.update_by_user_id(session, user_id, data)
    if not result:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.SETTINGS_NOT_FOUND,
                message="No settings found for user",
            ).model_dump(),
        )
    return result


@router.patch("", response_model=UserSettingsResponse)
async def patch_settings(
    user_id: str,
    data: UserSettingsPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> UserSettingsResponse:
    """Partial-update settings by user_id (PATCH).

    Uses UserSettingsPatch schema (all-optional) for semantic correctness.
    Same behavior as PUT — both use update_by_user_id() with exclude_unset.
    """
    result = await service.update_by_user_id(session, user_id, data)
    if not result:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.SETTINGS_NOT_FOUND,
                message="No settings found for user",
            ).model_dump(),
        )
    return result


@router.delete("/{settings_id}", status_code=204)
async def delete_settings(
    settings_id: str,
    service: _ServiceDep,
    session: SessionDep,
) -> None:
    """Delete a settings record by its primary key ID."""
    deleted = await service.delete(session, settings_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.SETTINGS_NOT_FOUND,
                message="Settings not found",
            ).model_dump(),
        )
