"""Business logic for location CRUD operations."""

from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.location import Location
from app.domain.locations.schemas import LocationCreate, LocationUpdate


class LocationService:
    """Handles location entity operations."""

    def __init__(self) -> None:
        pass

    async def list_all(self, db_session: AsyncSession) -> list[Location]:
        """Return all active locations."""
        result = await db_session.execute(
            select(Location).where(Location.is_active)
        )
        return list(result.scalars().all())

    async def get_by_id(self, db_session: AsyncSession, location_id: str) -> Location | None:
        """Return a location by ID, or None if not found."""
        result = await db_session.execute(
            select(Location).where(Location.id == location_id)
        )
        return result.scalar_one_or_none()

    async def create(self, db_session: AsyncSession, data: LocationCreate) -> Location:
        """Create a new location and persist it."""
        location = Location(**data.model_dump())
        db_session.add(location)
        await db_session.flush()
        await db_session.refresh(location)
        return location

    async def update(self, db_session: AsyncSession, location_id: str, data: LocationUpdate) -> Location | None:
        """Full-update a location by ID. Returns None if not found."""
        location = await self.get_by_id(db_session=db_session, location_id=location_id)
        if not location:
            return None
        for key, value in data.model_dump().items():
            setattr(location, key, value)
        await db_session.flush()
        await db_session.refresh(location)
        return location

    async def delete(self, db_session: AsyncSession, location_id: str) -> bool:
        """Soft-delete a location (set is_active=False). Returns False if not found."""
        location = await self.get_by_id(db_session=db_session, location_id=location_id)
        if not location:
            return False
        location.is_active = False
        await db_session.flush()
        return True


@lru_cache
def get_location_service() -> LocationService:
    """Returns a singleton LocationService."""
    return LocationService()
