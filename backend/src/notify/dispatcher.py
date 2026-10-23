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
  ``queued`` tasks with ``updated_at`` older than ``NOTIFY_REENQUEUE_AFTER``
  are re-enqueued with the SAVED payload in full (no address
  re-resolution); the ``updated_at`` refresh is the re-enqueue stamp that
  keeps the sweep from firing every tick; past the cap (module constant,
  not a setting) the task is ``failed``.
- **Cycle 2 — ``notify:statuses``**: ``reclaim_hanging()`` at process
  start, then claim → per event one append-only attempt row + the §4.3
  derived task state in ONE commit → ack. Unapplied items stay unacked
  and are reclaimed at the next process start (at-least-once, §4.4).
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
from src.notify.queue import InboundEvent
from src.notify.redis_queue import NotifyTransportError, connect_or_exit
from src.notify.scenarios import SCENARIOS

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
    """Re-enqueue ``queued`` tasks older than ``NOTIFY_REENQUEUE_AFTER``.

    The payload is the SAVED task payload in full — text and channels
    from the row, addresses never re-resolved (§3.4 panel finding). The
    ORM ``onupdate`` refresh of ``updated_at`` is the re-enqueue stamp:
    without it the age predicate would fire every polling tick instead
    of once per window. Past ``REENQUEUE_CAP`` the task becomes ``failed``
    (the error text has no column on the task row — it is logged; part 5
    screens read the attempt journal for failure detail).

    Deliberate inversion: the enqueue lands BEFORE the stamp is committed
    — a crash in between leaves an unstamped task that the next sweep
    re-enqueues again, an at-least-once duplicate absorbed by the
    terminal-``sent`` rule (§4.4), whereas the reverse order could
    silently lose a notification for a full re-enqueue window.
    """
    threshold = datetime.now(UTC).replace(tzinfo=None) - timedelta(
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
            else:
                try:
                    # sync adapter off the event loop (spec §3.1)
                    await asyncio.to_thread(
                        queue.enqueue_task,
                        {
                            "task_id": task.id,
                            "text": task.text,
                            "channels": task.channels,
                            "created_at": _utc_now_iso_z(),
                            "resend_of": None,
                        },
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


async def apply_status_event(session: AsyncSession, item: StatusEvent) -> None:
    """One §4.3 stage event → append-only attempt row + derived task
    state, ONE commit (the caller acks only after it succeeds).

    Derived state: the stage vocabulary maps 1:1 onto task statuses
    (``sending``/``sent``/``failed``); the single special rule is that
    ``sent`` is TERMINAL — the first ``sent`` of any attempt wins and is
    never overridden (a late ``failed`` after a success, e.g. a
    re-enqueue duplicate, must not flip a delivered task). Idempotent
    re-apply only appends the attempt row (§4.4 — duplicates accepted).
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
            occurred_at=_naive_utc(item["occurred_at"]),
        )
    )
    if task.status != "sent":
        task.status = stage
    await session.commit()


async def statuses_once(
    session_factory: async_sessionmaker[AsyncSession], queue: NotifyQueue
) -> None:
    """Claim ``notify:statuses`` → apply each event in its own commit →
    ack. An unapplied item is logged and left UNACKED: the reliable-list
    reclaim at the next process start redelivers it (§4.4), and sibling
    items of the same batch still proceed. The sync adapter is called
    through ``asyncio.to_thread`` (§3.1) — a transport failure propagates
    to the loop guard, the next tick retries.
    """
    for item in await asyncio.to_thread(queue.claim_statuses):
        try:
            async with session_factory() as session:
                await apply_status_event(session, item)
        except Exception:
            logger.exception(
                "notify dispatcher: status event %r not applied — left unacked for reclaim",
                item,
            )
        else:
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
