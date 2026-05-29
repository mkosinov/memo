"""Business logic for location CRUD operations."""

from functools import lru_cache

from app.db.models.location import Location
from app.db.repository import get_repository
from app.domain.base import GenericService
from app.domain.locations.schemas import LocationCreate, LocationUpdate


@lru_cache
def get_location_service() -> GenericService[Location, LocationCreate, LocationUpdate]:
    return GenericService(get_repository(), Location)
