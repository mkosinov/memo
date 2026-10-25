"""Queue ports of the notify subsystem (#482 spec §3.7; family #476
§4.2-§4.4; worker half — #484 spec §3.1).

Two complementary protocol halves form the seam between the notify
logic and its transport — consumers depend on the protocols only,
never on Redis directly. ``NotifyQueue`` is the dispatcher-side half
(scenarios, statuses/inbound consumption); ``WorkerQueue`` is the
worker-side half (task consumption, status publication — #484 §3.1).
Payloads crossing either seam are plain JSON dicts of the family
contracts (§4.2 tasks, §4.3 status events, §3.2 inbound); no ORM
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

# ── Contracts (family #476 §4.2/§4.3, rev.5) — JSON dicts, no ORM objects ────

#: Task payload of ``notify:tasks`` (§4.2 rev.5 — task = one channel,
#: ADR 014): ``{task_id, channel, address, payload, template_id,
#: template_body, root_task_id, created_at, resend_of}`` — the frozen
#: task row verbatim; the worker assembles the text from
#: ``payload`` + ``template_body``.
TaskPayload = dict[str, Any]

#: Worker stage event of ``notify:statuses`` (§4.3 rev.5):
#: ``{task_id, stage: sending|sent|failed, channel, outcome, error,
#: sent_text, occurred_at}`` — ``sent_text`` carries the actually
#: transmitted text (None when the attempt died before transmission).
StatusEvent = dict[str, Any]


def build_task_payload(task: Any, created_at: str) -> TaskPayload:
    """Map a ``NotifyTask`` row (duck-typed) onto the §4.2 rev.5 payload.

    The single construction point of the seam: the scenario (first
    enqueue) and the dispatcher's re-enqueue cycle emit the SAME shape
    from the SAME frozen columns — addresses never re-resolved (ADR
    014). Pure dict out: no ORM object crosses the seam.
    """
    return {
        "task_id": task.id,
        "channel": task.channel,
        "address": task.address,
        "payload": task.payload,
        "template_id": task.template_id,
        "template_body": task.template_body,
        "root_task_id": task.root_task_id,
        "created_at": created_at,
        "resend_of": task.resend_of,
    }

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

    def ensure_consumer_groups(self) -> None:
        """Consumer-start duty (§3.1): create this consumer's groups on
        the up-streams (``XGROUP CREATE ... MKSTREAM``; only BUSYGROUP
        suppressed) — ``reclaim_hanging`` needs them to exist."""
        ...

    def claim_inbound(self) -> list[InboundEvent]:
        """Reliable claim for ``notify:inbound`` channel replies."""
        ...

    def ack_inbound(self, item: InboundEvent) -> None:
        """Mark a processed inbound event done (idempotent)."""
        ...


@runtime_checkable
class WorkerQueue(Protocol):
    """Worker-side half of the queue seam (part 3 #484, spec §3.1).
    publish_status is TYPED here (ADR 013 keeps it off the dispatcher
    protocol); names follow the adapter (FakeQueue.push_status stays
    as an alias for part-1/2 tests)."""

    def claim_tasks(self) -> list[TaskPayload]:
        """Reliable claim for ``notify:tasks`` delivery tasks (§4.4)."""
        ...

    def ack_task(self, item: TaskPayload) -> None:
        """Mark a delivered task done (idempotent)."""
        ...

    def publish_status(self, event: StatusEvent) -> None:
        """Publish a §4.3 worker stage event to ``notify:statuses``."""
        ...

    def ensure_worker_group(self) -> None:
        """Worker-start duty (§3.1): create the ``worker`` group on
        ``notify:tasks`` (``id=0 MKSTREAM`` — the accumulated backlog
        stays deliverable; this is the point of part 3)."""
        ...

    def reclaim_hanging_tasks(self) -> None:
        """Return claimed-but-unacked TASKS back into delivery (§4.4);
        statuses/inbound reclaim is the dispatcher half's own duty."""
        ...


class FakeQueue:
    """In-process ``NotifyQueue`` on plain lists (part 1 tests, no Redis).

    FIFO everywhere: ``claim_*`` moves the whole queue into an internal
    servicing list (source emptied), ``ack_*`` deletes from it, and
    ``reclaim_hanging()`` puts the survivors back at the head of their
    queues — older than anything pushed meanwhile, so global order holds.

    ``publish_status`` is the worker-protocol name (#484 §3.1); the
    older ``push_status`` stays as a part-1/2 test alias, and
    ``push_inbound`` emulates channel replies for tests (off-protocol
    — replies come from external channels). ``tasks`` is the matching
    read seam for what scenarios enqueued.
    """

    def __init__(self) -> None:
        self._tasks: list[TaskPayload] = []
        self._statuses: list[StatusEvent] = []
        self._inbound: list[InboundEvent] = []
        self._servicing_tasks: list[TaskPayload] = []
        self._servicing_statuses: list[StatusEvent] = []
        self._servicing_inbound: list[InboundEvent] = []

    # ── producer side (protocol) ─────────────────────────────────────────────

    def enqueue_task(self, payload: TaskPayload) -> None:
        self._tasks.append(payload)

    @property
    def tasks(self) -> list[TaskPayload]:
        """Snapshot of the tasks pushed so far (test seam)."""
        return list(self._tasks)

    # ── worker side (test seams; publish_status IS on WorkerQueue) ──────────

    def push_status(self, event: StatusEvent) -> None:
        self._statuses.append(event)

    #: Worker-protocol name (#484 §3.1) — same function object, the
    #: part-1/2 ``push_status`` tests keep their spelling.
    publish_status = push_status

    def push_inbound(self, event: InboundEvent) -> None:
        self._inbound.append(event)

    # ── reliable list: notify:tasks (worker half, #484 §3.1) ────────────────

    def claim_tasks(self) -> list[TaskPayload]:
        claimed, self._tasks = self._tasks, []
        self._servicing_tasks.extend(claimed)
        return claimed

    def ack_task(self, item: TaskPayload) -> None:
        with contextlib.suppress(ValueError):
            self._servicing_tasks.remove(item)

    def reclaim_hanging_tasks(self) -> None:
        """Return hanging TASKS to the head of the queue (§4.4) — tasks
        only; the dispatcher half's ``reclaim_hanging`` owns statuses
        and inbound (spec §3.1)."""
        self._tasks = self._servicing_tasks + self._tasks
        self._servicing_tasks = []

    def ensure_worker_group(self) -> None:
        """No-op: plain lists need no consumer groups (§3.1 seam)."""

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

    def ensure_consumer_groups(self) -> None:
        """No-op: plain lists need no consumer groups (§3.1 seam)."""
