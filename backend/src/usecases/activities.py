"""Activity scenarios — multi-entity business actions around an activity.

GH #325 — the ``usecases`` layer, Corridor 2 of the service canon
(docs/domain-rules/service-layer.md rule 2): the scenario is a public
function named after the business action, decorated ``@transactional``
(ONE transaction + ONE event batch per action), composing service calls
and domain functions only — no RUNTIME ORM-model imports here (the
model descriptor comes from the loaded row: ``type(loaded)``, the
``usecases.records`` precedent).

CALLING CONVENTION: the ``@transactional`` wrapper's signature is
``wrapper(self, *args, **kwargs)`` — a module-level scenario therefore
MUST be called with an explicit leading ``None`` (the unused ``self``
slot) and keyword arguments::

    deleted = await delete_activity(None, db_session=session, id=...)

The selfless path opens the accumulator EMPTY — no auto entity-mark —
so the scenario marks its OWN entity explicitly
(``mark_changed("activities")``) to keep the published event grid
byte-identical to the former bound-method ``ActivityService.delete``
(whose decorator seeded "activities" via ``resolve_entity_name``).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from src.domain.deletion import collect_dependency_ids
from src.events.emitter import mark_changed
from src.services.activity import get_activity_service
from src.services.decorators import transactional
from src.services.payment import get_payment_service
from src.services.photo import get_photo_service
from src.services.record import get_record_service
from src.services.visit import get_visit_service

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


@transactional
async def delete_activity(db_session: AsyncSession, id: str) -> bool:
    """Hard-delete an activity with its whole dependent graph (#325).

    Behavior-preserving extraction of the cascade half of the former
    ``ActivityService.delete`` (Corridor 2 — canon rule 2): the ROUTE
    keeps transport (the #286 D2 contract — form 422s, dry-run preview,
    the ``expected`` fail-closed verification, 409/404 mapping) and now
    calls this scenario for the commit branch. Step order is identical
    to the pre-refactor flow:

    0. existence probe — missing id → ``False`` (the route → 404); the
       loaded row's class doubles as the model descriptor for the
       dependency collector (no ORM-model imports in the scenario);
    1. collect the record id-set via the READY ``collect_dependency_ids``
       (the same call the route runs for ``expected`` verification — one
       source of truth with the FK matrix; the extra collector reads are
       the accepted cost of never drifting from it);
    2. WITH records — the owners' bulk helpers, strictly in today's
       order: visits (``delete_visits_by_record_ids``, marks "visits")
       → payments (``delete_by_record_ids``, marks "payments") → the
       record_tags bundles + rows (``delete_rows_with_tags_bulk``, marks
       "records" + "tags"); an empty set is a no-op in every helper;
    3. photo unlink — ``PhotoService.unlink_from_activity`` (marks
       "photos"), UNCONDITIONAL: photos are detached
       (``activity_id := NULL``), never deleted, whether or not the
       activity had records (#194 G1b);
    4. the activity's OWN tables — ``activity_tags`` links + the row
       (``ActivityService.delete_row_with_activity_tags``, marks "tags")
       — the owner service's command, not a raw scenario write;
    5. return ``True`` (route → 204).

    Event grid (GH #239 §3.3), byte-identical to the former flow: with
    records — ``{"records", "visits", "payments", "tags", "photos",
    "activities"}``; a CLEAN activity — ``{"photos", "tags",
    "activities"}`` (the records/visits/payments block is conditional;
    "tags" is marked twice — record_tags conditionally, activity_tags
    unconditionally — the accumulator is a set, duplicates are
    harmless). The own-entity "activities" mark is EXPLICIT here: the
    selfless wrapper starts with an EMPTY accumulator (the former
    bound-method decorator seeded it).

    NOTE: call as ``delete_activity(None, db_session=..., id=...)`` —
    see the module docstring for why.
    """
    # ── Existence probe (route → 404 on False). ``get_scoped`` with
    #    ``master_key=None`` is the same unfiltered point-get the route
    #    runs today — it returns the RAW ORM row (unlike the generic
    #    ``get``, which validates into a Pydantic schema): the loaded
    #    row's class doubles as the model descriptor for the dependency
    #    collector and the audit snapshot — the scenario never imports
    #    ORM models at runtime (canon rule 2). ─────────────────────────
    activity = await get_activity_service().get_scoped(
        db_session,
        id=id,
        master_key=None,
    )
    if activity is None:
        return False
    model = type(activity)

    # ── Record id-set via the READY collector — the same call the route
    #    runs for ``expected`` verification (no new collection helper;
    #    one source of truth with the FK matrix). ──────────────────────
    now_ids = await collect_dependency_ids(db_session, model, id)
    record_ids = now_ids.get("records", [])

    # ── Cascade over the id set (bulk = ONE set command each) ─────────
    if record_ids:
        await get_visit_service().delete_visits_by_record_ids(db_session, record_ids)
        await get_payment_service().delete_by_record_ids(db_session, record_ids)
        await get_record_service().delete_rows_with_tags_bulk(db_session, record_ids)

    # ── Photo unlink — unconditional (photos survive, #194 G1b) ───────
    await get_photo_service().unlink_from_activity(db_session, id)

    # ── Own tables: activity_tags + the row (owner service command) ───
    await get_activity_service().delete_row_with_activity_tags(db_session, id)

    # Own-entity mark — selfless @transactional parity: the wrapper seeds
    # an EMPTY accumulator, so "activities" is marked EXPLICITLY (the
    # former bound-method decorator did it via resolve_entity_name).
    mark_changed("activities")

    # GH #344 (§4.3/§4.5): the deferred-delete COMMIT journals the final
    # DELETE — same staging point as the former method: the raw-SQL row
    # deletes above do NOT expire the ORM instance loaded by the probe,
    # so the label/snapshot read the pre-delete values; the cascaded
    # records/visits/payments/join/photo-unlink writes never journal
    # (§4.2). LAZY audit import — cycle discipline (entities.py WARNING).
    from src.events.audit import derive_row_label, mark_audit, snapshot_pairs_before

    mark_audit(
        entity="activities",
        action="delete",
        entity_id=id,
        entity_label=derive_row_label("activities", activity),
        changes=snapshot_pairs_before("activities", activity),
    )
    return True
