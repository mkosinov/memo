"""Business logic for location CRUD operations."""

from functools import lru_cache

from app.db.models.location import Location
from app.db.repository import GenericRepository
from app.domain.base import GenericService
from app.domain.locations.schemas import LocationCreate, LocationUpdate


@lru_cache
def get_location_repo() -> GenericRepository[Location]:
    return GenericRepository(Location)


@lru_cache
def get_location_service() -> GenericService[Location, LocationCreate, LocationUpdate]:
    return GenericService(get_location_repo())
