"""Business logic for master CRUD operations."""

from functools import lru_cache

from src.repositories.generic import get_soft_delete_repository
from src.models.master import Master
from src.schemas.master import MasterCreate, MasterResponse, MasterUpdate
from src.services.generic import GenericService


class MasterService(GenericService[MasterCreate, MasterUpdate, MasterResponse]):
    """Master service with NOT NULL field protection on PATCH."""

    NOT_NULL_FIELDS = {"first_name", "last_name", "color", "position", "specialty", "sort_order"}


@lru_cache
def get_master_service() -> MasterService:
    return MasterService(get_soft_delete_repository(), Master, MasterResponse)
