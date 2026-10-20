"""GH #482 Task 9 (spec §3.8; family #476 §4.3/§4.4): dispatcher process.

Three loops of one ``asyncio.TaskGroup`` over the queue port: journal
polling (batch 20 + re-enqueue sweep), ``notify:statuses`` reading
(§4.3 derived state), ``notify:inbound`` reading (empty pilot registry).
Covered (spec §5, US-5–US-8):

- polling processes and marks a batch (order ``occurred_at, id``, batch
  limit), the real scenario closes events for deleted records;
- 3-attempts policy: ``attempts`` 1→2→3 → ``processing_error`` (last
  error text), NOT written during attempts 1–2, dead event no longer
  picked;
- statuses: attempt rows appended, derived state per §4.3 (first
  ``sending`` → sending; first ``sent`` of ANY attempt → sent, terminal;
  final ``failed`` → failed), idempotent re-apply (duplicate redelivery
  harmless), unknown task → logged + NOT acked (at-least-once),
  ``reclaim_hanging()`` at dispatcher start;
- re-enqueue: by age with the SAVED payload in full, ``updated_at``
  refreshed (no every-tick re-enqueue), cap 10 → ``failed`` with the
  «не доставлено» error;
- ``NOTIFY_CHANNEL_PRIORITY`` parsing: empty/duplicates → loud startup
  error;
- inbound with no handler → warning + ack;
- ``NOTIFY_ENABLED=false`` → ``main()`` logs and returns without
  touching the queue;
- one iteration crash does not kill the loop or its siblings.
"""

import asyncio
import logging
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

import src.models  # noqa: F401 — registration first; breaks the models↔notify import cycle
from src.core.config import settings
from src.notify import dispatcher
from src.notify.models import DomainEvent, NotifyTask
from src.notify.queue import FakeQueue
from src.notify.render import RenderError
from src.notify.scenarios import SCENARIOS
from tests.conftest import query_db, query_db_params

pytestmark = pytest.mark.integration


# ── helpers ─────────────────────────────────────────────────────────────────

_LOGGER_NAME = "memo.notify.dispatcher"


class _ListHandler(logging.Handler):
    """In-memory sink — caplog is unusable in this repo (the app logging
    setup strips pytest's capture handler), so log assertions attach a
    dedicated handler to the dispatcher logger instead."""

    def __init__(self) -> None:
        super().__init__()
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(record.getMessage())


@contextmanager
def capture_dispatcher_logs() -> Iterator[list[str]]:
    """Attach an in-memory sink to the dispatcher logger.

    caplog is unusable here, and the logger needs re-enabling: the
    session-scoped schema setup runs ``alembic/env.py`` whose
    ``fileConfig(...)`` defaults to ``disable_existing_loggers=True`` —
    every logger created before it (i.e. at collection-time imports)
    ends up ``disabled``, silently dropping records. The context manager
    force-enables the logger for the capture window and restores state.
    """
    lg = logging.getLogger(_LOGGER_NAME)
    handler = _ListHandler()
    old_level, old_disabled = lg.level, lg.disabled
    lg.setLevel(logging.DEBUG)
    lg.disabled = False
    lg.addHandler(handler)
    try:
        yield handler.messages
    finally:
        lg.removeHandler(handler)
        lg.setLevel(old_level)
        lg.disabled = old_disabled


def _session_factory(db_engine):
    return async_sessionmaker(db_engine, expire_on_commit=False)


def _iso_z(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


async def _stage_event(
    db_session,
    *,
    type_: str = "new_record",
    occurred_at: datetime | None = None,
) -> DomainEvent:
    """A pending journal event; the default snapshot points at a record
    that does not exist — the real scenario then closes the event
    WITHOUT a task (§3.4 deleted-record branch)."""
    event = DomainEvent(
        type=type_,
        occurred_at=occurred_at or datetime.now(UTC).replace(tzinfo=None),
        snapshot={
            "event": {
                "type": type_,
                "occurred_at": _iso_z(datetime.now(UTC)),
                "record_id": str(uuid.uuid4()),
            }
        },
    )
    db_session.add(event)
    await db_session.commit()
    return event


async def _stage_queued_task(
    db_session,
    *,
    status: str = "queued",
    reenqueues: int = 0,
    age_seconds: int | None = None,
) -> NotifyTask:
    """A task row with FROZEN payload fields; ``age_seconds`` rewinds
    ``updated_at`` behind the re-enqueue predicate via raw SQL."""
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
        status=status,
        text="готовый текст",
        channels=[{"name": "telegram", "address": "+7OLD"}],
        reenqueues=reenqueues,
    )
    db_session.add(task)
    await db_session.commit()
    if age_seconds is not None:
        stale = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=age_seconds)
        query_db_params(
            "UPDATE notify_tasks SET updated_at = :u WHERE id = :i",
            {"u": stale.strftime("%Y-%m-%d %H:%M:%S.%f"), "i": task.id},
        )
    return task


