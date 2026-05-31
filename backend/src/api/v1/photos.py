"""FastAPI router for photo endpoints."""

from fastapi import APIRouter, Query
from sqlalchemy import select

from src.db import SessionDep
from src.models.photo import Photo
from src.schemas.photo import PhotoResponse

router = APIRouter(tags=["photos"])


@router.get("/web", response_model=list[PhotoResponse])
async def list_public_photos(
    session: SessionDep,
    activity_id: str | None = Query(None),
) -> list[PhotoResponse]:
    """Return public photos (is_public=true, is_active=true). Optionally filter by activity_id."""
    stmt = select(Photo).where(Photo.is_public == True, Photo.is_active == True)
    if activity_id:
        stmt = stmt.where(Photo.activity_id == activity_id)
    result = await session.execute(stmt)
    photos = result.scalars().all()
    return [PhotoResponse.model_validate(p) for p in photos]
