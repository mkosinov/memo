"""GH #483 Task 3 (spec §3.1, ADR 013): the ``RedisQueue`` adapter
against a REAL Redis — enqueue/read of tasks, reliable claim/ack for
statuses and inbound, consumer groups.

Marked ``redis`` with a declarative ``skipif`` guard over ``REDIS_URL``
(§3.6): without the variable every test here skips and the standard
no-Redis run stays green (invariant US-7/S2). Each test works in its
own key-prefix workspace (``contour`` fixture) and cleans up — safe on
a machine where a dev contour lives on the same instance.
"""

from typing import Any

from src.notify.queue import NotifyQueue
from tests.notify_redis_support import (
    RedisContour,
    capture_notify_logs,
    contour_fixture,
    make_inbound,
    make_status,
    make_task,
    redis_marks,
)

pytestmark = redis_marks

contour = contour_fixture()  # per-test isolated workspace fixture (§3.6)

WORKER_TEST_GROUP = "worker-test"  # part-3 worker stand-in for reading tasks


def _read_tasks(contour: RedisContour) -> list[dict[str, Any]]:
    """Consume ``notify:tasks`` via a test worker group (XREADGROUP ``>``),
    mirroring what part 3 will do."""
    stream = f"{contour.prefix}notify:tasks"
    contour.client.xgroup_create(stream, WORKER_TEST_GROUP, id="0", mkstream=True)
    reply = contour.client.xreadgroup(
        WORKER_TEST_GROUP,
        f"{WORKER_TEST_GROUP}-consumer",
        {stream: ">"},
        count=10,
    )
    return [
        {**_decode(fields), "_qid": entry_id}
        for _stream, entries in reply
        for entry_id, fields in entries
    ]


def _decode(fields: dict[str, str]) -> dict[str, Any]:
    import json

    return json.loads(fields["payload"])


class TestProtocolSeam:
    def test_redis_queue_satisfies_notify_queue_protocol(
        self, contour: RedisContour
    ) -> None:
        assert isinstance(contour.queue(), NotifyQueue)


class TestEnqueueTask:
    def test_task_round_trips_via_stream(self, contour: RedisContour) -> None:
        payload = make_task()
        contour.queue().enqueue_task(payload)
        (read,) = _read_tasks(contour)
        assert read["task_id"] == payload["task_id"]
        assert read["channel"] == payload["channel"]
        assert read["template_body"] == payload["template_body"]
        assert read["created_at"] == payload["created_at"]
        assert read["resend_of"] is None

    def test_payload_stored_as_single_field_without_envelope(
        self, contour: RedisContour
    ) -> None:
        """The task crosses the stream as ONE ``payload`` field (spec §3.1);
        the transport-reserved ``_qid`` envelope exists only on CLAIMED
        items, never inside the stored payload."""
        contour.queue().enqueue_task(make_task())
        stream = f"{contour.prefix}notify:tasks"
        (_entry_id, fields) = contour.client.xrange(stream, min="-", max="+")[0]
        assert set(fields) == {"payload"}
        assert "_qid" not in fields["payload"]


class TestPublishClaimStatuses:
    def test_claimed_fifo_with_envelope_then_empty(self, contour: RedisContour) -> None:
        q = contour.queue()
        q.ensure_consumer_groups()
        first, second = make_status(task_id=1), make_status(task_id=2)
        q.publish_status(first)
        q.publish_status(second)
        (claimed_first, claimed_second) = q.claim_statuses()
        assert claimed_first | {"_qid": claimed_first["_qid"]} == {
            **first,
            "_qid": claimed_first["_qid"],
        }
        assert claimed_first["task_id"] == 1
        assert claimed_second["task_id"] == 2
        assert claimed_first["_qid"] and claimed_second["_qid"]
        # reliable claim: the claimed batch is gone from the stream read
        assert q.claim_statuses() == []

    def test_claim_empty_stream_returns_empty_list(self, contour: RedisContour) -> None:
        q = contour.queue()
        q.ensure_consumer_groups()
        assert q.claim_statuses() == []


