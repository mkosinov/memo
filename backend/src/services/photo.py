"""Business logic for photo CRUD operations."""

from functools import lru_cache

from src.repositories.generic import get_generic_repository
from src.models.photo import Photo
from src.schemas.photo import PhotoCreate, PhotoResponse, PhotoUpdate
from src.services.generic import GenericService


@lru_cache
def get_photo_service() -> GenericService[PhotoCreate, PhotoUpdate, PhotoResponse]:
    return GenericService(get_generic_repository(), Photo, PhotoResponse)
