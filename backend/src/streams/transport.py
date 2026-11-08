"""Generic Redis Streams transport core (GH #580 spec §3.6).

The shared mechanics of every Redis Streams producer/consumer of the
backend — extracted from ``src/notify/redis_queue.py`` (GH #483 spec
§3.1, ADR 013) so the domain-events relay/subscribers (``src/domain_events``,
#580) reuse them without importing notify. The core knows NO stream
names: callers bring their own vocabulary (notify — the ``notify:*``
streams via ``RedisQueue``; domain events — ``domain_events:<type>``).

SYNC ``redis-py`` client only — no queue library; async callers wrap
every call in ``asyncio.to_thread`` (the notify dispatcher/worker
pattern), worker processes call the same sync surface directly.

Reliable delivery = consumer groups: :meth:`StreamTransport.claim` is a
NON-blocking ``XREADGROUP >`` (entries land in the consumer's PEL)
whose items carry the transport-reserved ``_qid`` envelope (the stream
entry id; the underscore marks the key as transport-reserved),
:meth:`StreamTransport.ack` is ``XACK`` by entry id (a duplicate ack is
a harmless no-op), and :meth:`StreamTransport.autoclaim` is the RAW
``XAUTOCLAIM`` PEL transfer — it hands claimed entries to the caller
WITHOUT re-adding them to the stream (notify's queue wraps it with
re-XADD + ack for its fresh-delivery semantics; a subscriber redelivers
by processing the claimed entry — a re-XADD on every reclaim would
churn the stream, #580 spec §3.6 rev.2).

Trimming: every ``XADD`` carries ``MAXLEN ~ 10_000`` — a stream is
transport only, never the archive (real retention lives in a durable
journal elsewhere: notify — the DB per ADR 008, domain events — the
``domain_events`` table); Redis trims whole macro-nodes at the ceiling
(approximate — tiny streams may briefly exceed the cap), a write is
never rejected, and a pending entry trimmed under the ceiling is
unrecoverable — logged terminally by :meth:`StreamTransport.autoclaim`.

**Failure volume** (GH #483 spec §3.1): transport failures are never
muted — every redis error surfaces as :class:`StreamTransportError`
carrying the original exception class + message and record identifiers,
never message bodies and never the URL value. The client is built with
retries explicitly OFF (redis-py ≥ 6 retries silently by default — a
quiet retry would hide the outage the caller must see), an explicit
pool ceiling, and a ``socket_timeout`` larger than any read ``BLOCK``
parameter the caller uses.

**Single-instance assumption**: one consuming process per group per
Redis instance — documented, no leader election; dev/CI contours are
isolated by ``key_prefix``.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
from typing import TYPE_CHECKING, Any, Protocol, cast

from redis import Redis
from redis.backoff import NoBackoff
from redis.connection import ConnectionPool
from redis.exceptions import RedisError, ResponseError
from redis.retry import Retry

if TYPE_CHECKING:
    from collections.abc import Callable, Generator, Iterable, Iterator

#: Default logger of the generic core; a caller with its own journal
#: (notify: ``memo.notify.redis_queue``) passes its logger explicitly.
DEFAULT_LOGGER_NAME = "memo.streams.transport"

logger = logging.getLogger(DEFAULT_LOGGER_NAME)

# ── transport parameters (values unchanged since GH #483) ────────────────────

#: Approximate per-entry MAXLEN: Redis trims whole macro-nodes, so tiny
#: streams may briefly exceed the cap — never assert exact XLEN at
#: small scales.
MAXLEN_APPROX = 10_000
#: Non-blocking claim batch (``XREADGROUP COUNT``).
CLAIM_BATCH = 100
#: Explicit ``XAUTOCLAIM COUNT`` page.
AUTOCLAIM_COUNT = 100
#: Single ``payload`` JSON field per stream entry (GH #483 spec §3.1).
PAYLOAD_FIELD = "payload"
#: Transport-reserved envelope key: the stream entry id, added to
#: claimed items only — underscore = reserved for the transport.
ENVELOPE_KEY = "_qid"
#: Pool ceiling (GH #483 spec §3.1: ≈10).
MAX_POOL_CONNECTIONS = 10
#: ``socket_timeout`` must exceed ANY read ``BLOCK`` parameter the
#: caller uses (the notify worker's blocking reads set the margin).
SOCKET_TIMEOUT_SECONDS = 30.0
#: Default ``XAUTOCLAIM min-idle-time`` — a caller with a re-enqueue
#: threshold (notify: ``NOTIFY_REENQUEUE_AFTER``, 120 s) passes its
#: setting explicitly at construction.
DEFAULT_RECLAIM_MIN_IDLE_MS = 120_000

#: Stable fail-fast message of the GENERIC gate; a caller with a stable
#: public message (notify: ``TRANSPORT_NOT_CONFIGURED_MESSAGE``) passes
#: its own. The URL value NEVER appears next to it.
DEFAULT_NOT_CONFIGURED_MESSAGE = "streams transport not configured"


class StreamTransportError(Exception):
    """A transport (Redis) failure of the streams core.

    Raised for every redis-py error surfacing through core methods —
    callers distinguish a transport outage from a domain error by this
    class (notify: the ``NotifyTransportError`` alias). The core never
    swallows it: the failure stays loud. The text carries the original
    exception class and message (never message bodies; the Redis URL
    value never appears in it).
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


