"""Business logic for master CRUD operations."""

from functools import lru_cache

from app.db.models.master import Master
from app.db.repository import get_repository
from src.services.generic import GenericService
from src.schemas.master import MasterCreate, MasterResponse, MasterUpdate


@lru_cache
def get_master_service() -> GenericService[MasterCreate, MasterUpdate, MasterResponse]:
    return GenericService(get_repository(), Master, MasterResponse)
