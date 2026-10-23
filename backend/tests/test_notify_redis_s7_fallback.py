"""GH #484 Task 7 (spec §4 S7, §3.6; family #476 US-5): channel fallback
and «не доставлено» — the marked integration contour of the delivery
core over the REAL ``RedisQueue``.

The scenario (spec §3.6): a HAND-CRAFTED §4.2 payload — a REAL
``task_id`` of an existing ``NotifyTask`` row (a UUID String(36): the
worker validator's string seam, commit 4cabab6b) plus two ``mock``
channel records scripted by address prefix — is enqueued through the
real adapter and consumed by ONE worker iteration of the Task-5
functions (no process): ``delivery_once`` claims, validates, delivers
through the §3.4 core and acks only after the whole status publication.

- fallback: the first record ``fail-transport:`` exhausts a SMALL retry
  budget (``NOTIFY_SEND_RETRIES`` monkeypatched to 2; the retry pause is
  squeezed through the clock-seam module constant — S9's «без реальных
  секунд» discipline applied to the marked contour), the second plain
  address delivers → events ``transport_error``×2 then ``sent``; the
  REAL dispatcher reader (``statuses_once`` → ``apply_status_event``)
  drives the DB row to ``sent`` with the full attempt journal;
- every channel scripted failing (``fail-transport:`` + ``fail-app:``)
  → ONE final ``failed/not_delivered`` (the last record's channel,
  §3.5) and the row ends ``failed``.

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
_GOOD = "+79990001133"
#: The retry-pause ceiling used while the budget lasts (plan: the sleep
#: seam, no real seconds — the budget itself is the monkeypatched 2).
_PAUSE_SECONDS = 0.05


def _iso_z(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _session_factory(db_engine) -> async_sessionmaker:
    return async_sessionmaker(db_engine, expire_on_commit=False)


async def _stage_task(db_session, channels: list[dict]) -> NotifyTask:
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
        text=_TEXT,
        channels=channels,
        reenqueues=0,
    )
    db_session.add(task)
    await db_session.commit()
    return task


def _payload(task: NotifyTask, channels: list[dict]) -> dict:
    """The hand-crafted §4.2 payload (spec §3.6): the REAL task row id
    plus the two scripted ``mock`` records — exactly what the e2e
    fallback contour puts on the seam."""
    return {
        "task_id": task.id,
        "text": _TEXT,
        "channels": channels,
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


class TestFallback:
    async def test_fail_transport_exhausts_retries_second_channel_delivers(
        self, db_engine, db_session, contour, monkeypatch
    ) -> None:
        """S7: the first record exhausts the small retry budget with
        ``transport_error`` events, the second delivers — the reader
        then drives the row to ``sent``."""
        monkeypatch.setattr(settings, "NOTIFY_SEND_RETRIES", 2)
        monkeypatch.setattr(worker, "TRANSPORT_RETRY_PAUSE_SECONDS", _PAUSE_SECONDS)
        scripted = [
            {"name": "mock", "address": _FAIL_TRANSPORT},
            {"name": "mock", "address": _GOOD},
        ]
        task = await _stage_task(db_session, scripted)

        queue = contour.queue()
        queue.ensure_worker_group()
        queue.ensure_consumer_groups()  # the dispatcher side reads the statuses
        queue.enqueue_task(_payload(task, scripted))

        recorder = InMemoryRecorder()
        await worker.delivery_once(queue, {"mock": MockChannel(recorder)}, asyncio.Event())

        # delivered by the SECOND record only, exactly once — the first
        # record's two attempts never reached the recorder
        assert recorder.deliveries == [{"address": _GOOD, "text": _TEXT}]
        # the task left delivery: acked after the whole status publication
        assert _pending(contour, TASKS_STREAM, WORKER_GROUP) == 0

        # the REAL dispatcher reader applies the published events
        await dispatcher.statuses_once(_session_factory(db_engine), queue)

        assert _task_status(task.id) == "sent"
        # the published sequence: transport_error×2 (the burned budget)
        # then sent via the second record
        assert _status_log(contour) == [
            ("sending", "attempt"),
            ("failed", "transport_error"),
            ("sending", "attempt"),
            ("failed", "transport_error"),
            ("sending", "attempt"),
            ("sent", "delivered"),
        ]
        assert _attempt_count(task.id) == 6  # append-only: one row per event
        # the statuses stream is drained: applied and acked, nothing hanging
        assert _pending(contour, STATUSES_STREAM, DISPATCHER_GROUP) == 0


class TestNotDelivered:
    async def test_all_channels_failing_final_not_delivered_row_failed(
        self, db_engine, db_session, contour, monkeypatch
    ) -> None:
        """S7, the terminal variant: every scripted channel fails — the
        transport budget burns on the first, the app error closes the
        second without retries — ONE final ``not_delivered`` and the
        row ends ``failed``."""
        monkeypatch.setattr(settings, "NOTIFY_SEND_RETRIES", 2)
        monkeypatch.setattr(worker, "TRANSPORT_RETRY_PAUSE_SECONDS", _PAUSE_SECONDS)
        scripted = [
            {"name": "mock", "address": _FAIL_TRANSPORT},
            {"name": "mock", "address": _FAIL_APP},
        ]
        task = await _stage_task(db_session, scripted)

        queue = contour.queue()
        queue.ensure_worker_group()
        queue.ensure_consumer_groups()
        queue.enqueue_task(_payload(task, scripted))

        recorder = InMemoryRecorder()
        await worker.delivery_once(queue, {"mock": MockChannel(recorder)}, asyncio.Event())

        assert recorder.deliveries == []  # nothing got through
        assert _pending(contour, TASKS_STREAM, WORKER_GROUP) == 0

        await dispatcher.statuses_once(_session_factory(db_engine), queue)

        assert _task_status(task.id) == "failed"
        # transport budget burned on the first record, the app error closed
        # the second without retries, ONE final not_delivered (§3.5)
        assert _status_log(contour) == [
            ("sending", "attempt"),
            ("failed", "transport_error"),
            ("sending", "attempt"),
            ("failed", "transport_error"),
            ("sending", "attempt"),
            ("failed", "app_error"),
            ("failed", "not_delivered"),
        ]
        assert _attempt_count(task.id) == 7  # append-only: one row per event
        assert _pending(contour, STATUSES_STREAM, DISPATCHER_GROUP) == 0
