"""Business logic for master CRUD operations."""

from functools import lru_cache

from src.db.repository import get_repository
from src.models.master import Master
from src.schemas.master import MasterCreate, MasterResponse, MasterUpdate
from src.services.generic import GenericService


@lru_cache
def get_master_service() -> GenericService[MasterCreate, MasterUpdate, MasterResponse]:
    return GenericService(get_repository(), Master, MasterResponse)
