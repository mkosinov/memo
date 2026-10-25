"""GH #482 — scenario-reaction registry + the ``new_record`` handler (§3.4).

The registry maps event type codes to handlers; the pilot has exactly one
entry (``new_record``). The Task 9 dispatcher calls handlers GENERICALLY
through this registry — never by import — so a new event type is one new
handler plus one registry line.

Handler contract (§3.4): ``async (event, session, queue) -> None``.

- LIVE reads for the predicate go by identifiers FROM THE SNAPSHOT:
  record by ``event.record_id`` (existence only — records have no
  soft-delete flag), client by ``client.id`` (existence, ``is_active``,
  ``phone``, ``notify_enabled``). The snapshot stays the ONLY data source
  for the render — the payload is frozen verbatim (rev.5, ADR 014).
- Predicate order is FIXED and cheapest-first (§3.4): ``notify_off`` →
  ``no_recipient`` → ``no_consent`` → ``past_event``. On multiple
  failures the FIRST branch wins.
- Decision is materialized as a ``notify_tasks`` row; ``processed_at``
  is set IN THE SAME TRANSACTION as the task (§4.4: reprocessing an
  event creates no duplicate). Enqueue happens AFTER the commit: an
  enqueue failure leaves the ``queued`` task for the re-enqueue loop
  (Task 9, §3.8); a duplicate delivery is accepted (§4.4).
- ``RenderError`` from :mod:`src.notify.render` PROPAGATES — it is not
  a decision branch. Only the five clean branches (deleted record, four
  skips/success) produce ``processed_at``; Task 9's attempts policy
  (1→2→3 → ``processing_error``) owns render failures.

Rev.5 (#485, ADR 014): on success the handler creates the task of the
FIRST priority channel — freezing the render payload (the §4.1
snapshot), the channel's template (:func:`find_template` — §3.7 lookup)
and the address (the live client phone). Text is NOT rendered here: the
worker assembles it per channel. The dispatcher's chain spawner (part 4
Task 5) continues the chain from this root task.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal

from sqlalchemy import select

from src.core.config import settings
from src.models.client import Client
from src.models.record import Record
from src.notify.channels.registry import parse_channel_priority
from src.notify.models import DomainEvent, NotifyTask
from src.notify.queue import build_task_payload
from src.notify.render import RenderError, find_template
from src.notify.time import business_now
from src.util.utc import utc_now

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from src.notify.queue import NotifyQueue

#: Pilot scenario code — the only registry entry of part 1 (§3.4).
SCENARIO_NEW_RECORD = "new_record"

SkipReason = Literal["notify_off", "no_recipient", "no_consent", "past_event"]

#: Registry: event type code → handler. The dispatcher (Task 9) resolves
#: handlers here and calls them generically.
ScenarioHandler = Callable[[DomainEvent, "AsyncSession", "NotifyQueue"], Awaitable[None]]
SCENARIOS: dict[str, ScenarioHandler] = {}


def _utc_now_iso_z() -> str:
    """UTC now → ISO 8601 with the ``Z`` suffix (payload ``created_at``,
    §4.2 — the same serialization the §4.1 snapshot uses)."""
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _first_priority_channel() -> str:
    """The channel of the FIRST task (rev.5): head of
    ``NOTIFY_CHANNEL_PRIORITY``. The dispatcher start already validates
    the setting loudly; here the canonical parser raises the same
    ``ValueError`` on a corrupt setting — a scenario error for the
    attempts policy, never a silent fallback."""
    return parse_channel_priority(settings.NOTIFY_CHANNEL_PRIORITY)[0]


async def _client_id_for_task(
    session: AsyncSession, snapshot: dict[str, Any]
) -> str | None:
    """Task ``client_id`` — the snapshot client id IFF the live row exists.

    The column is an FK to ``clients`` (ondelete SET NULL): it must never
    dangle, so a client deleted between event and processing yields NULL
    — the task history then survives exactly as the spec's hard-delete
    story describes (§3.6).
    """
    client_id = (snapshot.get("client") or {}).get("id")
    if client_id is None:
        return None
    live = await session.get(Client, client_id)
    return client_id if live is not None else None


async def _skip(
    event: DomainEvent,
    session: AsyncSession,
    reason: SkipReason,
) -> None:
    """Decision «skipped»: task row with the reason + ``processed_at``,
    ONE transaction, nothing enqueued (§3.4)."""
    session.add(
        NotifyTask(
            event_id=event.id,
            scenario=SCENARIO_NEW_RECORD,
            client_id=await _client_id_for_task(session, event.snapshot),
            status="skipped",
            skip_reason=reason,
        )
    )
    event.processed_at = utc_now()
    await session.commit()


async def handle_new_record(
    event: DomainEvent,
    session: AsyncSession,
    queue: NotifyQueue,
) -> None:
    """``new_record`` scenario — the §3.4 decision flowchart, verbatim.

    Owns its commit boundaries: task + ``processed_at`` in one
    transaction, ``enqueue_task`` after the commit.
    """
    snapshot: dict[str, Any] = event.snapshot

    # Idempotency (§4.4): (event, scenario) is unique. A closed event or
    # an already-existing task makes reprocessing a no-op — the guard
    # covers both a fresh fetch (processed_at set) and a stale in-memory
    # event object (task row exists).
    if event.processed_at is not None:
        return
    existing = await session.execute(
        select(NotifyTask.id).where(
            NotifyTask.event_id == event.id,
            NotifyTask.scenario == SCENARIO_NEW_RECORD,
        )
    )
    if existing.first() is not None:
        return

    # Live read #1 — record by event.record_id (existence only). A record
    # deleted before processing closes the event WITHOUT a task: there is
    # nothing to notify about (§3.4).
    record_id = (snapshot.get("event") or {}).get("record_id")
    record = await session.get(Record, record_id) if record_id else None
    if record is None:
        event.processed_at = utc_now()
        await session.commit()
        return

    # 1) notify_off — the record's own flag, LIVE (cheapest first; only
    # an authenticated actor could set it true, §3.3).
    if not record.notify:
        await _skip(event, session, "notify_off")
        return

    # Live read #2 — client by client.id: missing, soft-deleted
    # (is_active=false) or empty-phone (None / strip-empty) means there
    # is nobody to deliver to.
    client_id = (snapshot.get("client") or {}).get("id")
    client = await session.get(Client, client_id) if client_id else None
    if (
        client is None
        or not client.is_active
        or client.phone is None
        or not client.phone.strip()
    ):
        await _skip(event, session, "no_recipient")
        return

    # Live read #3 — consent never enters the snapshot: it is read at
    # processing time (§4.1 family).
    if not client.notify_enabled:
        await _skip(event, session, "no_consent")
        return

    # 4) past_event — the SNAPSHOT's activity.start. Interpretation (§3.4
    # wording: «activity.start > business_now()» with activity from the
    # snapshot): live reads are record existence, client and consent
    # ONLY; the time predicate consumes the event's own data — the same
    # frozen value the renderer prints (fmt_dt), so predicate and text
    # can never disagree. Naive local business time on both sides
    # (§3.2); a missing start cannot be in the future.
    start_raw = (snapshot.get("activity") or {}).get("start")
    if start_raw is None or datetime.fromisoformat(start_raw) <= business_now():
        await _skip(event, session, "past_event")
        return

    # Success (rev.5, ADR 014): create the task of the FIRST priority
    # channel — freeze the render payload (the snapshot verbatim), the
    # channel's template (§3.7 lookup: (event_type, channel) →
    # (event_type, NULL) → default) and the address (the live phone the
    # predicate just validated — never re-resolved). ``root_task_id``
    # defaults to the row's own id (chain root). RenderError (no
    # template) PROPAGATES — Task 9's attempts policy owns it; task +
    # ``processed_at`` in ONE transaction (§4.4 idempotency).
    channel_name = _first_priority_channel()
    template = await find_template(session, SCENARIO_NEW_RECORD, channel_name)
    if template is None:
        raise RenderError(
            f"no notify template for event_type={SCENARIO_NEW_RECORD!r}"
            f" channel={channel_name!r} and no default (spec §3.7)"
        )
    task = NotifyTask(
        event_id=event.id,
        scenario=SCENARIO_NEW_RECORD,
        client_id=client.id,
        status="queued",
        channel=channel_name,
        address=client.phone,
        payload=snapshot,
        template_id=template.id,
        template_body=template.body,
    )
    session.add(task)
    event.processed_at = utc_now()
    await session.commit()

    # Enqueue AFTER the commit (§3.4): an enqueue failure leaves the
    # queued task without a queue message — the re-enqueue loop (Task 9)
    # picks it up; duplicates are accepted (§4.4). Payload §4.2 rev.5 —
    # the frozen task values verbatim, never re-resolved.
    queue.enqueue_task(build_task_payload(task, _utc_now_iso_z()))


SCENARIOS[SCENARIO_NEW_RECORD] = handle_new_record
