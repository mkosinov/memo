"""Business logic for tag CRUD operations."""

from functools import lru_cache

from app.db.models.tag import Tag
from app.db.repository import get_repository
from src.services.generic import GenericService
from src.schemas.tag import TagCreate, TagResponse


@lru_cache
def get_tag_service() -> GenericService[TagCreate, TagCreate, TagResponse]:
    return GenericService(get_repository(), Tag, TagResponse)
