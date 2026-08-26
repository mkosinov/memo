"""Business logic for location CRUD operations."""

from functools import lru_cache

from src.repositories.generic import get_archive_repository
from src.repositories.search import SearchField
from src.models.location import Location
from src.schemas.location import LocationCreate, LocationResponse, LocationUpdate
from src.services.generic import ArchiveService


class LocationService(ArchiveService[LocationCreate, LocationUpdate, LocationResponse]):
    """Location service with NOT NULL field protection on PATCH."""

    NOT_NULL_FIELDS = {"name", "capacity", "sort_order"}

    # GH #212 search matrix (spec §5.2): substring on the 4 text fields;
    # id is exact-uuid (deep-link prerequisite #216); the 3 URL fields are
    # EXACT full-string equality only — a pasted full Yandex-map/review/
    # image URL finds the location, partial URLs never match (spec §5.2
    # note: no ilike on URL columns).
    search_fields = [
        SearchField(Location.name),
        SearchField(Location.short_title),
        SearchField(Location.address),
        SearchField(Location.description),
        SearchField(Location.id, kind="uuid"),
        SearchField(Location.yandex_map_url, kind="exact"),
        SearchField(Location.review_url, kind="exact"),
        SearchField(Location.image_url, kind="exact"),
    ]


@lru_cache
def get_location_service() -> LocationService:
    return LocationService(get_archive_repository(), Location, LocationResponse)
