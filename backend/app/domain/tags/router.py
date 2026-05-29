"""FastAPI router for tag CRUD endpoints (minimal: POST, GET)."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends

from app.db.database import SessionDep
from app.domain.tags.schemas import TagCreate, TagResponse
from app.domain.tags.service import TagService, get_tag_service

router = APIRouter(tags=["tags"])


@lru_cache
def _get_tag_service() -> TagService:
    """Dependency factory returning a singleton TagService."""
    return get_tag_service()


_ServiceDep = Annotated[TagService, Depends(_get_tag_service)]


@router.get("", response_model=list[TagResponse])
async def list_tags(
    service: _ServiceDep,
    session: SessionDep,
) -> list[TagResponse]:
    """Return all active tags."""
    tags = await service.list_all(db_session=session)
    return [TagResponse.model_validate(t) for t in tags]


@router.post("", response_model=TagResponse, status_code=201)
async def create_tag(
    data: TagCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> TagResponse:
    """Create a new tag."""
    tag = await service.create(db_session=session, data=data)
    return TagResponse.model_validate(tag)
