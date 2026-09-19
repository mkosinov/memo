"""Record scenarios — multi-entity business actions around a record.

GH #171 Task 3 — the ``usecases`` layer, Corridor 2 of the service canon
(docs/domain-rules/service-layer.md rule 2): each scenario is a public
function named after the business action, decorated ``@transactional``
(ONE transaction + ONE event batch per action), composing service calls
and domain functions only — no direct ORM-model imports here.

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

Behavior-preserving extraction of the former ``RecordService.create``
chain (step order, conditional cache marks, and status derivation are
byte-identical to the pre-refactor flow).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from src.domain.record_visits import (
    check_activity_capacity,
    recompute_record_seats,
    recompute_record_status,
)
from src.events.emitter import mark_changed
from src.services.client import get_client_service
from src.services.decorators import transactional
from src.services.record import get_record_service
from src.services.visit import get_visit_service
from src.services.visitor import get_visitor_service

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from src.models.record import Record
    from src.schemas.record import RecordCreate


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
    # Transient row construction only (Task-2 contract: the batch rows
    # are the caller's own) — the table command itself lives in the
    # owner repository behind VisitService.create_visits_bulk.
    from src.models.visit import Visit

    visits = [
        Visit(
            record_id=record.id,
            visitor_id=visitor_ids[i],
            # GH #257 US1: the booking tail's default tariff rides on the
            # VisitItem — persist it (parity with the PUT path).
            tariff_id=item.tariff_id,
            price=item.price,
            custom_price=item.custom_price,
            status=item.status.value,
        )
        for i, item in enumerate(data.visits)
    ]
    await get_visit_service().create_visits_bulk(db_session, visits)

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
