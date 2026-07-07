"""Business logic for location CRUD operations."""

from functools import lru_cache

from src.repositories.generic import get_soft_delete_repository
from src.models.location import Location
from src.schemas.location import LocationCreate, LocationResponse, LocationUpdate
from src.services.generic import GenericService


@lru_cache
def get_location_service() -> GenericService[LocationCreate, LocationUpdate, LocationResponse]:
    return GenericService(get_soft_delete_repository(), Location, LocationResponse)
