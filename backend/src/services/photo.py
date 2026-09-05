"""Business logic for photo CRUD operations (GH #211 4-owner model)."""

from __future__ import annotations

from functools import lru_cache

from fastapi import HTTPException
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.models.activity import Activity
from src.models.client import Client
from src.models.photo import Photo, photo_tags
from src.models.tag import Tag
from src.repositories.generic import get_base_repository
from src.repositories.search import SearchField, search_predicate
from src.schemas.photo import (
    OWNER_FIELDS,
    PhotoCreate,
    PhotoListParams,
    PhotoPatch,
    PhotoResponse,
    PhotoUpdate,
)
from src.services.decorators import transactional
from src.services.generic import GenericService

# Sort whitelist (GH #211 §6.8): filename | is_public | created_at.
# FK columns and the denormalized client_name are NOT sortable.
_SORT_COLUMNS = {
    "filename": Photo.filename,
    "is_public": Photo.is_public,
    "created_at": Photo.created_at,
}


def _merged_owner_conflict(existing: Photo, changes: dict) -> str | None:
    """Merged-set owner guard (GH #211 §6.2).

    Combines the stored row with the applied payload fields (unset fields
    keep their stored value — the ``exclude_unset`` hole) across all 4
    owner FKs. Returns the active-owner list when the merged set has more
    than one owner, else ``None``. Used by BOTH ``update`` and ``patch``;
    ``create`` is covered by the payload validator on ``PhotoCreate``.
    """
    owners = {f: changes.get(f, getattr(existing, f)) for f in OWNER_FIELDS}
    active = [k for k, v in owners.items() if v is not None]
    return ", ".join(active) if len(active) > 1 else None


