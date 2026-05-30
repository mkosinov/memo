"""Business logic for tag CRUD operations."""

from functools import lru_cache

from src.repositories.generic import get_generic_repository
from src.models.tag import Tag
from src.schemas.tag import TagCreate, TagResponse
from src.services.generic import GenericService


@lru_cache
def get_tag_service() -> GenericService[TagCreate, TagCreate, TagResponse]:
    return GenericService(get_generic_repository(), Tag, TagResponse)
