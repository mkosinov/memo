"""GH #483 Task 5 — the notify worker skeleton (spec §3.4; ADR 009).

Standalone entry ``python -m src.notify.worker`` — the SECOND process
entry of the notify family: unlike the dispatcher the worker has NO
database (ADR 009) and, as a skeleton, does not consume
``notify:tasks`` either — consuming with empty delivery logic would
create the group and strand every entry in its PEL unprocessed; the
``XREADGROUP`` loop and the ``worker`` consumer group ship in part 3
(#484). What the skeleton fixes (S5): the process starts, the fail-fast
gates and the signal handlers work, the transport link is up.

- Disabled subsystem (``NOTIFY_ENABLED=false``, the default): journal
  line + quiet exit 0 — symmetric to the dispatcher (family §3.3).
- Enabled: the SAME fail-fast gates as the dispatcher (spec §3.1) —
  ``connect_or_exit(REDIS_URL)`` refuses the process LOUDLY
  (``SystemExit(2)``, stable message, the URL value never disclosed)
  when the transport is not configured or does not answer PING;
  then SIGTERM/SIGINT handlers set the stop-event, one startup line
  «worker skeleton: delivery logic ships in #484» is journalled, and
  the process idles until a signal — quiet, exit 0 on shutdown.

Part 3, task 4: the module now carries the DELIVERY CORE —
``parse_task_payload`` (the §4.2 validator) and ``deliver_task`` (the
§3.4 channel sweep with retries) — pure functions over the injected
seams, no DB, no rendering (ADR 009). The delivery LOOP consuming
``notify:tasks`` is the next task: it wires the core into
``run_loop`` with claiming, acking, and the periodic reclaim.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from src.core.config import settings
from src.notify.channels.base import (
    Channel,
    ChannelAppError,
    ChannelTransportError,
)
from src.notify.process import install_signal_handlers
from src.notify.redis_queue import connect_or_exit

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from src.notify.queue import NotifyQueue, StatusEvent, TaskPayload, WorkerQueue

# The notify family logger convention (src/notify/journal.py):
# "memo.notify.<module>", independent of import paths.
logger = logging.getLogger("memo.notify.worker")

# ── module constants (spec §3.4 — deliberately NOT settings) ────────────────

#: Idle tick of the skeleton loop: a periodic no-op wait, the pulse the
#: part-3 delivery loop will replace.
IDLE_TICK_SECONDS = 1.0

#: The one startup line of the skeleton (spec §3.4 verbatim).
SKELETON_MESSAGE = "worker skeleton: delivery logic ships in #484"

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


# ── concurrency: signal handlers (process.py §3.7) + idle loop (§3.4) ───────


async def idle_loop(queue: NotifyQueue, stop: asyncio.Event) -> None:
    """The skeleton's idle wait: tick until the stop-event, NEVER read
    the queue (spec §3.4 — consumption is part 3; ``queue`` is received
    now so the part-3 loop replaces this body without re-plumbing the
    entry). Only the stop-event ends the process: SIGTERM/SIGINT set it
    (see :func:`src.notify.process.install_signal_handlers`), and the
    wait-for-stop form reacts within one tick instead of sleeping
    through a whole interval.
    """
    while not stop.is_set():
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=IDLE_TICK_SECONDS)


# ── process entry ───────────────────────────────────────────────────────────


async def main(queue: NotifyQueue | None = None) -> None:
    """``python -m src.notify.worker``. Disabled (``NOTIFY_ENABLED=false``,
    the default): log and return 0. Enabled: the fail-fast transport
    gate (spec §3.1), SIGTERM/SIGINT handlers, then the idle loop — the
    skeleton never consumes ``notify:tasks`` (part 3, #484). An
    explicitly injected queue (the test seam) skips gate selection.
    """
    if not settings.NOTIFY_ENABLED:
        logger.info("notify worker: NOTIFY_ENABLED=false — exiting (the queue stays untouched)")
        return

    if queue is None:
        # No FakeQueue fallback: an enabled worker with no configured or
        # unreachable transport must not idle silently — the gate exits
        # code 2 before the loop starts (spec §3.1, S5).
        queue = connect_or_exit(settings.REDIS_URL.get_secret_value())

    stop = asyncio.Event()
    install_signal_handlers(stop)
    logger.info(SKELETON_MESSAGE)
    await idle_loop(queue, stop)


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
