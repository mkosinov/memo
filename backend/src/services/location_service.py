"""Business logic for location CRUD operations."""

from functools import lru_cache

from src.db.repository import get_repository
from src.models.location import Location
from src.schemas.location import LocationCreate, LocationResponse, LocationUpdate
from src.services.generic import GenericService


@lru_cache
def get_location_service() -> GenericService[LocationCreate, LocationUpdate, LocationResponse]:
    return GenericService(get_repository(), Location, LocationResponse)