def _status_item(task_id: str, stage: str, *, channel: str = "telegram") -> dict:
    return {
        "task_id": task_id,
        "stage": stage,
        "channel": channel,
        "outcome": None,
        "error": "boom" if stage == "failed" else None,
        "occurred_at": _iso_z(datetime.now(UTC)),
    }


def _task_row(task_id: str, *cols: str) -> dict:
    col_list = ", ".join(cols)
    rows = query_db(f"SELECT {col_list} FROM notify_tasks WHERE id = '{task_id}'")
    assert rows, f"task {task_id} not found"
    return rows[0]


def _event_row(event_id: str) -> dict:
    rows = query_db(
        "SELECT processed_at, attempts, processing_error FROM domain_events"
        f" WHERE id = '{event_id}'"
    )
    assert rows, f"event {event_id} not found"
    return rows[0]


# ── NOTIFY_CHANNEL_PRIORITY parsing (§3.8) ──────────────────────────────────


class TestChannelPriorityParsing:
    def test_case_insensitive_order_preserved(self) -> None:
        assert dispatcher.parse_channel_priority("Telegram,WhatsApp") == [
            "telegram",
            "whatsapp",
        ]

    def test_single_channel(self) -> None:
        assert dispatcher.parse_channel_priority("telegram") == ["telegram"]

    @pytest.mark.parametrize("raw", ["", "   "])
    def test_empty_string_is_loud_error(self, raw: str) -> None:
        with pytest.raises(ValueError, match="NOTIFY_CHANNEL_PRIORITY"):
            dispatcher.parse_channel_priority(raw)

    @pytest.mark.parametrize("raw", ["telegram,Telegram", "sms,telegram,sms", "SMS,sms"])
    def test_duplicates_are_loud_error(self, raw: str) -> None:
        with pytest.raises(ValueError, match="NOTIFY_CHANNEL_PRIORITY"):
            dispatcher.parse_channel_priority(raw)

    def test_empty_segment_is_loud_error(self) -> None:
        with pytest.raises(ValueError, match="NOTIFY_CHANNEL_PRIORITY"):
            dispatcher.parse_channel_priority("telegram,,sms")


# ── main(): disabled path + startup validation (§3.8) ──────────────────────


class TestMain:
    async def test_disabled_main_logs_and_returns_without_touching_queue(self, monkeypatch) -> None:
        monkeypatch.setattr(settings, "NOTIFY_ENABLED", False)
        queue = FakeQueue()
        status = _status_item(str(uuid.uuid4()), "sending")
        inbound = {"channel": "telegram", "text": "hi"}
        queue.push_status(status)
        queue.push_inbound(inbound)

        with capture_dispatcher_logs() as messages:
            await dispatcher.main(queue)

        assert any("NOTIFY_ENABLED" in m for m in messages)
        # nothing was ever claimed — the queue still holds both items
        assert queue.claim_statuses() == [status]
        assert queue.claim_inbound() == [inbound]

    async def test_enabled_bad_priority_is_loud_startup_error(self, monkeypatch) -> None:
        monkeypatch.setattr(settings, "NOTIFY_ENABLED", True)
        monkeypatch.setattr(settings, "NOTIFY_CHANNEL_PRIORITY", "")
        with pytest.raises(ValueError, match="NOTIFY_CHANNEL_PRIORITY"):
            await dispatcher.main(FakeQueue())


# ── cycle 1: journal polling (§3.8) ─────────────────────────────────────────


