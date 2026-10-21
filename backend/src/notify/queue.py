"""Queue port of the notify subsystem (#482 spec §3.7; family #476 §4.2-§4.4).

``NotifyQueue`` is the seam between the notify logic and its transport:
scenarios and the dispatcher depend on this protocol only — never on
Redis directly. Payloads crossing the seam are plain JSON dicts of the
family contracts (§4.2 tasks, §4.3 status events, §3.2 inbound); no ORM
objects.

Reliable-delivery seam (family §4.4), mapped by every implementation:

- ``claim_*`` — atomically take the pending items and return them; the
  source no longer offers them to a plain next claim;
- ``ack_*`` — mark a processed item done; a late/duplicate ack is a
  harmless no-op (at-least-once tolerance);
- ``reclaim_hanging()`` — at process start, put claimed-but-unacked
  items back into delivery; the redelivery makes the whole seam
  at-least-once.

Items returned by ``claim_*`` are treated as opaque payloads plus the
TRANSPORT-RESERVED envelope key ``_qid`` (the delivery ticket: with the
Redis Streams adapter, ``src/notify/redis_queue.py``, it is the stream
entry id backing ``XACK``). The underscore marks the key as reserved
for the transport — payload contracts never use it; consumers pass the
item back to ``ack_*`` untouched.

Implementations: ``FakeQueue`` (in-process, plain lists — part 1 tests
and the standard test contour, no Redis) and ``RedisQueue`` (Redis
Streams + consumer groups, ADR 013 — part 2, GH #483).
"""

import contextlib
from typing import Any, Protocol, runtime_checkable

# ── Contracts (family #476 §4.2/§4.3) — JSON dicts, no ORM objects ──────────

#: Task payload of ``notify:tasks`` (§4.2):
#: ``{task_id, text, channels: [{name, address}], created_at, resend_of}``.
TaskPayload = dict[str, Any]

#: Worker stage event of ``notify:statuses`` (§4.3):
#: ``{task_id, stage: sending|sent|failed, channel, outcome, error,
#: occurred_at}``.
StatusEvent = dict[str, Any]

#: Channel reply of ``notify:inbound`` — the format is FIXED (family
#: §4.3; part-2 spec §3.2, GH #483):
#: ``{channel, external_address, kind, text, task_id, occurred_at}``.
#: All keys required; ``text`` ≤ 4000 chars; ``external_address`` ≤ 20
#: chars; ``occurred_at`` — UTC ISO-8601 of the external message.
#: Consumption rules (enforced by the dispatcher from part 3): the
#: source only normalizes into this format — all processing lives in
#: the dispatcher's handler extensions; ``channel`` is validated
#: against the channel registry and ``kind`` against the pilot
#: dictionary (``text``) — an unknown value is logged (identifiers
#: only, NO message text) and acked; no separate rejected-items stream.
#: The consumer verifies ``external_address`` against the channel
#: address of ``task_id`` — a mismatch is invalid (protects against
#: swapped/spoofed replies between clients). Deduplication by
#: ``task_id`` is deliberately NOT built — re-processing is harmless,
#: duplicates accepted (family §4.4).
#: A typed schema is deliberately NOT introduced here — it arrives with
#: the first producer (#485). Claimed items additionally carry the
#: transport-reserved ``_qid`` envelope (see module docstring).
InboundEvent = dict[str, Any]


@runtime_checkable
class NotifyQueue(Protocol):
    """Queue seam of the notify subsystem; the transport adapter plugs
    in here (Redis Streams — ``redis_queue.RedisQueue``, ADR 013)."""

    def enqueue_task(self, payload: TaskPayload) -> None:
        """Push a ready delivery task (§4.2) to ``notify:tasks``."""
        ...

    def claim_statuses(self) -> list[StatusEvent]:
        """Atomically take the pending status events and return them
        (§4.4 reliable delivery)."""
        ...

    def ack_status(self, item: StatusEvent) -> None:
        """Mark a processed status event done (idempotent)."""
        ...

    def reclaim_hanging(self) -> None:
        """At process start: return claimed-but-unacked items (statuses
        and inbound) back into delivery."""
        ...

    def claim_inbound(self) -> list[InboundEvent]:
        """Reliable claim for ``notify:inbound`` channel replies."""
        ...

    def ack_inbound(self, item: InboundEvent) -> None:
        """Mark a processed inbound event done (idempotent)."""
        ...


class FakeQueue:
    """In-process ``NotifyQueue`` on plain lists (part 1 tests, no Redis).

    FIFO everywhere: ``claim_*`` moves the whole queue into an internal
    servicing list (source emptied), ``ack_*`` deletes from it, and
    ``reclaim_hanging()`` puts the survivors back at the head of their
    queues — older than anything pushed meanwhile, so global order holds.

    ``push_status`` / ``push_inbound`` emulate the worker side for tests;
    they are deliberately NOT on the protocol (the dispatcher never
    produces statuses or replies). ``tasks`` is the matching read seam
    for what scenarios enqueued.
    """

    def __init__(self) -> None:
        self._tasks: list[TaskPayload] = []
        self._statuses: list[StatusEvent] = []
        self._inbound: list[InboundEvent] = []
        self._servicing_statuses: list[StatusEvent] = []
        self._servicing_inbound: list[InboundEvent] = []

    # ── producer side (protocol) ─────────────────────────────────────────────

    def enqueue_task(self, payload: TaskPayload) -> None:
        self._tasks.append(payload)

    @property
    def tasks(self) -> list[TaskPayload]:
        """Snapshot of the tasks pushed so far (test seam)."""
        return list(self._tasks)

    # ── worker side (test seams, not on the protocol) ────────────────────────

    def push_status(self, event: StatusEvent) -> None:
        self._statuses.append(event)

    def push_inbound(self, event: InboundEvent) -> None:
        self._inbound.append(event)

    # ── reliable list: notify:statuses ───────────────────────────────────────

    def claim_statuses(self) -> list[StatusEvent]:
        claimed, self._statuses = self._statuses, []
        self._servicing_statuses.extend(claimed)
        return claimed

    def ack_status(self, item: StatusEvent) -> None:
        # A no-op when the item is gone (already acked or reclaimed) —
        # at-least-once tolerance (family §4.4): a late/duplicate ack is
        # harmless.
        with contextlib.suppress(ValueError):
            self._servicing_statuses.remove(item)

    # ── reliable list: notify:inbound ────────────────────────────────────────

    def claim_inbound(self) -> list[InboundEvent]:
        claimed, self._inbound = self._inbound, []
        self._servicing_inbound.extend(claimed)
        return claimed

    def ack_inbound(self, item: InboundEvent) -> None:
        with contextlib.suppress(ValueError):
            self._servicing_inbound.remove(item)

    # ── process start ────────────────────────────────────────────────────────

    def reclaim_hanging(self) -> None:
        """Return hanging items to the heads of their queues (§4.4)."""
        self._statuses = self._servicing_statuses + self._statuses
        self._servicing_statuses = []
        self._inbound = self._servicing_inbound + self._inbound
        self._servicing_inbound = []
