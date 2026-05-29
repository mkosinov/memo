"""Business logic for tag CRUD operations."""

from functools import lru_cache

from app.db.models.tag import Tag
from app.db.repository import GenericRepository
from app.domain.base import GenericService
from app.domain.tags.schemas import TagCreate


@lru_cache
def get_tag_repo() -> GenericRepository[Tag]:
    return GenericRepository(Tag)


@lru_cache
def get_tag_service() -> GenericService[Tag, TagCreate, TagCreate]:
    return GenericService(get_tag_repo())
