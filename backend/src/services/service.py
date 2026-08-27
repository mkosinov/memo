"""Business logic for service CRUD operations with nested tariffs and tags."""

from __future__ import annotations

from functools import lru_cache
from typing import cast

from sqlalchemy import delete, not_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.domain.errors import BareListLimitExceededError
from src.models.enums import ArchiveStatus
from src.repositories.generic import ArchiveRepository, get_archive_repository
from src.repositories.search import SearchField
from src.models.service import Service
from src.models.tag import service_tags
from src.models.tariff import Tariff
from src.schemas.common import PaginatedResponse
from src.schemas.service import ServiceCreate, ServicePatch, ServiceResponse, ServiceUpdate
from src.services.generic import ArchiveService, BARE_LIST_MAX_ROWS
from src.services.decorators import transactional


class ServiceService(ArchiveService[ServiceCreate, ServiceUpdate, ServiceResponse]):
    """Service service with eager-loaded tariffs/tags and nested create/update.

    ``list`` delegates to ``ArchiveRepository.list`` passing ``selectinload``
    options for ``tariffs``/``tags`` so ``ServiceResponse`` validation doesn't
    hit ``MissingGreenlet`` under async SQLAlchemy (spec §4.1). The repository
    owns the select/status/filter/count/slice pipeline; the service only adds
    the eager-load options. ``list_all`` keeps its inline eager-load probe
    (spec non-goal — the unpaginated /all path doesn't route through the
    repo ``list``).
    """

    NOT_NULL_FIELDS = {"title", "description", "image_url", "specialty", "min_age", "duration", "record_info"}

    # GH #212 search matrix (spec §5.2): substring on title/description
    # (each field ilike'd separately), exact id equality when q parses as
    # a full UUID (deep-link prerequisite #216).
    search_fields = [
        SearchField(Service.title),
        SearchField(Service.description),
        SearchField(Service.id, kind="uuid"),
    ]

    def __init__(
        self, repository: ArchiveRepository, model: type[Service]
    ) -> None:
        super().__init__(repository, model, response_schema=ServiceResponse)

    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        status: ArchiveStatus = ArchiveStatus.ACTIVE,
        order_by=None,
        q: str | None = None,
        **filters,
    ) -> PaginatedResponse[ServiceResponse]:
        """Return services filtered by archive status, with tariffs and tags.

        Delegates to ``ArchiveRepository.list`` passing ``selectinload``
        options for ``tariffs``/``tags`` so ``ServiceResponse`` validation
        doesn't hit ``MissingGreenlet`` under async SQLAlchemy (spec §4.1).
        ``q`` (GH #212) narrows rows via the repo's ``search_predicate`` over
        ``self.search_fields`` before the COUNT (honest ``total``).
        ``self._repository`` is typed ``BaseRepository`` (inherited from
        ``GenericService.__init__``), but ``get_service_service()`` injects
        ``get_archive_repository()`` — an ``ArchiveRepository`` whose
        ``list()`` accepts ``status=``. The cast documents that runtime
        invariant without touching the factory (#206 Task 3).
        """
        items_orm, total = await cast(ArchiveRepository, self._repository).list(
            db_session,
            Service,
            status=status,
            filters=filters,
            q=q,
            search_fields=self.search_fields,
            order_by=order_by,
            limit=per_page,
            offset=(page - 1) * per_page,
            options=[selectinload(Service.tariffs), selectinload(Service.tags)],
        )
        items = [ServiceResponse.model_validate(s) for s in items_orm]
        return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)

    async def list_all(
        self,
        db_session: AsyncSession,
        order_by=None,
        status: ArchiveStatus = ArchiveStatus.ACTIVE,
        **filters,
    ) -> list[ServiceResponse]:
        """Unpaginated list of services with tariffs/tags eagerly loaded.

        Mirrors the ``list()`` override: the eager-load (``selectinload``) is
        MANDATORY because ``ServiceResponse`` nests tariffs and tags, and
        validating it from lazily-loaded relationships under async SQLAlchemy
        crashes with ``MissingGreenlet`` (spec §4.1). The base
        ``_list_stmt`` has no ``.options(...)``, so the override builds the
        select inline with the same archive-status + equality-filter clauses.
        Enforces ``BARE_LIST_MAX_ROWS`` via the LIMIT+1 probe.
        """
        stmt = select(Service).options(
            selectinload(Service.tariffs), selectinload(Service.tags)
        )
        if status == ArchiveStatus.ACTIVE:
            stmt = stmt.where(Service.is_active)
        elif status == ArchiveStatus.ARCHIVED:
            stmt = stmt.where(not_(Service.is_active))
        for key, value in filters.items():
            if value is not None:
                stmt = stmt.where(getattr(Service, key) == value)
        if order_by is not None:
            stmt = stmt.order_by(*order_by)
        result = await db_session.execute(stmt.limit(BARE_LIST_MAX_ROWS + 1))
        rows = list(result.scalars().all())
        if len(rows) > BARE_LIST_MAX_ROWS:
            raise BareListLimitExceededError(Service.__tablename__, BARE_LIST_MAX_ROWS)
        return [ServiceResponse.model_validate(s) for s in rows]

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
    return ServiceService(get_archive_repository(), Service)
