"""GH #482 Task 9 — the dispatcher process (spec §3.8; family #476 §3.2/§4.3/§4.4).

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
import contextlib
import logging
import os
import signal
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import select

import src.models  # noqa: F401 — registration first; breaks the models↔notify import cycle
from src.core.config import settings
from src.db.database import DBManager
from src.notify.models import DomainEvent, NotifyTask, NotifyTaskAttempt
from src.notify.queue import FakeQueue, InboundEvent
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


# ── settings parsing (§3.8) ─────────────────────────────────────────────────


def parse_channel_priority(raw: str) -> list[str]:
    """Parse ``NOTIFY_CHANNEL_PRIORITY`` (CSV, case-insensitive).

    An empty string (or an empty segment) or duplicate names are a LOUD
    startup error: the setting must never produce an empty/duplicated
    channel list in task payloads. Channel NAMES are not validated here
    — an unregistered channel is the worker's loud startup error
    (family §3.5, part 3).
    """
    names = [part.strip().lower() for part in raw.strip().split(",")]
    if not any(names):
        raise ValueError(
            f"NOTIFY_CHANNEL_PRIORITY is empty — at least one channel is required (got {raw!r})"
        )
    if any(not name for name in names):
        raise ValueError(f"NOTIFY_CHANNEL_PRIORITY has empty segments (got {raw!r})")
    seen: set[str] = set()
    for name in names:
        if name in seen:
            raise ValueError(f"NOTIFY_CHANNEL_PRIORITY duplicate channel {name!r} (got {raw!r})")
        seen.add(name)
    return names


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
    +1, ``processing_error`` at the 3rd failure. No backoff — the next
    polling iteration is the retry cadence (§3.8).

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
                queue.enqueue_task(
                    {
                        "task_id": task.id,
                        "text": task.text,
                        "channels": task.channels,
                        "created_at": _utc_now_iso_z(),
                        "resend_of": None,
                    }
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
    items of the same batch still proceed."""
    for item in queue.claim_statuses():
        try:
            async with session_factory() as session:
                await apply_status_event(session, item)
        except Exception:
            logger.exception(
                "notify dispatcher: status event %r not applied — left unacked for reclaim",
                item,
            )
        else:
            queue.ack_status(item)


# ── cycle 3: notify:inbound (§3.8) ──────────────────────────────────────────


async def inbound_once(queue: NotifyQueue) -> None:
    """Claim ``notify:inbound`` → route by the handler registry. The pilot
    registry is empty, so every event is logged as a warning and acked —
    producers do not exist yet; the routing form is the fixed contract."""
    for item in queue.claim_inbound():
        handler = INBOUND_HANDLERS.get(str(item.get("channel", "")))
        if handler is None:
            logger.warning(
                "notify dispatcher: inbound event on channel %r has no handler — acking",
                item.get("channel"),
            )
        else:
            await handler(item)
        queue.ack_inbound(item)


# ── concurrency model: loops + stop (§3.8) ──────────────────────────────────


async def run_loop(
    name: str,
    stop: asyncio.Event,
    interval: float,
    iteration: Callable[[], Awaitable[None]],
) -> None:
    """Run ``iteration`` until the stop-event, each iteration isolated in
    its own ``try/except``: a crash is logged and the loop (and its
    siblings in the TaskGroup) keep running — a silently dead cycle in a
    live process would be an invisible stop of notifications (panel
    finding, §3.8). Only ``Exception`` is caught; cancellation and
    KeyboardInterrupt propagate so shutdown stays correct."""
    while not stop.is_set():
        try:
            await iteration()
        except Exception:
            logger.exception("notify dispatcher: %s loop iteration failed", name)
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=interval)


async def run_dispatcher(
    session_factory: async_sessionmaker[AsyncSession],
    queue: NotifyQueue,
    stop: asyncio.Event,
) -> None:
    """The three cycles of the dispatcher: reclaim hanging queue items at
    process start (§4.4), then one ``asyncio.TaskGroup`` — a stop-event
    winds all loops down correctly (§3.8)."""
    interval = settings.NOTIFY_POLL_INTERVAL
    queue.reclaim_hanging()

    async def polling_iteration() -> None:
        await process_pending_batch(session_factory, queue)
        await reenqueue_stale_tasks(session_factory, queue)

    async def statuses_iteration() -> None:
        await statuses_once(session_factory, queue)

    async def inbound_iteration() -> None:
        await inbound_once(queue)

    async with asyncio.TaskGroup() as tg:
        tg.create_task(run_loop("polling", stop, interval, polling_iteration))
        tg.create_task(run_loop("statuses", stop, interval, statuses_iteration))
        tg.create_task(run_loop("inbound", stop, interval, inbound_iteration))


def _install_signal_handlers(stop: asyncio.Event) -> None:
    """SIGTERM/SIGINT → the stop-event (§3.8); the TaskGroup then winds
    the loops down. ``add_signal_handler`` is main-thread Unix — silently
    unsupported elsewhere (KeyboardInterrupt remains the fallback)."""
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, stop.set)


# ── process entry ───────────────────────────────────────────────────────────


async def main(queue: NotifyQueue | None = None) -> None:
    """``python -m src.notify.dispatcher``. Disabled (``NOTIFY_ENABLED=false``,
    the default): log and return 0 — events keep accumulating in the
    journal (family §3.3). Enabled: validate the channel priority loudly,
    then run the three cycles until SIGTERM/KeyboardInterrupt."""
    if not settings.NOTIFY_ENABLED:
        logger.info(
            "notify dispatcher: NOTIFY_ENABLED=false — exiting (domain events keep accumulating)"
        )
        return

    channels = parse_channel_priority(settings.NOTIFY_CHANNEL_PRIORITY)
    logger.info("notify dispatcher starting (channel priority: %s)", channels)

    if queue is None:
        # Part 1 boundary (#483): the Redis/arq adapter does not exist yet.
        # Run on FakeQueue, loudly — the process is not launched enabled in
        # any part-1 stack.
        logger.warning(
            "notify dispatcher: no queue adapter configured — using FakeQueue"
            " (the Redis/arq adapter ships in part 2)"
        )
        queue = FakeQueue()

    # Standalone-entry engine (the ``seed`` pattern): inherits the repo
    # connection pragmas — busy_timeout + WAL (src/db/database.py).
    database_url = os.environ.get("DATABASE_URL", "sqlite+aiosqlite:///./memo.db")
    manager = DBManager(database_url)
    stop = asyncio.Event()
    _install_signal_handlers(stop)
    try:
        await run_dispatcher(manager.async_session, queue, stop)
    finally:
        await manager.engine.dispose()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("notify dispatcher: interrupted — stopped")
