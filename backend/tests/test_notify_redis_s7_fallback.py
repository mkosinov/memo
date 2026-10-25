"""GH #484 Task 7 (spec §4 S7, §3.6; family #476 US-5) — «не доставлено»
and the attempt journal — the marked integration contour of the delivery
core over the REAL ``RedisQueue``.

Rev.5 (#485, ADR 014): the task is ONE channel — the worker-side
channel-record fallback of the original S7 no longer exists. The
per-channel outcomes below stay worker coverage over the real
transport; the CHANNEL CHAIN (first channel fails → the dispatcher
spawns the next → success/exhaustion, family US-5) arrives with part 4
Task 5 and its contour tests.

The scenario (spec §3.6): a HAND-CRAFTED §4.2 rev.5 payload — a REAL
``task_id`` of an existing ``NotifyTask`` row (a UUID String(36): the
worker validator's string seam, commit 4cabab6b) with one ``mock``
channel record scripted by address prefix — is enqueued through the
real adapter and consumed by ONE worker iteration of the Task-5
functions (no process): ``delivery_once`` claims, validates, assembles,
delivers through the §3.4 core and acks only after the whole status
publication.

- transport failure: the ``fail-transport:`` address exhausts a SMALL
  retry budget (``NOTIFY_SEND_RETRIES`` monkeypatched to 2; the retry
  pause is squeezed through the clock-seam module constant — S9's «без
  реальных секунд» discipline applied to the marked contour) →
  ``transport_error``×2 then ONE final ``failed/not_delivered``; the
  REAL dispatcher reader (``statuses_once`` → ``apply_status_event``)
  drives the DB row to ``failed`` with the full attempt journal;
- app failure: the ``fail-app:`` address closes the channel without
  retries → ONE ``app_error`` + the final ``not_delivered``; the row
  ends ``failed``.

Marked ``redis`` with the declarative ``REDIS_URL`` guard (§3.6): each
test works in its own key-prefix workspace (``contour`` fixture) and
cleans up after itself — safe next to a live dev contour on the same
instance.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import async_sessionmaker

import src.models  # noqa: F401 — registration first; breaks the models↔notify import cycle
from src.core.config import settings
from src.notify import dispatcher, worker
from src.notify.channels.mock import InMemoryRecorder, MockChannel
from src.notify.models import DomainEvent, NotifyTask
from src.notify.redis_queue import DISPATCHER_GROUP, STATUSES_STREAM, TASKS_STREAM, WORKER_GROUP
from tests.conftest import query_db
from tests.notify_redis_support import RedisContour, contour_fixture, redis_marks

pytestmark = redis_marks

contour = contour_fixture()  # per-test isolated workspace fixture (§3.6)

_TEXT = "Готовый текст S7"
_FAIL_TRANSPORT = "fail-transport:+79990001122"
_FAIL_APP = "fail-app:+79990001144"
#: The retry-pause ceiling used while the budget lasts (plan: the sleep
#: seam, no real seconds — the budget itself is the monkeypatched 2).
_PAUSE_SECONDS = 0.05


def _iso_z(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _session_factory(db_engine) -> async_sessionmaker:
    return async_sessionmaker(db_engine, expire_on_commit=False)


async def _stage_task(db_session, address: str) -> NotifyTask:
    """A real «queued» task row — the dispatcher-tests fixture pattern
    (``test_notify_dispatcher._stage_queued_task``): the payload below
    is hand-crafted per §3.6, but it carries the row's REAL id, so the
    statuses reader applies every event to a true row — no brak."""
    event = DomainEvent(
        type="new_record",
        occurred_at=datetime.now(UTC).replace(tzinfo=None),
        snapshot={},
    )
    db_session.add(event)
    await db_session.flush()
    task = NotifyTask(
        event_id=event.id,
        scenario="new_record",
        status="queued",
        channel="mock",
        address=address,
        payload={},
        template_id="06bd742e-56a7-4e4e-9f0e-3d5c0b6a1e11",
        template_body=_TEXT,
        reenqueues=0,
    )
    db_session.add(task)
    await db_session.commit()
    return task


def _payload(task: NotifyTask, address: str) -> dict:
    """The hand-crafted §4.2 rev.5 payload (spec §3.6): the REAL task
    row id plus the ONE scripted ``mock`` channel — exactly what the
    enabled contour puts on the seam."""
    return {
        "task_id": task.id,
        "channel": "mock",
        "address": address,
        "payload": {},
        "template_id": task.template_id,
        "template_body": _TEXT,
        "root_task_id": task.id,
        "created_at": _iso_z(datetime.now(UTC)),
        "resend_of": None,
    }


def _task_status(task_id: str) -> str:
    rows = query_db(f"SELECT status FROM notify_tasks WHERE id = '{task_id}'")
    assert rows, f"task {task_id} not found"
    return rows[0]["status"]


def _attempt_count(task_id: str) -> int:
    """Rows of the append-only attempt journal (one per applied event —
    the count checks the journal, the order lives on the stream below)."""
    return len(query_db(f"SELECT id FROM notify_task_attempts WHERE task_id = '{task_id}'"))


def _status_log(contour: RedisContour) -> list[tuple[str, str]]:
    """The §4.3 events in PUBLICATION order — XRANGE of the test's own
    statuses stream (acking does not remove entries, and the 10000-entry
    MAXLEN never trims a single-task contour; the attempt-journal ``id``
    is a random UUID, not an insertion cursor — no order there)."""
    stream = f"{contour.prefix}{STATUSES_STREAM}"
    entries = contour.client.xrange(stream, min="-", max="+")
    return [
        (payload["stage"], payload["outcome"])
        for _entry_id, fields in entries
        for payload in (json.loads(fields["payload"]),)
    ]


def _pending(contour: RedisContour, stream: str, group: str) -> int:
    return contour.client.xpending(f"{contour.prefix}{stream}", group)["pending"]


class TestTransportBudgetExhausted:
    async def test_fail_transport_exhausts_retries_final_not_delivered(
        self, db_engine, db_session, contour, monkeypatch
    ) -> None:
        """S7 (rev.5 worker half): the ``fail-transport:`` address burns
        the small retry budget with ``transport_error`` events, then ONE
        final ``failed/not_delivered`` closes the channel task — the
        reader drives the row to ``failed`` (the NEXT channel is the
        dispatcher chain, part 4 Task 5)."""
        monkeypatch.setattr(settings, "NOTIFY_SEND_RETRIES", 2)
        monkeypatch.setattr(worker, "TRANSPORT_RETRY_PAUSE_SECONDS", _PAUSE_SECONDS)
        task = await _stage_task(db_session, _FAIL_TRANSPORT)

        queue = contour.queue()
        queue.ensure_worker_group()
        queue.ensure_consumer_groups()  # the dispatcher side reads the statuses
        queue.enqueue_task(_payload(task, _FAIL_TRANSPORT))

        recorder = InMemoryRecorder()
        await worker.delivery_once(queue, {"mock": MockChannel(recorder)}, asyncio.Event())

        assert recorder.deliveries == []  # nothing got through
        # the task left delivery: acked after the whole status publication
        assert _pending(contour, TASKS_STREAM, WORKER_GROUP) == 0

        # the REAL dispatcher reader applies the published events
        await dispatcher.statuses_once(_session_factory(db_engine), queue)

        assert _task_status(task.id) == "failed"
        # the published sequence: transport_error×2 (the burned budget)
        # then the terminal not_delivered
        assert _status_log(contour) == [
            ("sending", "attempt"),
            ("failed", "transport_error"),
            ("sending", "attempt"),
            ("failed", "transport_error"),
            ("failed", "not_delivered"),
        ]
        assert _attempt_count(task.id) == 5  # append-only: one row per event
        # the statuses stream is drained: applied and acked, nothing hanging
        assert _pending(contour, STATUSES_STREAM, DISPATCHER_GROUP) == 0


class TestNotDelivered:
    async def test_app_error_closes_without_retries_final_not_delivered(
        self, db_engine, db_session, contour, monkeypatch
    ) -> None:
        """S7, the app-failure variant: the ``fail-app:`` address closes
        the channel after ONE attempt — no retries — and the final
        ``not_delivered`` ends the row as ``failed``."""
        monkeypatch.setattr(settings, "NOTIFY_SEND_RETRIES", 2)
        monkeypatch.setattr(worker, "TRANSPORT_RETRY_PAUSE_SECONDS", _PAUSE_SECONDS)
        task = await _stage_task(db_session, _FAIL_APP)

        queue = contour.queue()
        queue.ensure_worker_group()
        queue.ensure_consumer_groups()
        queue.enqueue_task(_payload(task, _FAIL_APP))

        recorder = InMemoryRecorder()
        await worker.delivery_once(queue, {"mock": MockChannel(recorder)}, asyncio.Event())

        assert recorder.deliveries == []  # nothing got through
        assert _pending(contour, TASKS_STREAM, WORKER_GROUP) == 0

        await dispatcher.statuses_once(_session_factory(db_engine), queue)

        assert _task_status(task.id) == "failed"
        # the app error closed the channel without retries, ONE final
        assert _status_log(contour) == [
            ("sending", "attempt"),
            ("failed", "app_error"),
            ("failed", "not_delivered"),
        ]
        assert _attempt_count(task.id) == 3  # append-only: one row per event
        assert _pending(contour, STATUSES_STREAM, DISPATCHER_GROUP) == 0
