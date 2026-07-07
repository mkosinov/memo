"""Business logic for master CRUD operations."""

from functools import lru_cache

from src.repositories.generic import get_soft_delete_repository
from src.models.master import Master
from src.schemas.master import MasterCreate, MasterResponse, MasterUpdate
from src.services.generic import GenericService


@lru_cache
def get_master_service() -> GenericService[MasterCreate, MasterUpdate, MasterResponse]:
    return GenericService(get_soft_delete_repository(), Master, MasterResponse)
