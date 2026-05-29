"""Business logic for client CRUD operations."""

from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.client import Client
from app.domain.clients.schemas import ClientCreate, ClientUpdate


class ClientService:
    """Handles client entity operations."""

    def __init__(self) -> None:
        pass

    async def list_all(self, db_session: AsyncSession) -> list[Client]:
        """Return all active clients."""
        result = await db_session.execute(
            select(Client).where(Client.is_active)
        )
        return list(result.scalars().all())

    async def get_by_id(self, db_session: AsyncSession, client_id: str) -> Client | None:
        """Return a client by ID, or None if not found."""
        result = await db_session.execute(
            select(Client).where(Client.id == client_id)
        )
        return result.scalar_one_or_none()

    async def create(self, db_session: AsyncSession, data: ClientCreate) -> Client:
        """Create a new client and persist it."""
        client = Client(**data.model_dump())
        db_session.add(client)
        await db_session.flush()
        await db_session.refresh(client)
        return client

    async def update(self, db_session: AsyncSession, client_id: str, data: ClientUpdate) -> Client | None:
        """Full-update a client by ID. Returns None if not found."""
        client = await self.get_by_id(db_session=db_session, client_id=client_id)
        if not client:
            return None
        for key, value in data.model_dump().items():
            setattr(client, key, value)
        await db_session.flush()
        await db_session.refresh(client)
        return client

    async def delete(self, db_session: AsyncSession, client_id: str) -> bool:
        """Soft-delete a client (set is_active=False). Returns False if not found."""
        client = await self.get_by_id(db_session=db_session, client_id=client_id)
        if not client:
            return False
        client.is_active = False
        await db_session.flush()
        return True


@lru_cache
def get_client_service() -> ClientService:
    """Returns a singleton ClientService."""
    return ClientService()
