"""Business logic for material CRUD operations."""

from functools import lru_cache

from src.repositories.generic import get_archive_repository
from src.models.material import Material
from src.schemas.material import MaterialCreate, MaterialResponse, MaterialUpdate
from src.services.generic import SoftDeleteService


class MaterialService(SoftDeleteService[MaterialCreate, MaterialUpdate, MaterialResponse]):
    """Material service with NOT NULL field protection on PATCH."""

    NOT_NULL_FIELDS = {"title", "description"}


@lru_cache
def get_material_service() -> MaterialService:
    return MaterialService(get_archive_repository(), Material, MaterialResponse)
