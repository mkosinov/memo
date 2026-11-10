"""GH #580 Task 5 (spec §3.4) — the public subscription API of the
domain-events service: :class:`Subscriber` over the shared streams core.

A service subscribes by OWNING one Redis consumer group on the stream of
every event type it consumes (``group`` = the service name — the
contract lives on the class). The subscriber adds NO Redis mechanics of
its own: it is a thin composition of the transport core
(``src/streams/transport.py``, §3.6) plus the domain-events vocabulary:

- stream-name validation against the declarative type registry (§3.2):
  every stream a subscriber touches must be
  ``stream_key(<registered code>)`` — a typo is a programming error and
  fails loudly with ``ValueError`` BEFORE any Redis call;
- the §4.1 record contract: claimed/reclaimed entries are handed to the
  caller as :class:`ClaimedEvent` — the parsed stream record plus
  ``qid``, the ack handle;
- RAW reclaim semantics (§3.6 rev.2): hanging entries are returned to
  the caller as-is (the core's XAUTOCLAIM PEL transfer) — the caller
  processes and acks them; a re-XADD on every reclaim would churn the
  relay stream.

SYNC surface only, like every consumer of the streams transport: async
callers wrap each call in ``asyncio.to_thread`` (the notification dispatcher
pattern; the Task-6 dispatcher group loop will follow it).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from src.domain_events.types import STREAM_KEY_PREFIX, require_type
from src.streams.transport import (
    ENVELOPE_KEY,
    PAYLOAD_FIELD,
    StreamTransport,
)


@dataclass(frozen=True)
class ClaimedEvent:
    """One §4.1 stream record delivered to a subscriber, parsed.

    ``qid`` is the stream entry id (the transport ``_qid`` envelope) —
    THE ack handle: materialize the result the event governs, then
    ``Subscriber ack(stream, qid)``; a duplicate ack is a harmless
    no-op (at-least-once). ``occurred_at`` is the ISO naive UTC string
    exactly as published (§4.1); ``snapshot`` rides verbatim — the
    event is self-sufficient, the subscriber reads ``domain_events``
    only for its own predicates.
    """

    qid: str
    event_id: str
    type: str
    occurred_at: str
    snapshot: dict[str, Any]


class Subscriber:
    """One service's subscription: a named consumer group on the streams
    of the event types it consumes (spec §3.4).

    THE GROUP-NAME CONTRACT — globally unique, part of the public API:

    ``group`` IS the service (``"notification"``, …) — one group per
    service across the whole system. Two services sharing one group
    SPLIT the stream's entries between them: every entry goes to exactly
    ONE of the two consumers — a silent loss for both. The name is a
    system-level decision; the transport cannot detect a misused name.

    Lifecycle (§3.4): :meth:`ensure` at process start (``XGROUP CREATE
    id=0 MKSTREAM`` — the history accumulated before the group existed
    stays deliverable), claim → process → ack in the service loop,
    :meth:`reclaim` at start AND on a periodic cadence, :meth:`close` on
    graceful stop (a consumer with a non-empty PEL is kept — its
    pending entries survive for the next start's reclaim).
    """

    def __init__(self, redis_url: str, group: str, *, key_prefix: str = "") -> None:
        self._group = group
        self._core = StreamTransport(redis_url, key_prefix=key_prefix)
        # Every stream this subscriber consumed from (ensure/claim/
        # reclaim) — the close-time deregistration set.
        self._streams: set[str] = set()

    # ── stream-name validation (§3.2 registry gate) ─────────────────────

    def _validated(self, stream: str) -> str:
        """Pass through ``stream`` iff it is ``stream_key(<registered
        type>)``; otherwise a loud ``ValueError`` BEFORE any Redis call —
        a typo'd stream name is a programming error, never a runtime
        hiccup. Reuses the registry's own gate (``require_type``) on the
        code side of the name, so the error lists the registered set."""
        prefix = f"{STREAM_KEY_PREFIX}:"
        code = stream[len(prefix) :] if stream.startswith(prefix) else None
        if code is None:
            raise ValueError(
                f"{stream!r} is not a domain-event stream name — expected"
                f" stream_key(<type>) = '{prefix}<type>'"
            )
        require_type(code)
        return stream

    # ── group lifecycle ──────────────────────────────────────────────────

    def ensure(self, streams: list[str]) -> None:
        """Subscriber-start duty: create this group on every stream
        (validated) with ``id=0 MKSTREAM`` — entries published before
        the group existed stay deliverable; an existing group (BUSYGROUP)
        is an idempotent no-op (the core's contract)."""
        for stream in streams:
            name = self._validated(stream)
            self._streams.add(name)
            self._core.ensure_group(name, self._group)

    # ── consumption ──────────────────────────────────────────────────────

    def claim(self, streams: list[str], count: int) -> list[ClaimedEvent]:
        """Non-blocking ``XREADGROUP >`` over each stream (validated),
        up to ``count`` entries per stream — parsed into
        :class:`ClaimedEvent`. The group must exist there (:meth:`ensure`
        runs first): NOGROUP surfaces as the typed transport error, loud.
        Entries land in this consumer's PEL — ack after materializing."""
        events: list[ClaimedEvent] = []
        for stream in streams:
            name = self._validated(stream)
            self._streams.add(name)
            for item in self._core.claim(name, self._group, count=count):
                events.append(self._claimed(item[ENVELOPE_KEY], item))
        return events

    def ack(self, stream: str, qid: str) -> None:
        """``XACK`` one entry by its :class:`ClaimedEvent.qid` — AFTER the
        result the event governs is materialized (at-least-once); a
        duplicate/late ack is a harmless no-op."""
        self._core.ack(self._validated(stream), self._group, qid)

    def reclaim(self, streams: list[str], min_idle_ms: int) -> list[ClaimedEvent]:
        """Return this group's hanging entries (claimed-but-unacked with
        idle ≥ ``min_idle_ms``): the RAW core XAUTOCLAIM transfer — the
        entries move into this consumer's PEL and are handed to the
        caller as :class:`ClaimedEvent`, NOTHING is re-XADDed (§3.6
        rev.2); the caller processes and acks them. Runs at subscriber
        start and on a periodic cadence (the caller's loop owns the
        interval — a module constant of the subscriber service, §3.4)."""
        events: list[ClaimedEvent] = []
        for stream in streams:
            name = self._validated(stream)
            self._streams.add(name)
            for page in self._core.autoclaim(name, self._group, min_idle_ms=min_idle_ms):
                for entry_id, fields in page:
                    events.append(self._claimed(entry_id, json.loads(fields[PAYLOAD_FIELD])))
        return events

    # ── stop / probe ─────────────────────────────────────────────────────

    def close(self) -> None:
        """Graceful stop: deregister this consumer from its groups with
        ``keep_if_pending`` — a consumer holding unacked entries is NOT
        deregistered (``XGROUP DELCONSUMER`` would destroy the delivery
        ledger); the pending entries survive for the next start's
        :meth:`reclaim`. A missing group/key is a graceful no-op; the
        release itself is idempotent (the core's contract)."""
        self._core.close((stream, self._group, True) for stream in sorted(self._streams))

    def ping(self) -> None:
        """Startup reachability probe — the ``connect_or_exit`` gate seam
        of the subscriber's process entry (Task 6)."""
        self._core.ping()

    # ── parsing ──────────────────────────────────────────────────────────

    @staticmethod
    def _claimed(qid: str, record: dict[str, Any]) -> ClaimedEvent:
        """Lift a parsed §4.1 record into a :class:`ClaimedEvent` — a
        malformed record (missing fields) is a code bug against the
        relay's formatter and fails loudly here."""
        return ClaimedEvent(
            qid=qid,
            event_id=record["event_id"],
            type=record["type"],
            occurred_at=record["occurred_at"],
            snapshot=record["snapshot"],
        )
