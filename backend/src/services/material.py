"""Business logic for material CRUD operations."""

# Class-body annotations reference the builtin ``list`` AFTER a method named
# ``list`` is defined in the same class body — string annotations (PEP 563)
# keep ``list[MaterialResponse]`` resolving to the builtin, not the method
# (same idiom as ``services/generic.py``).
from __future__ import annotations

from functools import lru_cache

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.enums import ArchiveStatus
from src.models.material import Material
from src.models.service import Service
from src.models.service_material import ServiceMaterial
from src.repositories.generic import get_archive_repository
from src.repositories.search import SearchField
from src.schemas.common import PaginatedResponse
from src.schemas.material import MaterialCreate, MaterialResponse, MaterialUpdate
from src.services.generic import ArchiveService


class MaterialService(ArchiveService[MaterialCreate, MaterialUpdate, MaterialResponse]):
    """Material service with NOT NULL field protection on PATCH.

    Adds the canonical ``used_in_services_count`` aggregate (GH #223 §6):
    the number of NON-ARCHIVED services linked to the material — one
    definition regardless of the request's ``status`` slice (the counter
    describes the material, not the requested list). Attached on every
    read path (``list`` / ``list_all`` / ``get``) and after
    ``update``/``patch`` returns via one shared helper: a single
    JOIN + GROUP BY aggregate for the whole page (no N+1).
    ``ArchiveService.archive``/``restore`` return ``bool``; the router's
    refetch goes through ``get`` → counts attached there. ``create``
    returns 0 by definition (schema default).
    """

    NOT_NULL_FIELDS = {"title", "description"}

    # GH #212 search matrix (spec §5.2): substring on title/description
    # (each field ilike'd separately), exact id equality when q parses as
    # a full UUID (deep-link prerequisite #216).
    search_fields = [
        SearchField(Material.title),
        SearchField(Material.description),
        SearchField(Material.id, kind="uuid"),
    ]

    async def _attach_counts(
        self, db_session: AsyncSession, materials: list[MaterialResponse]
    ) -> None:
        """Attach ``used_in_services_count`` in place (spec §6, canonical).

        One aggregate query for the whole batch:

            SELECT material_id, COUNT(*) FROM service_materials
            JOIN services ON services.id = service_materials.service_id
                 AND services.is_active = 1
            WHERE material_id IN (…page ids…)
            GROUP BY material_id

        Materials with no linked ACTIVE services are absent from the result
        → keep the schema default 0. Early-returns on an empty batch.
        """
        if not materials:
            return
        stmt = (
            select(ServiceMaterial.material_id, func.count())
            .join(Service, Service.id == ServiceMaterial.service_id)
            .where(Service.is_active)
            .where(ServiceMaterial.material_id.in_([m.id for m in materials]))
            .group_by(ServiceMaterial.material_id)
        )
        result = await db_session.execute(stmt)
        counts = {material_id: count for material_id, count in result.all()}
        for material in materials:
            material.used_in_services_count = counts.get(material.id, 0)

    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        order_by=None,
        status: ArchiveStatus = ArchiveStatus.ACTIVE,
        q: str | None = None,
        **filters,
    ) -> PaginatedResponse[MaterialResponse]:
        """Paginated list with the usage counter attached to every item."""
        paginated = await super().list(
            db_session,
            page=page,
            per_page=per_page,
            order_by=order_by,
            status=status,
            q=q,
            **filters,
        )
        await self._attach_counts(db_session, paginated.items)
        return paginated

    async def list_all(
        self,
        db_session: AsyncSession,
        order_by=None,
        status: ArchiveStatus = ArchiveStatus.ACTIVE,
        **filters,
    ) -> list[MaterialResponse]:
        """Bare /all list with the usage counter attached to every item."""
        items = await super().list_all(
            db_session, order_by=order_by, status=status, **filters
        )
        await self._attach_counts(db_session, items)
        return items

    async def get(
        self, db_session: AsyncSession, id: str
    ) -> MaterialResponse | None:
        """Single material with the usage counter attached."""
        material = await super().get(db_session, id)
        if material is None:
            return None
        await self._attach_counts(db_session, [material])
        return material

    async def update(
        self, db_session: AsyncSession, id: str, data: MaterialUpdate
    ) -> MaterialResponse | None:
        """Full update; the response re-attaches the usage counter."""
        material = await super().update(db_session, id, data)
        if material is None:
            return None
        await self._attach_counts(db_session, [material])
        return material

    async def patch(
        self, db_session: AsyncSession, id: str, data: BaseModel
    ) -> MaterialResponse | None:
        """Partial update; the response re-attaches the usage counter."""
        material = await super().patch(db_session, id, data)
        if material is None:
            return None
        await self._attach_counts(db_session, [material])
        return material


@lru_cache
def get_material_service() -> MaterialService:
    return MaterialService(get_archive_repository(), Material, MaterialResponse)
