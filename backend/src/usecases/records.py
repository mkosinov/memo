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
``RecordService.update`` / ``RecordService.patch`` chains (step order and
status derivation are byte-identical to the pre-refactor flow).

EVENT GRID (GH #239), pinned by
``tests/usecases/test_records_update_patch.py`` — the rule is:
``"records"`` ALWAYS; ``"visits"`` ADDITIONALLY when the visit
collection was actually (re)populated:

- ``create_record`` — ``{"records", "visits"}`` (visits are created);
- ``update_record`` / ``patch_record`` with a NON-EMPTY ``visits`` list —
  ``{"records", "visits"}``: a real replacement touches both entities;
- ``update_record`` with an EMPTY list / ``patch_record`` without
  ``visits`` (or with an empty list) — exactly ``{"records"}``: a
  field-only update keeps the pre-refactor grid (the visit helpers are
  still invoked — the mandatory interleaving — but with
  ``mark_visits=False`` their "visits" marks are suppressed).
"""

from __future__ import annotations

from typing import Any, TYPE_CHECKING

from src.domain.deletion import (
    BlockingDepsError,
    InvalidResolutionError,
    StaleDependenciesError,
    collect_dependencies,
    collect_dependency_ids,
    has_blocking_deps,
    stale_expected_entities,
    validate_resolutions,
)
from src.domain.record_visits import (
    check_activity_capacity,
    recompute_record_seats,
    recompute_record_status,
)
from src.events.emitter import mark_changed
from src.schemas.record import VisitItem
from src.services.client import get_client_service
from src.services.decorators import transactional
from src.services.payment import get_payment_service
from src.services.record import get_record_service
from src.services.visit import get_visit_service
from src.services.visitor import get_visitor_service

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from src.models.record import Record
    from src.schemas.record import RecordCreate, RecordPatch, RecordUpdate


# ─── GH #344 — explicit journal marks for the record scenarios (§4.3) ─────────

# Update-diff carriers: the scenario's own scalar writes + the recompute
# fields (seats/status). ``comment`` participates in CHANGE DETECTION (a
# comment-only edit is a real action) but never enters the journaled
# pairs (free text, §5.1); ``updated_at`` is bookkeeping, never journaled.
_RECORD_DIFF_FIELDS = (
    "activity_id", "client_id", "custom_price", "seats", "status", "comment",
)


def _mark_record_audit(
    record: Record,
    action: str,
    changes: dict[str, Any] | None = None,
) -> None:
    """Stage the record's own journal row (spec §4.3).

    LAZY audit import — cycle discipline (usecases sit inside the
    services walk graph, see ``src/events/entities.py`` WARNING). The
    cascade visits/payments are never journaled (§4.2 "one action — one
    row"); the deferred-delete commit marks here, next to
    ``mark_changed("records")``, BEFORE the record row disappears (§4.5).
    """
    from src.events.audit import mark_audit

    mark_audit(
        entity="records",
        action=action,
        entity_id=record.id,
        changes=changes,
    )


def _record_diff(
    old: dict[str, Any], record: Record
) -> tuple[dict[str, Any], bool]:
    """``(journaled pairs, anything-changed)`` for the tracked fields.

    ``anything-changed`` covers comment too (a comment-only edit is an
    action); the journaled pairs EXCLUDE comment (§5.1 free text) and may
    be empty while the action still journals with ``changes={}``.
    """
    from src.events.audit import diff_pairs

    raw = diff_pairs(_RECORD_DIFF_FIELDS, old, record)
    pairs = {f: v for f, v in raw.items() if f != "comment"}
    return pairs, bool(raw)


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
    # GH #344 (§4.3): the scenario journals its own row explicitly — AFTER
    # the recompute flushes so the create snapshot carries the derived
    # seats/status, not the pre-recompute placeholders.
    from src.events.audit import snapshot_pairs_after

    _mark_record_audit(record, "create", snapshot_pairs_after("records", record))
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
    5. insert the new batch (ONE bulk) — ``visitor_id`` is carried
       VERBATIM from the items (today's update flow performs NO
       client/visitor find-or-create; unlike create, a name-bearing item
       links nothing — anonymous unless ``visitor_id`` is sent);
    6. recompute seats + status from the persisted visits, refresh.

    Event grid (GH #239, Task 4 fix): "records" always; "visits"
    additionally ONLY on a non-empty replacement list (a field-only
    update — empty list — keeps the pre-refactor {"records"} grid).

    NOTE: call as ``update_record(None, db_session=..., id=..., data=...)``
    — see the module docstring for why.
    """
    # Own-entity mark — selfless @transactional parity (see create_record).
    mark_changed("records")

    # ── Scalar writes (own-entity row op; missing id → None) ────────
    # GH #344 (§4.2 invariant): the "before" half of the update diff is
    # fixed BEFORE the first in-session mutation — read the tracked
    # fields off the current row, then let update_row write.
    record_service = get_record_service()
    existing = await record_service.get(db_session, id)
    if not existing:
        return None
    _old = {f: getattr(existing, f) for f in _RECORD_DIFF_FIELDS}
    record = await record_service.update_row(
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
    # Event parity: the helpers' "visits" marks are gated on a REAL
    # (non-empty) replacement — an empty list is a field-only update and
    # must keep the pre-refactor {"records"} grid.
    mark_visits = bool(data.visits)
    await get_visit_service().delete_visits_by_record(
        db_session, record.id, mark_visits=mark_visits,
    )
    await recompute_record_seats(db_session, record.id)

    effective_seats = len(data.visits)
    await check_activity_capacity(
        db_session, data.activity_id, seats=effective_seats,
    )

    # ── ONE bulk insert (value payloads only) — visitor_id verbatim ──
    await get_visit_service().create_visits_bulk(
        db_session, record.id, data.visits, mark_visits=mark_visits,
    )

    # ── Recompute from actual visits ─────────────────────────────────
    await recompute_record_seats(db_session, record.id)
    await recompute_record_status(db_session, record.id)
    await db_session.refresh(record)
    # GH #344 (§4.3): explicit journal row — the scenario rewrote the
    # record (PUT semantics: the action happened); the snapshot carries
    # only the tracked fields that actually changed (comment is free
    # text and never enters, §5.1 — the row still records the action).
    _pairs, _changed = _record_diff(_old, record)
    _mark_record_audit(record, "update", _pairs or {})
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
    3. insert the new batch (ONE bulk) — visits not provided → untouched;
       ``visitor_id`` carried verbatim (no find-or-create, same as
       today's patch flow);
    4. recompute seats + status, refresh.

    Event grid (GH #239, Task 4 fix): "records" always; "visits"
    additionally ONLY on a non-empty replacement list (a comment/
    custom_price-only patch keeps the pre-refactor {"records"} grid).

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
    # GH #344 (§4.2 invariant): the "before" half of the diff is fixed
    # BEFORE the first in-session mutation (see update_record).
    record_service = get_record_service()
    existing = await record_service.get(db_session, id)
    if not existing:
        return None
    _old = {f: getattr(existing, f) for f in _RECORD_DIFF_FIELDS}
    record = await record_service.patch_row(db_session, id, scalar_fields)
    if not record:
        return None

    # ── Visit replacement (only when seats may change) — STRICT order:
    #    delete → recompute → check (same interleaving as update_record). ──
    # Event parity: the helpers' "visits" marks are gated on a REAL
    # (non-empty) replacement — a comment/custom_price-only patch (or an
    # empty list) must keep the pre-refactor {"records"} grid.
    mark_visits = bool(update_data.get("visits"))
    if "visits" in update_data:
        await get_visit_service().delete_visits_by_record(
            db_session, record.id, mark_visits=mark_visits,
        )
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
            db_session, record.id, patch_items, mark_visits=mark_visits,
        )

    # ── Recompute from actual active visits ──────────────────────────
    await recompute_record_seats(db_session, record.id)
    await recompute_record_status(db_session, record.id)
    await db_session.refresh(record)
    # GH #344 (§4.3): explicit journal row — only when something actually
    # changed (empty-body PATCH is a no-op action → no row, §5.1).
    _pairs, _changed = _record_diff(_old, record)
    if _changed:
        _mark_record_audit(record, "update", _pairs or {})
    return record


@transactional
async def delete_record(
    db_session: AsyncSession,
    id: str,
    resolutions: dict[str, str] | None,
    expected: dict[str, list[str]] | None,
) -> bool | None:
    """Delete a record — the whole deferred-delete business chain (#285).

    Formerly the commit branch of the route + ``RecordService.resolve_delete``
    (behavior-for-behavior move, GH #171 Task 5; Corridor 2 — canon
    docs/domain-rules/service-layer.md rule 2). The ROUTE keeps transport:
    the form 422s (``expected_state_required`` /
    ``dry_run_with_resolutions_forbidden``), the scope probe, the dry-run
    preview branch (pure read — no transaction, no SSE), and the 409/404/
    422 mapping + response format. This scenario owns the business:
    dependency collection, snapshot verification, resolutions validation,
    and the cascade. The #285 contract is unchanged.

    Step order is identical to the pre-refactor flow:

    0. existence probe — missing id → ``None`` (the route maps that to
       404);
    1. collect dependencies (``collect_dependencies`` — the 409 tree,
       with per-row ``items``);
    2. defensive blocking check → ``BlockingDepsError`` (route → 422;
       unreachable for records — every dep is cascade — kept for parity);
    3. expected id-set verification (rev5/rev6): collect
       ``collect_dependency_ids`` and require
       ``set(now_ids) ⊆ set(expected[entity])`` for every non-auto dep
       (auto-deps — record_tags — are exempt); mismatch →
       ``StaleDependenciesError`` carrying the fresh tree (route → 409
       ``stale_dependencies`` + tree). Subset, not equality: a dep that
       disappeared mid-window does not block; one that APPEARED does.
    4. resolutions validation → ``InvalidResolutionError`` (route → 422);
       ``resolutions=None`` (clean path — the commit declared only
       ``expected``) behaves as {} — trivial for a clean record;
    5. mark the own entity ("records") — AFTER every check has passed:
       in the flow being moved ONLY the cascade was ``@transactional``
       (the auto-mark), so the failed branches must raise BEFORE the
       mark — the decorator then aborts without publishing (exact
       per-branch parity: no event batch on 404/422/409-stale);
    6. the cascade, strictly in today's order: visits
       (``delete_visits_by_record``, marks "visits") → payments
       (``delete_by_record``, marks "payments") → record_tags bundles +
       the record row (``delete_row_with_tags`` — the owner service's
       own-edge command from #171 Task 1);
    7. return ``True`` (route → 204).

    Event grid (GH #239): success publishes EXACTLY
    ``{"records", "visits", "payments"}`` — the pre-refactor grid of
    ``RecordService.delete``; every failure branch publishes nothing.

    NOTE: call as ``delete_record(None, db_session=..., id=...,
    resolutions=..., expected=...)`` — see the module docstring for why.
    """
    # ── Existence probe (route → 404 on None). The loaded row's class is
    #    the model descriptor the deletion domain is keyed on — the
    #    scenario never imports ORM models at runtime (canon rule 2). ──
    record = await get_record_service().get(db_session, id)
    if record is None:
        return None
    model = type(record)

    # ── Dependency collection (the 409 tree) ─────────────────────────
    deps = await collect_dependencies(db_session, model, id)

    # ── Defensive blocking check (route → 422; never fires for Record).
    if has_blocking_deps(deps):
        raise BlockingDepsError(
            "Entity has blocking dependencies — archive instead"
        )

    # ── Expected snapshot verification FIRST (rev5/rev6) — a stale
    #    commit must 409 BEFORE the resolutions validation could turn
    #    it into a 422. Auto-deps (record_tags) are exempt. ───────────
    now_ids = await collect_dependency_ids(db_session, model, id)
    if stale_expected_entities(model, now_ids, expected or {}):
        raise StaleDependenciesError(deps)

    # ── Resolutions validation (route → 422 on issues). ``None`` (the
    #    clean-path declaration) validates trivially for a clean record.
    issues = validate_resolutions(model, deps, resolutions or {})
    if issues:
        msg = "; ".join(f"{i.relation}: {i.message}" for i in issues)
        raise InvalidResolutionError(msg)

    # ── All checks passed — mark the own entity (selfless @transactional
    #    parity; see the step-5 note above) and run the cascade. ─────
    mark_changed("records")
    # GH #344 (§4.3/§4.5): the deferred-delete COMMIT journals the final
    # DELETE here — next to mark_changed, BEFORE the record row (and its
    # cascade visits/payments) disappears; the cascade children are
    # never journaled (§4.2).
    from src.events.audit import snapshot_pairs_before

    _mark_record_audit(record, "delete", snapshot_pairs_before("records", record))
    await get_visit_service().delete_visits_by_record(db_session, id)
    await get_payment_service().delete_by_record(db_session, id)
    await get_record_service().delete_row_with_tags(db_session, id)
    return True