class TestAckStatus:
    def test_acked_item_is_not_redelivered(self, contour: RedisContour) -> None:
        q = contour.queue()
        q.ensure_consumer_groups()
        q.publish_status(make_status())
        (claimed,) = q.claim_statuses()
        q.ack_status(claimed)
        # the entry left the group PEL...
        stream = f"{contour.prefix}notify:statuses"
        assert contour.client.xpending(stream, "dispatcher")["pending"] == 0
        # the acked id can never come back: nothing is left in the PEL
        assert q.claim_statuses() == []

    def test_duplicate_ack_is_harmless(self, contour: RedisContour) -> None:
        """At-least-once seam (family §4.4): a late/duplicate ack must not
        raise — XACK of an unknown id is a no-op."""
        q = contour.queue()
        q.ensure_consumer_groups()
        q.publish_status(make_status())
        (claimed,) = q.claim_statuses()
        q.ack_status(claimed)
        q.ack_status(claimed)  # duplicate
        never_claimed = {**make_status(task_id=9), "_qid": "0-1"}
        q.ack_status(never_claimed)  # foreign/unknown id


class TestInboundMirror:
    def test_claim_inbound_fifo_and_envelope(self, contour: RedisContour) -> None:
        q = contour.queue()
        q.ensure_consumer_groups()
        first, second = make_inbound(task_id=1), make_inbound(task_id=2)
        q.publish_inbound(first)
        q.publish_inbound(second)
        claimed_first, claimed_second = q.claim_inbound()
        assert claimed_first["task_id"] == 1
        assert claimed_first["external_address"] == "+79990001122"
        assert claimed_second["task_id"] == 2
        assert q.claim_inbound() == []

    def test_ack_inbound_and_duplicate_harmless(self, contour: RedisContour) -> None:
        q = contour.queue()
        q.ensure_consumer_groups()
        q.publish_inbound(make_inbound())
        (claimed,) = q.claim_inbound()
        q.ack_inbound(claimed)
        q.ack_inbound(claimed)  # duplicate
        stream = f"{contour.prefix}notify:inbound"
        assert contour.client.xpending(stream, "dispatcher")["pending"] == 0


class TestConsumerGroups:
    def test_ensure_groups_creates_dispatcher_groups_idempotent(
        self, contour: RedisContour
    ) -> None:
        """XGROUP CREATE with MKSTREAM; a second call is suppressed as
        BUSYGROUP only — no error surfaces either way (spec §3.1)."""
        q = contour.queue()
        q.ensure_consumer_groups()
        q.ensure_consumer_groups()  # idempotent — BUSYGROUP suppressed
        for stream_name in ("notify:statuses", "notify:inbound"):
            groups = contour.client.xinfo_groups(f"{contour.prefix}{stream_name}")
            assert [g["name"] for g in groups] == ["dispatcher"]

    def test_consumer_name_is_unique_per_live_process(
        self, contour: RedisContour
    ) -> None:
        import os

        q = contour.queue()
        q.ensure_consumer_groups()
        q.publish_status(make_status())
        (q.claim_statuses(),)  # a real delivery materializes the consumer
        consumers = contour.client.xinfo_consumers(
            f"{contour.prefix}notify:statuses", "dispatcher"
        )
        assert f"dispatcher-{os.getpid()}" in [c["name"] for c in consumers]