class StreamTransport:
    """The generic Redis Streams core: publish/claim/ack, group setup,
    RAW XAUTOCLAIM, PEL reads, ping/close over one connection pool.

    Consumer names are unique per live process (``<group>-<pid>`` —
    override with ``consumer_name``); hanging-entry recovery works at
    group level (``XAUTOCLAIM``), so the per-process name uniqueness is
    correct. ``key_prefix`` namespaces every stream — the test contour's
    isolation on a shared instance; production keeps the default (no
    prefix). ``logger`` routes the core's journal (terminal trim losses,
    keep-if-pending warnings) into the caller's volume — notify keeps
    ``memo.notify.redis_queue`` for its stable log contracts.
    """

    def __init__(
        self,
        url: str,
        *,
        key_prefix: str = "",
        max_connections: int = MAX_POOL_CONNECTIONS,
        reclaim_min_idle_ms: int = DEFAULT_RECLAIM_MIN_IDLE_MS,
        consumer_name: str | None = None,
        logger: logging.Logger | None = None,
    ) -> None:
        self._prefix = key_prefix
        self._reclaim_min_idle_ms = reclaim_min_idle_ms
        self._consumer_override = consumer_name
        self._logger = logger if logger is not None else logging.getLogger(DEFAULT_LOGGER_NAME)
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

    # ── failure volume: typed, loud transport errors (GH #483 §3.1) ──────

    @contextlib.contextmanager
    def _transport(self, operation: str) -> Generator[None]:
        """Normalize every redis error to ``StreamTransportError`` and
        let it PROPAGATE — muting is forbidden; the caller's loop catches
        the typed failure, logs it and survives to the next tick."""
        try:
            yield
        except RedisError as exc:
            raise StreamTransportError(
                f"streams transport failed during {operation}: {type(exc).__name__}: {exc}"
            ) from exc

    # ── producer side ────────────────────────────────────────────────────

    def publish(self, stream: str, payload: dict[str, Any]) -> None:
        """``XADD`` a JSON payload as the single ``payload`` field with
        the approximate MAXLEN trim — a stream is transport only, never
        the archive; a write is never rejected at the ceiling."""
        with self._transport(f"publish {stream}"):
            self._client.xadd(
                self._stream(stream),
                {PAYLOAD_FIELD: json.dumps(payload, ensure_ascii=False)},
                maxlen=MAXLEN_APPROX,
                approximate=True,
            )

    def republish(self, stream: str, fields: dict[str, str]) -> None:
        """``XADD`` the entry's ``payload`` field VERBATIM (same MAXLEN
        trim) — the fresh-delivery copy of a reclaim wrapper: no JSON
        re-encoding, the stored bytes are authoritative."""
        with self._transport(f"republish {stream}"):
            self._client.xadd(
                self._stream(stream),
                {PAYLOAD_FIELD: fields[PAYLOAD_FIELD]},
                maxlen=MAXLEN_APPROX,
                approximate=True,
            )

    # ── consumer side: claim / ack ───────────────────────────────────────

    def claim(self, stream: str, group: str) -> list[dict[str, Any]]:
        """Non-blocking ``XREADGROUP >`` with the ``_qid`` envelope; the
        group parameter picks the consuming half (notify: dispatcher
        up-streams / worker tasks).

        Reading id ``0`` (draining one's own PEL) is the FORBIDDEN
        anti-pattern (GH #483 spec §3.1): inside the loop it keeps
        hanging entries below the reclaim threshold forever — recovery
        happens only through :meth:`autoclaim`."""
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

    def ack(self, stream: str, group: str, entry_id: str) -> None:
        """``XACK`` by entry id — a duplicate/late ack is a harmless
        no-op (at-least-once tolerance; ack AFTER the result governed by
        the entry is materialized)."""
        with self._transport(f"ack {stream}/{group}"):
            self._client.xack(self._stream(stream), group, entry_id)

    # ── group lifecycle ──────────────────────────────────────────────────

    def ensure_group(self, stream: str, group: str) -> None:
        """``XGROUP CREATE id=0 MKSTREAM`` — entries published before the
        group existed stay deliverable («improving» to ``$`` is
        forbidden: a backlog accumulated with no consumer is exactly
        what the group must deliver). ONLY the concrete BUSYGROUP error
        is suppressed (group exists); swallowing ``ResponseError`` whole
        is forbidden — anything else propagates loudly."""
        with self._transport(f"ensure group {stream}/{group}"):
            try:
                self._client.xgroup_create(self._stream(stream), group, id="0", mkstream=True)
            except ResponseError as exc:
                if str(exc).startswith("BUSYGROUP"):
                    return
                raise

    # ── process start / periodic recovery: RAW XAUTOCLAIM ────────────────

    def autoclaim(self, stream: str, group: str) -> Iterator[list[tuple[str, dict[str, str]]]]:
        """RAW ``XAUTOCLAIM`` over one group's PEL — a PEL transfer to
        this consumer, page by page, WITHOUT re-adding anything to the
        stream and without acking: the CALLER decides what a redelivery
        means (notify's queue re-XADDs a verbatim copy and acks the old
        id; a domain-events subscriber processes the claimed entry as-is
        and acks after materializing — #580 §3.6).

        - cursor-driven to exhaustion (``0-0``), explicit ``COUNT`` page,
          ``min-idle-time`` = the constructor's ``reclaim_min_idle_ms``;
        - each yielded page is the claimed entries as stored —
          ``(entry_id, fields)`` with the verbatim ``payload`` field;
        - entries deleted under the MAXLEN ceiling arrive in the reply's
          THIRD element, leave the PEL in this same call and are
          unrecoverable — logged terminally (entry id + stream, never a
          message body, logging hygiene).

        The whole walk shares one transport-error scope: a redis failure
        at any page surfaces as :class:`StreamTransportError`.
        """
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
                    self._logger.error(
                        "streams transport: entry %s of stream %s/%s was"
                        " trimmed under the MAXLEN ceiling while pending —"
                        " unrecoverable, dropped from delivery",
                        trimmed_id,
                        full_name,
                        group,
                    )
                yield cast("list[tuple[str, dict[str, str]]]", entries)
                if cursor == "0-0":
                    return

    # ── PEL inspection ───────────────────────────────────────────────────

    def pending_entries(self, stream: str, group: str) -> list[tuple[str, dict[str, str]]]:
        """The group's PEL with payloads — paged ``XPENDING`` (inclusive
        cursor — the PEL carries message ids, not payloads) + ``XRANGE``
        per entry, as stored ``(entry_id, fields)``.

        A missing group/key (NOGROUP — e.g. a wiped transport before the
        consumer ever ran) is an EMPTY list: nothing was ever claimed,
        and a recovery sweep MUST proceed for wipe survival. Every other
        failure is the typed transport error.
        """
        full_name = self._stream(stream)
        collected: list[tuple[str, dict[str, str]]] = []
        seen_entries: set[str] = set()
        with self._transport(f"pending {stream}/{group}"):
            try:
                cursor = "-"
                while True:
                    entries = self._client.xpending_range(
                        full_name,
                        group,
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
                            self._client.xrange(full_name, min=message_id, max=message_id, count=1),
                        )
                        collected.extend(rows)
                    if len(entries) < AUTOCLAIM_COUNT:
                        break
                    cursor = fresh[-1]
            except ResponseError as exc:
                if _is_missing_group(str(exc)):
                    return []
                raise
        return collected

    # ── graceful stop ────────────────────────────────────────────────────

    def close(self, consumers: Iterable[tuple[str, str, bool]] = ()) -> None:
        """Graceful stop: deregister the given consumers — each spec is
        ``(stream, group, keep_if_pending)`` — then release the client
        and the pool. With ``keep_if_pending`` a non-empty consumer PEL
        cancels the deregistration with a warning instead
        (:meth:`_delconsumer`) — the pending records survive for the
        next start's ``autoclaim``. A missing group/key stays a graceful
        no-op; other errors stay loud. Idempotent."""
        for stream, group, keep_if_pending in consumers:
            self._delconsumer(stream, group, keep_if_pending=keep_if_pending)
        self._client.close()
        self._pool.disconnect()

    def _delconsumer(self, stream: str, group: str, *, keep_if_pending: bool = False) -> None:
        """Deregister this consumer from the group. With
        ``keep_if_pending``, a non-empty consumer PEL cancels the
        deregistration with a warning instead (XGROUP DELCONSUMER would
        destroy the pending records — unrecoverable task loss). A
        missing group/key (NOGROUP) stays a graceful no-op — the
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
                        self._logger.warning(
                            "streams transport: consumer %s of %s/%s kept"
                            " on stop — %d pending entries preserved for"
                            " reclaim (XGROUP DELCONSUMER would destroy"
                            " them)",
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

    # ── reachability probe ───────────────────────────────────────────────

    def ping(self) -> None:
        """Startup probe: raise ``StreamTransportError`` unless Redis
        answers PING (the :func:`connect_or_exit` gate turns that into
        exit code 2 — loud, never silent loop rotation)."""
        with self._transport("ping"):
            self._client.ping()


class _Pingable(Protocol):
    """The gate's structural seam: anything it may construct and probe —
    the core itself, or a delegating facade (notify's ``RedisQueue``)
    that satisfies ``ping`` without inheriting from the core."""

    def ping(self) -> None: ...


def connect_or_exit[TransportT: _Pingable](
    url: str,
    *,
    transport_factory: Callable[..., TransportT],
    logger: logging.Logger | None = None,
    not_configured_message: str = DEFAULT_NOT_CONFIGURED_MESSAGE,
    unavailable_prefix: str = "streams transport unavailable",
    **kwargs: Any,
) -> TransportT:
    """The fail-fast transport gate consumed by the process entries
    (notify dispatcher/worker — GH #483 spec §3.1; generic since #580
    §3.6):

    - empty URL (transport not configured) → journal +
      ``SystemExit(2)`` with the caller's STABLE message;
    - configured but unreachable Redis → PING at start, loud failure,
      ``SystemExit(2)`` — a half-alive process must not rotate silently.

    The URL value NEVER appears in messages or the journal — only the
    fact "not configured / unavailable". ``transport_factory`` builds
    the caller's own facade (notify: ``RedisQueue`` — delegation, not
    inheritance; anything PING-able satisfies the seam) and is what the
    gate returns; ``logger`` routes the gate's journal into the
    caller's volume (notify: ``memo.notify.redis_queue``).
    """
    gate_logger = logger if logger is not None else logging.getLogger(DEFAULT_LOGGER_NAME)
    if not url:
        gate_logger.error(not_configured_message)
        raise SystemExit(2)
    transport = transport_factory(url, **kwargs)
    try:
        transport.ping()
    except StreamTransportError as exc:
        gate_logger.error("%s: %s", unavailable_prefix, exc)
        raise SystemExit(2) from exc
    return transport
