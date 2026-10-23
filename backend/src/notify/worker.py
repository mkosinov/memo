"""GH #484 (part 3 of the notify family #476; spec §3.1/§3.3/§3.7) —
the notify WORKER process: the delivery loop consuming ``notify:tasks``.

Standalone entry ``python -m src.notify.worker`` — the second process
entry of the family. The worker has NO database and NO rendering
(ADR 009): ready text and addresses arrive in the payload, only §4.3
status events go up.

Startup (spec §3.1/§3.3, strictly in order):

- ``NOTIFY_ENABLED=false`` (the default) — journal line, quiet exit 0;
- ``parse_channel_priority`` → ``validate_priority_channels`` — an
  unregistered priority name is a LOUD ``SystemExit(2)`` BEFORE the
  group is created or anything is consumed (§3.3);
- the transport gate — ``connect_or_exit(REDIS_URL)`` refuses the
  process loudly (``SystemExit(2)``, stable message, the URL value
  never disclosed) and carries ``reclaim_min_idle_ms =
  NOTIFY_REENQUEUE_AFTER x 1000`` (the setting is seconds, XAUTOCLAIM
  wants milliseconds);
- channel instances — injected (the test seam) or built from the
  priority names;
- ``ensure_worker_group`` (``id=0`` — the accumulated backlog stays
  deliverable; the point of part 3) → ``reclaim_hanging_tasks`` (both
  via ``to_thread`` — XAUTOCLAIM needs the group to exist) → signal
  handlers → ``run_loop("delivery", ...)``.

The loop (spec §3.1): each iteration claims a non-blocking batch,
validates every payload (brak → identifiers-only journal + ack, no
status — §3.1), delivers valid ones through the §3.4 core with
statuses published via ``to_thread(queue.publish_status)``, and acks
the task only AFTER the whole publication; then the PERIODIC
``reclaim_hanging_tasks`` returns entries abandoned mid-flight (a
crashed iteration, a transport outage) within minutes instead of at
the next restart. A ``NotifyTransportError`` propagates to the
``run_loop`` guard: the record keeps its delivery ticket, attempts
never continue status-less (monitoring beats haste, §3.1).
"""

from __future__ import annotations

import asyncio
import contextlib
import functools
import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from src.core.config import settings
from src.notify.channels.base import ChannelAppError, ChannelTransportError
from src.notify.channels.registry import (
    build_instances,
    parse_channel_priority,
    validate_priority_channels,
)
from src.notify.process import install_signal_handlers, run_loop
from src.notify.redis_queue import connect_or_exit

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from src.notify.channels.base import Channel
    from src.notify.queue import StatusEvent, TaskPayload, WorkerQueue

# The notify family logger convention (src/notify/journal.py):
# "memo.notify.<module>", independent of import paths.
logger = logging.getLogger("memo.notify.worker")

# ── module constants (spec §3.4 — deliberately NOT settings) ────────────────

#: Pause before a transport retry when the channel gave no
#: ``retry_after`` (spec §3.4 — a module constant, not a setting).
TRANSPORT_RETRY_PAUSE_SECONDS = 1.0

#: Ceiling of a channel-requested ``retry_after`` pause; anything over
#: it is capped with a journal line (spec §3.4).
RETRY_AFTER_CAP_SECONDS = 30.0


# ── delivery core: validator + channel sweep (spec §3.1/§3.4/§3.5) ──────────


def _utc_now_iso_z() -> str:
    """UTC now → ISO 8601 with the ``Z`` suffix (the ``occurred_at``
    serialization of every §4.3 event — same convention as the
    dispatcher/scenario/mock modules)."""
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _status_event(
    task_id: int,
    stage: str,
    channel: str,
    outcome: str,
    *,
    error: str | None = None,
) -> StatusEvent:
    """One §4.3 stage event with the full contract key set — no
    notification text, no client data (family §4.3)."""
    return {
        "task_id": task_id,
        "stage": stage,
        "channel": channel,
        "outcome": outcome,
        "error": error,
        "occurred_at": _utc_now_iso_z(),
    }


class InvalidTaskPayload(ValueError):  # noqa: N818 — the plan/spec fix
    # this exact name as the §4.2 brak contract; it names the PAYLOAD
    # state, not an error mode.
    """Task payload violating the family §4.2 shape — brak: log + ack,
    no status event (nothing to address)."""


