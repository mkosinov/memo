"""GH #484 (part 3 of the notify family #476; spec §3.1/§3.3/§3.7) —
the notify WORKER process: the delivery loop consuming ``notify:tasks``.

Standalone entry ``python -m src.notify.worker`` — the second process
entry of the family. The worker has NO database (ADR 009): the frozen
render data and the channel template arrive in the payload (rev.5,
ADR 014), the worker ASSEMBLES the text per task — once, in the
environment variant keyed by the task's channel escape mode (spec
§5.2/§5.3) — and sends it to the task's ONE channel; only §4.3 status
events go up (carrying the actually transmitted ``sent_text``).

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
from src.notify.assembly import RenderError, assemble_text
from src.notify.channels.base import ChannelAppError, ChannelTransportError
from src.notify.channels.limits import ChannelLimiter, RedisCapStore
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
    task_id: str,
    stage: str,
    channel: str,
    outcome: str,
    *,
    error: str | None = None,
    sent_text: str | None = None,
) -> StatusEvent:
    """One §4.3 rev.5 stage event with the full contract key set —
    ``sent_text`` carries the text actually handed to the transport
    (``sending``/``sent`` stages); failure stages keep it ``None``.
    No other client data rides the statuses (family §4.3)."""
    return {
        "task_id": task_id,
        "stage": stage,
        "channel": channel,
        "outcome": outcome,
        "error": error,
        "sent_text": sent_text,
        "occurred_at": _utc_now_iso_z(),
    }


class InvalidTaskPayload(ValueError):  # noqa: N818 — the plan/spec fix
    # this exact name as the §4.2 brak contract; it names the PAYLOAD
    # state, not an error mode.
    """Task payload violating the family §4.2 shape — brak: log + ack,
    no status event (nothing to address)."""


#: Spec §5.4 (rev.5): the fixed russian phrase of an assembly failure —
#: a deterministic app error, never retried on the transport.
ASSEMBLY_ERROR_MESSAGE = "не удалось собрать текст уведомления: "


def parse_task_payload(raw: dict[str, Any]) -> TaskPayload:
    """Validate a ``notify:tasks`` payload (spec §3.1; §4.2 rev.5 — the
    task is ONE channel, ADR 014): ``task_id`` — a NON-EMPTY STRING (a
    UUID String(36): ``NotifyTask.id``, the AbstractModel PK — the shape
    scenarios and the re-enqueue cycle actually put on the seam; the
    original §4.2 int example was a sketch artifact, corrected by the
    #560 spec errata; ints/bools are brak), ``channel`` — a non-empty
    string (the ONE channel of this task), ``address`` — a non-empty
    string (frozen, never re-resolved), ``payload`` — a dict (the §4.1
    render data), ``template_body`` — a string (the frozen template the
    worker assembles the text from). ANY violation braks the whole task
    — the caller logs (identifiers and keys only, never the payload
    data) and acks the item away. Delivery-irrelevant ``template_id``/
    ``root_task_id``/``created_at``/``resend_of`` are deliberately not
    checked; ``template_channel`` (the frozen template's ORIGIN, #485
    Task 4) is metadata too — a missing value means the universal
    spelling and never braks. Returns the same dict untouched: the seam
    stays plain JSON (§4.2), no new schema objects (ADR 009).
    """
    task_id = raw.get("task_id")
    if not isinstance(task_id, str) or not task_id:
        raise InvalidTaskPayload(
            f"task_id must be a non-empty string (UUID String(36) NotifyTask.id),"
            f" got {type(task_id).__name__}"
        )
    channel = raw.get("channel")
    if not isinstance(channel, str) or not channel:
        raise InvalidTaskPayload(
            f"channel must be a non-empty string, got {type(channel).__name__}"
        )
    if not isinstance(raw.get("address"), str) or not raw.get("address"):
        raise InvalidTaskPayload(
            f"address must be a non-empty string, got {type(raw.get('address')).__name__}"
        )
    if not isinstance(raw.get("payload"), dict):
        raise InvalidTaskPayload(
            f"payload must be a dict, got {type(raw.get('payload')).__name__}"
        )
    if not isinstance(raw.get("template_body"), str):
        raise InvalidTaskPayload(
            "template_body must be a string,"
            f" got {type(raw.get('template_body')).__name__}"
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

    Rev.5 (ADR 014): the task is ONE channel, and the worker owns the
    text assembly (spec §5.2/§5.3):

    - the name missing from the priority instances → ``failed/
      unknown_channel`` (no assembly — the escape mode is the channel's
      to declare);
    - ``is_available()`` false → ``failed/unavailable`` — no attempt
      is burned (spec §3.5), no assembly either (nothing would
      transmit the text);
    - the text is assembled ONCE from the frozen ``payload`` +
      ``template_body``, the environment variant keyed by the channel's
      declared ``escape_mode`` — regardless of the template's origin
      (§5.3: a telegram task HTML-escapes values even from a universal
      template); assembly failure → ``RenderError`` → ONE ``failed/
      app_error`` («не удалось собрать текст уведомления: …», spec
      §5.4) and RETURN — a deterministic error, no transport retries;
      the dispatcher chain (part 4 Task 5) owns the next channel;

    then up to ``retries`` attempts of the single channel (every
    attempt sends the SAME assembled text, §5.2):

    - ``sending/attempt`` → ``send``; success → ``sent/delivered`` and
      RETURN;
    - ``ChannelAppError`` and ANY unclassified exception (a channel
      bug, §3.2: loud trace, the exception class in ``error``) close
      the channel as ``failed/app_error`` — never retried;
    - ``ChannelTransportError`` → ``failed/transport_error``; while the
      attempt budget lasts, sleep ``min(retry_after or 1s, 30s)`` and
      retry (the budget is checked BEFORE sleeping — the last failure
      buys no pause), otherwise the task ends ``failed/
      not_delivered``.

    ``sent_text`` rides the ``sending``/``sent`` stages (the §4.3 rev.5
    audit trail of the actually transmitted text); failure stages carry
    ``None``.

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
    name = task["channel"]

    channel = channels.get(name)
    if channel is None:
        await publish(_status_event(task_id, "failed", name, "unknown_channel"))
        await publish(_status_event(task_id, "failed", name, "not_delivered"))
        return

    try:
        available = await channel.is_available()
    except Exception as exc:
        # A channel bug in the probe — same rule as in send (§3.2):
        # loud trace, the exception class in ``error``, the channel
        # closes as an app error.
        logger.exception(
            "notify worker: is_available of channel %r raised — closing as app_error (task %s)",
            name,
            task_id,
        )
        await publish(
            _status_event(task_id, "failed", name, "app_error", error=type(exc).__name__)
        )
        await publish(_status_event(task_id, "failed", name, "not_delivered"))
        return

    if not available:
        await publish(_status_event(task_id, "failed", name, "unavailable"))
        await publish(_status_event(task_id, "failed", name, "not_delivered"))
        return

    # ONCE per task (spec §5.2): the environment variant is keyed by
    # the TASK'S channel escape mode (§5.3 — regardless of the
    # template's origin); the retries below send this same ``text``.
    try:
        text = assemble_text(
            task["template_body"], task["payload"], escape_mode=channel.escape_mode
        )
    except RenderError as exc:
        # Spec §5.4: deterministic assembly failure — one app_error,
        # no transport retries (retrying a bug is pointless).
        await publish(
            _status_event(
                task_id,
                "failed",
                name,
                "app_error",
                error=f"{ASSEMBLY_ERROR_MESSAGE}{exc}",
            )
        )
        return

    for attempt in range(1, retries + 1):
        await publish(
            _status_event(task_id, "sending", name, "attempt", sent_text=text)
        )
        try:
            # The frozen template ORIGIN rides every send (spec §6.2 —
            # the channel keys its transport parse mode by it; §5.2 —
            # retries send the same text, hence the same origin). A
            # payload without the key (legacy in-flight) sends ``None``
            # — the plain/universal spelling, never a crash.
            await channel.send(
                task["address"], text, template_channel=task.get("template_channel")
            )
        except ChannelAppError as exc:
            await publish(
                _status_event(task_id, "failed", name, "app_error", error=str(exc))
            )
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
                break  # budget spent — the channel task is done, no pause
            requested = exc.retry_after or TRANSPORT_RETRY_PAUSE_SECONDS
            pause = min(requested, RETRY_AFTER_CAP_SECONDS)
            if (
                exc.retry_after is not None
                and exc.retry_after > RETRY_AFTER_CAP_SECONDS
            ):
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
            # Unclassified = a channel bug, not a ChannelError
            # (§3.2): retrying a bug is pointless, losing the
            # observability is not — loud trace, app_error.
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
            await publish(
                _status_event(task_id, "sent", name, "delivered", sent_text=text)
            )
            return
    # The channel task is terminally done without a delivery (rev.5:
    # ONE final event — the dispatcher chain owns the next channel).
    await publish(_status_event(task_id, "failed", name, "not_delivered"))


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
    the channel instances (injected — the test seam — or built from
    the priority THROUGH the send-limits mechanism: a ``ChannelLimiter``
    over the ``RedisCapStore`` wraps every registry-built channel,
    #485 Task 3 spec §4.4/§6.3), create the ``worker`` group and
    reclaim the hanging tasks, install the signal handlers, then run
    the delivery loop until SIGTERM/KeyboardInterrupt. An explicitly
    injected queue skips adapter selection entirely.
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

    stop = asyncio.Event()
    if channels is None:
        # Registry-built channels go through the send-limits mechanism
        # (#485 Task 3, spec §4.4/§6.3): the cap store rides the same
        # Redis the transport gate just validated; injected channels
        # (the test seam) are used as-is — a contour wraps its own.
        limiter = ChannelLimiter(
            RedisCapStore(settings.REDIS_URL.get_secret_value()),
            sleep=functools.partial(_sleep_through, stop),
        )
        channels = build_instances(names, limiter=limiter)

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
