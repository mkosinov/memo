"""Queue port of the notify subsystem (#482 spec §3.7; family #476 §4.2-§4.4).

``NotifyQueue`` is the seam to part 2 (#483): scenarios and the dispatcher
depend on this protocol only — never on Redis/arq. Payloads crossing the
seam are plain JSON dicts of the family contracts (§4.2 tasks, §4.3 status
events); no ORM objects.

Reliable-list pattern (family §4.4), mirrored for ``notify:statuses`` and
``notify:inbound``:

- ``claim`` — atomically move all pending items from the queue into an
  internal servicing list and return them;
- ``ack`` — delete a processed item from the servicing list;
- ``reclaim_hanging()`` — at process start, return everything left in the
  servicing lists (claimed but never acked) back to the queues; the
  redelivery makes the whole seam at-least-once.

``FakeQueue`` is the in-process implementation on plain lists: part 1
tests and the standard test contour (no Redis). The Redis/arq adapter
ships in part 2 and satisfies the same protocol.
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

#: Channel reply of ``notify:inbound`` — the payload contract is fixed
#: in part 2; for the port it is an opaque JSON dict.
InboundEvent = dict[str, Any]


@runtime_checkable
class NotifyQueue(Protocol):
    """Queue seam of the notify subsystem; part 2 plugs Redis/arq here."""

    def enqueue_task(self, payload: TaskPayload) -> None:
        """Push a ready delivery task (§4.2) to ``notify:tasks``."""
        ...

    def claim_statuses(self) -> list[StatusEvent]:
        """Atomically move all pending status events into the servicing
        list and return them (§4.4 reliable-list pattern)."""
        ...

    def ack_status(self, item: StatusEvent) -> None:
        """Delete a processed event from the servicing list."""
        ...

    def reclaim_hanging(self) -> None:
        """At process start: return claimed-but-unacked items (statuses
        and inbound) from the servicing lists back to their queues."""
        ...

    def claim_inbound(self) -> list[InboundEvent]:
        """Reliable-list claim for ``notify:inbound`` channel replies."""
        ...

    def ack_inbound(self, item: InboundEvent) -> None:
        """Delete a processed inbound event from the servicing list."""
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
