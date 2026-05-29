"""Business logic for client CRUD operations."""

from functools import lru_cache

from app.db.models.client import Client
from app.db.repository import get_repository
from app.domain.base import GenericService
from app.domain.clients.schemas import ClientCreate, ClientUpdate


@lru_cache
def get_client_service() -> GenericService[Client, ClientCreate, ClientUpdate]:
    return GenericService(get_repository(), Client)