class TestPollingBatch:
    async def test_poll_processes_and_marks_batch(self, db_engine, db_session) -> None:
        base = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=10)
        for i in range(3):
            await _stage_event(db_session, occurred_at=base + timedelta(seconds=i))

        await dispatcher.process_pending_batch(_session_factory(db_engine), FakeQueue())

        rows = query_db("SELECT processed_at FROM domain_events")
        assert len(rows) == 3
        # nonexistent record → the scenario closes the event WITHOUT a task
        assert all(r["processed_at"] is not None for r in rows)
        assert query_db("SELECT id FROM notify_tasks") == []

    async def test_poll_respects_batch_size_and_occurred_at_order(
        self, db_engine, db_session, monkeypatch
    ) -> None:
        monkeypatch.setattr(dispatcher, "POLL_BATCH_SIZE", 2)
        base = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=10)
        staged = [
            (await _stage_event(db_session, occurred_at=base + timedelta(seconds=i))).id
            for i in range(5)
        ]

        await dispatcher.process_pending_batch(_session_factory(db_engine), FakeQueue())
        closed = {
            r["id"] for r in query_db("SELECT id FROM domain_events WHERE processed_at IS NOT NULL")
        }
        assert closed == set(staged[:2])  # oldest first, batch of 2

        await dispatcher.process_pending_batch(_session_factory(db_engine), FakeQueue())
        closed = {
            r["id"] for r in query_db("SELECT id FROM domain_events WHERE processed_at IS NOT NULL")
        }
        assert closed == set(staged[:4])

    async def test_unknown_event_type_logged_and_stays_pending(self, db_engine, db_session) -> None:
        event = await _stage_event(db_session, type_="mystery")

        with capture_dispatcher_logs() as messages:
            await dispatcher.process_pending_batch(_session_factory(db_engine), FakeQueue())

        assert any("mystery" in m for m in messages)
        row = _event_row(event.id)
        assert row["processed_at"] is None
        assert row["attempts"] == 0
        assert row["processing_error"] is None


class TestAttemptsPolicy:
    async def test_attempts_1_2_3_then_processing_error(
        self, db_engine, db_session, monkeypatch
    ) -> None:
        calls: list[str] = []

        async def boom(event, session, queue) -> None:
            calls.append(event.id)
            raise RenderError("template exploded")

        monkeypatch.setitem(SCENARIOS, "new_record", boom)
        event = await _stage_event(db_session)
        factory = _session_factory(db_engine)

        await dispatcher.process_pending_batch(factory, FakeQueue())
        row = _event_row(event.id)
        assert row["attempts"] == 1
        assert row["processing_error"] is None  # NOT written on attempt 1
        assert row["processed_at"] is None

        await dispatcher.process_pending_batch(factory, FakeQueue())
        row = _event_row(event.id)
        assert row["attempts"] == 2
        assert row["processing_error"] is None  # NOT written on attempt 2

        await dispatcher.process_pending_batch(factory, FakeQueue())
        row = _event_row(event.id)
        assert row["attempts"] == 3
        assert row["processed_at"] is None
        assert row["processing_error"] is not None
        assert "template exploded" in row["processing_error"]

        # dead event: the polling predicate no longer takes it
        await dispatcher.process_pending_batch(factory, FakeQueue())
        assert len(calls) == 3


# ── cycle 2: notify:statuses → attempts + derived state (§4.3) ──────────────


