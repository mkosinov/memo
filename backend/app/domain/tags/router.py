"""FastAPI router for tag CRUD endpoints (minimal: POST, GET)."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db_session
from app.domain.tags.schemas import TagCreate, TagResponse
from app.domain.tags.service import TagService

router = APIRouter(tags=["tags"])

_SessionDep = Annotated[AsyncSession, Depends(get_db_session)]


def _get_service(session: _SessionDep) -> TagService:
    return TagService(session)


_ServiceDep = Annotated[TagService, Depends(_get_service)]


@router.get("", response_model=list[TagResponse])
async def list_tags(service: _ServiceDep) -> list[TagResponse]:
    """Return all active tags."""
    tags = await service.list_all()
    return [TagResponse.model_validate(t) for t in tags]


@router.post("", response_model=TagResponse, status_code=201)
async def create_tag(data: TagCreate, service: _ServiceDep) -> TagResponse:
    """Create a new tag."""
    tag = await service.create(data)
    return TagResponse.model_validate(tag)
