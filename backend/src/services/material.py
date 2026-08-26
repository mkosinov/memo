"""Business logic for material CRUD operations."""

from functools import lru_cache

from src.repositories.generic import get_archive_repository
from src.repositories.search import SearchField
from src.models.material import Material
from src.schemas.material import MaterialCreate, MaterialResponse, MaterialUpdate
from src.services.generic import ArchiveService


class MaterialService(ArchiveService[MaterialCreate, MaterialUpdate, MaterialResponse]):
    """Material service with NOT NULL field protection on PATCH."""

    NOT_NULL_FIELDS = {"title", "description"}

    # GH #212 search matrix (spec §5.2): substring on title/description
    # (each field ilike'd separately), exact id equality when q parses as
    # a full UUID (deep-link prerequisite #216).
    search_fields = [
        SearchField(Material.title),
        SearchField(Material.description),
        SearchField(Material.id, kind="uuid"),
    ]


@lru_cache
def get_material_service() -> MaterialService:
    return MaterialService(get_archive_repository(), Material, MaterialResponse)
