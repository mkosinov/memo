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
from src.schemas.photo import PhotoPublicResponse, PublicPhotoListParams
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
