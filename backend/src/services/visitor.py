"""Business logic for visitor CRUD operations."""

from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING, cast

from sqlalchemy import delete, func, select

from src.events.emitter import mark_changed
from src.models.activity import Activity
from src.models.record import Record
from src.models.tag import visitor_tags
from src.models.visit import Visit
from src.models.visitor import Visitor
from src.repositories.generic import BaseRepository, get_base_repository
from src.repositories.search import SearchField, ids_in_predicate, search_predicate
from src.schemas.common import PaginatedResponse
from src.schemas.visitor import VisitorCreate, VisitorResponse, VisitorUpdate
from src.services.decorators import transactional
from src.services.generic import GenericService
from src.services.visit import get_visit_service

if TYPE_CHECKING:
    from collections.abc import Sequence
    from typing import Any
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession
    from sqlalchemy.sql.elements import ColumnElement

    from src.domain.sorting import SortExpr


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
        # GH #324 §5: the ``(Visitor, "visits")`` cascade handler reaches
        # the batch block ``delete_visits_by_visitor`` (bulk delete +
        # recompute of the affected records) through this attribute (the
        # ``_h_cascade_client_visitors`` DI precedent). The standalone
        # ``delete`` composes the brick itself (lazy factory call).
        self._visit_service = get_visit_service()

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
        order_by: Sequence[SortExpr] | None = None,
        q: str | None = None,
        ids: Sequence[UUID] | None = None,
        master_key: str | None = None,
        **filters: Any,
    ) -> PaginatedResponse[VisitorResponse]:
        """Return a paginated page of visitors, scoped + searched (GH #263 T2).

        The scope EXISTS-predicate, the ``q`` search predicate, the typed
        ``ids`` narrowing (GH #232 §3.1) and the generic ``**filters``
        equality narrowings all land BEFORE the COUNT, so ``total``
        reflects the filtered count (the generic list contract —
        ``id=`` etc. — keeps working on this override). ``order_by``
        applies after the count, like the repo core (#213).
        """
        stmt = select(Visitor)
        predicate = self._visibility_predicate(master_key)
        if predicate is not None:
            stmt = stmt.where(predicate)
        for key, value in filters.items():  # generic equality filters (contract)
            if value is not None:
                stmt = stmt.where(getattr(Visitor, key) == value)
        id_pred = ids_in_predicate(Visitor.id, ids)
        if id_pred is not None:
            stmt = stmt.where(id_pred)
        if q:
            stmt = stmt.where(search_predicate(q, self.search_fields or []))
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = (await db_session.execute(count_stmt)).scalar_one()
        if order_by is not None:
            stmt = stmt.order_by(*order_by)
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
        self,
        db_session: AsyncSession,
        client_id: str,
        master_key: str | None = None,
    ) -> Sequence[Visitor]:
        """Return all visitors for a given client.

        GH #263 T3-fix: for a scoped (master) caller the visitor
        visibility predicate (visits → records → activities of THIS
        master) narrows the result — an in-scope client may also carry
        visitors from another master's records, and those stay invisible
        (the T2 rule «посетитель без визитов мастера невидим»).
        ``master_key=None`` (admin) → unchanged, all visitors.
        """
        stmt = select(Visitor).where(Visitor.client_id == client_id)
        predicate = self._visibility_predicate(master_key)
        if predicate is not None:
            stmt = stmt.where(predicate)
        result = await db_session.execute(stmt)
        return list(result.scalars().all())

    async def _delete_cascade(
        self,
        db_session: AsyncSession,
        visitor_id: str,
        *,
        visitor: Visitor | None = None,
    ) -> bool:
        """Own-edge delete: visitor_tags join rows + the Visitor row — on
        the GIVEN session, WITHOUT committing (GH #327 Task 2).

        The visits of the visitor are NOT touched here: since #327 the
        visits table has ONE writer — the owner service brick
        ``VisitService.delete_visits_by_visitor`` →
        ``VisitRepository.delete_by_visitor_id`` (canon rule 1). The
        standalone ``delete`` composes that brick BEFORE this core;
        the future ``usecases.clients.delete_client`` scenario does the
        same inside its visitor-cascade loop.

        GH #380 ("one read per mutation"): the optional keyword-only
        ``visitor`` — the service's OWN row, already read in the same
        session/transaction by the caller (the standalone ``delete``
        reads it once for the journal label + before-snapshot, #344
        §4.1). Omitted/``None`` → the method loads the row itself,
        exactly as before (the client-cascade loop calls it two-arg).
        The name still does not reflect the full cascade shape — that
        price stays documented in #327 spec §8; the role lives in this
        docstring.

        GH #324 §5 (rebase): the brick now RECOMPUTES the affected
        records (seats/status) — every brick caller inherits the
        recompute through the shared ``delete_visits_by_visitor`` path;
        THIS core still touches only the own edge (tags + row).

        The visitor_tags join table has FKs with NO ondelete action, so
        its rows are removed BEFORE the visitor row — otherwise the DB
        raises IntegrityError (FK on) or leaves orphan rows (FK off).
        Photos are NOT touched: since GH #211 a photo is never
        visitor-owned (4-owner model: client|service|activity|location).

        Returns False if the visitor does not exist — either missing
        at the (self-performed) load, or, per the GH #380 rowcount
        parity, the visitor-row DELETE reported 0 affected rows (the
        row vanished between the caller's read and this core inside
        the same transaction window — the same False → 404 outcome
        the re-read used to produce). Does NOT commit — the caller
        owns the transaction boundary.

        Raises:
            ValueError: ``visitor`` is passed but its ``id`` does not
                match the requested ``visitor_id`` — a caller
                programming error (the row belongs to another
                visitor), not user input.
        """
        if visitor is not None:
            if visitor.id != visitor_id:
                raise ValueError(
                    f"_delete_cascade: visitor row id {visitor.id!r} does "
                    f"not match the requested visitor_id {visitor_id!r}"
                )
        else:
            visitor = await self._repository.get(db_session, Visitor, visitor_id)
            if not visitor:
                return False

        await db_session.execute(delete(visitor_tags).where(visitor_tags.c.visitor_id == visitor_id))
        result = await db_session.execute(delete(Visitor).where(Visitor.id == visitor_id))
        rowcount = int(cast("Any", result).rowcount)
        return rowcount > 0

    @transactional
    async def delete(self, db_session: AsyncSession, id: str) -> bool:
        """Hard-delete a visitor and cascade (visits, visitor_tags) inside one
        ``@transactional`` transaction.

        Composition (GH #327 Task 2): the owner-service visit brick runs
        FIRST (``get_visit_service().delete_visits_by_visitor(...)``
        — visits are removed before the visitor row disappears), then
        the own-edge ``_delete_cascade`` core (tags + row). Net DB
        effects are identical to the pre-#327 shape. Event grid (GH
        #375): the decorator's auto ``"visitors"`` mark PLUS
        ``"visits"`` — the brick's ``mark_visits`` default (rows died)
        and the dispatch-fact mark below (zero rows included) both
        name it; with visits present the recompute adds ``"records"``.

        GH #344 (§4.3): the standalone delete journals ONE ``delete`` row
        with the deleted visitor's label + before-snapshot (§9 scenario 6)
        staged BEFORE the row disappears — the raw-SQL cascade bypasses
        the repository, so this explicit mark is the row's only journal
        source. The Client→visitors cascade keeps using the bare
        ``_delete_cascade`` (cascade children never journal, §8).
        """
        # LAZY import + pre-read: the mark needs the label BEFORE the row
        # dies; a miss writes nothing (§4.1 — no row, no journal entry).
        from src.events.audit import derive_row_label, mark_audit, snapshot_pairs_before

        visitor = await self._repository.get(db_session, Visitor, id)
        if visitor is None:
            return False
        mark_audit(
            entity="visitors",
            action="delete",
            entity_id=id,
            entity_label=derive_row_label("visitors", visitor),
            changes=snapshot_pairs_before("visitors", visitor),
        )
        from src.services.visit import get_visit_service

        await get_visit_service().delete_visits_by_visitor(db_session, id)
        # GH #375: mark by dispatch fact — the brick publishes "visits"
        # only when rows die (a visit-less visitor early-exits), but the
        # dispatch itself is unconditional, so every delete names it.
        mark_changed("visits")
        # GH #380 ("one read per mutation"): the row read above for the
        # journal mark is handed DOWN to the core — no second SELECT
        # inside ``_delete_cascade``.
        return await self._delete_cascade(db_session, id, visitor=visitor)

    # ── GH #171 Task 2 — scenario building block (no transaction) ───────

    async def get_or_create_by_name(
        self,
        db_session: AsyncSession,
        client_id: str | None,
        name: str,
        age: int | None = None,
    ) -> Visitor:
        """Find the visitor by (client_id, name), or create one — WITHOUT
        committing.

        Non-transactional scenario building block for the usecases layer
        (canon docs/domain-rules/service-layer.md rules 3-4) — moved
        BEHAVIOR-FOR-BEHAVIOR from ``RecordService._resolve_visitor_by_name``
        (the future create_record scenario re-links it in Task 6): lookup
        by the exact (``client_id``, ``name``) pair; on a miss a visitor
        is created with the caller's ``age`` and flushed so ``id`` is
        populated. ``mark_changed("visitors")`` fires ONLY on the creation
        branch (GH #239 §3.3); outside an active transaction the mark is
        a no-op. Value-typed parameters — no foreign ORM/schema objects.
        """
        result = await db_session.execute(
            select(Visitor).where(
                Visitor.client_id == client_id,
                Visitor.name == name,
            )
        )
        visitor = result.scalar_one_or_none()
        if not visitor:
            visitor = Visitor(
                client_id=client_id,
                name=name,
                age=age,
            )
            db_session.add(visitor)
            await db_session.flush()
            # GH #239 §3.3: conditional mark — only when actually created
            mark_changed("visitors")
        return visitor


@lru_cache
def get_visitor_service() -> VisitorService:
    """Returns a singleton VisitorService."""
    return VisitorService(get_base_repository(), Visitor)
