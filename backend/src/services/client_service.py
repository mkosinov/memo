"""Business logic for client CRUD operations."""

from functools import lru_cache

from src.db.repository import get_repository
from src.models.client import Client
from src.schemas.client import ClientCreate, ClientResponse, ClientUpdate
from src.services.generic import GenericService


@lru_cache
def get_client_service() -> GenericService[ClientCreate, ClientUpdate, ClientResponse]:
    return GenericService(get_repository(), Client, ClientResponse)
