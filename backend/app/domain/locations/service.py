"""Business logic for location CRUD operations."""

from functools import lru_cache

from app.db.models.location import Location
from app.db.repository import get_repository
from src.services.generic import GenericService
from src.schemas.location import LocationCreate, LocationResponse, LocationUpdate


@lru_cache
def get_location_service() -> GenericService[LocationCreate, LocationUpdate, LocationResponse]:
    return GenericService(get_repository(), Location, LocationResponse)
