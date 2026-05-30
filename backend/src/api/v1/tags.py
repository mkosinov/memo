"""FastAPI router for tag CRUD endpoints (minimal: POST, GET)."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends

from src.db import SessionDep
from src.schemas.tag import TagCreate, TagResponse
from src.services.generic import GenericService
from src.services.tag import get_tag_service

router = APIRouter(tags=["tags"])


@lru_cache
def _get_tag_service() -> GenericService[TagCreate, TagCreate, TagResponse]:
    """Dependency factory returning a singleton TagService."""
    return get_tag_service()


_ServiceDep = Annotated[GenericService[TagCreate, TagCreate, TagResponse], Depends(_get_tag_service)]


@router.get("", response_model=list[TagResponse])
async def list_tags(
    service: _ServiceDep,
    session: SessionDep,
) -> list[TagResponse]:
    """Return all active tags."""
    return await service.list(db_session=session)


@router.post("", response_model=TagResponse, status_code=201)
async def create_tag(
    data: TagCreate,
    service: _ServiceDep,
    session: SessionDep,
) -> TagResponse:
    """Create a new tag."""
    return await service.create(db_session=session, data=data)
