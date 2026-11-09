"""Anonymous showcase routes — the ``/api/v1/public`` namespace (ADR-015).

Audience: anonymous callers. The prefix alone exposes nothing: every route
here also carries an explicit ``PUBLIC_ROUTES`` allowlist entry (the
default-deny walk, ``src/auth/public.py``). Schemas are minimal
per-audience variants — never the admin contract (``MyPhotoItem``
precedent, ``schemas/my.py``).
"""

from typing import Annotated

from fastapi import APIRouter, Query

from src.db import SessionDep
from src.schemas.common import PaginatedResponse
from src.schemas.pagination import PaginationParams
from src.schemas.photo import PhotoPublicResponse
from src.services.photo import list_public_photos_view

router = APIRouter(tags=["public"])


@router.get("/photos", response_model=PaginatedResponse[PhotoPublicResponse])
async def list_public_photos(
    session: SessionDep,
    params: Annotated[PaginationParams, Query()],
) -> PaginatedResponse[PhotoPublicResponse]:
    """Public gallery list: forced ``is_public=True``, pinned sort
    (``created_at desc`` + ``id asc``), minimal schema (tags — title
    strings). Owner filters are not wired; unknown query params are
    ignored (repo convention: silent result, not 4xx)."""
    items, total = await list_public_photos_view(session, params)
    return PaginatedResponse(
        items=items, total=total, page=params.page, per_page=params.per_page
    )
