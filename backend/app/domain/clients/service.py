"""Business logic for client CRUD operations."""

from functools import lru_cache

from app.db.models.client import Client
from app.db.repository import get_repository
from src.services.generic import GenericService
from src.schemas.client import ClientCreate, ClientResponse, ClientUpdate


@lru_cache
def get_client_service() -> GenericService[ClientCreate, ClientUpdate, ClientResponse]:
    return GenericService(get_repository(), Client, ClientResponse)
