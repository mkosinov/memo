"""Business logic for client CRUD operations."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.client import Client
from app.domain.clients.schemas import ClientCreate, ClientUpdate


class ClientService:
    """Handles client entity operations."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_all(self) -> list[Client]:
        """Return all active clients."""
        result = await self._session.execute(
            select(Client).where(Client.is_active)
        )
        return list(result.scalars().all())

    async def get_by_id(self, client_id: str) -> Client | None:
        """Return a client by ID, or None if not found."""
        result = await self._session.execute(
            select(Client).where(Client.id == client_id)
        )
        return result.scalar_one_or_none()

    async def create(self, data: ClientCreate) -> Client:
        """Create a new client and persist it."""
        client = Client(**data.model_dump())
        self._session.add(client)
        await self._session.flush()
        await self._session.refresh(client)
        return client

    async def update(self, client_id: str, data: ClientUpdate) -> Client | None:
        """Full-update a client by ID. Returns None if not found."""
        client = await self.get_by_id(client_id)
        if not client:
            return None
        for key, value in data.model_dump().items():
            setattr(client, key, value)
        await self._session.flush()
        await self._session.refresh(client)
        return client

    async def delete(self, client_id: str) -> bool:
        """Soft-delete a client (set is_active=False). Returns False if not found."""
        client = await self.get_by_id(client_id)
        if not client:
            return False
        client.is_active = False
        await self._session.flush()
        return True
