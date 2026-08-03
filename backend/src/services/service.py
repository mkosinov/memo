"""Business logic for service CRUD operations with nested tariffs and tags."""

from __future__ import annotations

from functools import lru_cache

from sqlalchemy import delete, func, not_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.models.enums import ArchiveStatus
from src.repositories.generic import SoftDeleteRepository, get_soft_delete_repository
from src.models.service import Service
from src.models.tag import service_tags
from src.models.tariff import Tariff
from src.schemas.common import PaginatedResponse
from src.schemas.service import ServiceCreate, ServicePatch, ServiceResponse, ServiceUpdate
from src.services.generic import SoftDeleteService
from src.services.decorators import transactional


class ServiceService(SoftDeleteService[ServiceCreate, ServiceUpdate, ServiceResponse]):
    """Service service with eager-loaded tariffs/tags and nested create/update.

    Overrides ``list`` to eager-load ``tariffs``/``tags`` via ``selectinload``.
    The eager-load makes the select structurally incompatible with the
    ``SoftDeleteService._list_stmt`` base (which uses a bare ``select(model)``),
    so the archive-status clause is applied inline here rather than composed
    (spec §5.3 explicitly permits this duplication for the eager-load override).
    """

    NOT_NULL_FIELDS = {"title", "description", "image_url", "specialty", "min_age", "duration", "record_info"}

    def __init__(
        self, repository: SoftDeleteRepository, model: type[Service]
    ) -> None:
        super().__init__(repository, model, response_schema=ServiceResponse)

    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        status: ArchiveStatus = ArchiveStatus.ACTIVE,
        **filters,
    ) -> PaginatedResponse[ServiceResponse]:
        """Return a paginated page of services filtered by archive status,
        with tariffs/tags eagerly loaded."""
        stmt = (
            select(Service)
            .options(selectinload(Service.tariffs), selectinload(Service.tags))
        )
        if status == ArchiveStatus.ACTIVE:
            stmt = stmt.where(Service.is_active)
        elif status == ArchiveStatus.ARCHIVED:
            stmt = stmt.where(not_(Service.is_active))
        for key, value in filters.items():
            if value is not None:
                stmt = stmt.where(getattr(Service, key) == value)
        total = (
            await db_session.execute(select(func.count()).select_from(stmt.subquery()))
        ).scalar_one()
        result = await db_session.execute(
            stmt.limit(per_page).offset((page - 1) * per_page)
        )
        items = [ServiceResponse.model_validate(s) for s in result.scalars().all()]
        return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)

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

    @transactional
    async def patch(
        self, db_session: AsyncSession, id: str, data: ServicePatch
    ) -> Service | None:
        """Partial-update a service — only sent fields are changed.

        Scalar fields: applied via exclude_unset. NOT NULL fields
        with null values are silently stripped.

        tag_ids: if sent → hard-replace all tag links (delete + insert).
        If not sent → existing tag links are preserved.

        tariffs: if sent → hard-replace all tariffs (delete + insert).
        If not sent → existing tariffs are preserved.
        """
        service = await self.get(db_session, id)
        if not service:
            return None

        data_dict = data.model_dump(exclude_unset=True)

        # Separate tag_ids and tariffs from scalar fields
        tag_ids = data_dict.pop("tag_ids", None)
        tariffs_data = data_dict.pop("tariffs", None)

        # Strip NOT NULL fields sent as null
        for field in self.NOT_NULL_FIELDS:
            if field in data_dict and data_dict[field] is None:
                del data_dict[field]

        # Apply scalar fields
        for key, value in data_dict.items():
            setattr(service, key, value)

        # Handle tag_ids: if sent (even if empty list), hard-replace links
        if tag_ids is not None:
            await db_session.execute(
                delete(service_tags).where(service_tags.c.service_id == id)
            )
            if tag_ids:
                for tid in tag_ids:
                    await db_session.execute(
                        service_tags.insert().values(
                            service_id=id, tag_id=tid
                        )
                    )

        # Handle tariffs: if sent (even if empty list), hard-replace tariffs
        if tariffs_data is not None:
            await db_session.execute(
                delete(Tariff).where(Tariff.service_id == id)
            )
            for td in tariffs_data:
                tariff = Tariff(service_id=service.id, **td)
                db_session.add(tariff)

        await db_session.flush()
        db_session.expunge(service)
        return await self.get(db_session, id)


@lru_cache
def get_service_service() -> ServiceService:
    """Returns a singleton ServiceService."""
    return ServiceService(get_soft_delete_repository(), Service)
