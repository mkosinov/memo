"""Business logic for service CRUD operations with nested tariffs and tags."""

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models.service import Service
from app.db.models.tag import service_tags
from app.db.models.tariff import Tariff
from app.domain.services.schemas import ServiceCreate, ServiceUpdate


class ServiceService:
    """Handles service entity operations with nested tariffs and tags."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_all(self) -> list[Service]:
        """Return all active services with tariffs and tags eagerly loaded."""
        result = await self._session.execute(
            select(Service)
            .where(Service.is_active)
            .options(
                selectinload(Service.tariffs),
                selectinload(Service.tags),
            )
        )
        return list(result.scalars().all())

    async def get_by_id(self, service_id: str) -> Service | None:
        """Return a service by ID with tariffs and tags, or None."""
        result = await self._session.execute(
            select(Service)
            .where(Service.id == service_id)
            .options(
                selectinload(Service.tariffs),
                selectinload(Service.tags),
            )
        )
        return result.scalar_one_or_none()

    async def create(self, data: ServiceCreate) -> Service:
        """Create a new service with tariffs and tag links."""
        tag_ids = data.tag_ids
        tariff_data = data.tariffs
        service_data = data.model_dump(exclude={"tariffs", "tag_ids"})

        service = Service(**service_data)
        self._session.add(service)
        await self._session.flush()

        # Create tariffs
        for td in tariff_data:
            tariff = Tariff(service_id=service.id, **td.model_dump())
            self._session.add(tariff)

        # Link existing tags via direct join table inserts (avoids lazy-load)
        if tag_ids:
            for tid in tag_ids:
                await self._session.execute(
                    service_tags.insert().values(
                        service_id=service.id, tag_id=tid
                    )
                )

        await self._session.flush()

        # Reload with relationships eagerly loaded
        return await self.get_by_id(service.id)

    async def update(self, service_id: str, data: ServiceUpdate) -> Service | None:
        """Full-update a service: replaces attributes, tariffs, and tag links."""
        service = await self.get_by_id(service_id)
        if not service:
            return None

        tag_ids = data.tag_ids
        tariff_data = data.tariffs
        update_data = data.model_dump(exclude={"tariffs", "tag_ids"})

        # Update service attributes
        for key, value in update_data.items():
            setattr(service, key, value)

        # Replace tariffs (delete old, create new)
        await self._session.execute(
            delete(Tariff).where(Tariff.service_id == service_id)
        )
        for td in tariff_data:
            tariff = Tariff(service_id=service.id, **td.model_dump())
            self._session.add(tariff)

        # Replace tag links (delete old, insert new)
        await self._session.execute(
            delete(service_tags).where(service_tags.c.service_id == service_id)
        )
        if tag_ids:
            for tid in tag_ids:
                await self._session.execute(
                    service_tags.insert().values(
                        service_id=service.id, tag_id=tid
                    )
                )

        await self._session.flush()
        # Expunge to avoid stale identity-map cache after cascading deletes
        self._session.expunge(service)

        # Reload with relationships eagerly loaded
        return await self.get_by_id(service_id)

    async def delete(self, service_id: str) -> bool:
        """Soft-delete a service. Returns False if not found."""
        service = await self.get_by_id(service_id)
        if not service:
            return False
        service.is_active = False
        await self._session.flush()
        return True
