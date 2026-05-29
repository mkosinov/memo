"""Business logic for master CRUD operations."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.master import Master
from app.domain.masters.schemas import MasterCreate, MasterUpdate


class MasterService:
    """Handles master entity operations."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_all(self) -> list[Master]:
        """Return all active masters."""
        result = await self._session.execute(
            select(Master).where(Master.is_active)
        )
        return list(result.scalars().all())

    async def get_by_id(self, master_id: str) -> Master | None:
        """Return a master by ID, or None if not found."""
        result = await self._session.execute(
            select(Master).where(Master.id == master_id)
        )
        return result.scalar_one_or_none()

    async def create(self, data: MasterCreate) -> Master:
        """Create a new master and persist it."""
        master = Master(**data.model_dump())
        self._session.add(master)
        await self._session.flush()
        await self._session.refresh(master)
        return master

    async def update(self, master_id: str, data: MasterUpdate) -> Master | None:
        """Full-update a master by ID. Returns None if not found."""
        master = await self.get_by_id(master_id)
        if not master:
            return None
        for key, value in data.model_dump().items():
            setattr(master, key, value)
        await self._session.flush()
        await self._session.refresh(master)
        return master

    async def delete(self, master_id: str) -> bool:
        """Soft-delete a master (set is_active=False). Returns False if not found."""
        master = await self.get_by_id(master_id)
        if not master:
            return False
        master.is_active = False
        await self._session.flush()
        return True
