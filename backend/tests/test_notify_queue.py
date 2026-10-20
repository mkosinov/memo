"""#482 Task 3 (spec §3.7, family #476 §4.2–§4.4): queue port + FakeQueue.

Pure unit tests — no DB, no Redis. ``FakeQueue`` must implement the
reliable-list pattern (family §4.4) in-process on plain lists:

- claim = atomic move queue → servicing list: the source is emptied and
  the claimed batch keeps FIFO order;
- ack = delete from the servicing list — processed items never reappear
  in later claims;
- ``reclaim_hanging()`` = claimed-but-unacked items (statuses AND
  inbound) return to the queue, order preserved, ahead of newer items,
  ready to be claimed again;
- ``FakeQueue`` satisfies the ``NotifyQueue`` protocol structurally —
  the seam part 2 (#483) plugs the Redis/arq adapter into.
"""

from typing import Any

import pytest

from src.notify.queue import FakeQueue, InboundEvent, NotifyQueue, StatusEvent, TaskPayload

pytestmark = pytest.mark.pure_unit


def _task(task_id: int = 456) -> TaskPayload:
    """Family §4.2 task payload."""
    return {
        "task_id": task_id,
        "text": "Готовый текст",
        "channels": [{"name": "telegram", "address": "+79990001122"}],
        "created_at": "2026-10-20T10:00:00",
        "resend_of": None,
    }


def _status(task_id: int = 456, stage: str = "sending") -> StatusEvent:
    """Family §4.3 worker stage event."""
    return {
        "task_id": task_id,
        "stage": stage,
        "channel": "telegram",
        "outcome": None,
        "error": None,
        "occurred_at": "2026-10-20T10:00:05",
    }


def _inbound(task_id: int = 456) -> InboundEvent:
    """Inbound reply — the payload contract itself is fixed in part 2;
    for the fake it is opaque."""
    return {"channel": "telegram", "task_id": task_id, "text": "Ответ клиента"}


class TestProtocolSeam:
    def test_fake_queue_satisfies_notify_queue_protocol(self) -> None:
        assert isinstance(FakeQueue(), NotifyQueue)


class TestEnqueueTask:
    def test_stores_payload_verbatim(self) -> None:
        q = FakeQueue()
        payload = _task()
        q.enqueue_task(payload)
        assert q.tasks == [payload]

    def test_fifo_order_preserved(self) -> None:
        q = FakeQueue()
        for task_id in (1, 2, 3):
            q.enqueue_task(_task(task_id=task_id))
        assert [t["task_id"] for t in q.tasks] == [1, 2, 3]


class TestClaimStatuses:
    def test_empty_queue_returns_empty_list(self) -> None:
        q = FakeQueue()
        assert q.claim_statuses() == []

    def test_returns_items_in_fifo_order(self) -> None:
        q = FakeQueue()
        first, second = _status(task_id=1), _status(task_id=2)
        q.push_status(first)
        q.push_status(second)
        assert q.claim_statuses() == [first, second]

    def test_claim_empties_source_atomic_move(self) -> None:
        q = FakeQueue()
        q.push_status(_status())
        q.claim_statuses()
        assert q.claim_statuses() == []


class TestAckStatus:
    def test_acked_item_not_returned_by_next_claim(self) -> None:
        q = FakeQueue()
        event = _status()
        q.push_status(event)
        q.claim_statuses()
        q.ack_status(event)
        q.reclaim_hanging()
        assert q.claim_statuses() == []

    def test_ack_of_unknown_item_is_noop(self) -> None:
        """At-least-once seam: a late/duplicate ack must not raise."""
        q = FakeQueue()
        q.ack_status(_status())  # never claimed
        q.push_status(_status(task_id=1))
        (claimed,) = q.claim_statuses()
        q.ack_status(claimed)
        q.ack_status(claimed)  # duplicate ack


class TestReclaimHanging:
    def test_returns_only_unacked_items_preserving_order(self) -> None:
        q = FakeQueue()
        first, second, third = _status(1), _status(2), _status(3)
        for event in (first, second, third):
            q.push_status(event)
        q.claim_statuses()
        q.ack_status(second)
        q.reclaim_hanging()
        assert q.claim_statuses() == [first, third]

    def test_noop_when_nothing_hanging(self) -> None:
        q = FakeQueue()
        pending = _status()
        q.push_status(pending)
        q.reclaim_hanging()
        assert q.claim_statuses() == [pending]

    def test_reclaim_puts_hanging_ahead_of_newer_items(self) -> None:
        """Hanging items are older than anything pushed after the claim —
        they return to the head of the queue, global FIFO stays true."""
        q = FakeQueue()
        older = _status(task_id=1)
        q.push_status(older)
        q.claim_statuses()
        newer = _status(task_id=2)
        q.push_status(newer)
        q.reclaim_hanging()
        assert q.claim_statuses() == [older, newer]


class TestInboundMirror:
    def test_claim_inbound_fifo_and_empties_source(self) -> None:
        q = FakeQueue()
        first, second = _inbound(task_id=1), _inbound(task_id=2)
        q.push_inbound(first)
        q.push_inbound(second)
        assert q.claim_inbound() == [first, second]
        assert q.claim_inbound() == []

    def test_ack_inbound_removes_from_servicing(self) -> None:
        q = FakeQueue()
        event = _inbound()
        q.push_inbound(event)
        q.claim_inbound()
        q.ack_inbound(event)
        q.reclaim_hanging()
        assert q.claim_inbound() == []

    def test_unacked_inbound_returned_by_reclaim(self) -> None:
        q = FakeQueue()
        first, second = _inbound(task_id=1), _inbound(task_id=2)
        q.push_inbound(first)
        q.push_inbound(second)
        q.claim_inbound()
        q.ack_inbound(first)
        q.reclaim_hanging()
        assert q.claim_inbound() == [second]

    def test_reclaim_covers_statuses_and_inbound_in_one_call(self) -> None:
        q = FakeQueue()
        status_hanging = _status()
        inbound_hanging = _inbound()
        q.push_status(status_hanging)
        q.push_inbound(inbound_hanging)
        q.claim_statuses()
        q.claim_inbound()
        q.reclaim_hanging()
        assert q.claim_statuses() == [status_hanging]
        assert q.claim_inbound() == [inbound_hanging]


class TestClaimedPayloadsAreJsonDicts:
    def test_claimed_statuses_are_plain_dicts(self) -> None:
        """Spec §3.7: payloads crossing the seam are JSON dicts — no ORM."""
        q: Any = FakeQueue()
        event = _status()
        q.push_status(event)
        claimed = q.claim_statuses()
        assert type(claimed[0]) is dict
