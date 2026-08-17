"""Business logic for location CRUD operations."""

from functools import lru_cache

from src.repositories.generic import get_archive_repository
from src.models.location import Location
from src.schemas.location import LocationCreate, LocationResponse, LocationUpdate
from src.services.generic import ArchiveService


class LocationService(ArchiveService[LocationCreate, LocationUpdate, LocationResponse]):
    """Location service with NOT NULL field protection on PATCH."""

    NOT_NULL_FIELDS = {"name", "capacity", "sort_order"}


@lru_cache
def get_location_service() -> LocationService:
    return LocationService(get_archive_repository(), Location, LocationResponse)
