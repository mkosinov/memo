"""Client scenarios — multi-entity business actions around a client.

GH #327 Task 4 — the ``usecases`` layer, Corridor 2 of the service canon
(docs/domain-rules/service-layer.md rule 2): the execute branch of the
unified client DELETE moves from the generic executor
(``ClientService.resolve_delete`` → ``_resolve_delete_core`` +
``CASCADE_HANDLERS``) into the ``delete_client`` scenario below. The
ROUTE keeps transport: the 409 dry-run tree (``collect_dependencies``
preview), the 404/422 mapping, and the response format.

GH #345 Task 4 (§4.5) — the scenario additionally owns the ``expected``
subset verification INSIDE its transaction (the
``delete_record``/``delete_staff`` mirror): an unconfirmed non-auto dep
(records/visitors) raises ``StaleDependenciesError`` (route → 409
``stale_dependencies``) BEFORE the blocking/resolutions checks could
turn the race into a 422 (#285 D7 order pin). The ROUTE keeps the
transport of the tags/records/staff family (§4.1 forms: bare DELETE →
422 ``expected_state_required``, ``?dry_run=true`` preview,
``dry_run_with_resolutions_forbidden``).

CALLING CONVENTION (mirror of ``usecases/records.py``): the
``@transactional`` wrapper's signature is ``wrapper(self, *args,
**kwargs)`` — a module-level scenario therefore MUST be called with an
explicit leading ``None`` (the unused ``self`` slot) and keyword
arguments::

    ok = await delete_client(
        None, db_session=session, id=..., resolutions=..., expected=...,
    )

The selfless path opens the accumulator EMPTY — no auto entity-mark —
so the scenario marks its OWN entity explicitly and byte-identically to
the former decorated ``ClientService.resolve_delete`` on EVERY
non-exception branch (404 included — today the decorator's auto-mark
published ``{"clients"}`` even when the probe returned ``False``).

DOCUMENTED DEVIATION from the ``delete_record`` precedent: the scenario
imports the ``Client`` ORM class at RUNTIME as a STATIC registry key
for ``FK_MATRIX`` / ``NULLIFY_HANDLERS`` / ``collect_dependencies`` /
``collect_dependency_ids`` — the record scenario reads ``type(row)``
off its probe because ``RecordService.get`` returns an ORM row, while
``ClientService.get`` returns a Pydantic schema (spec #327 §4.4). The
import never builds ORM rows; every table write goes through owner
services.

EVENT GRID (GH #239), byte-parity with the pre-refactor executor:
success publishes EXACTLY ``{"clients", "records", "photos",
"visitors", "client_tags"}`` — the dependency marks are UNCONDITIONAL
(by dispatch fact, not row count; a clean client with empty
resolutions ``{}`` publishes the same set). ``"visits"`` is
deliberately NOT published (the pre-refactor hole, spec §8 — closing
it is #375). The 404 branch publishes ``{"clients"}``; the 422/409
branches (validation + stale exceptions) publish NOTHING (the
accumulator resets).

AUDIT (GH #344 §4.5): the deferred-delete COMMIT journals ONE
``("delete", "clients", id)`` row with the label + before-snapshot —
staged next to ``mark_changed``, BEFORE the row disappears, exactly
where the former executor staged it. The cascade children (visitors,
visits, join rows) are never journaled (§4.2 "one action — one row").
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from src.domain.deletion import (
    FK_MATRIX,
    NULLIFY_HANDLERS,
    BlockingDepsError,
    InvalidResolutionError,
    StaleDependenciesError,
    collect_dependencies,
    collect_dependency_ids,
    has_blocking_deps,
    stale_expected_entities,
    validate_resolutions,
)
from src.events.emitter import mark_changed
from src.models.client import Client
from src.services.client import get_client_service
from src.services.decorators import transactional
from src.services.visit import get_visit_service
from src.services.visitor import get_visitor_service

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


@transactional
async def delete_client(
    db_session: AsyncSession,
    id: str,
    resolutions: dict[str, str],
    expected: dict[str, list[str]] | None = None,
) -> bool:
    """Delete a client — the whole resolution cascade in ONE transaction.

    Formerly ``ClientService.resolve_delete`` (the generic
    ``_resolve_delete_core`` executor + the client CASCADE_HANDLERS
    pair — both dismantled together with this switch, spec §4.5). Step
    order is identical to the pre-refactor executor:

    0. existence probe — the service point ``get`` (Pydantic schema);
       missing id → ``False`` (the route maps that to 404);
    1. ``mark_changed("clients")`` IMMEDIATELY after the probe — BEFORE
       the ``None`` check: the former decorated method auto-marked
       "clients" on every non-exception branch (404 included), and the
       selfless scenario reproduces that publication parity. The audit
       journal row is NOT staged here — it belongs to the success path,
       next to the row delete (the executor staged it there);
    2. GH #345 Task 4 — expected id-set verification (§4.1/§4.3, subset
       semantics #285 rev8, the ``delete_staff``/``delete_record``
       mirror): collect ``collect_dependency_ids`` and require
       ``set(now_ids) ⊆ set(expected[entity])`` for every non-auto dep
       (records/visitors; auto deps — client_tags/photos — are exempt);
       mismatch → ``StaleDependenciesError`` carrying the fresh tree
       (route → 409 ``stale_dependencies`` + tree). Fires BEFORE the
       blocking/resolutions checks could turn a race into a 422
       (#285 D7 order pin). Subset, not equality: a dep that
       disappeared mid-window does not block; one that APPEARED does;
    3. ``collect_dependencies`` (the 409 tree counters — read-only);
    4. defensive blocking check → ``BlockingDepsError`` (route → 422;
       unreachable for the current ``FK_MATRIX[Client]`` — every dep is
       cascade/nullify — kept for parity, the matrix is data);
    5. resolutions validation → ``InvalidResolutionError`` (route →
       422; the exception resets the accumulator without publishing);
    6. nullify phase — dispatch ``FK_MATRIX[Client]`` deps with action
       ``"nullify"`` through ``NULLIFY_HANDLERS`` on the client service
       instance (records: ``client_id → NULL``; photos: owner detach),
       ``mark_changed(dep.entity)`` UNCONDITIONALLY after each dispatch
       (parity: a zero-row dep still marks its entity);
    7. visitors cascade — ``VisitorService.list_by_client(...,
       master_key=None)`` (admin mode, no scope predicate); per
       visitor: the owner visit brick
       ``delete_visits_by_visitor(..., mark_visits=False)`` then
       ``VisitorService._delete_cascade`` (visitor_tags + row; visits
       BEFORE the visitor row — FK). After the loop
       ``mark_changed("visitors")`` unconditionally, even on an empty
       list. The visits are removed by their OWNER service (canon rule
       1), replacing the DB-level ``ondelete=CASCADE`` reliance of the
       interim state — net DB effects identical;
    8. audit journal row (§4.5) — the client's own ``delete`` row with
       the label + before-snapshot captured from the probe;
    9. the client row via the own-edge brick
       ``ClientService.delete_row_with_tags`` (client_tags join rows
       BEFORE the row — FK with no ondelete), then
       ``mark_changed("client_tags")``;
    10. ``True`` (route → 204).

    Service singletons are resolved by their factories INSIDE the body
    on EVERY call (never captured at module level): the API atomicity
    test monkeypatches ``VisitorService._delete_cascade`` on the
    singleton, and the scenario must see the patched method.

    NOTE: call as ``delete_client(None, db_session=..., id=...,
    resolutions=..., expected=...)`` — see the module docstring for why.
    """
    # ── Phase 0: existence probe (route → 404 on miss) ───────────────
    client_service = get_client_service()
    client = await client_service.get(db_session, id)

    # ── Phase 1: own-entity mark — BEFORE the None check (the former
    #    decorated resolve_delete published {"clients"} on the 404 branch
    #    too; the selfless wrapper opens the accumulator empty). ───────
    mark_changed("clients")
    if client is None:
        return False

    # ── Phase 2: GH #345 — expected snapshot verification FIRST
    #    (fail-closed, #285 D7 order): a stale commit must 409 BEFORE
    #    the blocking/resolutions validation could turn it into a 422,
    #    and before any row is touched. Auto deps (client_tags/photos)
    #    are exempt — they resolve themselves during execution and the
    #    user could not have confirmed them. ───────────────────────────
    now_ids = await collect_dependency_ids(db_session, Client, id)
    if stale_expected_entities(Client, now_ids, expected or {}):
        raise StaleDependenciesError(
            await collect_dependencies(db_session, Client, id)
        )

    # ── Phase 3: dependency collection (the 409 tree counters) ───────
    # ``Client`` is the STATIC registry key (documented deviation — the
    # probe returns a Pydantic schema, not an ORM row; see module
    # docstring). The scenario never builds ORM rows.
    deps = await collect_dependencies(db_session, Client, id)

    # ── Phase 4: defensive blocking check (route → 422) ──────────────
    if has_blocking_deps(deps):
        raise BlockingDepsError(
            "Entity has blocking dependencies — archive instead"
        )

    # ── Phase 5: resolutions validation (route → 422) ────────────────
    issues = validate_resolutions(Client, deps, resolutions)
    if issues:
        msg = "; ".join(f"{i.relation}: {i.message}" for i in issues)
        raise InvalidResolutionError(msg)

    # ── Phase 6: nullify phase — matrix dispatch, unconditional marks ─
    for dep in FK_MATRIX[Client]:
        if dep.action != "nullify":
            continue
        handler = NULLIFY_HANDLERS.get((Client, dep.entity))
        if handler is not None:
            await handler(client_service, db_session, id)
            # Parity with the executor: mark by DISPATCH FACT, not row
            # count — a zero-row nullify dep still marks its entity.
            mark_changed(dep.entity)

    # ── Phase 7: visitors cascade — singletons resolved per call so a
    #    monkeypatch on the visitor singleton keeps intercepting. ──────
    visitor_service = get_visitor_service()
    visitors = await visitor_service.list_by_client(
        db_session, client_id=id, master_key=None
    )
    for visitor in visitors:
        # Visits BEFORE the visitor row (FK) — the owner service brick,
        # mark suppressed: the grid owner is this scenario (parity).
        await get_visit_service().delete_visits_by_visitor(
            db_session, visitor.id, mark_visits=False
        )
        await visitor_service._delete_cascade(db_session, visitor.id)
    # Unconditional — the executor marked the dispatched visitors dep
    # even when the loop found zero rows.
    mark_changed("visitors")

    # ── Phase 8: audit journal row (§4.5) — next to the disappearance ─
    # LAZY audit import — cycle discipline (usecases sit inside the
    # services walk graph, see src/events/entities.py WARNING). The
    # helpers read label/snapshot fields via getattr, so the Pydantic
    # probe result works exactly like the ORM row the executor passed.
    from src.events.audit import derive_row_label, mark_audit, snapshot_pairs_before

    mark_audit(
        entity="clients",
        action="delete",
        entity_id=id,
        entity_label=derive_row_label("clients", client),
        changes=snapshot_pairs_before("clients", client),
    )

    # ── Phase 9: own-edge — client_tags join rows + the client row ───
    await client_service.delete_row_with_tags(db_session, id)
    mark_changed("client_tags")

    # ── Phase 10: success (route → 204) ───────────────────────────────
    return True
