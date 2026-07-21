"""Business logic for service CRUD operations with nested tariffs and tags."""

from __future__ import annotations

from functools import lru_cache

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.repositories.generic import SoftDeleteRepository, get_soft_delete_repository
from src.models.service import Service
from src.models.tag import service_tags
from src.models.tariff import Tariff
from src.schemas.service import ServiceCreate, ServiceResponse, ServiceUpdate
from src.services.generic import GenericService
from src.services.decorators import transactional


class ServiceService(GenericService[ServiceCreate, ServiceUpdate, ServiceResponse]):
    """Service service with eager-loaded tariffs/tags and nested create/update."""

    def __init__(
        self, repository: SoftDeleteRepository, model: type[Service]
    ) -> None:
        super().__init__(repository, model, response_schema=ServiceResponse)

    async def list(
        self, db_session: AsyncSession, **filters
    ) -> list[Service]:
        """Return all active services with tariffs and tags eagerly loaded."""
        result = await db_session.execute(
            select(Service)
            .where(Service.is_active)
            .options(selectinload(Service.tariffs), selectinload(Service.tags))
        )
        return list(result.scalars().all())

    async def get(
        self, db_session: AsyncSession, id: str
    ) -> Service | None:
        """Return a service by ID with tariffs and tags, or None."""
        result = await db_session.execute(
            select(Service)
            .where(Service.id == id)
            .options(selectinload(Service.tariffs), selectinload(Service.tags))
        )
        return result.scalar_one_or_none()

    @transactional
    async def create(
        self, db_session: AsyncSession, data: ServiceCreate
    ) -> Service:
        """Create service with nested tariffs and tag links."""
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

        # Link tags
        if tag_ids:
            for tid in tag_ids:
                await db_session.execute(
                    service_tags.insert().values(
                        service_id=service.id, tag_id=tid
                    )
                )

        await db_session.flush()
        return await self.get(db_session, service.id)

    @transactional
    async def update(
        self, db_session: AsyncSession, id: str, data: ServiceUpdate
    ) -> Service | None:
        """Full-update: replaces attributes, tariffs, and tag links."""
        service = await self.get(db_session, id)
        if not service:
            return None

        tag_ids = data.tag_ids
        tariff_data = data.tariffs
        update_data = data.model_dump(exclude={"tariffs", "tag_ids"})

        for key, value in update_data.items():
            setattr(service, key, value)

        await db_session.execute(
            delete(Tariff).where(Tariff.service_id == id)
        )
        for td in tariff_data:
            tariff = Tariff(service_id=service.id, **td.model_dump())
            db_session.add(tariff)

        await db_session.execute(
            delete(service_tags).where(service_tags.c.service_id == id)
        )
        if tag_ids:
            for tid in tag_ids:
                await db_session.execute(
                    service_tags.insert().values(
                        service_id=service.id, tag_id=tid
                    )
                )

        await db_session.flush()
        db_session.expunge(service)
        return await self.get(db_session, id)


@lru_cache
def get_service_service() -> ServiceService:
    """Returns a singleton ServiceService."""
    return ServiceService(get_soft_delete_repository(), Service)