def parse_task_payload(raw: dict[str, Any]) -> TaskPayload:
    """Validate a ``notify:tasks`` payload (spec §3.1): ``task_id`` — a
    positive int, ``text`` — a string, ``channels`` — a non-empty list
    of ``{name, address}`` records with non-empty string values. ANY
    violation braks the whole task — the caller logs (identifiers and
    keys only, never the text) and acks the item away. Delivery-
    irrelevant ``created_at``/``resend_of`` are deliberately not
    checked. Returns the same dict untouched: the seam stays plain JSON
    (§4.2), no new schema objects (ADR 009).
    """
    task_id = raw.get("task_id")
    if not isinstance(task_id, int) or task_id <= 0:
        raise InvalidTaskPayload(f"task_id must be a positive int, got {type(task_id).__name__}")
    if not isinstance(raw.get("text"), str):
        raise InvalidTaskPayload(f"text must be a string, got {type(raw.get('text')).__name__}")
    channels = raw.get("channels")
    if not isinstance(channels, list) or not channels:
        raise InvalidTaskPayload(
            f"channels must be a non-empty list, got {type(channels).__name__}"
        )
    for index, entry in enumerate(channels):
        if (
            not isinstance(entry, dict)
            or not isinstance(entry.get("name"), str)
            or not entry.get("name")
            or not isinstance(entry.get("address"), str)
            or not entry.get("address")
        ):
            raise InvalidTaskPayload(
                f"channels[{index}] must be a dict with non-empty string name and address"
            )
    return raw


async def deliver_task(
    task: TaskPayload,
    channels: dict[str, Channel],
    queue: WorkerQueue,
    *,
    retries: int,
    sleep: Callable[[float], Awaitable[None]],
    stop: asyncio.Event,
    publish: Callable[[StatusEvent], Awaitable[None]],
) -> None:
    """The §3.4 delivery algorithm of one VALID task (brak payloads
    never get here — the delivery loop validates first).

    Sweeps the payload channel records in their payload order (the
    dispatcher already ordered them by priority, family §4.2):

    - a name missing from the priority instances → ``failed/
      unknown_channel``, next record (spec §3.3);
    - ``is_available()`` false → ``failed/unavailable``, next record —
      no attempt is burned (spec §3.5);
    - up to ``retries`` attempts per channel: ``sending/attempt`` →
      ``send``; success → ``sent/delivered`` and RETURN (the task is
      done, the remaining records are not tried);
    - ``ChannelAppError`` and ANY unclassified exception (a channel
      bug, §3.2: loud trace, the exception class in ``error``) close
      the channel as ``failed/app_error`` — never retried, next record;
    - ``ChannelTransportError`` → ``failed/transport_error``; while the
      attempt budget lasts, sleep ``min(retry_after or 1s, 30s)`` and
      retry (the budget is checked BEFORE sleeping — the last failure
      buys no pause), otherwise next record;
    - every record exhausted → ONE final ``failed/not_delivered``
      carrying the LAST record's channel name (§3.5: the attempt-log
      channel column is NOT NULL).

    Seams: ``publish`` — the §4.3 status seam (the production loop
    wraps ``queue.publish_status`` in ``to_thread``); a publication
    ``NotifyTransportError`` propagates — attempts do not continue
    status-less, the item keeps its delivery ticket (spec §3.1: ack
    happens in the loop only after the whole task succeeds).
    ``sleep`` — the clock seam (in production
    ``wait_for(stop.wait(), timeout=pause)`` so SIGTERM never waits
    out a pause's tail). ``queue`` — the caller's transport handle;
    the core itself never claims/acks — that is the delivery loop's
    ownership. Message bodies never reach the journal: identifiers and
    outcomes only.
    """
    task_id = task["task_id"]
    text = task["text"]
    last_name = ""
    for entry in task["channels"]:
        name = entry["name"]
        last_name = name
        channel = channels.get(name)
        if channel is None:
            await publish(_status_event(task_id, "failed", name, "unknown_channel"))
            continue
        try:
            available = await channel.is_available()
        except Exception as exc:
            # A channel bug in the probe — same rule as in send (§3.2):
            # loud trace, the exception class in ``error``, the channel
            # closes as an app error, next record.
            logger.exception(
                "notify worker: is_available of channel %r raised — closing as app_error (task %s)",
                name,
                task_id,
            )
            await publish(
                _status_event(
                    task_id,
                    "failed",
                    name,
                    "app_error",
                    error=type(exc).__name__,
                )
            )
            continue
        if not available:
            await publish(_status_event(task_id, "failed", name, "unavailable"))
            continue
        for attempt in range(1, retries + 1):
            await publish(_status_event(task_id, "sending", name, "attempt"))
            try:
                await channel.send(entry["address"], text)
            except ChannelAppError as exc:
                await publish(_status_event(task_id, "failed", name, "app_error", error=str(exc)))
                break
            except ChannelTransportError as exc:
                await publish(
                    _status_event(
                        task_id,
                        "failed",
                        name,
                        "transport_error",
                        error=str(exc),
                    )
                )
                if attempt >= retries:
                    break  # budget spent — next record, no pause
                requested = exc.retry_after or TRANSPORT_RETRY_PAUSE_SECONDS
                pause = min(requested, RETRY_AFTER_CAP_SECONDS)
                if exc.retry_after is not None and exc.retry_after > RETRY_AFTER_CAP_SECONDS:
                    logger.warning(
                        "notify worker: retry_after %.1fs capped to %.1fs (task %s, channel %s)",
                        exc.retry_after,
                        RETRY_AFTER_CAP_SECONDS,
                        task_id,
                        name,
                    )
                await sleep(pause)
                continue
            except Exception as exc:
                # Unclassified = a channel bug, not a ChannelError (§3.2):
                # retrying a bug is pointless, losing the observability
                # is not — loud trace, close as app_error, next record.
                logger.exception(
                    "notify worker: unclassified exception from channel %r"
                    " send — closing as app_error (task %s)",
                    name,
                    task_id,
                )
                await publish(
                    _status_event(
                        task_id,
                        "failed",
                        name,
                        "app_error",
                        error=type(exc).__name__,
                    )
                )
                break
            else:
                await publish(_status_event(task_id, "sent", name, "delivered"))
                return
    await publish(_status_event(task_id, "failed", last_name, "not_delivered"))


