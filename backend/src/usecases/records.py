"""Record scenarios — multi-entity business actions around a record.

GH #171 Task 3 — the ``usecases`` layer, Corridor 2 of the service canon
(docs/domain-rules/service-layer.md rule 2): each scenario is a public
function named after the business action, decorated ``@transactional``
(ONE transaction + ONE event batch per action), composing service calls
and domain functions only — no RUNTIME ORM-model imports here (the only
model reference is the TYPE_CHECKING-only return annotation; ORM rows
are built by the owning services — GH #171 Task 3 fix: the visit batch
is passed to ``VisitService.create_visits_bulk`` as ``VisitItem``
VALUES, never as transient ORM rows).

CALLING CONVENTION: the ``@transactional`` wrapper's signature is
``wrapper(self, *args, **kwargs)`` — a module-level scenario therefore
MUST be called with an explicit leading ``None`` (the unused ``self``
slot) and keyword arguments::

    record = await create_record(None, db_session=session, data=data)

A bare positional call ``create_record(session, data)`` would bind the
session to the wrapper's ``self`` slot and shift every argument —
that misdirection fails loudly (TypeError), never silently. The
selfless path opens the accumulator EMPTY — no auto entity-mark — so
the scenario marks its OWN entity explicitly
(``mark_changed("records")``) to keep the published event grid
byte-identical to the former method-based ``RecordService.create``.

Behavior-preserving extraction of the former ``RecordService.create`` /
``RecordService.update`` / ``RecordService.patch`` chains (step order,
conditional cache marks, and status derivation are byte-identical to the
pre-refactor flow).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from src.domain.record_visits import (
    check_activity_capacity,
    recompute_record_seats,
    recompute_record_status,
)
from src.events.emitter import mark_changed
from src.schemas.record import VisitItem
from src.services.client import get_client_service
from src.services.decorators import transactional
from src.services.record import get_record_service
from src.services.visit import get_visit_service
from src.services.visitor import get_visitor_service

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from src.models.record import Record
    from src.schemas.record import RecordCreate, RecordPatch, RecordUpdate


@transactional
async def create_record(
    db_session: AsyncSession,
    data: RecordCreate,
) -> Record:
    """Create a record with nested visits — the whole booking chain.

    Formerly ``RecordService.create`` (behavior-for-behavior move, GH #171
    Task 3). Step order, cache marks, and recalculation timing are
    identical to the pre-refactor flow:

    0. mark the own entity ("records") — parity with the auto-mark the
       decorator used to seed via ``RecordService``;
    1. capacity check (domain rule — 409 over capacity, rollback);
    2. find-or-create the client by phone (marks "clients" on create);
    3. per-visit visitor resolution: name → find-or-create (marks
       "visitors" on create), visitor_id → link, else anonymous;
    4. record row (status "pending", seats initialized to len(visits));
    5. ONE bulk visit insert (marks "visits");
    6. recalculate seats then status from the persisted visits, refresh.

    NOTE: call as ``create_record(None, db_session=..., data=...)`` —
    see the module docstring for why.
    """
    # Own-entity mark — the selfless @transactional path seeds an EMPTY
    # accumulator (no auto-mark), so publish parity with the former
    # RecordService.create (auto-marked "records") requires this here.
    mark_changed("records")

    # ── Capacity check ─────────────────────────────────────────────
    effective_seats = len(data.visits)
    await check_activity_capacity(db_session, data.activity_id, seats=effective_seats)

    # ── Resolve client ──────────────────────────────────────────────
    client = None
    if data.phone:
        first_name = data.visits[0].name if data.visits else None
        client = await get_client_service().get_or_create_by_phone(
            db_session,
            data.phone,
            name=first_name,
        )

    # ── Resolve visitors (name-based, ID-based, or anonymous) ───────
    visitor_service = get_visitor_service()
    visitor_ids: list[str | None] = []
    for item in data.visits:
        if item.name:
            # Name-based flow: find-or-create Visitor
            visitor = await visitor_service.get_or_create_by_name(
                db_session,
                client_id=client.id if client else data.client_id,
                name=item.name,
                age=item.age,
            )
            visitor_ids.append(visitor.id)
        elif item.visitor_id:
            # ID-based flow: use existing Visitor directly
            visitor_ids.append(item.visitor_id)
        else:
            # Anonymous visit — no visitor linked
            visitor_ids.append(None)

    # ── Create Record row (status derived after visits flush) ──────
    record = await get_record_service().create_row(
        db_session,
        activity_id=data.activity_id,
        client_id=client.id if client else data.client_id,
        seats=effective_seats,
        comment=data.comment,
        custom_price=data.custom_price,
    )

    # ── Create Visits — ONE bulk insert (marks "visits") ────────────
    # Value payloads only (canon rule 2): visitor resolution replaces the
    # item's visitor_id (name-flow resolved an id; id/anonymous flows keep
    # theirs/None). The SERVICE builds its own ORM rows behind
    # VisitService.create_visits_bulk.
    visit_items = [
        item.model_copy(update={"visitor_id": visitor_ids[i]})
        for i, item in enumerate(data.visits)
    ]
    await get_visit_service().create_visits_bulk(
        db_session, record.id, visit_items,
    )

    # ── Recompute seats and status from actual visits ────────────────
    # Route final persisted seats through recompute_record_seats so
    # create/update/patch all share the same single source of truth
    # (US-8). The inline ``seats=effective_seats`` above is only an
    # initial value before the visits are flushed; after the flush
    # we always recompute from the DB.
    await recompute_record_seats(db_session, record.id)
    await recompute_record_status(db_session, record.id)
    await db_session.refresh(record)
    return record


@transactional
async def update_record(
    db_session: AsyncSession,
    id: str,
    data: RecordUpdate,
) -> Record | None:
    """Full-update a record (PUT semantics) — replace visits, recalc seats.

    Formerly ``RecordService.update`` (behavior-for-behavior move, GH #171
    Task 4). Step order, capacity semantics, and recalculation timing are
    identical to the pre-refactor flow:

    0. mark the own entity ("records") — selfless @transactional parity;
    1. ``RecordService.update_row`` — load the row (missing id → None; the
       route maps that to 404) and apply the PUT scalar writes +
       ``updated_at``;
    2. DELETE the record's own visits (so they don't self-count);
    3. recompute seats (→ 0) — CRITICAL interleaving: the capacity check
       sums the stored ``seats`` COLUMN, so without this reset the sum
       still carries the record's stale old seats → double-count → a
       shrink (US-6) would falsely 409;
    4. capacity check (409 over capacity → rollback restores the old visits);
    5. insert the new batch (ONE bulk, marks "visits") — ``visitor_id`` is
       carried VERBATIM from the items (today's update flow performs NO
       client/visitor find-or-create; unlike create, a name-bearing item
       links nothing — anonymous unless ``visitor_id`` is sent);
    6. recompute seats + status from the persisted visits, refresh.

    NOTE: call as ``update_record(None, db_session=..., id=..., data=...)``
    — see the module docstring for why.
    """
    # Own-entity mark — selfless @transactional parity (see create_record).
    mark_changed("records")

    # ── Scalar writes (own-entity row op; missing id → None) ────────
    record = await get_record_service().update_row(
        db_session,
        id,
        activity_id=data.activity_id,
        client_id=data.client_id,
        comment=data.comment,
        custom_price=data.custom_price,
    )
    if not record:
        return None

    # ── Visit replacement — STRICT order (delete → recompute → check →
    #    insert). Inserting before recomputing would double-count the
    #    record's own seats in the capacity check. ─────────────────────
    await get_visit_service().delete_visits_by_record(db_session, record.id)
    await recompute_record_seats(db_session, record.id)

    effective_seats = len(data.visits)
    await check_activity_capacity(
        db_session, data.activity_id, seats=effective_seats,
    )

    # ── ONE bulk insert (value payloads only) — visitor_id verbatim ──
    await get_visit_service().create_visits_bulk(db_session, record.id, data.visits)

    # ── Recompute from actual visits ─────────────────────────────────
    await recompute_record_seats(db_session, record.id)
    await recompute_record_status(db_session, record.id)
    await db_session.refresh(record)
    return record


@transactional
async def patch_record(
    db_session: AsyncSession,
    id: str,
    data: RecordPatch,
) -> Record | None:
    """Partial-update a record — only fields explicitly sent are changed.

    Formerly ``RecordService.patch`` (behavior-for-behavior move, GH #171
    Task 4). Step order, ``seats_changed`` guard, and recalculation timing
    are identical to the pre-refactor flow:

    0. mark the own entity ("records") — selfless @transactional parity;
    1. ``RecordService.patch_row`` — load the row (missing id → None; the
       route maps that to 404) and apply ONLY the sent scalar fields
       (``comment`` / ``custom_price``) + ``updated_at``;
    2. when ``visits`` is provided (``seats_changed``): delete → recompute
       seats → capacity check (same interleaving as update_record) — a
       patch of only comment/custom_price skips the capacity query;
    3. insert the new batch (ONE bulk, marks "visits") — visits not
       provided → untouched; ``visitor_id`` carried verbatim (no
       find-or-create, same as today's patch flow);
    4. recompute seats + status, refresh.

    NOTE: call as ``patch_record(None, db_session=..., id=..., data=...)``
    — see the module docstring for why.
    """
    # Own-entity mark — selfless @transactional parity (see create_record).
    mark_changed("records")

    update_data = data.model_dump(exclude_unset=True)
    scalar_fields = {
        key: update_data[key] for key in ("comment", "custom_price") if key in update_data
    }

    # ── Scalar writes (own-entity row op; missing id → None) ────────
    record = await get_record_service().patch_row(db_session, id, scalar_fields)
    if not record:
        return None

    # ── Visit replacement (only when seats may change) — STRICT order:
    #    delete → recompute → check (same interleaving as update_record). ──
    if "visits" in update_data:
        await get_visit_service().delete_visits_by_record(db_session, record.id)
        await recompute_record_seats(db_session, record.id)
        effective_seats = len(update_data["visits"])
        await check_activity_capacity(
            db_session, record.activity_id, seats=effective_seats,
        )
        # ── ONE bulk insert — re-coerce the dumped dicts into VisitItem
        #    values (canon rule 2; identical field mapping to today's
        #    row-by-row build, incl. the WAITING status default). ──────
        patch_items = [
            VisitItem(**raw) if isinstance(raw, dict) else raw
            for raw in update_data["visits"]
        ]
        await get_visit_service().create_visits_bulk(
            db_session, record.id, patch_items,
        )

    # ── Recompute from actual active visits ──────────────────────────
    await recompute_record_seats(db_session, record.id)
    await recompute_record_status(db_session, record.id)
    await db_session.refresh(record)
    return record
