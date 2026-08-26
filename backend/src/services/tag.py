"""Business logic for tag CRUD operations."""

from functools import lru_cache

from src.repositories.generic import get_base_repository
from src.repositories.search import SearchField
from src.models.tag import Tag
from src.schemas.tag import TagCreate, TagResponse
from src.services.generic import GenericService


class TagService(GenericService[TagCreate, TagCreate, TagResponse]):
    """Tag service with NOT NULL field protection on PATCH."""

    NOT_NULL_FIELDS = {"tag"}

    # GH #212 search matrix (spec §5.2): substring on ``tag``, exact id
    # equality when q parses as a full UUID (deep-link prerequisite #216).
    search_fields = [SearchField(Tag.tag), SearchField(Tag.id, kind="uuid")]


@lru_cache
def get_tag_service() -> TagService:
    return TagService(get_base_repository(), Tag, TagResponse)