# ── the delivery loop (spec §3.1: periodic reclaim, ack after statuses) ─────


async def _sleep_through(stop: asyncio.Event, pause: float) -> None:
    """The production clock seam (§3.4): a retry pause is interrupted by
    the stop-event — SIGTERM never waits out a pause's tail."""
    with contextlib.suppress(asyncio.TimeoutError):
        await asyncio.wait_for(stop.wait(), timeout=pause)


async def delivery_once(
    queue: WorkerQueue, channels: dict[str, Channel], stop: asyncio.Event
) -> None:
    """One delivery pass of the loop (spec §3.1): claim a non-blocking
    batch, deliver every task, then the PERIODIC hanging-task reclaim —
    an entry abandoned mid-flight (a crashed iteration, a transport
    outage) returns to delivery within minutes, not at the next restart.

    Per task: ``parse_task_payload`` — brak → loud journal (task_id and
    keys, never the message text) + ``ack_task`` WITHOUT a status event,
    the batch continues; a valid task goes through the §3.4 core and is
    acked only AFTER the whole status publication (§3.1: a crash in
    between gives a rare delivery duplicate — both accepted, §4.4).

    A ``NotifyTransportError`` anywhere here (claim, publish, ack,
    reclaim) propagates to the ``run_loop`` guard: the record keeps its
    delivery ticket — attempts never continue status-less (monitoring
    beats haste, §3.1); the periodic reclaim of a LATER iteration
    returns it.
    """
    items = await asyncio.to_thread(queue.claim_tasks)
    for item in items:
        try:
            task = parse_task_payload(item)
        except InvalidTaskPayload as exc:
            logger.error(
                "notify worker: brak task payload (task_id=%r, keys=%s): %s"
                " — acking without a status event",
                item.get("task_id"),
                sorted(str(key) for key in item),
                exc,
            )
            await asyncio.to_thread(queue.ack_task, item)
            continue
        await deliver_task(
            task,
            channels,
            queue,
            retries=settings.NOTIFY_SEND_RETRIES,
            sleep=functools.partial(_sleep_through, stop),
            stop=stop,
            publish=lambda event: asyncio.to_thread(queue.publish_status, event),
        )
        await asyncio.to_thread(queue.ack_task, item)
    await asyncio.to_thread(queue.reclaim_hanging_tasks)


# ── process entry ───────────────────────────────────────────────────────────


async def main(
    queue: WorkerQueue | None = None, channels: dict[str, Channel] | None = None
) -> None:
    """``python -m src.notify.worker``. Disabled (``NOTIFY_ENABLED=false``,
    the default): log and return 0. Enabled: the startup checks of
    §3.1/§3.3 in order — parse and validate the channel priority (an
    unregistered name is a loud ``SystemExit(2)`` before the group is
    created), select the transport adapter (``connect_or_exit`` carries
    ``reclaim_min_idle_ms = NOTIFY_REENQUEUE_AFTER x 1000``), resolve
    the channel instances (injected — the test seam — or built from the
    priority), create the ``worker`` group and reclaim the hanging
    tasks, install the signal handlers, then run the delivery loop
    until SIGTERM/KeyboardInterrupt. An explicitly injected queue skips
    adapter selection entirely.
    """
    if not settings.NOTIFY_ENABLED:
        logger.info("notify worker: NOTIFY_ENABLED=false — exiting (the queue stays untouched)")
        return

    names = parse_channel_priority(settings.NOTIFY_CHANNEL_PRIORITY)
    validate_priority_channels(names)

    if queue is None:
        queue = connect_or_exit(
            settings.REDIS_URL.get_secret_value(),
            reclaim_min_idle_ms=settings.NOTIFY_REENQUEUE_AFTER * 1000,
        )

    channels = channels or build_instances(names)

    stop = asyncio.Event()
    await asyncio.to_thread(queue.ensure_worker_group)
    await asyncio.to_thread(queue.reclaim_hanging_tasks)
    install_signal_handlers(stop)
    logger.info("notify worker starting (channel priority: %s)", names)

    async def iteration() -> None:
        await delivery_once(queue, channels, stop)

    await run_loop("delivery", stop, settings.NOTIFY_POLL_INTERVAL, iteration, log=logger)


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    # KeyboardInterrupt ONLY: the transport gate's SystemExit(2) (spec §3.1,
    # S5) must propagate — the process exit code IS the fail-fast contract.
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("notify worker: interrupted — stopped")
