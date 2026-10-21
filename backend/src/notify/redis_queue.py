"""Redis Streams transport of the notify queue (GH #483 spec §3.1; ADR 013).

``RedisQueue`` implements the ``NotifyQueue`` port (``queue.py``) on top
of Redis Streams + consumer groups through the SYNC ``redis-py`` client —
no queue library. The dispatcher wraps every queue call in
``asyncio.to_thread`` (part 2 wiring); the worker (part 3) calls the
same sync surface from its own process.

Three streams (``MAXLEN ~ 10000`` on every write — the queue is
transport only, real retention lives in the DB per ADR 008; Redis
silently trims the oldest entries at the ceiling, and a write is never
rejected):

- ``notify:tasks`` (down)  — group ``worker`` (consumed by part 3);
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
every redis error surfaces as :class:`NotifyTransportError` (the
dispatcher tells a transport outage from a scenario error by that
class); the message carries the original exception class + message and
record identifiers, never message bodies and never the URL value.
The client is built with retries explicitly OFF (redis-py ≥ 6 retries
silently by default — a quiet retry would hide the outage the
dispatcher must see), an explicit pool ceiling, and a ``socket_timeout``
larger than any read ``BLOCK`` parameter (the dispatcher reads
non-blocking; the margin is the part-3 worker's BLOCK requirement).
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
from typing import TYPE_CHECKING, Any, cast

from redis import Redis
from redis.backoff import NoBackoff
from redis.connection import ConnectionPool
from redis.exceptions import RedisError, ResponseError
from redis.retry import Retry

if TYPE_CHECKING:
    from collections.abc import Generator

    from src.notify.queue import InboundEvent, StatusEvent, TaskPayload

logger = logging.getLogger("memo.notify.redis_queue")

# ── stream / group vocabulary (spec §3.1; ADR 013) ──────────────────────────

TASKS_STREAM = "notify:tasks"
STATUSES_STREAM = "notify:statuses"
INBOUND_STREAM = "notify:inbound"

#: Consumer group of the dispatcher process on the up-streams (part 2).
DISPATCHER_GROUP = "dispatcher"
#: Consumer group of the worker on ``notify:tasks`` — its consumer
#: arrives with part 3; creating it here would be an empty promise.
WORKER_GROUP = "worker"

# ── transport parameters ─────────────────────────────────────────────────────

#: Approximate per-entry MAXLEN: Redis trims whole macro-nodes, so tiny
#: streams may briefly exceed the cap — never assert exact XLEN at
#: small scales.
MAXLEN_APPROX = 10_000
#: Non-blocking claim batch (``XREADGROUP COUNT``).
CLAIM_BATCH = 100
#: Explicit ``XAUTOCLAIM COUNT`` page.
AUTOCLAIM_COUNT = 100
#: Single ``payload`` JSON field per stream entry (spec §3.1).
PAYLOAD_FIELD = "payload"
#: Transport-reserved envelope key: the stream entry id, added to
#: claimed items only — underscore = reserved for the transport.
ENVELOPE_KEY = "_qid"
#: Pool ceiling (spec §3.1: ≈10).
MAX_POOL_CONNECTIONS = 10
#: ``socket_timeout`` must exceed ANY read ``BLOCK`` parameter: the
#: dispatcher claims non-blocking, the margin covers the part-3
#: worker's blocking reads (spec §3.1).
SOCKET_TIMEOUT_SECONDS = 30.0
#: Default ``XAUTOCLAIM min-idle-time`` — never less than
#: ``NOTIFY_REENQUEUE_AFTER`` (whose default is 120 s). The consuming
#: process passes its setting explicitly at construction.
DEFAULT_RECLAIM_MIN_IDLE_MS = 120_000

#: Stable fail-fast message (spec §3.1). The URL value NEVER appears
#: next to it — only the fact "not configured".
TRANSPORT_NOT_CONFIGURED_MESSAGE = "notify: transport not configured"


class NotifyTransportError(Exception):
    """A transport (Redis) failure of the queue adapter.

    Raised for every redis-py error surfacing through adapter methods —
    the dispatcher distinguishes a transport outage from a scenario
    error by this class (consumed by Task 4). The adapter never swallows
    it: the failure stays loud. The text carries the original exception
    class and message (logging hygiene, spec §3.1 — no message bodies,
    channel addresses masked); the Redis URL value never appears in it.
    """


def _as_str(value: str | bytes) -> str:
    """Normalize a Redis reply string across client decoding modes."""
    return value.decode() if isinstance(value, bytes) else value


def _is_missing_group(message: str) -> bool:
    """True for both Redis phrasings of "no such consumer group": the
    ``NOGROUP`` error (group absent on an existing key) and the XGROUP
    "key to exist" error (the whole key absent — a producer-only
    lifecycle, or a flushed instance). Both mean the consumer has
    nothing to deregister from — a graceful no-op for shutdown."""
    return message.startswith("NOGROUP") or message.startswith(
        "The XGROUP subcommand requires the key to exist"
    )


class RedisQueue:
    """``NotifyQueue`` over Redis Streams + consumer groups (sync client).

    Consumer names are unique per live process (``<group>-<pid>`` —
    override with ``consumer_name``); hanging-entry recovery works at
    group level (``XAUTOCLAIM``), so the per-process name uniqueness is
    correct. ``close()`` on graceful stop drops the consumer from its
    groups (no ghost consumers).

    ``key_prefix`` namespaces every stream — the test contour's
    isolation on a shared instance; production keeps the default (no
    prefix). ``reclaim_min_idle_ms`` is the ``XAUTOCLAIM`` threshold:
    never below ``NOTIFY_REENQUEUE_AFTER`` in production (the consuming
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
        self._prefix = key_prefix
        self._reclaim_min_idle_ms = reclaim_min_idle_ms
        self._consumer_override = consumer_name
        # Retries OFF explicitly (redis-py >= 6: ExponentialWithJitterBackoff
        # x10 by default), explicit pool ceiling, socket_timeout above any
        # BLOCK, decoded responses (payloads are JSON strings by contract).
        self._pool = ConnectionPool.from_url(
            url,
            max_connections=max_connections,
            socket_timeout=SOCKET_TIMEOUT_SECONDS,
            decode_responses=True,
            retry=Retry(NoBackoff(), 0),
        )
        self._client: Redis = Redis(connection_pool=self._pool)

    # ── naming ───────────────────────────────────────────────────────────

    def _stream(self, name: str) -> str:
        return f"{self._prefix}{name}"

    def _consumer(self, group: str) -> str:
        return self._consumer_override or f"{group}-{os.getpid()}"

    # ── failure volume: typed, loud transport errors (spec §3.1) ─────────

    @contextlib.contextmanager
    def _transport(self, operation: str) -> Generator[None]:
        """Normalize every redis error to ``NotifyTransportError`` and let
        it PROPAGATE — muting is forbidden; the dispatcher's loop catches
        the typed failure, logs it and survives to the next tick."""
        try:
            yield
        except RedisError as exc:
            raise NotifyTransportError(
                f"notify queue transport failed during {operation}: "
                f"{type(exc).__name__}: {exc}"
            ) from exc

    # ── producer side (protocol) ─────────────────────────────────────────

    def enqueue_task(self, payload: TaskPayload) -> None:
        with self._transport("enqueue_task"):
            self._client.xadd(
                self._stream(TASKS_STREAM),
                {PAYLOAD_FIELD: json.dumps(payload, ensure_ascii=False)},
                maxlen=MAXLEN_APPROX,
                approximate=True,
            )

    # ── producer side (off-protocol; worker side from part 3) ────────────

    def publish_status(self, event: StatusEvent) -> None:
        """``XADD`` a §4.3 stage event to ``notify:statuses`` (mirrors
        ``FakeQueue.push_status``; deliberately NOT on the protocol)."""
        self._publish(STATUSES_STREAM, event)

    def publish_inbound(self, event: InboundEvent) -> None:
        """``XADD`` a §3.2 inbound event to ``notify:inbound`` (mirrors
        ``FakeQueue.push_inbound``; deliberately NOT on the protocol)."""
        self._publish(INBOUND_STREAM, event)

    def _publish(self, stream: str, payload: dict[str, Any]) -> None:
        with self._transport(f"publish {stream}"):
            self._client.xadd(
                self._stream(stream),
                {PAYLOAD_FIELD: json.dumps(payload, ensure_ascii=False)},
                maxlen=MAXLEN_APPROX,
                approximate=True,
            )

    # ── reliable delivery: notify:statuses / notify:inbound ──────────────

    def claim_statuses(self) -> list[StatusEvent]:
        return self._claim(STATUSES_STREAM)

    def claim_inbound(self) -> list[InboundEvent]:
        return self._claim(INBOUND_STREAM)

    def _claim(self, stream: str) -> list[dict[str, Any]]:
        """Non-blocking ``XREADGROUP >`` with the ``_qid`` envelope.

        Reading id ``0`` (draining one's own PEL) is the FORBIDDEN
        anti-pattern (spec §3.1): inside the loop it keeps hanging
        entries below the reclaim threshold forever — recovery happens
        only through :meth:`reclaim_hanging`."""
        group = DISPATCHER_GROUP
        with self._transport(f"claim {stream}"):
            reply = cast(
                "list[tuple[str, list[tuple[str, dict[str, str]]]]]",
                self._client.xreadgroup(
                    groupname=group,
                    consumername=self._consumer(group),
                    streams={self._stream(stream): ">"},
                    count=CLAIM_BATCH,
                ),
            )
        return [
            self._envelope(entry_id, fields)
            for _name, entries in reply
            for entry_id, fields in entries
        ]

    @staticmethod
    def _envelope(entry_id: str, fields: dict[str, str]) -> dict[str, Any]:
        return {**json.loads(fields[PAYLOAD_FIELD]), ENVELOPE_KEY: entry_id}

    def ack_status(self, item: StatusEvent) -> None:
        self._ack(STATUSES_STREAM, item)

    def ack_inbound(self, item: InboundEvent) -> None:
        self._ack(INBOUND_STREAM, item)

    def _ack(self, stream: str, item: dict[str, Any]) -> None:
        """``XACK`` by ``_qid`` — a duplicate/late ack is a harmless no-op
        (family §4.4, at-least-once tolerance)."""
        with self._transport(f"ack {stream}"):
            self._client.xack(
                self._stream(stream), DISPATCHER_GROUP, item[ENVELOPE_KEY]
            )

    # ── consumer start / graceful stop ───────────────────────────────────

    def ensure_consumer_groups(self) -> None:
        """Consumer-start duty (spec §3.1): the ``dispatcher`` groups on
        the up-streams, ``id=0`` (entries published before the group
        existed stay deliverable). The part-3 worker creates ``worker``
        on the task stream the same way. ONLY the concrete BUSYGROUP
        error is suppressed (group exists); swallowing ``ResponseError``
        whole is forbidden — anything else propagates loudly."""
        for stream in (STATUSES_STREAM, INBOUND_STREAM):
            self._ensure_group(stream, DISPATCHER_GROUP)

    def _ensure_group(self, stream: str, group: str) -> None:
        with self._transport(f"ensure group {stream}/{group}"):
            try:
                self._client.xgroup_create(
                    self._stream(stream), group, id="0", mkstream=True
                )
            except ResponseError as exc:
                if str(exc).startswith("BUSYGROUP"):
                    return
                raise

    # ── process start: reclaim hanging entries (spec §3.1, §4.4) ─────────

    def reclaim_hanging(self) -> None:
        """At consumer start: return claimed-but-unacked entries of the
        group's PEL (a crashed previous process) back to delivery —
        both up-streams (§4.4)."""
        for stream in (STATUSES_STREAM, INBOUND_STREAM):
            self._reclaim_stream(stream, DISPATCHER_GROUP)

    def _reclaim_stream(self, stream: str, group: str) -> None:
        """``XAUTOCLAIM`` loop over one group's PEL.

        - cursor-driven to exhaustion (``0-0``), explicit ``COUNT`` page,
          ``min-idle-time`` = ``reclaim_min_idle_ms`` (in production
          never below ``NOTIFY_REENQUEUE_AFTER``);
        - a claimed entry is re-XADDed to the stream FIRST, THEN XACKed
          out of the PEL: a crash in between leaves a harmless duplicate
          (family §4.4), the reverse order could lose an entry that had
          already left the PEL;
        - entries deleted under the MAXLEN ceiling arrive in the reply's
          THIRD element, leave the PEL in this same call and are
          unrecoverable — logged terminally (entry id + stream, never a
          message body, logging hygiene §3.1)."""
        consumer = self._consumer(group)
        full_name = self._stream(stream)
        with self._transport(f"reclaim {stream}"):
            cursor = "0-0"
            while True:
                claimed_cursor, entries, trimmed = self._client.xautoclaim(
                    name=full_name,
                    groupname=group,
                    consumername=consumer,
                    min_idle_time=self._reclaim_min_idle_ms,
                    start_id=cursor,
                    count=AUTOCLAIM_COUNT,
                )
                cursor = _as_str(claimed_cursor)
                for trimmed_id in trimmed:
                    logger.error(
                        "notify queue: entry %s of stream %s/%s was trimmed"
                        " under the MAXLEN ceiling while pending —"
                        " unrecoverable, dropped from delivery",
                        trimmed_id,
                        full_name,
                        group,
                    )
                for entry_id, fields in entries:
                    self._client.xadd(
                        full_name,
                        {PAYLOAD_FIELD: fields[PAYLOAD_FIELD]},
                        maxlen=MAXLEN_APPROX,
                        approximate=True,
                    )
                    self._client.xack(full_name, group, entry_id)
                if cursor == "0-0":
                    return

    # ── graceful stop (spec §3.1) ────────────────────────────────────────

    def close(self) -> None:
        """Graceful stop: drop this consumer from its groups (the graceful
        path holds no PEL entries — no ghost consumers), then release the
        pool. A flushed group (NOGROUP) is suppressed — the shutdown must
        stay graceful; other errors stay loud. Idempotent."""
        for stream in (STATUSES_STREAM, INBOUND_STREAM):
            self._delconsumer(stream, DISPATCHER_GROUP)
        self._client.close()
        self._pool.disconnect()

    def _delconsumer(self, stream: str, group: str) -> None:
        with self._transport(f"delconsumer {stream}/{group}"):
            try:
                self._client.xgroup_delconsumer(
                    self._stream(stream), group, self._consumer(group)
                )
            except ResponseError as exc:
                if _is_missing_group(str(exc)):
                    return
                raise

    # ── reachability probe + fail-fast startup gate (spec §3.1) ──────────

    def ping(self) -> None:
        """Startup probe: raise ``NotifyTransportError`` unless Redis
        answers PING (the gate turns that into exit code 2 — loud,
        never silent loop rotation)."""
        with self._transport("ping"):
            self._client.ping()

    # ── context manager: scoped graceful stop ────────────────────────────

    def __enter__(self) -> RedisQueue:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()


def connect_or_exit(url: str, **kwargs: Any) -> RedisQueue:
    """The fail-fast transport gate consumed by the process entries
    (dispatcher — Task 4, worker — Task 5; spec §3.1):

    - empty URL (transport not configured) → journal + ``SystemExit(2)``
      with the STABLE message ``notify: transport not configured``;
    - configured but unreachable Redis → PING at start, loud failure,
      ``SystemExit(2)`` — a half-alive process must not rotate silently.

    The URL value NEVER appears in messages or the journal (spec §3.3:
    application secret) — only the fact "not configured / unavailable".
    """
    if not url:
        logger.error(TRANSPORT_NOT_CONFIGURED_MESSAGE)
        raise SystemExit(2)
    queue = RedisQueue(url, **kwargs)
    try:
        queue.ping()
    except NotifyTransportError as exc:
        logger.error("notify: transport unavailable: %s", exc)
        raise SystemExit(2) from exc
    return queue
