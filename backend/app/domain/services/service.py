"""Business logic for service CRUD operations with nested tariffs and tags."""

from functools import lru_cache

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models.service import Service
from app.db.models.tag import service_tags
from app.db.models.tariff import Tariff
from app.domain.services.schemas import ServiceCreate, ServiceUpdate


class ServiceService:
    """Handles service entity operations with nested tariffs and tags."""

    def __init__(self) -> None:
        pass

    async def list_all(self, db_session: AsyncSession) -> list[Service]:
        """Return all active services with tariffs and tags eagerly loaded."""
        result = await db_session.execute(
            select(Service)
            .where(Service.is_active)
            .options(
                selectinload(Service.tariffs),
                selectinload(Service.tags),
            )
        )
        return list(result.scalars().all())

    async def get_by_id(self, db_session: AsyncSession, service_id: str) -> Service | None:
        """Return a service by ID with tariffs and tags, or None."""
        result = await db_session.execute(
            select(Service)
            .where(Service.id == service_id)
            .options(
                selectinload(Service.tariffs),
                selectinload(Service.tags),
            )
        )
        return result.scalar_one_or_none()

    async def create(self, db_session: AsyncSession, data: ServiceCreate) -> Service:
        """Create a new service with tariffs and tag links."""
        tag_ids = data.tag_ids
        tariff_data = data.tariffs
        service_data = data.model_dump(exclude={"tariffs", "tag_ids"})

        service = Service(**service_data)
        db_session.add(service)
        await db_session.flush()

        # Create tariffs
        for td in tariff_data:
            tariff = Tariff(service_id=service.id, **td.model_dump())
            db_session.add(tariff)

        # Link existing tags via direct join table inserts (avoids lazy-load)
        if tag_ids:
            for tid in tag_ids:
                await db_session.execute(
                    service_tags.insert().values(
                        service_id=service.id, tag_id=tid
                    )
                )

        await db_session.flush()

        # Reload with relationships eagerly loaded
        return await self.get_by_id(db_session=db_session, service_id=service.id)

    async def update(self, db_session: AsyncSession, service_id: str, data: ServiceUpdate) -> Service | None:
        """Full-update a service: replaces attributes, tariffs, and tag links."""
        service = await self.get_by_id(db_session=db_session, service_id=service_id)
        if not service:
            return None

        tag_ids = data.tag_ids
        tariff_data = data.tariffs
        update_data = data.model_dump(exclude={"tariffs", "tag_ids"})

        # Update service attributes
        for key, value in update_data.items():
            setattr(service, key, value)

        # Replace tariffs (delete old, create new)
        await db_session.execute(
            delete(Tariff).where(Tariff.service_id == service_id)
        )
        for td in tariff_data:
            tariff = Tariff(service_id=service.id, **td.model_dump())
            db_session.add(tariff)

        # Replace tag links (delete old, insert new)
        await db_session.execute(
            delete(service_tags).where(service_tags.c.service_id == service_id)
        )
        if tag_ids:
            for tid in tag_ids:
                await db_session.execute(
                    service_tags.insert().values(
                        service_id=service.id, tag_id=tid
                    )
                )

        await db_session.flush()
        # Expunge to avoid stale identity-map cache after cascading deletes
        db_session.expunge(service)

        # Reload with relationships eagerly loaded
        return await self.get_by_id(db_session=db_session, service_id=service_id)

    async def delete(self, db_session: AsyncSession, service_id: str) -> bool:
        """Soft-delete a service. Returns False if not found."""
        service = await self.get_by_id(db_session=db_session, service_id=service_id)
        if not service:
            return False
        service.is_active = False
        await db_session.flush()
        return True


@lru_cache
def get_service_service() -> ServiceService:
    """Returns a singleton ServiceService."""
    return ServiceService()
