"""Business logic for material CRUD operations."""

from functools import lru_cache

from src.repositories.generic import get_soft_delete_repository
from src.models.material import Material
from src.schemas.material import MaterialCreate, MaterialResponse, MaterialUpdate
from src.services.generic import GenericService


@lru_cache
def get_material_service() -> GenericService[MaterialCreate, MaterialUpdate, MaterialResponse]:
    return GenericService(get_soft_delete_repository(), Material, MaterialResponse)