class TestReclaimHanging:
    def test_unacked_hanging_entry_returns_to_delivery(self, contour: RedisContour) -> None:
        """A crashed previous process leaves claimed-but-unacked entries
        in the group PEL; XAUTOCLAIM at the new process's start returns
        them to delivery — claimable again, with a NEW ``_qid`` (the
        entry is re-added to the stream, family §4.4 at-least-once)."""
        dead = contour.queue(consumer_name="dispatcher-dead")
        dead.ensure_consumer_groups()
        dead.publish_status(make_status(task_id=7))
        (claimed,) = dead.claim_statuses()
        stream = f"{contour.prefix}notify:statuses"
        assert contour.client.xpending(stream, "dispatcher")["pending"] == 1

        fresh = contour.queue(reclaim_min_idle_ms=30)
        import time

        time.sleep(0.05)  # let the entry age past min-idle-time
        fresh.reclaim_hanging()

        (redelivered,) = fresh.claim_statuses()
        assert redelivered["task_id"] == 7
        assert redelivered["_qid"] != claimed["_qid"]
        assert contour.client.xpending(stream, "dispatcher")["pending"] == 1

    def test_acked_entries_are_not_resurrected(self, contour: RedisContour) -> None:
        dead = contour.queue(consumer_name="dispatcher-dead")
        dead.ensure_consumer_groups()
        dead.publish_status(make_status())
        (claimed,) = dead.claim_statuses()
        dead.ack_status(claimed)

        fresh = contour.queue(reclaim_min_idle_ms=0)
        fresh.reclaim_hanging()
        assert fresh.claim_statuses() == []

    def test_reclaim_covers_inbound_stream_too(self, contour: RedisContour) -> None:
        dead = contour.queue(consumer_name="dispatcher-dead")
        dead.ensure_consumer_groups()
        dead.publish_inbound(make_inbound(task_id=8))
        dead.claim_inbound()

        fresh = contour.queue(reclaim_min_idle_ms=0)
        fresh.reclaim_hanging()
        (redelivered,) = fresh.claim_inbound()
        assert redelivered["task_id"] == 8

    def test_entries_trimmed_from_stream_leave_pel_terminally(
        self, contour: RedisContour
    ) -> None:
        """Entries deleted under the MAXLEN ceiling are unrecoverable:
        the XAUTOCLAIM reply's third element reports them, they leave the
        PEL in the same call, and the adapter logs TERMINALLY (entry id +
        stream, no payload — logging hygiene §3.1)."""
        dead = contour.queue(consumer_name="dispatcher-dead")
        dead.ensure_consumer_groups()
        dead.publish_status(make_status(task_id=9))
        (claimed,) = dead.claim_statuses()
        stream = f"{contour.prefix}notify:statuses"
        assert contour.client.xdel(stream, claimed["_qid"]) == 1

        with capture_notify_logs() as messages:
            contour.queue(reclaim_min_idle_ms=0).reclaim_hanging()

        assert contour.client.xpending(stream, "dispatcher")["pending"] == 0
        terminal = [m for m in messages if "unrecoverable" in m]
        assert terminal, "trimmed-entry loss must be logged terminally"
        assert claimed["_qid"] in terminal[0]
        assert "notify:statuses" in terminal[0]
        # no message bodies in logs (hygiene): the payload text never leaks
        assert "Готовый текст" not in terminal[0]


class TestGracefulStop:
    def test_close_drops_consumer_from_groups(self, contour: RedisContour) -> None:
        """Graceful stop: XGROUP DELCONSUMER — no ghost consumers (the
        graceful path holds no PEL entries, spec §3.1)."""
        q = contour.queue()
        q.ensure_consumer_groups()
        q.publish_status(make_status())
        q.claim_statuses()
        stream = f"{contour.prefix}notify:statuses"
        assert contour.client.xinfo_consumers(stream, "dispatcher")

        q.close()

        assert contour.client.xinfo_consumers(stream, "dispatcher") == []

    def test_close_without_groups_is_graceful(self, contour: RedisContour) -> None:
        """A producer-only lifecycle (no groups ever created) closes
        cleanly — NOGROUP on DELCONSUMER is suppressed; anything else
        would break the shutdown (spec §3.1)."""
        contour.queue().close()

    def test_duplicate_close_is_harmless(self, contour: RedisContour) -> None:
        q = contour.queue()
        q.ensure_consumer_groups()
        q.close()
        q.close()  # idempotent teardown
