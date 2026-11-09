"""Redis Streams transport of the notification queue (GH #483 spec §3.1; ADR 013).

``RedisQueue`` implements the ``NotificationQueue`` port (``queue.py``) as the
notify stream/group vocabulary on top of the GENERIC streams core
``src/streams/transport.py`` (GH #580 spec §3.6) — delegation, not
inheritance: the domain-events relay/subscribers (#580) reuse the same
core without importing notification. All mechanics — pool construction
(retries OFF, socket timeout), XADD with the approximate MAXLEN trim,
``XREADGROUP >`` claims with the ``_qid`` envelope, ``XACK``,
``XGROUP CREATE id=0 MKSTREAM``, the RAW ``XAUTOCLAIM`` PEL transfer,
``ping``/``close`` — live in the core; this adapter keeps the notification
API (verb methods over the three streams below) and the ONE
notification-specific wrapper: a reclaim re-XADDs a verbatim copy of the
claimed entry and acks the old id (the fresh-delivery semantics of a
task/status queue).

The dispatcher wraps every queue call in ``asyncio.to_thread``; the
worker calls the same sync surface from its own process.

Three streams (``MAXLEN ~ 10000`` on every write — the queue is
transport only, real retention lives in the DB per ADR 008; Redis
silently trims the oldest entries at the ceiling, and a write is never
rejected):

- ``notify:tasks`` (down)  — group ``worker`` (the worker half, #484);
- ``notify:statuses``      — group ``dispatcher`` (this part);
- ``notify:inbound``       — group ``dispatcher`` (this part).

Reliable delivery = consumer groups: ``claim_*`` is a NON-blocking
``XREADGROUP >`` (entries land in the consumer's PEL), ``ack_*`` is
``XACK`` by the transport-reserved ``_qid`` envelope (a duplicate ack
is a harmless no-op), and ``reclaim_hanging()`` at consumer start
returns hanging PEL entries (a crashed previous process) to delivery
via ``XAUTOCLAIM``. Claimed items additionally carry ``_qid`` — the
stream entry id; the underscore marks the key as transport-reserved,
the §4.2/§4.3 field contracts are unchanged.

**Single-instance assumption** (spec §2/§3.1): ONE dispatcher and ONE
worker per Redis instance — documented, no leader election in the
pilot; dev/CI contours are isolated.

**Failure volume** (spec §3.1): transport failures are never muted —
every redis error surfaces as :class:`NotificationTransportError` (the alias
of the core's ``StreamTransportError`` — same class object, so the
dispatcher's catch shape and the test corpus keep the alias);
the message carries the original exception class + message and record
identifiers, never message bodies and never the URL value.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

from src.streams.transport import (
    AUTOCLAIM_COUNT as AUTOCLAIM_COUNT,  # re-export: tests/reenqueue contour
)
from src.streams.transport import (
    DEFAULT_RECLAIM_MIN_IDLE_MS,
    ENVELOPE_KEY,
    PAYLOAD_FIELD,
    StreamTransport,
    StreamTransportError,
)
from src.streams.transport import (
    MAX_POOL_CONNECTIONS as MAX_POOL_CONNECTIONS,  # re-export: channels/limits, channels/mock
)
from src.streams.transport import (
    SOCKET_TIMEOUT_SECONDS as SOCKET_TIMEOUT_SECONDS,  # re-export: channels/limits
)
from src.streams.transport import (
    connect_or_exit as core_connect_or_exit,
)

if TYPE_CHECKING:
    from src.notification.queue import InboundEvent, StatusEvent, TaskPayload

logger = logging.getLogger("memo.notification.redis_queue")

# ── stream / group vocabulary (spec §3.1; ADR 013) ──────────────────────────

TASKS_STREAM = "notify:tasks"
STATUSES_STREAM = "notify:statuses"
INBOUND_STREAM = "notify:inbound"

#: Consumer group of the dispatcher process on the up-streams (part 2).
DISPATCHER_GROUP = "dispatcher"
#: Consumer group of the worker process on ``notify:tasks`` — the
#: worker half's group (claim/ack/reclaim, part 3 #484 spec §3.1).
WORKER_GROUP = "worker"

#: Stable fail-fast message (spec §3.1). The URL value NEVER appears
#: next to it — only the fact "not configured".
TRANSPORT_NOT_CONFIGURED_MESSAGE = "notification: transport not configured"

#: The typed transport failure of the notification queue — since the #580
#: core extraction an ALIAS of the generic
#: :class:`src.streams.transport.StreamTransportError` (same class
#: object: ``except NotificationTransportError`` catches core-raised errors
#: and vice versa; the dispatcher/worker catch shape and the test
#: corpus keep the alias).
NotificationTransportError = StreamTransportError


class RedisQueue:
    """``NotificationQueue`` over Redis Streams + consumer groups — the notify
    vocabulary delegating to the generic streams core.

    Consumer names are unique per live process (``<group>-<pid>`` —
    override with ``consumer_name``); hanging-entry recovery works at
    group level (``XAUTOCLAIM``), so the per-process name uniqueness is
    correct. ``close()`` on graceful stop drops the consumer from its
    groups (no ghost consumers).

    ``key_prefix`` namespaces every stream — the test contour's
    isolation on a shared instance; production keeps the default (no
    prefix). ``reclaim_min_idle_ms`` is the ``XAUTOCLAIM`` threshold:
    never below ``NOTIFICATION_REENQUEUE_AFTER`` in production (the consuming
    process passes its setting).
    """

    def __init__(
        self,
        url: str,
        *,
        key_prefix: str = "",
        max_connections: int = MAX_POOL_CONNECTIONS,
        reclaim_min_idle_ms: int = DEFAULT_RECLAIM_MIN_IDLE_MS,
        consumer_name: str | None = None,
    ) -> None:
        self._core = StreamTransport(
            url,
            key_prefix=key_prefix,
            max_connections=max_connections,
            reclaim_min_idle_ms=reclaim_min_idle_ms,
            consumer_name=consumer_name,
            logger=logger,
        )

    # ── producer side (protocol) ─────────────────────────────────────────

    def enqueue_task(self, payload: TaskPayload) -> None:
        self._core.publish(TASKS_STREAM, payload)

    # ── producer side (off-protocol; worker side from part 3) ────────────

    def publish_status(self, event: StatusEvent) -> None:
        """``XADD`` a §4.3 stage event to ``notify:statuses`` (mirrors
        ``FakeQueue.publish_status``; off the DISPATCHER protocol per
        ADR 013 — typed on ``WorkerQueue`` since part 3, #484 §3.1)."""
        self._core.publish(STATUSES_STREAM, event)

    def publish_inbound(self, event: InboundEvent) -> None:
        """``XADD`` a §3.2 inbound event to ``notify:inbound`` (mirrors
        ``FakeQueue.push_inbound``; deliberately NOT on the protocol)."""
        self._core.publish(INBOUND_STREAM, event)

    # ── reliable delivery: notify:statuses / notify:inbound ──────────────

    def claim_statuses(self) -> list[StatusEvent]:
        return self._core.claim(STATUSES_STREAM, DISPATCHER_GROUP)

    def claim_inbound(self) -> list[InboundEvent]:
        return self._core.claim(INBOUND_STREAM, DISPATCHER_GROUP)

    def ack_status(self, item: StatusEvent) -> None:
        self._core.ack(STATUSES_STREAM, DISPATCHER_GROUP, item[ENVELOPE_KEY])

    def ack_inbound(self, item: InboundEvent) -> None:
        self._core.ack(INBOUND_STREAM, DISPATCHER_GROUP, item[ENVELOPE_KEY])

    # ── worker half: notify:tasks, group ``worker`` (part 3 #484 §3.1) ───

    def claim_tasks(self) -> list[TaskPayload]:
        """Non-blocking claim of the ``worker`` group (``XREADGROUP >``,
        ``CLAIM_BATCH``, ``_qid`` envelope)."""
        return self._core.claim(TASKS_STREAM, WORKER_GROUP)

    def ack_task(self, item: TaskPayload) -> None:
        """``XACK`` a delivered task (idempotent, family §4.4)."""
        self._core.ack(TASKS_STREAM, WORKER_GROUP, item[ENVELOPE_KEY])

    def ensure_worker_group(self) -> None:
        """Worker-start duty (spec §3.1): the ``worker`` group on
        ``notify:tasks`` — ``id=0 MKSTREAM``, so the backlog accumulated
        before the group existed stays deliverable (deliberate: tasks
        piled up with no consumer — that is what part 3 consumes;
        «improving» to ``$`` is forbidden). ONLY the concrete BUSYGROUP
        error is suppressed; anything else propagates loudly."""
        self._core.ensure_group(TASKS_STREAM, WORKER_GROUP)

    def reclaim_hanging_tasks(self) -> None:
        """Return claimed-but-unacked TASK entries of the ``worker``
        group back into delivery (§4.4) — tasks only; the statuses and
        inbound streams are the dispatcher half's own reclaim."""
        self._reclaim_stream(TASKS_STREAM, WORKER_GROUP)

    def pending_worker_task_ids(self) -> set[str]:
        """Task ids in the PEL of the ``worker`` group on
        ``notify:tasks`` — the dispatcher's re-enqueue predicate probe
        (family §3.3 rev.5). The PEL paging (XPENDING + XRANGE) lives in
        the core; this side only maps payloads to task ids.

        A missing group/key (NOGROUP — e.g. a wiped transport before the
        worker ever ran) is an EMPTY set: nothing was ever claimed, and
        the re-enqueue sweep MUST proceed for wipe survival (§4.4).
        Every other failure is the typed transport error.
        """
        ids: set[str] = set()
        for _entry_id, fields in self._core.pending_entries(TASKS_STREAM, WORKER_GROUP):
            try:
                ids.add(json.loads(fields[PAYLOAD_FIELD])["task_id"])
            except (json.JSONDecodeError, KeyError, TypeError):
                # A brak payload inside the PEL — the worker's own brak
                # rule acks it away; the probe must not die on it.
                continue
        return ids

    # ── consumer start / graceful stop ───────────────────────────────────

    def ensure_consumer_groups(self) -> None:
        """Consumer-start duty (spec §3.1): the ``dispatcher`` groups on
        the up-streams, ``id=0`` (entries published before the group
        existed stay deliverable). The part-3 worker creates ``worker``
        on the task stream the same way. ONLY the concrete BUSYGROUP
        error is suppressed (group exists); swallowing ``ResponseError``
        whole is forbidden — anything else propagates loudly."""
        for stream in (STATUSES_STREAM, INBOUND_STREAM):
            self._core.ensure_group(stream, DISPATCHER_GROUP)

    # ── process start: reclaim hanging entries (spec §3.1, §4.4) ─────────

    def reclaim_hanging(self) -> None:
        """At consumer start: return claimed-but-unacked entries of the
        group's PEL (a crashed previous process) back to delivery —
        both up-streams (§4.4)."""
        for stream in (STATUSES_STREAM, INBOUND_STREAM):
            self._reclaim_stream(stream, DISPATCHER_GROUP)

    def _reclaim_stream(self, stream: str, group: str) -> None:
        """The notification-specific reclaim wrapper over the core's RAW
        ``XAUTOCLAIM`` (fresh-delivery semantics — kept HERE, out of the
        generic core, #580 §3.6 rev.2):

        - a claimed entry is re-XADDed to the stream FIRST as a VERBATIM
          copy (the next claim sees a NEW entry id), THEN XACKed out of
          the PEL: a crash in between leaves a harmless duplicate
          (family §4.4), the reverse order could lose an entry that had
          already left the PEL;
        - entries deleted under the MAXLEN ceiling are logged terminally
          by the core's autoclaim (entry id + stream, never a message
          body, logging hygiene §3.1)."""
        for entries in self._core.autoclaim(stream, group):
            for entry_id, fields in entries:
                self._core.republish(stream, fields)
                self._core.ack(stream, group, entry_id)

    # ── graceful stop (spec §3.1) ────────────────────────────────────────

    def close(self) -> None:
        """Graceful stop: drop this consumer from its groups (the graceful
        path holds no PEL entries — no ghost consumers), then release the
        pool. The WORKER consumer is dropped only with an EMPTY PEL
        (part 3 #484, spec §3.1): ``XGROUP DELCONSUMER`` destroys the
        consumer's PEL records, and an unacked entry there is the
        designed abort-path state — a hanging entry keeps the consumer
        registered for the next start's ``reclaim_hanging_tasks``. A
        flushed group (NOGROUP) is suppressed — the shutdown must stay
        graceful; other errors stay loud. Idempotent."""
        self._core.close(
            (
                (TASKS_STREAM, WORKER_GROUP, True),
                (STATUSES_STREAM, DISPATCHER_GROUP, False),
                (INBOUND_STREAM, DISPATCHER_GROUP, False),
            )
        )

    # ── reachability probe + fail-fast startup gate (spec §3.1) ──────────

    def ping(self) -> None:
        """Startup probe: raise ``NotificationTransportError`` unless Redis
        answers PING (the gate turns that into exit code 2 — loud,
        never silent loop rotation)."""
        self._core.ping()

    # ── context manager: scoped graceful stop ────────────────────────────

    def __enter__(self) -> RedisQueue:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()


def connect_or_exit(url: str, **kwargs: Any) -> RedisQueue:
    """The fail-fast transport gate consumed by the process entries
    (dispatcher — Task 4, worker — Task 5; spec §3.1); the gate
    mechanics live in the streams core (``transport.connect_or_exit``,
    #580 §3.6), this wrapper keeps the notification journal and message
    contracts:

    - empty URL (transport not configured) → journal + ``SystemExit(2)``
      with the STABLE message ``notification: transport not configured``;
    - configured but unreachable Redis → PING at start, loud failure,
      ``SystemExit(2)`` — a half-alive process must not rotate silently.

    The URL value NEVER appears in messages or the journal (spec §3.3:
    application secret) — only the fact "not configured / unavailable".
    """
    return core_connect_or_exit(
        url,
        transport_factory=RedisQueue,
        logger=logger,
        not_configured_message=TRANSPORT_NOT_CONFIGURED_MESSAGE,
        unavailable_prefix="notification: transport unavailable",
        **kwargs,
    )
