"""Business logic for visitor CRUD operations."""

from collections.abc import Sequence
from functools import lru_cache

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from src.models.activity import Activity
from src.models.record import Record
from src.models.tag import visitor_tags
from src.models.visit import Visit
from src.models.visitor import Visitor
from src.repositories.generic import BaseRepository, get_base_repository
from src.repositories.search import SearchField, search_predicate
from src.schemas.common import PaginatedResponse
from src.schemas.visitor import VisitorCreate, VisitorResponse, VisitorUpdate
from src.services.decorators import transactional
from src.services.generic import GenericService


class VisitorService(GenericService[VisitorCreate, VisitorUpdate, VisitorResponse]):
    """Visitor service with client-based filtering."""

    NOT_NULL_FIELDS = {"name"}

    # GH #212 search matrix (spec §5.2): substring on ``name``, exact id
    # equality when q parses as a full UUID (deep-link prerequisite #216).
    search_fields = [SearchField(Visitor.name), SearchField(Visitor.id, kind="uuid")]

    def __init__(
        self, repository: BaseRepository, model: type[Visitor]
    ) -> None:
        super().__init__(repository, model, response_schema=VisitorResponse)

    @staticmethod
    def _visibility_predicate(
        master_key: str | None,
    ) -> ColumnElement[bool] | None:
        """Scope predicate for visitors (GH #263 T2, «всё через записи»).

        A visitor is visible to a scoped master iff he has at least one
        visit on one of the master's records (EXISTS visits → records →
        activities where ``master_id`` = the key) — a visitor without the
        master's visits is invisible. ``None`` (admin) → no predicate.
        Returns the EXISTS clause (or ``None`` when unscoped).
        """
        if master_key is None:
            return None
        chain = (
            select(Visit.id)
            .join(Record, Visit.record_id == Record.id)
            .join(Activity, Record.activity_id == Activity.id)
            .where(
                Visit.visitor_id == Visitor.id,
                Activity.master_id == master_key,
            )
            .exists()
        )
        return chain

    async def get_scoped(
        self, db_session: AsyncSession, id: str, master_key: str | None
    ) -> VisitorResponse | None:
        """Point get with the per-master scope in ONE query (GH #263 T2).

        The EXISTS visibility predicate folds into the same SELECT —
        чужой visitor is indistinguishable from missing (``None`` → the
        route renders 404; 404-fast-path, plan T7).
        """
        stmt = select(Visitor).where(Visitor.id == id)
        predicate = self._visibility_predicate(master_key)
        if predicate is not None:
            stmt = stmt.where(predicate)
        visitor = (await db_session.execute(stmt)).scalar_one_or_none()
        if visitor is None:
            return None
        return VisitorResponse.model_validate(visitor)

    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        q: str | None = None,
        master_key: str | None = None,
        **filters: object,
    ) -> PaginatedResponse[VisitorResponse]:
        """Return a paginated page of visitors, scoped + searched (GH #263 T2).

        The scope EXISTS-predicate, the ``q`` search predicate and the
        generic ``**filters`` equality narrowings all land BEFORE the
        COUNT, so ``total`` reflects the filtered count (the generic
        list contract — ``id=`` etc. — keeps working on this override).
        """
        stmt = select(Visitor)
        predicate = self._visibility_predicate(master_key)
        if predicate is not None:
            stmt = stmt.where(predicate)
        for key, value in filters.items():  # generic equality filters (contract)
            if value is not None:
                stmt = stmt.where(getattr(Visitor, key) == value)
        if q:
            stmt = stmt.where(search_predicate(q, self.search_fields or []))
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = (await db_session.execute(count_stmt)).scalar_one()
        rows = await db_session.execute(
            stmt.limit(per_page).offset((page - 1) * per_page)
        )
        items_orm = list(rows.scalars().all())
        items = [VisitorResponse.model_validate(o) for o in items_orm]
        return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)

    async def client_is_scoped_visible(
        self, db_session: AsyncSession, client_id: str, master_key: str | None
    ) -> bool:
        """GH #263 T2 — visitor-create context gate («свои записи»).

        A scoped master may create a visitor only for a client visible in
        his scope: EXISTS a record of this client to the master's activity
        (the client-scope rule of T3, surfaced here for the standalone
        visitor POST). ``master_key=None`` (admin) → True.
        """
        if master_key is None:
            return True
        stmt = (
            select(Record.id)
            .join(Activity, Record.activity_id == Activity.id)
            .where(
                Record.client_id == client_id,
                Activity.master_id == master_key,
            )
            .limit(1)
        )
        return (await db_session.execute(stmt)).scalar_one_or_none() is not None

    async def list_by_client(
        self, db_session: AsyncSession, client_id: str
    ) -> Sequence[Visitor]:
        """Return all visitors for a given client."""
        result = await db_session.execute(
            select(Visitor).where(Visitor.client_id == client_id)
        )
        return list(result.scalars().all())

    async def _delete_cascade(self, db_session: AsyncSession, visitor_id: str) -> bool:
        """Hard-delete a visitor and its visits; delete visitor_tags join
        rows — on the GIVEN session, WITHOUT committing.

        Extracted (Task 7 of #207) from ``delete`` so ``ClientService`` can call
        this inside its OWN ``@transactional`` outer cascade loop on a SHARED
        session — atomicity with ONE commit at the outer boundary, not N
        mid-loop commits (§8 atomicity requirement — BLOCKER-class).

        All cascade deletes run as explicit SQL inside the caller's transaction.
        Visits are removed BEFORE the visitor (visits reference visitors via FK).
        The visitor_tags join table has FKs with NO ondelete action, so its rows
        must be removed BEFORE the visitor — otherwise the DB raises
        IntegrityError (FK on) or leaves orphan rows (FK off). Photos are NOT
        touched: since GH #211 a photo is never visitor-owned (4-owner model:
        client|service|activity|location).

        Returns False if the visitor does not exist. Does NOT commit — the
        caller owns the transaction boundary.
        """
        visitor = await self._repository.get(db_session, Visitor, visitor_id)
        if not visitor:
            return False

        await db_session.execute(delete(Visit).where(Visit.visitor_id == visitor_id))
        await db_session.execute(delete(visitor_tags).where(visitor_tags.c.visitor_id == visitor_id))
        await db_session.execute(delete(Visitor).where(Visitor.id == visitor_id))
        return True

    @transactional
    async def delete(self, db_session: AsyncSession, id: str) -> bool:
        """Hard-delete a visitor and cascade (visits, visitor_tags) inside one
        ``@transactional`` transaction.

        Thin decorated wrapper around the non-decorated ``_delete_cascade``
        core (Task 7 of #207) so standalone ``VisitorService.delete`` still
        commits exactly as before — existing callers are unaffected.
        ``ClientService`` reuses ``_delete_cascade`` directly on a shared outer
        session (Task 10) keeping the Client→visitors cascade atomic.
        """
        return await self._delete_cascade(db_session, id)


@lru_cache
def get_visitor_service() -> VisitorService:
    """Returns a singleton VisitorService."""
    return VisitorService(get_base_repository(), Visitor)
