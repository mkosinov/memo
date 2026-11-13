"""Anonymous showcase routes — the ``/api/v1/public`` namespace (ADR-015).

Audience: anonymous callers. The prefix alone exposes nothing: every route
here also carries an explicit ``PUBLIC_ROUTES`` allowlist entry (the
default-deny walk, ``src/auth/public.py``). Schemas are minimal
per-audience variants — never the admin contract (``MyPhotoItem``
precedent, ``schemas/my.py``).
"""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from src.db import SessionDep
from src.domain.errors import BareListLimitExceededError
from src.schemas.activity import (
    ActivityPublicResponse,
    PublicActivityListParams,
)
from src.schemas.common import PaginatedResponse
from src.schemas.location import LocationPublicResponse
from src.schemas.photo import PhotoPublicResponse, PublicPhotoListParams
from src.services.activity import list_public_activities_view
from src.services.location import list_public_locations_view
from src.services.photo import list_public_photos_view

router = APIRouter(tags=["public"])


@router.get("/photos", response_model=PaginatedResponse[PhotoPublicResponse])
async def list_public_photos(
    session: SessionDep,
    params: Annotated[PublicPhotoListParams, Query()],
) -> PaginatedResponse[PhotoPublicResponse]:
    """Public gallery list: forced ``is_public=True``, minimal schema
    (tags — title strings). ``service_id`` (#576): union semantics
    (variant A) — direct photos of the service OR public photos of its
    activities; the answer is two-group ordered (direct service photos
    first, then activity photos; pinned ``created_at desc`` + ``id
    asc`` within each group). Without the filter the pinned order
    (``created_at desc`` + ``id asc``) covers the whole public feed.
    Other owner filters stay unwired; unknown query params are ignored
    (repo convention: silent result, not 4xx)."""
    items, total = await list_public_photos_view(session, params)
    return PaginatedResponse(items=items, total=total, page=params.page, per_page=params.per_page)


@router.get("/activities", response_model=PaginatedResponse[ActivityPublicResponse])
async def list_public_activities(
    session: SessionDep,
    params: Annotated[PublicActivityListParams, Query()],
) -> PaginatedResponse[ActivityPublicResponse]:
    """Public schedule list (GH #600): minimal ``ActivityPublicResponse``
    schema (exactly what the web schedule consumes), private rows
    excluded server-side (NULL-safe ``is_private IS NOT TRUE`` — a
    private lesson is invisible to clients), pinned order ``start`` +
    ``id``. ``date_from``/``date_to`` bound the window as whole days;
    without ``date_from`` the window starts TODAY (the web schedule
    never shows the past). ``?id=`` narrowing ANDs with the predicate —
    a private id yields an empty page, never a leak. Other admin
    filters (``q``/``service_id``) stay unwired; unknown query params
    are ignored (repo convention: silent result, not 4xx)."""
    items, total = await list_public_activities_view(session, params)
    return PaginatedResponse(items=items, total=total, page=params.page, per_page=params.per_page)


@router.get("/locations", response_model=list[LocationPublicResponse])
async def list_public_locations(
    session: SessionDep,
) -> list[LocationPublicResponse]:
    """Public location dictionary (GH #601, ADR-015): a bare JSON
    array — no parameters at all (the ``/all`` canon, spec §2.2). Forced
    server-side visibility: only rows that are both not archived and
    ``is_public = true`` (a hidden location is a site-only concern —
    inside the admin it stays fully working). Minimal 4-field
    ``LocationPublicResponse`` schema; pinned order ``sort_order, title,
    id``; capped by ``BARE_LIST_MAX_ROWS`` like every bare list."""
    try:
        return await list_public_locations_view(session)
    except BareListLimitExceededError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
