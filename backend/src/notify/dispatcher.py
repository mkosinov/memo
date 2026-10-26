"""GH #482 Task 9 — the dispatcher process (spec §3.8; family #476 §3.2/§4.3/§4.4).

GH #483 part 2 wiring: the queue adapter is selected at start
(``connect_or_exit`` — ``RedisQueue`` over ``REDIS_URL``, fail-fast code 2
gates), every queue call from the async cycles goes through
``asyncio.to_thread``, and a transport failure at the enqueue point is
kept apart from scenario errors (attempts are not burned — the re-enqueue
cycle owns recovery; spec §3.1).

Standalone entry ``python -m src.notify.dispatcher``. Three loops of ONE
``asyncio.TaskGroup``, each iteration isolated in its own ``try/except``
(one crash is logged and never kills the process or the sibling loops —
spec §3.8 panel finding); SIGTERM/KeyboardInterrupt set the stop-event
and the TaskGroup winds down cleanly.

- **Cycle 1 — journal polling** (interval ``NOTIFY_POLL_INTERVAL``, batch
  20, ``processed_at IS NULL AND processing_error IS NULL``, ``ORDER BY
  occurred_at, id`` — cursor by row state, no "id > last"): applies the
  scenario registry. Scenario/render errors are the DISPATCHER's
  bookkeeping: ``attempts`` 1→2→3, ``processing_error`` (last error
  text) at 3 - never written during attempts 1-2; a dead event is no
  longer picked. The same iteration sweeps the re-enqueue predicate:
  ``queued`` tasks with ``updated_at`` older than
  ``NOTIFY_REENQUEUE_AFTER`` that the worker does not HOLD (family
  §3.3 rev.5 — ``pending_worker_task_ids``: the PEL of the ``worker``
  group; a channel-send pause or retry sleep is not a hang) are
  re-enqueued with the SAVED payload in full (no address
  re-resolution); the ``updated_at`` refresh is the re-enqueue stamp that
  keeps the sweep from firing every tick; past the cap (module constant,
  not a setting) the task is ``failed``.
- **Cycle 2 — ``notify:statuses``**: ``reclaim_hanging()`` at process
  start, then claim → per event one append-only attempt row + the §4.3
  derived task state + the rev.5 CHAIN rules in ONE commit → the
  spawned continuation (if any) is enqueued → ack. Chain (part-4 spec
  §8, #485 Task 5): the first ``sent`` of any chain task writes
  ``delivery_outcome = delivered`` on the root (terminal, never
  flipped); a terminal failure (``not_delivered`` final or the
  no-final ``app_error`` of an assembly error) spawns the next priority
  channel — FRESH template freeze, payload/address/ids inherited from
  the root (ADR 014) — or, at channel exhaustion with nothing in
  flight, closes the chain ``not_delivered`` on the root (the reason
  lives in the attempt journal). Spawn idempotency: the used-channel
  filter over the chain rows is the ``UNIQUE(root_task_id, channel)``
  pre-check — at-least-once report redelivery never duplicates a task.
  Brak leaves delivery by the two-layer rule (#484 spec §3.5): shape
  pre-validation and a ``ValueError`` from ``apply_status_event``
  (unknown task/stage after a valid form) are journalled (identifiers
  only) and ACKED; any other error keeps the item unacked — the
  reliable-list reclaim at the next process start redelivers it
  (at-least-once, §4.4).
- **Cycle 3 — ``notify:inbound``**: routed by the handler registry
  (channel → handler). The pilot registry is EMPTY: log warning + ack.

The dispatcher inherits the repo engine pragmas (``busy_timeout``, WAL —
``src/db/database.py``) by building its own ``DBManager`` the way other
standalone entries do (``seed``).
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import select

import src.models  # noqa: F401 — registration first; breaks the models↔notify import cycle
from src.core.config import settings
from src.db.database import DBManager
from src.notify.channels.registry import parse_channel_priority
from src.notify.models import DomainEvent, NotifyTask, NotifyTaskAttempt
from src.notify.process import install_signal_handlers, run_loop
from src.notify.queue import InboundEvent, TaskPayload, build_task_payload
from src.notify.redis_queue import NotifyTransportError, connect_or_exit
from src.notify.render import find_template
from src.notify.scenarios import SCENARIOS
from src.util.utc import utc_now

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from src.notify.queue import NotifyQueue, StatusEvent

# The notify family logger convention (src/notify/journal.py):
# "memo.notify.<module>", independent of import paths.
logger = logging.getLogger("memo.notify.dispatcher")

# ── module constants (spec §3.8 — deliberately NOT settings) ────────────────

#: Journal polling batch size.
POLL_BATCH_SIZE = 20
#: Scenario/render attempts before an event is dead (``processing_error``).
MAX_EVENT_ATTEMPTS = 3
#: Re-enqueue ceiling; past it the task is ``failed``.
REENQUEUE_CAP = 10
#: Failure text of a cap-exhausted task (spec §3.8 verbatim).
REENQUEUE_FAILED_MESSAGE = "не доставлено: очередь не подтверждает приём"

#: Failure volume of a §4. report that ends the CHANNEL task (spec §8.2:
#: «транспортные ретраи исчерпаны, либо app_error»). ``not_delivered``
#: is the worker's ONE final event; ``app_error`` is included because
#: the ASSEMBLY failure (§5.4) publishes it WITHOUT any final follow-up
#: — and the chain must continue there too (domain rule: «цепочка идёт
#: к следующему каналу»). Harmless on the send-path duplicate (app_error
#: followed by not_delivered): the spawn is idempotent (the used-channel
#: filter is the UNIQUE(root, channel) pre-check) and the close is
#: guarded by the in-flight check.
TERMINAL_FAILURE_OUTCOMES = frozenset({"not_delivered", "app_error"})

#: In-flight task statuses of a chain (§4.3): a live task means the
#: chain is NOT exhausted, whatever the other rows say.
_IN_FLIGHT_STATUSES = frozenset({"queued", "sending"})

#: Inbound handler registry (channel → handler). Pilot: EMPTY — replies
#: arrive with part 4; the empty-registry behavior (warn + ack) is the
#: contract fixed here.
InboundHandler = Callable[[InboundEvent], Awaitable[None]]
INBOUND_HANDLERS: dict[str, InboundHandler] = {}


# ── small time helpers ──────────────────────────────────────────────────────


def _utc_now_iso_z() -> str:
    """UTC now → ISO 8601 with the ``Z`` suffix (payload ``created_at``,
    §4.2 — same serialization as the scenario module)."""
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _naive_utc(value: str) -> datetime:
    """ISO 8601 timestamp → naive UTC ``datetime`` (the repository storage
    convention for ``occurred_at`` columns)."""
    parsed = datetime.fromisoformat(value)  # py3.11+: trailing "Z" supported
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(UTC).replace(tzinfo=None)
    return parsed


def _is_malformed_status(item: StatusEvent) -> bool:
    """Shape pre-validation (spec §3.5): ``task_id`` a NON-EMPTY STRING
    (a UUID String(36) — ``NotifyTask.id``, the only spelling the
    dispatcher's own enqueue seam puts on tasks; the family §4.2 int
    example is a sketch artifact — int/bool are malformed), ``stage``
    in the §4.3 vocabulary, ``channel`` a non-empty string,
    ``occurred_at`` parseable, ``sent_text`` (rev.5) — a string or
    NULL. Guards the reader against events that would raise a
    non-ValueError inside ``apply_status_event`` and hang on the
    stream unacked forever."""
    try:
        task_id = item.get("task_id")
        if not isinstance(task_id, str) or not task_id:
            return True
        if item.get("stage") not in ("sending", "sent", "failed"):
            return True
        channel = item.get("channel")
        if not isinstance(channel, str) or not channel:
            return True
        sent_text = item.get("sent_text")
        if sent_text is not None and not isinstance(sent_text, str):
            return True
        _naive_utc(item["occurred_at"])
    except (KeyError, TypeError, ValueError, AttributeError):
        # AttributeError: a corrupt entry that is not even a mapping —
        # the reader must ack it away, not crash on it.
        return True
    return False


# ── cycle 1: journal polling (§3.8) ─────────────────────────────────────────


async def process_pending_batch(
    session_factory: async_sessionmaker[AsyncSession], queue: NotifyQueue
) -> None:
    """Apply the scenario registry to one batch of pending events.

    Handlers own their commit boundaries (task + ``processed_at`` in one
    transaction, enqueue after commit — §3.4). A raising handler leaves
    the attempts bookkeeping to the dispatcher: rollback, ``attempts``
    +1, ``processing_error`` at the 3rd failure — EXCEPT the typed
    transport failure (``NotifyTransportError``, GH #483 §3.1), which
    burns no attempts: the queued task is left for the re-enqueue cycle.
    No backoff — the next polling iteration is the retry cadence (§3.8).

    The batch is selected as PLAIN ``(id, type)`` tuples and each event
    re-loaded inside its own ``try``: a failing handler's ``rollback()``
    expires every identity-mapped instance, and touching an attribute of
    an expired instance is synchronous lazy IO — ``MissingGreenlet`` in
    an async session, raised OUTSIDE the per-event ``try``. With ORM
    instances in the routing one failing event would therefore skip the
    whole rest of the batch every tick.
    """
    async with session_factory() as session:
        batch = (
            await session.execute(
                select(DomainEvent.id, DomainEvent.type)
                .where(
                    DomainEvent.processed_at.is_(None),
                    DomainEvent.processing_error.is_(None),
                )
                .order_by(DomainEvent.occurred_at.asc(), DomainEvent.id.asc())
                .limit(POLL_BATCH_SIZE)
            )
        ).all()
        for event_id, event_type in batch:
            handler = SCENARIOS.get(event_type)
            if handler is None:
                logger.error(
                    "notify dispatcher: no scenario handler for event type %r"
                    " (event %s) — event stays pending",
                    event_type,
                    event_id,
                )
                continue
            try:
                # Fresh instance per event: a previous iteration's rollback
                # may have expired the identity-mapped copy, and
                # populate_existing guarantees the row values overwrite
                # whatever stale state it holds.
                event = (
                    await session.execute(
                        select(DomainEvent)
                        .where(DomainEvent.id == event_id)
                        .execution_options(populate_existing=True)
                    )
                ).scalar_one()
                await handler(event, session, queue)
            except NotifyTransportError as exc:
                # GH #483 (spec §3.1): a TRANSPORT failure at the enqueue
                # point is not a scenario failure — attempts must not burn
                # (three dead Redis ticks must not kill the event). The
                # handler owns its commit boundary (§3.4): the queued task
                # is already committed and the re-enqueue cycle recovers
                # it by NOTIFY_REENQUEUE_AFTER. Loud, identifiers only —
                # no message bodies, no addresses.
                await session.rollback()
                logger.error(
                    "notify dispatcher: event %s: transport failure at the enqueue"
                    " point (%s) — attempts not burned, queued task left for the"
                    " re-enqueue cycle",
                    event_id,
                    exc,
                )
            except Exception as exc:
                await session.rollback()
                fresh = (
                    await session.execute(select(DomainEvent).where(DomainEvent.id == event_id))
                ).scalar_one()
                fresh.attempts += 1
                if fresh.attempts >= MAX_EVENT_ATTEMPTS:
                    fresh.processing_error = f"{type(exc).__name__}: {exc}"
                else:
                    # Attempts 1-2 degrade invisibly without this: the error
                    # text only lands on the row at attempt 3.
                    logger.warning(
                        "notify dispatcher: scenario for event %s failed (attempt %d/%d): %s: %s",
                        event_id,
                        fresh.attempts,
                        MAX_EVENT_ATTEMPTS,
                        type(exc).__name__,
                        exc,
                        exc_info=exc,
                    )
                await session.commit()


async def reenqueue_stale_tasks(
    session_factory: async_sessionmaker[AsyncSession], queue: NotifyQueue
) -> None:
    """Re-enqueue ``queued`` tasks older than ``NOTIFY_REENQUEUE_AFTER``
    that the worker does not HOLD (family §3.3 rev.5: not in the PEL of
    the ``worker`` group — a task being worked on, e.g. a channel-send
    pause or a transport-retry sleep, is not hanging; re-enqueueing it
    would duplicate the delivery).

    The payload is the SAVED task row verbatim (§4.2 rev.5) — channel,
    address, render data and the frozen template; addresses never
    re-resolved (§3.4 panel finding). The ORM ``onupdate`` refresh of
    ``updated_at`` is the re-enqueue stamp: without it the age
    predicate would fire every polling tick instead of once per
    window. Past ``REENQUEUE_CAP`` the task becomes ``failed`` (the
    error text has no column on the task row — it is logged; part 5
    screens read the attempt journal for failure detail).

    Deliberate inversion: the enqueue lands BEFORE the stamp is committed
    — a crash in between leaves an unstamped task that the next sweep
    re-enqueues again, an at-least-once duplicate absorbed by the
    terminal-``sent`` rule (§4.4), whereas the reverse order could
    silently lose a notification for a full re-enqueue window.
    """
    try:
        held_ids = await asyncio.to_thread(queue.pending_worker_task_ids)
    except NotifyTransportError as exc:
        # The probe precedes every enqueue decision: a blind sweep over
        # a dead probe would duplicate every task the worker holds.
        # Nothing burns — the next tick retries the whole sweep.
        logger.error(
            "notify dispatcher: re-enqueue sweep aborted — worker PEL probe"
            " failed (%s); the next tick retries",
            exc,
        )
        return
    threshold = utc_now() - timedelta(
        seconds=settings.NOTIFY_REENQUEUE_AFTER
    )
    async with session_factory() as session:
        tasks = (
            (
                await session.execute(
                    select(NotifyTask).where(
                        NotifyTask.status == "queued",
                        NotifyTask.updated_at < threshold,
                    )
                )
            )
            .scalars()
            .all()
        )
        for task in tasks:
            if task.reenqueues >= REENQUEUE_CAP:
                task.status = "failed"
                logger.error(
                    "notify task %s: %s (re-enqueue cap %d reached)",
                    task.id,
                    REENQUEUE_FAILED_MESSAGE,
                    REENQUEUE_CAP,
                )
            elif task.id in held_ids:
                # §3.3 rev.5: the worker holds the ticket (PEL) — not a
                # hang; no stamp either, so the sweep re-checks after
                # the worker is done with it.
                logger.debug(
                    "notify task %s: held by the worker (PEL) — re-enqueue skipped",
                    task.id,
                )
                continue
            else:
                try:
                    # sync adapter off the event loop (spec §3.1); the
                    # payload is the SAVED task row verbatim (§4.2
                    # rev.5 — channel, address, render data and the
                    # frozen template; addresses never re-resolved).
                    await asyncio.to_thread(
                        queue.enqueue_task,
                        build_task_payload(task, _utc_now_iso_z()),
                    )
                except NotifyTransportError as exc:
                    # GH #483 (spec §3.1): a failed enqueue counts toward
                    # the SAME cap as a successful one — a dead transport
                    # must churn finitely, not forever. The task stays
                    # «queued» until the cap path terminates it; the log
                    # carries the exception class + task id only.
                    logger.error(
                        "notify task %s: enqueue failed (%s) — re-enqueue"
                        " %d/%d counted, task stays queued",
                        task.id,
                        exc,
                        task.reenqueues + 1,
                        REENQUEUE_CAP,
                    )
                task.reenqueues += 1
            await session.commit()


# ── cycle 2: notify:statuses (§3.8; family §4.3/§4.4) ───────────────────────


async def _chain_root(session: AsyncSession, task: NotifyTask) -> NotifyTask:
    """The chain root of ``task`` — the row ``delivery_outcome`` lives
    on. Falls back to ``task`` itself for a dangling chain reference
    (the root row is gone): the outcome then lands on the surviving
    task, never on a missing one."""
    if task.root_task_id == task.id:
        return task
    root = await session.get(NotifyTask, task.root_task_id)
    return task if root is None else root


async def _chain_reaction(session: AsyncSession, task: NotifyTask) -> NotifyTask | None:
    """The §8.2 chain rules on a TERMINAL failure of a channel task.

    - Candidates: priority entries AFTER ``task.channel`` (all unused
      ones when the channel left the priority list), minus the channels
      the chain already used — the DB rows ARE the UNIQUE(root,
      channel) pre-check, so an at-least-once duplicate report re-runs
      this idempotently and never duplicates a task.
    - First candidate with a template (§3.7 lookup, FRESH freeze for
      the new channel) → a queued continuation inheriting the ROOT's
      ``payload``/``address``/ids (never re-resolved, ADR 014) with
      ``parent_task_id`` = the failed task; returned for the caller to
      enqueue AFTER the commit (§3.4).
    - No candidate AND nothing in flight (queued/sending chain tasks)
      → the chain is exhausted: ``delivery_outcome = not_delivered`` on
      the root. The REASON deliberately lives in the append-only attempt
      journal (the failed events themselves) — no reason column on the
      task (part-5 screens read attempts). ``delivered`` is never
      overwritten; an in-flight sibling keeps the chain open — its own
      terminal event closes it.
    """
    root = await _chain_root(session, task)
    priority = parse_channel_priority(settings.NOTIFY_CHANNEL_PRIORITY)
    chain = (
        await session.execute(
            select(NotifyTask.channel, NotifyTask.status).where(
                NotifyTask.root_task_id == root.id
            )
        )
    ).all()
    used = {channel for channel, _status in chain if channel is not None}
    in_flight = any(status in _IN_FLIGHT_STATUSES for _channel, status in chain)
    if task.channel in priority:
        candidates = priority[priority.index(task.channel) + 1 :]
    else:
        candidates = list(priority)
    for name in candidates:
        if name in used:
            continue
        template = await find_template(session, root.scenario, name)
        if template is None:
            # Near-dead branch (seed invariant: a default exists) — skip
            # the channel LOUDLY and try the next one; exhaustion below
            # closes the chain if nothing deliverable remains.
            logger.error(
                "notify dispatcher: chain of task %s: no template for channel %r"
                " — channel skipped",
                task.id,
                name,
            )
            continue
        continuation = NotifyTask(
            event_id=root.event_id,
            scenario=root.scenario,
            client_id=root.client_id,
            status="queued",
            channel=name,
            address=root.address,
            payload=root.payload,
            template_id=template.id,
            template_body=template.body,
            template_channel=template.channel,
            root_task_id=root.id,
            parent_task_id=task.id,
            resend_of=root.resend_of,
        )
        session.add(continuation)
        return continuation
    if not in_flight and root.delivery_outcome is None:
        root.delivery_outcome = "not_delivered"
    return None


async def apply_status_event(
    session: AsyncSession, item: StatusEvent
) -> TaskPayload | None:
    """One §4.3 stage event → append-only attempt row + derived task
    state, ONE commit (the caller acks only after it succeeds).

    Derived state: the stage vocabulary maps 1:1 onto task statuses
    (``sending``/``sent``/``failed``); the single special rule is that
    ``sent`` is TERMINAL — the first ``sent`` of any attempt wins and is
    never overridden (a late ``failed`` after a success, e.g. a
    re-enqueue duplicate, must not flip a delivered task). Idempotent
    re-apply only appends the attempt row (§4.4 — duplicates accepted).

    Chain (rev.5, ADR 014 — the task is ONE channel):

    - the first ``sent`` of any chain task → ``delivery_outcome =
      delivered`` on the root (any success wins, even over a closed
      ``not_delivered`` — a late duplicate that actually delivered);
      ``delivered`` is never overwritten;
    - a TERMINAL failure (``TERMINAL_FAILURE_OUTCOMES``) of a task
      whose status is not the terminal ``sent`` → :func:`_chain_reaction`:
      the next priority channel task (returned as its §4.2 payload for
      the caller to enqueue after the commit) or the ``not_delivered``
      close on the root at channel exhaustion.
    """
    task_id = item["task_id"]
    task = await session.get(NotifyTask, task_id)
    if task is None:
        raise ValueError(f"status for unknown notify task {task_id!r}")
    stage = item["stage"]
    if stage not in ("sending", "sent", "failed"):
        raise ValueError(f"unknown status stage {stage!r}")
    session.add(
        NotifyTaskAttempt(
            task_id=task_id,
            channel=item["channel"],
            stage=stage,
            outcome=item.get("outcome"),
            error=item.get("error"),
            # rev.5 (§4.3): the actually transmitted text of the
            # attempt — NULL on failures before any transmission.
            sent_text=item.get("sent_text"),
            occurred_at=_naive_utc(item["occurred_at"]),
        )
    )
    spawned: NotifyTask | None = None
    if task.status != "sent":
        task.status = stage
    if stage == "sent":
        # The chain outcome rides the ROOT (spec §8.2); «delivered» is
        # terminal — written once, never flipped back.
        root = await _chain_root(session, task)
        root.delivery_outcome = "delivered"
    elif (
        stage == "failed"
        and item.get("outcome") in TERMINAL_FAILURE_OUTCOMES
        and task.status != "sent"
    ):
        spawned = await _chain_reaction(session, task)
    await session.commit()
    if spawned is None:
        return None
    # §3.4 order: the row is committed, the queue message follows — an
    # enqueue failure leaves the queued continuation to the re-enqueue
    # cycle (duplicates accepted, §4.4).
    return build_task_payload(spawned, _utc_now_iso_z())


async def statuses_once(
    session_factory: async_sessionmaker[AsyncSession], queue: NotifyQueue
) -> None:
    """Claim ``notify:statuses`` → apply each event in its own commit →
    ack. The two-layer brak rule (#484 spec §3.5): (1) shape
    pre-validation, (2) ``ValueError`` from ``apply_status_event``
    (unknown task/stage after a valid form) — both journalled
    (identifiers only) and ACKED: redelivery cannot fix a handmade or
    corrupted payload, and the task row commits before enqueue (#482),
    so «unknown task» means a lost DB row, not a race worth waiting
    out. Any OTHER error (DB down, integrity on commit) keeps the old
    contract: logged, left UNACKED — the reliable-list reclaim at the
    next process start redelivers it (§4.4), and sibling items of the
    same batch still proceed. The sync adapter is called through
    ``asyncio.to_thread`` (§3.1) — a transport failure propagates to
    the loop guard, the next tick retries.
    """
    for item in await asyncio.to_thread(queue.claim_statuses):
        if _is_malformed_status(item):
            logger.error(
                "notify dispatcher: malformed status event (spec §3.5 shape"
                " brak) — acked away, identifiers %r",
                {k: item.get(k) for k in ("task_id", "stage")}
                if isinstance(item, dict)
                else item,
            )
            await asyncio.to_thread(queue.ack_status, item)
            continue
        try:
            async with session_factory() as session:
                spawned = await apply_status_event(session, item)
        except ValueError as exc:
            # Layer 2 (spec §3.5): a VALID form naming an unknown
            # task/stage — handmade/broken payload or a lost DB row;
            # redelivery cannot fix it, so the event leaves delivery.
            logger.error(
                "notify dispatcher: status event rejected (%s: %s) — acked"
                " away (spec §3.5)",
                type(exc).__name__,
                exc,
            )
            await asyncio.to_thread(queue.ack_status, item)
        except Exception:
            logger.exception(
                "notify dispatcher: status event %r not applied — left unacked for reclaim",
                item,
            )
        else:
            if spawned is not None:
                # The chain continuation (§8.2): the row is committed,
                # the queue message goes out BEFORE the ack — a transport
                # failure leaves the event unacked (redelivery re-runs
                # the reaction idempotently: the attempt row is an
                # accepted duplicate, the spawn is suppressed by the
                # used-channel filter) and the queued row waits for the
                # re-enqueue cycle as the last resort.
                await asyncio.to_thread(queue.enqueue_task, spawned)
            await asyncio.to_thread(queue.ack_status, item)


# ── cycle 3: notify:inbound (§3.8) ──────────────────────────────────────────


async def inbound_once(queue: NotifyQueue) -> None:
    """Claim ``notify:inbound`` → route by the handler registry. The pilot
    registry is empty, so every event is logged as a warning and acked —
    producers do not exist yet; the routing form is the fixed contract.
    Queue calls go through ``asyncio.to_thread`` (§3.1)."""
    for item in await asyncio.to_thread(queue.claim_inbound):
        handler = INBOUND_HANDLERS.get(str(item.get("channel", "")))
        if handler is None:
            logger.warning(
                "notify dispatcher: inbound event on channel %r has no handler — acking",
                item.get("channel"),
            )
        else:
            await handler(item)
        await asyncio.to_thread(queue.ack_inbound, item)


# ── concurrency model: loops + stop (§3.7 — run_loop/signals live in
# src/notify/process.py; §3.8) ───────────────────────────────────────────────


async def run_dispatcher(
    session_factory: async_sessionmaker[AsyncSession],
    queue: NotifyQueue,
    stop: asyncio.Event,
) -> None:
    """The three cycles of the dispatcher: ensure the consumer groups
    and reclaim hanging queue items at process start (§3.1, §4.4), then
    one ``asyncio.TaskGroup`` — a stop-event winds all loops down
    correctly (§3.8). The sync adapter's start calls go through
    ``asyncio.to_thread`` (§3.1); a failure there is a process-start
    failure — loud, before any cycle begins."""
    interval = settings.NOTIFY_POLL_INTERVAL
    # Consumer-start duty (§3.1): the groups MUST exist before the
    # XAUTOCLAIM of ``reclaim_hanging`` — on a fresh Redis they don't,
    # and the start would die with NOGROUP before any cycle begins.
    await asyncio.to_thread(queue.ensure_consumer_groups)
    await asyncio.to_thread(queue.reclaim_hanging)

    async def polling_iteration() -> None:
        await process_pending_batch(session_factory, queue)
        await reenqueue_stale_tasks(session_factory, queue)

    async def statuses_iteration() -> None:
        await statuses_once(session_factory, queue)

    async def inbound_iteration() -> None:
        await inbound_once(queue)

    async with asyncio.TaskGroup() as tg:
        tg.create_task(run_loop("polling", stop, interval, polling_iteration, log=logger))
        tg.create_task(run_loop("statuses", stop, interval, statuses_iteration, log=logger))
        tg.create_task(run_loop("inbound", stop, interval, inbound_iteration, log=logger))


# ── process entry ───────────────────────────────────────────────────────────


async def main(queue: NotifyQueue | None = None) -> None:
    """``python -m src.notify.dispatcher``. Disabled (``NOTIFY_ENABLED=false``,
    the default): log and return 0 — events keep accumulating in the
    journal (family §3.3). Enabled: validate the channel priority loudly,
    select the transport adapter, then run the three cycles until
    SIGTERM/KeyboardInterrupt.

    Adapter selection (GH #483 spec §3.1): no injected queue →
    ``connect_or_exit(REDIS_URL)`` — the fail-fast gate builds the
    ``RedisQueue`` and refuses the process LOUDLY (``SystemExit(2)``,
    stable message, the URL value never disclosed) when the transport
    is not configured or unreachable. An explicitly injected queue
    (the part-1 test seam) skips selection entirely.
    """
    if not settings.NOTIFY_ENABLED:
        logger.info(
            "notify dispatcher: NOTIFY_ENABLED=false — exiting (domain events keep accumulating)"
        )
        return

    channels = parse_channel_priority(settings.NOTIFY_CHANNEL_PRIORITY)
    logger.info("notify dispatcher starting (channel priority: %s)", channels)

    if queue is None:
        # Part-1's FakeQueue fallback is gone: an enabled dispatcher with
        # no configured/working transport must not rotate silently — the
        # gate exits code 2 before any cycle starts.
        queue = connect_or_exit(settings.REDIS_URL.get_secret_value())

    # Standalone-entry engine (the ``seed`` pattern): inherits the repo
    # connection pragmas — busy_timeout + WAL (src/db/database.py).
    database_url = os.environ.get("DATABASE_URL", "sqlite+aiosqlite:///./memo.db")
    manager = DBManager(database_url)
    stop = asyncio.Event()
    install_signal_handlers(stop)
    try:
        await run_dispatcher(manager.async_session, queue, stop)
    finally:
        await manager.engine.dispose()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    # KeyboardInterrupt ONLY: the transport gate's SystemExit(2) (spec §3.1,
    # S3) must propagate — the process exit code IS the fail-fast contract.
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("notify dispatcher: interrupted — stopped")
