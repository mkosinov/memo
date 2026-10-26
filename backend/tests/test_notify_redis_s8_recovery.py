"""GH #484 Task 7 (spec §4 S8; family #476 US-7): surviving a WORKER
crash — the marked integration contour of the hanging-entry recovery on
the real transport.

The scenario: a task is claimed and never acked (an entry sits in the
``worker`` group PEL — the mid-task crash state). A NEW ``RedisQueue``
with a SMALL ``reclaim_min_idle_ms=500`` — the re-enqueue window staged
by a short real wait, the aging precedent of
``test_notify_redis_reenqueue.py`` — returns it to delivery via
``reclaim_hanging_tasks``:

- claim hands the record out AGAIN (a re-XADD copy, family §4.4: the
  redelivered duplicate is accepted);
- the graceful-stop line of Task 3 pinned at scenario level: ``close()``
  of the crashed instance with a hanging entry KEEPS its consumer (no
  XGROUP DELCONSUMER — the PEL records survive for the reclaim);
- delivery proceeds on the reclaimed duplicate: ONE Task-5 iteration
  (``delivery_once``, no process) delivers through the mock channel,
  publishes the status events and acks — the PEL drains to zero.

The payload is well-formed (a valid UUID string ``task_id`` — no DB row
is needed for the transport-level scenario; the S7 module owns the
real-row loop).

Marked ``redis`` with the declarative ``REDIS_URL`` guard (§3.6): each
test works in its own key-prefix workspace (``contour`` fixture) and
cleans up after itself — safe next to a live dev contour.
"""

from __future__ import annotations

import asyncio
import time
import uuid

from src.notify import worker
from src.notify.channels.mock import InMemoryRecorder, MockChannel
from src.notify.redis_queue import TASKS_STREAM, WORKER_GROUP
from tests.notify_redis_support import (
    RedisContour,
    capture_notify_logs,
    contour_fixture,
    redis_marks,
)

pytestmark = redis_marks

contour = contour_fixture()  # per-test isolated workspace fixture (§3.6)

#: The small reclaim threshold of the scenario (plan: 500 ms — the
#: ``NOTIFY_REENQUEUE_AFTER`` analogue staged without the 120 s wait).
_RECLAIM_MIN_IDLE_MS = 500
#: Real wait past the threshold (aging by a small value, §4 S4/S8).
_AGING_WAIT_SECONDS = 0.7

_TEXT = "Готовый текст S8"
_GOOD = "+79990001133"


def _payload() -> dict:
    """A well-formed §4.2 rev.5 payload (one channel, frozen render
    data + template — the literal template keeps the assembled text ==
    _TEXT) — a valid UUID string ``task_id`` (the worker validator's
    seam): the transport scenario needs no DB row."""
    task_id = str(uuid.uuid4())
    return {
        "task_id": task_id,
        "channel": "mock",
        "address": _GOOD,
        "payload": {},
        "template_id": "06bd742e-56a7-4e4e-9f0e-3d5c0b6a1e11",
        "template_body": _TEXT,
        "root_task_id": task_id,
        "created_at": "2026-10-24T10:00:00Z",
        "resend_of": None,
    }


def _worker_consumers(contour: RedisContour) -> list[str]:
    """Live consumers of the ``worker`` group (XINFO CONSUMERS) — the
    observation surface of the graceful-stop scenario."""
    stream = f"{contour.prefix}{TASKS_STREAM}"
    return [c["name"] for c in contour.client.xinfo_consumers(stream, WORKER_GROUP)]


def _pending_tasks(contour: RedisContour) -> int:
    return contour.client.xpending(f"{contour.prefix}{TASKS_STREAM}", WORKER_GROUP)["pending"]


class TestWorkerCrashRecovery:
    def test_hanging_entry_returns_to_claim_and_consumer_survives_close(
        self, contour: RedisContour
    ) -> None:
        """Claimed and never acked → ``close()`` of the crashed instance
        keeps the consumer (the PEL records survive) → a new instance's
        ``reclaim_hanging_tasks`` (500 ms threshold) returns the record
        to delivery: claim hands it out again — the duplicate is
        accepted (family §4.4)."""
        payload = _payload()
        victim = contour.queue(consumer_name="worker-victim")
        victim.ensure_worker_group()
        victim.enqueue_task(payload)
        (hanging,) = victim.claim_tasks()  # the crash state: PEL entry, no ack
        assert hanging["task_id"] == payload["task_id"]
        assert _pending_tasks(contour) == 1

        with capture_notify_logs() as messages:
            victim.close()  # graceful stop with a NON-empty PEL

        # Task 3's line at scenario level: no delconsumer — the hanging
        # entry keeps the consumer registered for the next start's reclaim
        assert "worker-victim" in _worker_consumers(contour)
        assert any("preserved for reclaim" in m for m in messages)

        survivor = contour.queue(
            consumer_name="worker-next", reclaim_min_idle_ms=_RECLAIM_MIN_IDLE_MS
        )
        survivor.ensure_worker_group()
        time.sleep(_AGING_WAIT_SECONDS)  # age the entry past the small threshold
        survivor.reclaim_hanging_tasks()

        (redelivered,) = survivor.claim_tasks()
        # the record returns — a re-XADD duplicate, not a PEL re-read
        assert redelivered["task_id"] == payload["task_id"]
        assert redelivered["_qid"] != hanging["_qid"]
        assert _pending_tasks(contour) == 1  # the new claim alone; the original left the PEL

    async def test_reclaimed_duplicate_is_delivered_and_acked(self, contour: RedisContour) -> None:
        """Delivery proceeds on the reclaimed duplicate: one Task-5
        iteration claims the re-XADDed copy, delivers it through the
        mock channel, publishes the status events and acks — the PEL
        drains to zero."""
        payload = _payload()
        victim = contour.queue(consumer_name="worker-crashed")
        victim.ensure_worker_group()
        victim.enqueue_task(payload)
        (hanging,) = victim.claim_tasks()  # hard crash: no ack, no close
        assert hanging["task_id"] == payload["task_id"]

        survivor = contour.queue(
            consumer_name="worker-relived", reclaim_min_idle_ms=_RECLAIM_MIN_IDLE_MS
        )
        survivor.ensure_worker_group()
        survivor.ensure_consumer_groups()  # the statuses side of the same contour
        time.sleep(_AGING_WAIT_SECONDS)
        survivor.reclaim_hanging_tasks()

        recorder = InMemoryRecorder()
        await worker.delivery_once(survivor, {"mock": MockChannel(recorder)}, asyncio.Event())

        # the reclaimed duplicate was claimed AND delivered
        assert recorder.deliveries == [{"address": _GOOD, "text": _TEXT}]
        # acked after the whole status publication — nothing hangs anywhere
        assert survivor.claim_tasks() == []
        assert _pending_tasks(contour) == 0
        # the §4.3 events of the recovered delivery sit on the statuses
        # stream, claimable by the dispatcher side
        statuses = survivor.claim_statuses()
        assert [(e["stage"], e["outcome"]) for e in statuses] == [
            ("sending", "attempt"),
            ("sent", "delivered"),
        ]
        assert statuses[0]["task_id"] == payload["task_id"]
