"""GH #484 Task 3 (spec §3.1; family #476 §4.2/§4.4): the WORKER half
of the real ``RedisQueue`` transport — the ``worker`` consumer group
on ``notify:tasks``.

Marked ``redis`` with a declarative ``skipif`` guard over ``REDIS_URL``
(§3.6): without the variable every test here skips and the standard
no-Redis run stays green. Each test works in its own key-prefix
workspace (``contour`` fixture) and cleans up after itself — safe on a
machine where a dev contour lives on the same instance.

Covered, per spec §3.1:

- ``ensure_worker_group`` — ``XGROUP CREATE id=0 MKSTREAM`` (the
  accumulated backlog stays deliverable — the point of part 3); double
  call suppresses BUSYGROUP;
- roundtrip: ``enqueue_task`` → ``claim_tasks`` (``_qid`` envelope) →
  ``ack_task`` → repeat claim empty;
- reliable delivery: an unacked entry returns to delivery through
  ``reclaim_hanging_tasks`` (``XAUTOCLAIM`` of the ``worker`` group) —
  the redelivered duplicate is accepted (family §4.4);
- graceful stop: ``close()`` removes the worker consumer only with an
  EMPTY PEL; a hanging entry keeps it (XGROUP DELCONSUMER would
  destroy the PEL records — the designed abort-path state).
"""

from __future__ import annotations

from src.notify.queue import WorkerQueue
from src.notify.redis_queue import TASKS_STREAM, WORKER_GROUP
from tests.notify_redis_support import (
    RedisContour,
    capture_notify_logs,
    contour_fixture,
    make_task,
    redis_marks,
)

pytestmark = redis_marks

contour = contour_fixture()  # per-test isolated workspace fixture (§3.6)


def _consumer_names(contour: RedisContour) -> list[str]:
    """Live consumers of the ``worker`` group — the observation surface
    of the graceful-stop tests (XINFO CONSUMERS)."""
    stream = f"{contour.prefix}{TASKS_STREAM}"
    return [c["name"] for c in contour.client.xinfo_consumers(stream, WORKER_GROUP)]


class TestWorkerProtocolSeam:
    def test_redis_queue_satisfies_worker_queue_protocol(self, contour: RedisContour) -> None:
        assert isinstance(contour.queue(), WorkerQueue)


class TestEnsureWorkerGroup:
    def test_double_call_idempotent_busygroup_suppressed(self, contour: RedisContour) -> None:
        q = contour.queue()
        q.ensure_worker_group()
        q.ensure_worker_group()  # BUSYGROUP suppressed — no raise

        groups = [g["name"] for g in contour.client.xinfo_groups(f"{contour.prefix}{TASKS_STREAM}")]
        assert groups == [WORKER_GROUP]

    def test_group_reads_backlog_enqueued_before_creation(self, contour: RedisContour) -> None:
        """``id=0`` is deliberate (§3.1): tasks accumulated WITHOUT a
        consumer must be deliverable at the group's first start."""
        q = contour.queue()
        q.enqueue_task(make_task(task_id=1))  # BEFORE any group exists
        q.ensure_worker_group()
        (claimed,) = q.claim_tasks()
        assert claimed["task_id"] == 1


class TestTaskRoundtrip:
    def test_enqueue_claim_ack_then_claim_empty(self, contour: RedisContour) -> None:
        q = contour.queue()
        payload = make_task()
        q.enqueue_task(payload)
        q.ensure_worker_group()

        (claimed,) = q.claim_tasks()
        assert claimed["task_id"] == payload["task_id"]
        assert claimed["text"] == payload["text"]
        assert claimed["channels"] == payload["channels"]
        assert claimed["resend_of"] is None
        assert isinstance(claimed["_qid"], str)  # transport envelope

        q.ack_task(claimed)
        assert q.claim_tasks() == []


class TestReclaimHangingTasks:
    def test_unacked_entry_returned_to_delivery(self, contour: RedisContour) -> None:
        """A claimed-but-unacked entry (crashed worker mid-task) returns
        to delivery via XAUTOCLAIM of the ``worker`` group; the
        redelivered duplicate is accepted (family §4.4)."""
        victim = contour.queue(consumer_name="worker-victim")
        victim.ensure_worker_group()
        victim.enqueue_task(make_task(task_id=456))
        (hanging,) = victim.claim_tasks()
        assert hanging  # sits in the victim's PEL, never acked
        victim.close()  # hanging PEL → consumer kept (asserted below)

        survivor = contour.queue(consumer_name="worker-next", reclaim_min_idle_ms=0)
        survivor.ensure_worker_group()
        survivor.reclaim_hanging_tasks()

        (redelivered,) = survivor.claim_tasks()
        assert redelivered["task_id"] == 456
        assert redelivered["_qid"] != hanging["_qid"]  # re-XADD, not a PEL re-read


class TestGracefulStop:
    def test_close_with_empty_pel_removes_worker_consumer(self, contour: RedisContour) -> None:
        q = contour.queue(consumer_name="worker-clean")
        q.ensure_worker_group()
        q.enqueue_task(make_task())
        (claimed,) = q.claim_tasks()
        q.ack_task(claimed)  # PEL empty — graceful removal

        q.close()

        assert "worker-clean" not in _consumer_names(contour)

    def test_close_with_hanging_entry_keeps_worker_consumer(self, contour: RedisContour) -> None:
        q = contour.queue(consumer_name="worker-hanging")
        q.ensure_worker_group()
        q.enqueue_task(make_task())
        (claimed,) = q.claim_tasks()
        assert claimed  # no ack — the PEL holds the entry

        with capture_notify_logs() as messages:
            q.close()

        assert "worker-hanging" in _consumer_names(contour)
        assert any("preserved for reclaim" in m for m in messages)

    def test_close_without_worker_group_stays_graceful(self, contour: RedisContour) -> None:
        """Regression: the XPENDING pre-check must respect NOGROUP —
        a queue whose worker group was never created (a dispatcher-only
        lifecycle, a wiped group) still closes gracefully; the worker
        half's guard may not out-noise the shutdown it guards."""
        q = contour.queue()
        q.enqueue_task(make_task())  # the tasks stream exists; the group does not
        q.close()  # NOGROUP suppressed — no raise