class PhotoService(GenericService[PhotoCreate, PhotoUpdate, PhotoResponse]):
    """Extended photo service with tag handling + paginated list."""

    NOT_NULL_FIELDS = {"filename", "is_public"}

    async def list(
        self, db_session: AsyncSession, params: PhotoListParams
    ) -> tuple[list[PhotoResponse], int]:
        """Paginated photo list riding the repo row core (GH #213 §5.2).

        Service owns stmt construction (q / filters / sort whitelist) and
        the Row→``PhotoResponse`` mapping — the denormalized
        ``client_name`` labeled column flows through the multi-column
        select unchanged. The repo core (``BaseRepository.list_custom``)
        owns count (computed on the UNordered stmt — the count-order
        deviation is fixed by construction), order, and the limit/offset
        slice; ordering arrives via its ``order_by=`` parameter (the
        ``RecordService.list`` convention).

        Returns ``(items, total)``; the router assembles the
        ``PaginatedResponse`` envelope echoing the client's page/per_page.
        """
        client_name = select(Client.name).where(Client.id == Photo.client_id).scalar_subquery()
        stmt = select(Photo, client_name.label("client_name")).options(selectinload(Photo.tags))

        conds = []
        if params.q is not None:
            conds.append(search_predicate(params.q, [SearchField(column=Photo.filename, kind="substring")]))
        if params.client_id is not None:
            conds.append(Photo.client_id == params.client_id)
        if params.location_id is not None:
            conds.append(Photo.location_id == params.location_id)
        if params.activity_id is not None:
            conds.append(Photo.activity_id == params.activity_id)
        if params.service_id is not None:
            # variant A: direct OR via activity — LEFT OUTER JOIN required
            # (an INNER JOIN would drop direct-service photos; 1:0..1, so
            # the count stays honest — spec #211 §6.7).
            stmt = stmt.outerjoin(Activity, Activity.id == Photo.activity_id)
            conds.append(or_(Photo.service_id == params.service_id,
                             Activity.service_id == params.service_id))
        if params.tag_id:
            for t in dict.fromkeys(params.tag_id):          # dedupe, keep order
                conds.append(Photo.tags.any(Tag.id == t))   # per-tag EXISTS, AND-chained
        if conds:
            stmt = stmt.where(*conds)

        col = _SORT_COLUMNS[params.sort_by]
        order_exprs = [
            col.desc() if params.sort_order == "desc" else col.asc(),
            Photo.id.asc(),
        ]
        rows, total = await self._repository.list_custom(
            db_session,
            stmt,
            order_by=order_exprs,
            limit=params.per_page,
            offset=(params.page - 1) * params.per_page,
        )

        items = []
        for photo, name in rows:
            resp = PhotoResponse.model_validate(photo)
            resp.client_name = name
            items.append(resp)
        return items, total

    async def get(
        self, db_session: AsyncSession, id: str
    ) -> PhotoResponse | None:
        """Return a single photo with tags eagerly loaded."""
        stmt = (
            select(Photo)
            .where(Photo.id == id)
            .options(selectinload(Photo.tags))
        )
        result = await db_session.execute(stmt)
        orm = result.scalar_one_or_none()
        if orm is None:
            return None
        return self._response_schema.model_validate(orm)

    @transactional
    async def create(
        self, db_session: AsyncSession, data: PhotoCreate
    ) -> PhotoResponse:
        """Create a new photo with tag links.

        Owner fields (client/service/activity/location) come straight from
        the payload — the ``PhotoCreate`` validator already guarantees at
        most one owner (GH #211 §6.2), matching the DB CHECK constraint.

        tag_ids: link via the photo_tags join table directly (NOT the ORM
        relationship), because ``orm.tags = list(tags)`` triggers a lazy load
        on AsyncSession and crashes with MissingGreenlet.
        """
        # Extract tag_ids before creating photo
        tag_ids = data.tag_ids

        # Create ORM instance directly (the generic repository create expects
        # BaseModel but PhotoCreate includes tag_ids which Photo doesn't have)
        orm = Photo(
            filename=data.filename,
            client_id=data.client_id,
            service_id=data.service_id,
            activity_id=data.activity_id,
            location_id=data.location_id,
            is_public=data.is_public,
        )
        db_session.add(orm)
        await db_session.flush()
        await db_session.refresh(orm)

        # Link tags via the join table directly (avoids async lazy-load bug)
        for tid in tag_ids or []:
            await db_session.execute(
                photo_tags.insert().values(photo_id=orm.id, tag_id=tid)
            )
        await db_session.flush()

        # Reload with tags
        return await self.get(db_session, orm.id)

    @transactional
    async def update(
        self, db_session: AsyncSession, id: str, data: PhotoUpdate
    ) -> PhotoResponse | None:
        """Full-update: replace scalar fields and tag links.

        Merged-set owner check runs BEFORE any field is applied: a payload
        carrying a single owner can still collide with owners already on
        the row (the ``exclude_unset`` hole — GH #211 §6.2).

        tag_ids: handled via the photo_tags join table (not the ORM
        relationship) to avoid the async lazy-load bug.
        """
        orm = await self._repository.get(db_session, Photo, id)
        if orm is None:
            return None

        # Update scalar fields (exclude tag_ids)
        update_data = data.model_dump(exclude={'tag_ids'}, exclude_unset=True)

        conflict = _merged_owner_conflict(orm, update_data)
        if conflict:
            raise HTTPException(
                status_code=422,
                detail=f"photo may have at most one owner; got: {conflict}",
            )

        for key, value in update_data.items():
            setattr(orm, key, value)

        # Replace tag links via the join table if tag_ids was sent
        if data.tag_ids is not None:
            await db_session.execute(
                delete(photo_tags).where(photo_tags.c.photo_id == id)
            )
            for tid in data.tag_ids:
                await db_session.execute(
                    photo_tags.insert().values(photo_id=id, tag_id=tid)
                )

        await db_session.flush()
        # Reload with tags eagerly loaded
        return await self.get(db_session, id)

    @transactional
    async def patch(
        self, db_session: AsyncSession, id: str, data: PhotoPatch
    ) -> PhotoResponse | None:
        """Partial-update a photo — only sent fields are changed.

        Scalar fields: applied via exclude_unset. NOT NULL fields
        with null values are silently stripped.

        Merged-set owner check runs BEFORE any field is applied
        (GH #211 §6.2): ``PhotoPatch`` has no payload validator because
        PATCH semantics need the merged field set (payload + stored row).

        tag_ids: if sent → hard-replace all tag links via the photo_tags
        join table. If not sent → existing tag links are preserved.
        """
        orm = await self._repository.get(db_session, Photo, id)
        if orm is None:
            return None

        data_dict = data.model_dump(exclude_unset=True)

        # Separate tag_ids from scalar fields
        tag_ids = data_dict.pop("tag_ids", None)

        # Strip NOT NULL fields sent as null
        for field in self.NOT_NULL_FIELDS:
            if field in data_dict and data_dict[field] is None:
                del data_dict[field]

        conflict = _merged_owner_conflict(orm, data_dict)
        if conflict:
            raise HTTPException(
                status_code=422,
                detail=f"photo may have at most one owner; got: {conflict}",
            )

        # Apply scalar fields
        for key, value in data_dict.items():
            setattr(orm, key, value)

        # Handle tag_ids via the join table directly
        if tag_ids is not None:
            await db_session.execute(
                delete(photo_tags).where(photo_tags.c.photo_id == id)
            )
            for tid in tag_ids:
                await db_session.execute(
                    photo_tags.insert().values(photo_id=id, tag_id=tid)
                )

        await db_session.flush()
        # Reload with tags eagerly loaded
        return await self.get(db_session, id)


@lru_cache
def get_photo_service() -> PhotoService:
    return PhotoService(get_base_repository(), Photo, PhotoResponse)