class TestStatusesCycle:
    async def test_sending_then_sent_terminal(self, db_engine, db_session) -> None:
        task = await _stage_queued_task(db_session)
        factory = _session_factory(db_engine)
        queue = FakeQueue()

        queue.push_status(_status_item(task.id, "sending"))
        await dispatcher.statuses_once(factory, queue)
        assert _task_row(task.id, "status")["status"] == "sending"
        assert query_db(f"SELECT stage FROM notify_task_attempts WHERE task_id = '{task.id}'") == [
            {"stage": "sending"}
        ]

        queue.push_status(_status_item(task.id, "sent"))
        await dispatcher.statuses_once(factory, queue)
        assert _task_row(task.id, "status")["status"] == "sent"

        # sent is TERMINAL — later stages of any attempt never override
        queue.push_status(_status_item(task.id, "sending"))
        queue.push_status(_status_item(task.id, "failed"))
        await dispatcher.statuses_once(factory, queue)
        assert _task_row(task.id, "status")["status"] == "sent"
        # attempt rows are append-only: one per status event
        assert (
            len(query_db(f"SELECT id FROM notify_task_attempts WHERE task_id = '{task.id}'")) == 4
        )

    async def test_failed_then_late_sent_of_any_attempt_wins(self, db_engine, db_session) -> None:
        task = await _stage_queued_task(db_session)
        factory = _session_factory(db_engine)
        queue = FakeQueue()

        queue.push_status(_status_item(task.id, "failed"))
        await dispatcher.statuses_once(factory, queue)
        assert _task_row(task.id, "status")["status"] == "failed"

        # «первый sent любой попытки» overrides even a final failed
        queue.push_status(_status_item(task.id, "sent"))
        await dispatcher.statuses_once(factory, queue)
        assert _task_row(task.id, "status")["status"] == "sent"

    async def test_duplicate_redelivery_is_harmless(self, db_engine, db_session) -> None:
        task = await _stage_queued_task(db_session)
        factory = _session_factory(db_engine)
        queue = FakeQueue()
        item = _status_item(task.id, "sent")

        queue.push_status(item)
        await dispatcher.statuses_once(factory, queue)
        queue.push_status(item)  # at-least-once duplicate (§4.4)
        await dispatcher.statuses_once(factory, queue)

        # two append-only rows, derived state unchanged
        assert (
            len(query_db(f"SELECT id FROM notify_task_attempts WHERE task_id = '{task.id}'")) == 2
        )
        assert _task_row(task.id, "status")["status"] == "sent"

    async def test_unknown_task_logged_not_acked_sibling_processed(
        self, db_engine, db_session
    ) -> None:
        task = await _stage_queued_task(db_session)
        queue = FakeQueue()
        bad = _status_item(str(uuid.uuid4()), "sending")

        queue.push_status(bad)
        queue.push_status(_status_item(task.id, "sending"))
        with capture_dispatcher_logs() as messages:
            await dispatcher.statuses_once(_session_factory(db_engine), queue)

        assert any("not applied" in m for m in messages)
        assert _task_row(task.id, "status")["status"] == "sending"

        # the poison item was NOT acked: reclaim brings it back (§4.4)
        queue.reclaim_hanging()
        assert queue.claim_statuses() == [bad]

    async def test_reclaimed_hanging_item_is_processed(self, db_engine, db_session) -> None:
        task = await _stage_queued_task(db_session)
        queue = FakeQueue()
        item = _status_item(task.id, "sent")
        queue.push_status(item)
        assert queue.claim_statuses() == [item]  # claimed, never acked — hanging

        queue.reclaim_hanging()  # process start (§3.8)
        await dispatcher.statuses_once(_session_factory(db_engine), queue)
        assert _task_row(task.id, "status")["status"] == "sent"

    async def test_run_dispatcher_reclaims_on_start_and_stops(self, db_engine) -> None:
        class SpyQueue(FakeQueue):
            def __init__(self) -> None:
                super().__init__()
                self.reclaimed = False

            def reclaim_hanging(self) -> None:
                self.reclaimed = True
                super().reclaim_hanging()

        queue = SpyQueue()
        stop = asyncio.Event()
        stop.set()  # loops exit immediately; only the start path runs

        await dispatcher.run_dispatcher(_session_factory(db_engine), queue, stop)

        assert queue.reclaimed is True


# ── cycle 3: notify:inbound (§3.8, empty pilot registry) ────────────────────


class TestInboundCycle:
    async def test_no_handler_logs_warning_and_acks(self) -> None:
        queue = FakeQueue()
        queue.push_inbound({"channel": "telegram", "text": "hi"})

        with capture_dispatcher_logs() as messages:
            await dispatcher.inbound_once(queue)

        assert any("telegram" in m for m in messages)
        # acked: nothing pending, nothing hanging after a reclaim
        assert queue.claim_inbound() == []
        queue.reclaim_hanging()
        assert queue.claim_inbound() == []


# ── re-enqueue (§3.8, inside the polling cycle) ─────────────────────────────


