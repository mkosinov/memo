"""Business logic for service CRUD operations with nested tariffs and tags."""

from __future__ import annotations

from functools import lru_cache

from fastapi import HTTPException
from sqlalchemy import delete, not_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from src.domain.errors import BareListLimitExceededError
from src.errors import ErrorCode, ErrorDetail
from src.models.enums import ArchiveStatus
from src.models.material import Material
from src.models.service import Service
from src.models.service_material import ServiceMaterial
from src.models.tag import service_tags
from src.models.tariff import Tariff
from src.repositories.generic import ArchiveRepository, get_archive_repository
from src.repositories.search import SearchField, search_predicate
from src.schemas.common import PaginatedResponse
from src.schemas.service import (
    ServiceCreate,
    ServiceMaterialLinkIn,
    ServicePatch,
    ServiceResponse,
    ServiceUpdate,
)
from src.services.decorators import transactional
from src.services.generic import ArchiveService, BARE_LIST_MAX_ROWS


class ServiceService(ArchiveService[ServiceCreate, ServiceUpdate, ServiceResponse]):
    """Service service with eager-loaded tariffs/tags and nested create/update.

    ``list`` builds its statement inline (status + ``q`` + ``material_id``
    predicates + eager-load ``selectinload`` options for ``tariffs``/``tags``
    /``service_materials``) and rides the repo ``list_entity`` row core, so
    ``ServiceResponse`` validation doesn't hit ``MissingGreenlet`` under
    async SQLAlchemy (spec §4.1) and every predicate lands BEFORE the
    COUNT. ``list_all`` keeps its inline eager-load probe (spec non-goal —
    the unpaginated /all path doesn't route through the repo either).
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
        material_id: str | None = None,
        **filters,
    ) -> PaginatedResponse[ServiceResponse]:
        """Return services filtered by archive status, with tariffs and tags.

        Builds the statement inline (mirroring ``list_all``) and rides the
        repo ``list_entity`` row core: the eager-load ``selectinload``
        options for ``tariffs``/``tags``/``service_materials`` keep
        ``ServiceResponse`` validation off lazy loads under async SQLAlchemy
        (spec §4.1), and the COUNT runs on the predicate-bearing subquery so
        ``total`` always reflects every filter.

        ``q`` (GH #212) narrows rows via ``search_predicate`` over
        ``self.search_fields``.

        ``material_id`` (GH #223 spec §5) adds a join predicate —
        ``Service.id.in_(SELECT service_id FROM service_materials WHERE
        material_id = :material_id)`` — which CANNOT ride the generic repo
        ``filters`` dict (column-equality via ``getattr(table, key)``
        only, ``repositories/generic.py``); hence the inline statement.
        Unknown-but-valid id simply matches no rows (filter semantics).
        """
        stmt = select(Service).options(
            selectinload(Service.tariffs),
            selectinload(Service.tags),
            selectinload(Service.service_materials).joinedload(ServiceMaterial.material),
        )
        if status == ArchiveStatus.ACTIVE:
            stmt = stmt.where(Service.is_active)
        elif status == ArchiveStatus.ARCHIVED:
            stmt = stmt.where(not_(Service.is_active))
        if q is not None:
            stmt = stmt.where(search_predicate(q, self.search_fields))
        for key, value in filters.items():
            if value is not None:
                stmt = stmt.where(getattr(Service, key) == value)
        if material_id is not None:
            stmt = stmt.where(
                Service.id.in_(
                    select(ServiceMaterial.service_id).where(
                        ServiceMaterial.material_id == material_id
                    )
                )
            )
        items_orm, total = await self._repository.list_entity(
            db_session,
            stmt,
            order_by=order_by,
            limit=per_page,
            offset=(page - 1) * per_page,
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
        Enforces ``BARE_LIST_MAX_ROWS`` via the LIMIT+1 probe. Materials
        links are eager-loaded too (GH #223 spec §3.1).
        """
        stmt = select(Service).options(
            selectinload(Service.tariffs),
            selectinload(Service.tags),
            selectinload(Service.service_materials).joinedload(ServiceMaterial.material),
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
        """Return a service by ID with tariffs, tags, and materials, or None."""
        result = await db_session.execute(
            select(Service)
            .where(Service.id == id)
            .options(
                selectinload(Service.tariffs),
                selectinload(Service.tags),
                selectinload(Service.service_materials).joinedload(ServiceMaterial.material),
            )
        )
        return result.scalar_one_or_none()

    async def _replace_service_materials(
        self,
        db_session: AsyncSession,
        service_id: str,
        items: list[ServiceMaterialLinkIn],
    ) -> None:
        """Hard-replace the service's material links (GH #223 spec §4).

        Mirrors the tag replace loop, with two deliberate deviations:
        ids are pre-validated (unknown ``material_id`` → 422 VALIDATION_ERROR
        naming the ids — tags rely on the DB FK violation instead), and each
        link carries a ``note`` that normalizes whitespace-only text to NULL
        (spec §4). Duplicate ids within one list → 422 (the composite PK
        would reject them anyway; fail fast with a clearer message).
        """
        if not items:
            await db_session.execute(
                delete(ServiceMaterial).where(ServiceMaterial.service_id == service_id)
            )
            return

        ids = [i.material_id for i in items]
        if len(set(ids)) != len(ids):
            duplicates = sorted({mid for mid in ids if ids.count(mid) > 1})
            raise HTTPException(
                status_code=422,
                detail=ErrorDetail(
                    code=ErrorCode.VALIDATION_ERROR,
                    message=f"Duplicate material ids in 'materials': {', '.join(duplicates)}",
                ).model_dump(),
            )

        found = (
            await db_session.execute(select(Material.id).where(Material.id.in_(ids)))
        ).scalars().all()
        missing = set(ids) - set(found)
        if missing:
            raise HTTPException(
                status_code=422,
                detail=ErrorDetail(
                    code=ErrorCode.VALIDATION_ERROR,
                    message=f"Unknown material ids: {', '.join(sorted(missing))}",
                ).model_dump(),
            )

        await db_session.execute(
            delete(ServiceMaterial).where(ServiceMaterial.service_id == service_id)
        )
        for i in items:
            note = (i.note or "").strip() or None  # whitespace-only → NULL (spec §4)
            db_session.add(
                ServiceMaterial(
                    service_id=service_id, material_id=i.material_id, note=note
                )
            )

    @transactional
    async def create(
        self, db_session: AsyncSession, data: ServiceCreate
    ) -> Service:
        """Create service with nested tariffs, tag links, and material links."""
        tag_ids = data.tag_ids
        tariff_data = data.tariffs
        service_data = data.model_dump(exclude={"tariffs", "tag_ids", "materials"})

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

        # Link materials (GH #223 spec §4)
        if data.materials:
            await self._replace_service_materials(
                db_session, service.id, data.materials
            )

        await db_session.flush()
        return await self.get(db_session, service.id)

    @transactional
    async def update(
        self, db_session: AsyncSession, id: str, data: ServiceUpdate
    ) -> Service | None:
        """Full-update: replaces attributes, tariffs, tag links, and material links."""
        service = await self.get(db_session, id)
        if not service:
            return None

        tag_ids = data.tag_ids
        tariff_data = data.tariffs
        update_data = data.model_dump(exclude={"tariffs", "tag_ids", "materials"})

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

        # Materials: hard-replace ([] clears — same semantics as tag_ids, GH #223 §4)
        await self._replace_service_materials(db_session, id, data.materials)

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

        materials (GH #223 spec §4): absent/null → existing links preserved;
        sent (incl. []) → hard-replace; [] → clear all.
        """
        service = await self.get(db_session, id)
        if not service:
            return None

        data_dict = data.model_dump(exclude_unset=True)

        # Separate tag_ids, tariffs, and materials from scalar fields
        # (materials MUST be popped: Service.materials is a read-only property)
        tag_ids = data_dict.pop("tag_ids", None)
        tariffs_data = data_dict.pop("tariffs", None)
        data_dict.pop("materials", None)

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

        # Handle materials: sent (incl. []) → hard-replace; absent/null → preserve
        if data.materials is not None:
            await self._replace_service_materials(db_session, id, data.materials)

        await db_session.flush()
        db_session.expunge(service)
        return await self.get(db_session, id)


@lru_cache
def get_service_service() -> ServiceService:
    """Returns a singleton ServiceService."""
    return ServiceService(get_archive_repository(), Service)
