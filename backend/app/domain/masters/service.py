"""Business logic for master CRUD operations."""

from functools import lru_cache

from app.db.models.master import Master
from app.db.repository import get_repository
from app.domain.base import GenericService
from app.domain.masters.schemas import MasterCreate, MasterUpdate


@lru_cache
def get_master_service() -> GenericService[Master, MasterCreate, MasterUpdate]:
    return GenericService(get_repository(), Master)