class TestReenqueue:
    async def test_aged_queued_task_reenqueued_with_saved_payload(
        self, db_engine, db_session
    ) -> None:
        task = await _stage_queued_task(db_session, age_seconds=300)
        queue = FakeQueue()

        await dispatcher.reenqueue_stale_tasks(_session_factory(db_engine), queue)

        assert len(queue.tasks) == 1
        payload = queue.tasks[0]
        assert payload["task_id"] == task.id
        assert payload["text"] == "готовый текст"
        # saved payload IN FULL — channels verbatim, no re-resolution
        assert payload["channels"] == [{"name": "telegram", "address": "+7OLD"}]
        assert payload["resend_of"] is None
        assert payload["created_at"]
        row = _task_row(task.id, "status", "reenqueues", "updated_at")
        assert row["status"] == "queued"
        assert row["reenqueues"] == 1
        # the re-enqueue STAMP: updated_at left the stale window
        assert datetime.fromisoformat(row["updated_at"]) > datetime.now(UTC).replace(
            tzinfo=None
        ) - timedelta(seconds=settings.NOTIFY_REENQUEUE_AFTER)

    async def test_not_more_often_than_the_window(self, db_engine, db_session) -> None:
        task = await _stage_queued_task(db_session, age_seconds=300)
        factory = _session_factory(db_engine)
        queue = FakeQueue()

        await dispatcher.reenqueue_stale_tasks(factory, queue)
        await dispatcher.reenqueue_stale_tasks(factory, queue)  # immediate re-sweep

        assert len(queue.tasks) == 1
        assert _task_row(task.id, "reenqueues")["reenqueues"] == 1

    async def test_fresh_task_untouched(self, db_engine, db_session) -> None:
        await _stage_queued_task(db_session)  # updated_at = now
        queue = FakeQueue()

        await dispatcher.reenqueue_stale_tasks(_session_factory(db_engine), queue)

        assert queue.tasks == []

    async def test_cap_fails_task_with_loud_error_and_no_enqueue(
        self, db_engine, db_session
    ) -> None:
        task = await _stage_queued_task(
            db_session, reenqueues=dispatcher.REENQUEUE_CAP, age_seconds=300
        )
        queue = FakeQueue()

        with capture_dispatcher_logs() as messages:
            await dispatcher.reenqueue_stale_tasks(_session_factory(db_engine), queue)

        assert queue.tasks == []
        assert _task_row(task.id, "status")["status"] == "failed"
        assert any(dispatcher.REENQUEUE_FAILED_MESSAGE in m for m in messages)

    async def test_last_reenqueue_allowed_then_cap_fails(self, db_engine, db_session) -> None:
        task = await _stage_queued_task(
            db_session, reenqueues=dispatcher.REENQUEUE_CAP - 1, age_seconds=300
        )
        factory = _session_factory(db_engine)
        queue = FakeQueue()

        await dispatcher.reenqueue_stale_tasks(factory, queue)
        assert len(queue.tasks) == 1
        assert _task_row(task.id, "reenqueues", "status")["reenqueues"] == dispatcher.REENQUEUE_CAP
        assert _task_row(task.id, "reenqueues", "status")["status"] == "queued"

        # age it again past the window — the 11th re-enqueue is refused
        stale = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=300)
        query_db_params(
            "UPDATE notify_tasks SET updated_at = :u WHERE id = :i",
            {"u": stale.strftime("%Y-%m-%d %H:%M:%S.%f"), "i": task.id},
        )
        await dispatcher.reenqueue_stale_tasks(factory, queue)
        assert len(queue.tasks) == 1
        assert _task_row(task.id, "reenqueues", "status")["status"] == "failed"

    async def test_non_queued_tasks_never_reenqueued(self, db_engine, db_session) -> None:
        await _stage_queued_task(db_session, status="skipped", age_seconds=300)
        await _stage_queued_task(db_session, status="sent", age_seconds=300)
        queue = FakeQueue()

        await dispatcher.reenqueue_stale_tasks(_session_factory(db_engine), queue)

        assert queue.tasks == []


# ── loop resilience (§3.8 concurrency model) ────────────────────────────────


class TestLoopResilience:
    async def test_crashing_iteration_keeps_loop_and_siblings_alive(
        self,
    ) -> None:
        stop = asyncio.Event()
        journal: list[str] = []

        async def bad() -> None:
            journal.append("bad")
            if journal.count("bad") >= 5:
                stop.set()
            raise RuntimeError("boom")

        async def good() -> None:
            journal.append("good")

        async with asyncio.TaskGroup() as tg:
            tg.create_task(dispatcher.run_loop("bad", stop, 0.01, bad))
            tg.create_task(dispatcher.run_loop("good", stop, 0.01, good))

        assert journal.count("bad") == 5  # the loop survived 5 crashes
        assert journal.count("good") >= 3  # the sibling kept running
