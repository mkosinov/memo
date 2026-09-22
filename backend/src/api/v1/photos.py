"""FastAPI router for photo CRUD endpoints."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.auth.permissions import require_permission, verify_fetch_metadata
from src.auth.scope import ScopeContext, get_optional_scope, get_scope
from src.db import SessionDep
from src.errors import ErrorCode, ErrorDetail
from src.models.photo import Photo
from src.schemas.common import PaginatedResponse
from src.schemas.photo import (
    PhotoCreate,
    PhotoListParams,
    PhotoPatch,
    PhotoResponse,
    PhotoUpdate,
)
from src.services.photo import (
    PhotoService,
    get_photo_service,
    list_photos_view,
)

router = APIRouter(tags=["photos"])


@lru_cache
def _get_photo_service() -> PhotoService:
    return get_photo_service()


_ServiceDep = Annotated[PhotoService, Depends(_get_photo_service)]

# GH #247 (spec §3.7): every mutating route carries photos:write plus the
# CSRF fetch-metadata secondary line (verify_fetch_metadata).
_WRITE_GUARD = [
    Depends(require_permission("photos:write")),
    Depends(verify_fetch_metadata),
]


async def _photo_scoped_or_404(
    service: PhotoService,
    session: SessionDep,
    photo_id: str,
    scope: ScopeContext,
) -> None:
    """GH #263 T5 — shared point-op owner gate (get/PUT/PATCH/DELETE).

    ONE scope-aware query (photo → activity via correlated EXISTS); a
    scoped master whose photo is foreign/owner-less gets the same 404 as a
    missing photo (404-fast-path). Admin (``master_key=None``) passes
    untouched.
    """
    photo = await service.get_scoped(
        db_session=session, id=photo_id, master_key=scope.master_key
    )
    if not photo:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.PHOTO_NOT_FOUND,
                message="Photo not found",
            ).model_dump(),
        )


async def _activity_scoped_or_404(
    service: PhotoService,
    session: SessionDep,
    activity_id: str,
    scope: ScopeContext,
) -> None:
    """GH #263 T5 — target-activity owner gate (create / PUT / PATCH re-target).

    ONE query (activity.master_id); чужая активность → the same 404 as a
    missing target. Admin (``master_key=None``) passes untouched.
    """
    activity = await service.get_activity_scoped(
        db_session=session, activity_id=activity_id, master_key=scope.master_key
    )
    if not activity:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.ACTIVITY_NOT_FOUND,
                message="Activity not found",
            ).model_dump(),
        )


@router.get("/web", response_model=list[PhotoResponse])
async def list_public_photos(
    session: SessionDep,
    activity_id: str | None = Query(None),
) -> list[PhotoResponse]:
    """Return public photos (is_public=true). Optionally filter by activity_id."""
    stmt = (
        select(Photo)
        .where(Photo.is_public == True)
        .options(selectinload(Photo.tags))
    )
    if activity_id:
        stmt = stmt.where(Photo.activity_id == activity_id)
    result = await session.execute(stmt)
    photos = result.scalars().all()
    return [PhotoResponse.model_validate(p) for p in photos]


@router.get("", response_model=PaginatedResponse[PhotoResponse])
async def list_photos(
    session: SessionDep,
    params: Annotated[PhotoListParams, Query()],
    # GH #263 T5: scoped master sees only photos attached to HIS activities
    # (EXISTS photo → activity.master_id); conjunctive with the params.
    # Admin → master_key=None → no filter (unchanged behaviour). The list
    # is a PUBLIC route (the web gallery rides the same table) —
    # get_optional_scope keeps anonymous requests at 200 (T2 pattern).
    scope: ScopeContext = Depends(get_optional_scope),  # noqa: B008
) -> PaginatedResponse[PhotoResponse]:
    """Return a paginated page of photos (admin view, GH #211).

    Corridor 3 free function (GH #217 Task 3, ADR 007): the route calls
    ``list_photos_view`` directly with the session as an argument — no
    service dependency here (the module's other routes keep theirs: they
    are CRUD). ``params`` (page/per_page/q/filters/sort) is validated at
    the router level; filtering/sorting/pagination and the denormalized
    ``client_name`` live in the free function (spec #211 §6.5, GH #206).
    """
    items, total = await list_photos_view(
        db_session=session, params=params, master_key=scope.master_key
    )
    return PaginatedResponse(
        items=items, total=total, page=params.page, per_page=params.per_page
    )


@router.get("/{photo_id}", response_model=PhotoResponse)
async def get_photo(
    photo_id: str,
    service: _ServiceDep,
    session: SessionDep,
    # GH #263 T5: чужое фото (нет своей активности) → 404. Public route —
    # get_optional_scope: anonymous stays 200 (T2 pattern), a logged-in
    # master is narrowed to his own rows.
    scope: ScopeContext = Depends(get_optional_scope),  # noqa: B008
) -> PhotoResponse:
    """Return a single photo by ID."""
    await _photo_scoped_or_404(service, session, photo_id, scope)
    photo = await service.get(db_session=session, id=photo_id)
    if not photo:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.PHOTO_NOT_FOUND,
                message="Photo not found",
            ).model_dump(),
        )
    return photo


@router.post("", response_model=PhotoResponse, status_code=201,
             dependencies=_WRITE_GUARD)
async def create_photo(
    data: PhotoCreate,
    service: _ServiceDep,
    session: SessionDep,
    # GH #263 T5: a master may attach photos only к своей активности —
    # create с чужим activity_id → 404 (same code as «цель не найдена»).
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> PhotoResponse:
    """Create a new photo."""
    if scope.master_key is not None and data.activity_id:
        await _activity_scoped_or_404(service, session, data.activity_id, scope)
    return await service.create(db_session=session, data=data)


@router.put("/{photo_id}", response_model=PhotoResponse, dependencies=_WRITE_GUARD)
async def update_photo(
    photo_id: str,
    data: PhotoUpdate,
    service: _ServiceDep,
    session: SessionDep,
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> PhotoResponse:
    """Full-update a photo by ID."""
    await _photo_scoped_or_404(service, session, photo_id, scope)
    # GH #263 T5-quality: PUT re-targets the photo — the NEW activity_id
    # must be inside the master's scope (None means «detach», which the
    # owner gate above already covered for the stored row).
    if scope.master_key is not None and data.activity_id:
        await _activity_scoped_or_404(service, session, data.activity_id, scope)
    photo = await service.update(db_session=session, id=photo_id, data=data)
    if not photo:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.PHOTO_NOT_FOUND,
                message="Photo not found",
            ).model_dump(),
        )
    return photo


@router.patch("/{photo_id}", response_model=PhotoResponse, dependencies=_WRITE_GUARD)
async def patch_photo(
    photo_id: str,
    data: PhotoPatch,
    service: _ServiceDep,
    session: SessionDep,
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> PhotoResponse:
    """Partial-update a photo by ID (PATCH)."""
    await _photo_scoped_or_404(service, session, photo_id, scope)
    # GH #263 T5-quality: PATCH can re-target activity_id too → same
    # new-target gate as PUT (the sentinel «don't change» is a not-sent
    # field, which Pydantic keeps None here — but a sent null detaches the
    # photo from the master's scope, which the owner gate has already
    # validated on the stored row).
    if scope.master_key is not None and data.activity_id:
        await _activity_scoped_or_404(service, session, data.activity_id, scope)
    photo = await service.patch(db_session=session, id=photo_id, data=data)
    if not photo:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.PHOTO_NOT_FOUND,
                message="Photo not found",
            ).model_dump(),
        )
    return photo


@router.delete("/{photo_id}", status_code=204, dependencies=_WRITE_GUARD)
async def delete_photo(
    photo_id: str,
    service: _ServiceDep,
    session: SessionDep,
    # GH #263 T5: чужое фото не удаляем — 404.
    scope: ScopeContext = Depends(get_scope),  # noqa: B008
) -> None:
    """Delete a photo (hard delete)."""
    await _photo_scoped_or_404(service, session, photo_id, scope)
    deleted = await service.delete(db_session=session, id=photo_id)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.PHOTO_NOT_FOUND,
                message="Photo not found",
            ).model_dump(),
        )
