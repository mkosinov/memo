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

- ``notify:tasks`` (down)  — group ``worker`` (the worker half below,
  part 3 #484);
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
#: Consumer group of the worker process on ``notify:tasks`` — the
#: worker half's group (claim/ack/reclaim, part 3 #484 spec §3.1).
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


def _as_str(value: str | bytes | int) -> str:
    """Normalize a Redis reply value across client decoding modes —
    ``message_id`` of an XPENDING reply is typed ``bytes | str | int``
    (legacy integer ids), the cursor/entry ids are ``bytes | str``."""
    if isinstance(value, bytes):
        return value.decode()
    return str(value)


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
                f"notify queue transport failed during {operation}: {type(exc).__name__}: {exc}"
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
        ``FakeQueue.publish_status``; off the DISPATCHER protocol per
        ADR 013 — typed on ``WorkerQueue`` since part 3, #484 §3.1)."""
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
        return self._claim(STATUSES_STREAM, DISPATCHER_GROUP)

    def claim_inbound(self) -> list[InboundEvent]:
        return self._claim(INBOUND_STREAM, DISPATCHER_GROUP)

    def _claim(self, stream: str, group: str) -> list[dict[str, Any]]:
        """Non-blocking ``XREADGROUP >`` with the ``_qid`` envelope; the
        group parameter picks the consuming half (dispatcher up-streams,
        worker tasks — part 3 #484 §3.1).

        Reading id ``0`` (draining one's own PEL) is the FORBIDDEN
        anti-pattern (spec §3.1): inside the loop it keeps hanging
        entries below the reclaim threshold forever — recovery happens
        only through :meth:`reclaim_hanging` / :meth:`reclaim_hanging_tasks`."""
        with self._transport(f"claim {stream}/{group}"):
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
        self._ack(STATUSES_STREAM, DISPATCHER_GROUP, item)

    def ack_inbound(self, item: InboundEvent) -> None:
        self._ack(INBOUND_STREAM, DISPATCHER_GROUP, item)

    def _ack(self, stream: str, group: str, item: dict[str, Any]) -> None:
        """``XACK`` by ``_qid`` — a duplicate/late ack is a harmless no-op
        (family §4.4, at-least-once tolerance)."""
        with self._transport(f"ack {stream}/{group}"):
            self._client.xack(self._stream(stream), group, item[ENVELOPE_KEY])

    # ── worker half: notify:tasks, group ``worker`` (part 3 #484 §3.1) ───

    def claim_tasks(self) -> list[TaskPayload]:
        """Non-blocking claim of the ``worker`` group (``XREADGROUP >``,
        ``CLAIM_BATCH``, ``_qid`` envelope)."""
        return self._claim(TASKS_STREAM, WORKER_GROUP)

    def ack_task(self, item: TaskPayload) -> None:
        """``XACK`` a delivered task (idempotent, family §4.4)."""
        self._ack(TASKS_STREAM, WORKER_GROUP, item)

    def ensure_worker_group(self) -> None:
        """Worker-start duty (spec §3.1): the ``worker`` group on
        ``notify:tasks`` — ``id=0 MKSTREAM``, so the backlog accumulated
        before the group existed stays deliverable (deliberate: tasks
        piled up with no consumer — that is what part 3 consumes;
        «improving» to ``$`` is forbidden). ONLY the concrete BUSYGROUP
        error is suppressed; anything else propagates loudly."""
        self._ensure_group(TASKS_STREAM, WORKER_GROUP)

    def reclaim_hanging_tasks(self) -> None:
        """Return claimed-but-unacked TASK entries of the ``worker``
        group back into delivery (§4.4) — tasks only; the statuses and
        inbound streams are the dispatcher half's own reclaim."""
        self._reclaim_stream(TASKS_STREAM, WORKER_GROUP)

    def pending_worker_task_ids(self) -> set[str]:
        """Task ids in the PEL of the ``worker`` group on
        ``notify:tasks`` — the dispatcher's re-enqueue predicate probe
        (family §3.3 rev.5).

        ``XPENDING`` (paged, inclusive cursor — the PEL carries message
        ids, not payloads) + ``XRANGE`` per entry to read the task_id.
        A missing group/key (NOGROUP — e.g. a wiped transport before
        the worker ever ran) is an EMPTY set: nothing was ever claimed,
        and the re-enqueue sweep MUST proceed for wipe survival (§4.4).
        Every other failure is the typed transport error.
        """
        stream = self._stream(TASKS_STREAM)
        ids: set[str] = set()
        seen_entries: set[str] = set()
        with self._transport("pending worker tasks"):
            try:
                cursor = "-"
                while True:
                    entries = self._client.xpending_range(
                        stream,
                        WORKER_GROUP,
                        min=cursor,
                        max="+",
                        count=AUTOCLAIM_COUNT,
                    )
                    if not entries:
                        break
                    fresh = [
                        _as_str(entry["message_id"])
                        for entry in entries
                        if _as_str(entry["message_id"]) not in seen_entries
                    ]
                    if not fresh:
                        break
                    seen_entries.update(fresh)
                    for message_id in fresh:
                        rows = cast(
                            "list[tuple[str, dict[str, str]]]",
                            self._client.xrange(
                                stream, min=message_id, max=message_id, count=1
                            ),
                        )
                        for _entry_id, fields in rows:
                            try:
                                ids.add(json.loads(fields[PAYLOAD_FIELD])["task_id"])
                            except (json.JSONDecodeError, KeyError, TypeError):
                                # A brak payload inside the PEL — the
                                # worker's own brak rule acks it away;
                                # the probe must not die on it.
                                continue
                    if len(entries) < AUTOCLAIM_COUNT:
                        break
                    cursor = fresh[-1]
            except ResponseError as exc:
                if _is_missing_group(str(exc)):
                    return set()
                raise
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
            self._ensure_group(stream, DISPATCHER_GROUP)

    def _ensure_group(self, stream: str, group: str) -> None:
        with self._transport(f"ensure group {stream}/{group}"):
            try:
                self._client.xgroup_create(self._stream(stream), group, id="0", mkstream=True)
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
        pool. The WORKER consumer is dropped only with an EMPTY PEL
        (part 3 #484, spec §3.1): ``XGROUP DELCONSUMER`` destroys the
        consumer's PEL records, and an unacked entry there is the
        designed abort-path state — a hanging entry keeps the consumer
        registered for the next start's ``reclaim_hanging_tasks``. A
        flushed group (NOGROUP) is suppressed — the shutdown must stay
        graceful; other errors stay loud. Idempotent."""
        self._delconsumer(TASKS_STREAM, WORKER_GROUP, keep_if_pending=True)
        for stream in (STATUSES_STREAM, INBOUND_STREAM):
            self._delconsumer(stream, DISPATCHER_GROUP)
        self._client.close()
        self._pool.disconnect()

    def _delconsumer(self, stream: str, group: str, *, keep_if_pending: bool = False) -> None:
        """Deregister this consumer from the group. With
        ``keep_if_pending``, a non-empty consumer PEL cancels the
        deregistration with a warning instead (spec §3.1: DELCONSUMER
        would destroy the pending records — unrecoverable task loss).
        A missing group/key (NOGROUP) stays a graceful no-op — the
        XPENDING pre-check must not out-noise the shutdown it guards."""
        with self._transport(f"delconsumer {stream}/{group}"):
            consumer = self._consumer(group)
            full_name = self._stream(stream)
            try:
                if keep_if_pending:
                    pending = self._client.xpending_range(
                        full_name,
                        group,
                        min="-",
                        max="+",
                        count=AUTOCLAIM_COUNT,
                        consumername=consumer,
                    )
                    if pending:
                        logger.warning(
                            "notify queue: consumer %s of %s/%s kept on stop — "
                            "%d pending entries preserved for reclaim "
                            "(XGROUP DELCONSUMER would destroy them, #484 §3.1)",
                            consumer,
                            full_name,
                            group,
                            len(pending),
                        )
                        return
                self._client.xgroup_delconsumer(full_name, group, consumer)
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
