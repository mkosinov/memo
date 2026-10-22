"""GH #482 Task 9 (spec §3.8; family #476 §4.3/§4.4): dispatcher process.

Three loops of one ``asyncio.TaskGroup`` over the queue port: journal
polling (batch 20 + re-enqueue sweep), ``notify:statuses`` reading
(§4.3 derived state), ``notify:inbound`` reading (empty pilot registry).
Covered (spec §5, US-5–US-8):

- polling processes and marks a batch (order ``occurred_at, id``, batch
  limit), the real scenario closes events for deleted records;
- 3-attempts policy: ``attempts`` 1→2→3 → ``processing_error`` (last
  error text), NOT written during attempts 1–2, dead event no longer
  picked, failing handler does not skip the rest of the batch (rollback
  expiry — routing survives, later events process in the same sweep);
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
import os
import subprocess
import sys
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import async_sessionmaker

import src.models  # noqa: F401 — registration first; breaks the models↔notify import cycle
from src.core.config import settings
from src.notify import dispatcher
from src.notify.models import DomainEvent, NotifyTask
from src.notify.queue import FakeQueue
from src.notify.redis_queue import TRANSPORT_NOT_CONFIGURED_MESSAGE, NotifyTransportError
from src.notify.render import RenderError
from src.notify.scenarios import SCENARIOS
from tests.conftest import BACKEND_DIR, query_db, query_db_params
from tests.notify_redis_support import capture_notify_logs

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


def _age_task(task_id: str, age_seconds: int = 300) -> None:
    """Rewind ``updated_at`` behind the re-enqueue predicate (raw SQL —
    determinism without waiting out ``NOTIFY_REENQUEUE_AFTER``)."""
    stale = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=age_seconds)
    query_db_params(
        "UPDATE notify_tasks SET updated_at = :u WHERE id = :i",
        {"u": stale.strftime("%Y-%m-%d %H:%M:%S.%f"), "i": task_id},
    )


class _TransportBrokenQueue(FakeQueue):
    """FakeQueue whose transport-facing calls raise the typed transport
    error — a deterministic dead-Redis stand-in (no server, no marks).
    The message mirrors the adapter's real failure text (class + message,
    no bodies)."""

    def __init__(self, *, fail_enqueue: bool = True, fail_claim: bool = True) -> None:
        super().__init__()
        self._fail_enqueue = fail_enqueue
        self._fail_claim = fail_claim

    def enqueue_task(self, payload: dict) -> None:
        if self._fail_enqueue:
            raise NotifyTransportError(
                "notify queue transport failed during enqueue_task:"
                " ConnectionError: mock-dead-redis"
            )
        super().enqueue_task(payload)

    def claim_statuses(self):
        if self._fail_claim:
            raise NotifyTransportError(
                "notify queue transport failed during claim notify:statuses:"
                " ConnectionError: mock-dead-redis"
            )
        return super().claim_statuses()

    def claim_inbound(self):
        if self._fail_claim:
            raise NotifyTransportError(
                "notify queue transport failed during claim notify:inbound:"
                " ConnectionError: mock-dead-redis"
            )
        return super().claim_inbound()


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


# ── main(): transport adapter selection — GH #483 Task 4 (spec §3.1, S3) ────


class TestMainTransportGates:
    """Enabled without a configured/working transport is a LOUD exit code
    2 (spec §3.1, S3) — the part-1 FakeQueue fallback is gone."""

    async def test_enabled_empty_url_exits_code_2_with_stable_message(
        self, monkeypatch
    ) -> None:
        monkeypatch.setattr(settings, "NOTIFY_ENABLED", True)
        monkeypatch.setattr(settings, "NOTIFY_CHANNEL_PRIORITY", "telegram")
        monkeypatch.setattr(settings, "REDIS_URL", SecretStr(""))
        with (
            capture_notify_logs("memo.notify.redis_queue") as messages,
            pytest.raises(SystemExit) as exit_info,
        ):
            await dispatcher.main()
        assert exit_info.value.code == 2
        assert any(TRANSPORT_NOT_CONFIGURED_MESSAGE in m for m in messages)

    async def test_enabled_unreachable_redis_exits_code_2_loudly_without_url_leak(
        self, monkeypatch
    ) -> None:
        monkeypatch.setattr(settings, "NOTIFY_ENABLED", True)
        monkeypatch.setattr(settings, "NOTIFY_CHANNEL_PRIORITY", "telegram")
        monkeypatch.setattr(
            settings, "REDIS_URL", SecretStr("redis://default:topsecret@127.0.0.1:1/0")
        )
        with (
            capture_notify_logs("memo.notify.redis_queue") as messages,
            pytest.raises(SystemExit) as exit_info,
        ):
            await dispatcher.main()
        assert exit_info.value.code == 2
        # loud: the PING refusal is journalled with the exception class
        assert any("transport unavailable" in m for m in messages)
        # hygiene: the URL value never appears (spec §3.3)
        assert all("topsecret" not in m for m in messages)

    async def test_adapter_selection_unwraps_secret_url_and_runs_built_queue(
        self, monkeypatch
    ) -> None:
        """Non-empty ``REDIS_URL`` → ``connect_or_exit(<unwrapped url>)``;
        the queue it returns is what the cycles run."""
        monkeypatch.setattr(settings, "NOTIFY_ENABLED", True)
        monkeypatch.setattr(settings, "NOTIFY_CHANNEL_PRIORITY", "telegram")
        monkeypatch.setattr(settings, "REDIS_URL", SecretStr("redis://localhost:6379/0"))
        built = FakeQueue()
        seen: dict[str, str] = {}
        ran: dict[str, object] = {}

        def fake_connect(url: str, **kwargs: object) -> FakeQueue:
            seen["url"] = url
            return built

        async def fake_run(
            session_factory: object, queue: FakeQueue, stop: asyncio.Event
        ) -> None:
            ran["queue"] = queue

        monkeypatch.setattr(dispatcher, "connect_or_exit", fake_connect)
        monkeypatch.setattr(dispatcher, "run_dispatcher", fake_run)

        await dispatcher.main()

        assert seen["url"] == "redis://localhost:6379/0"
        assert ran["queue"] is built

    async def test_injected_queue_skips_adapter_selection(self, monkeypatch) -> None:
        """Part-1 test seam (unchanged): an explicitly injected queue is
        used as is — the gates never run for it."""
        monkeypatch.setattr(settings, "NOTIFY_ENABLED", True)
        monkeypatch.setattr(settings, "NOTIFY_CHANNEL_PRIORITY", "telegram")
        injected = FakeQueue()
        ran: dict[str, object] = {}

        def forbidden_connect(url: str, **kwargs: object) -> FakeQueue:
            raise AssertionError("adapter selection must not run for an injected queue")

        async def fake_run(
            session_factory: object, queue: FakeQueue, stop: asyncio.Event
        ) -> None:
            ran["queue"] = queue

        monkeypatch.setattr(dispatcher, "connect_or_exit", forbidden_connect)
        monkeypatch.setattr(dispatcher, "run_dispatcher", fake_run)

        await dispatcher.main(injected)

        assert ran["queue"] is injected


class TestMainExitCodePropagation:
    """S3: the PROCESS exits 2 — ``__main__`` must not swallow the gate's
    ``SystemExit(2)`` (part 1 returned None and the code was lost)."""

    def test_python_m_exits_code_2_when_transport_not_configured(self) -> None:
        env = {k: v for k, v in os.environ.items() if k not in ("REDIS_URL", "ENV")}
        env.update(ENV="development", NOTIFY_ENABLED="true", REDIS_URL="")
        proc = subprocess.run(
            [sys.executable, "-m", "src.notify.dispatcher"],
            cwd=str(BACKEND_DIR),
            env=env,
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )
        assert proc.returncode == 2
        assert TRANSPORT_NOT_CONFIGURED_MESSAGE in proc.stdout + proc.stderr


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

    async def test_failing_event_rest_of_batch_processes_same_sweep(
        self, db_engine, db_session, monkeypatch
    ) -> None:
        """Regression (review of 6710caba): a failing handler's rollback
        expires every loaded event of the batch; the routing must survive
        that, and the events AFTER the failing one must still process in
        the SAME sweep instead of waiting out the next ticks."""
        real_handler = SCENARIOS["new_record"]
        base = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=10)
        first = await _stage_event(db_session, occurred_at=base)
        await _stage_event(db_session, occurred_at=base + timedelta(seconds=1))
        await _stage_event(db_session, occurred_at=base + timedelta(seconds=2))

        async def flaky(event, session, queue) -> None:
            if event.id == first.id:
                raise RenderError("template exploded")
            await real_handler(event, session, queue)

        monkeypatch.setitem(SCENARIOS, "new_record", flaky)

        await dispatcher.process_pending_batch(_session_factory(db_engine), FakeQueue())

        row = _event_row(first.id)
        assert row["attempts"] == 1
        assert row["processed_at"] is None
        assert row["processing_error"] is None  # attempt 1 — not written yet
        # the two LATER events closed in the same sweep (nonexistent record
        # → the scenario closes them without a task)
        processed = query_db(
            f"SELECT id FROM domain_events WHERE processed_at IS NOT NULL AND id != '{first.id}'"
        )
        assert len(processed) == 2


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


# ── enqueue-point transport failure — GH #483 Task 4 (spec §3.1) ────────────


class TestEnqueueTransportFailure:
    """A TYPED transport failure at the enqueue point is not a scenario
    failure: the event's ``attempts`` must not burn (the re-enqueue cycle
    owns recovery); scenario errors keep the 1→2→3 policy unchanged."""

    async def test_transport_error_does_not_burn_attempts_scenarios_still_do(
        self, db_engine, db_session, monkeypatch
    ) -> None:
        base = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=10)
        dead = await _stage_event(db_session, occurred_at=base)
        boom = await _stage_event(db_session, occurred_at=base + timedelta(seconds=1))

        async def transport_dead(event, session, queue) -> None:
            # the §3.4 contract shape: task + processed_at committed,
            # enqueue AFTER the commit — the failure leaves a queued task
            session.add(
                NotifyTask(
                    event_id=event.id,
                    scenario="new_record",
                    status="queued",
                    text="готовый текст",
                    channels=[{"name": "telegram", "address": "+7OLD"}],
                )
            )
            event.processed_at = datetime.now(UTC).replace(tzinfo=None)
            await session.commit()
            raise NotifyTransportError(
                "notify queue transport failed during enqueue_task:"
                " ConnectionError: mock-dead-redis"
            )

        async def scenario_boom(event, session, queue) -> None:
            raise RenderError("template exploded")

        async def selective(event, session, queue) -> None:
            if event.id == dead.id:
                await transport_dead(event, session, queue)
            else:
                await scenario_boom(event, session, queue)

        monkeypatch.setitem(SCENARIOS, "new_record", selective)

        with capture_dispatcher_logs() as messages:
            await dispatcher.process_pending_batch(_session_factory(db_engine), FakeQueue())

        # transport failure: attempts did NOT move, no processing_error,
        # the queued task waits for the re-enqueue cycle (§3.1)
        dead_row = _event_row(dead.id)
        assert dead_row["attempts"] == 0
        assert dead_row["processing_error"] is None
        assert dead_row["processed_at"] is not None  # closed by its own handler
        task_rows = query_db(
            f"SELECT status, reenqueues FROM notify_tasks WHERE event_id = '{dead.id}'"
        )
        assert task_rows[0]["status"] == "queued"
        assert task_rows[0]["reenqueues"] == 0

        # contrast, same sweep: a scenario error DID burn an attempt
        boom_row = _event_row(boom.id)
        assert boom_row["attempts"] == 1
        assert boom_row["processing_error"] is None  # attempt 1 — not written yet

        # loud + log hygiene: exception class in the journal, no message
        # bodies, no addresses (§3.1)
        assert any("transport" in m and "ConnectionError" in m for m in messages)
        assert all("готовый текст" not in m for m in messages)
        assert all("+7OLD" not in m for m in messages)


class TestReenqueueTransportFailure:
    """A failed enqueue still counts the re-enqueue (a dead transport must
    not churn forever) — the EXISTING cap path ends the task as
    «не доставлено» (spec §3.1)."""

    async def test_failed_enqueue_counts_toward_cap_and_cap_fails(
        self, db_engine, db_session
    ) -> None:
        task = await _stage_queued_task(
            db_session, reenqueues=dispatcher.REENQUEUE_CAP - 1, age_seconds=300
        )
        factory = _session_factory(db_engine)
        broken = _TransportBrokenQueue()

        with capture_dispatcher_logs() as messages:
            await dispatcher.reenqueue_stale_tasks(factory, broken)

        # the enqueue FAILED, but the counter moved and the task is queued
        row = _task_row(task.id, "status", "reenqueues")
        assert row["reenqueues"] == dispatcher.REENQUEUE_CAP
        assert row["status"] == "queued"
        assert broken.tasks == []  # nothing reached the stream
        assert any("enqueue failed" in m for m in messages)
        # log hygiene: identifiers only — no text, no addresses
        assert all("готовый текст" not in m for m in messages)
        assert all("+7OLD" not in m for m in messages)

        # next window: the cap path terminates the task — no more churn
        _age_task(task.id)
        with capture_dispatcher_logs() as messages:
            await dispatcher.reenqueue_stale_tasks(factory, broken)

        row = _task_row(task.id, "status", "reenqueues")
        assert row["status"] == "failed"
        assert any(dispatcher.REENQUEUE_FAILED_MESSAGE in m for m in messages)
        assert broken.tasks == []


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


# ── GH #483 Task 4: sync adapter called off the event loop (spec §3.1) ──────


class TestQueueCallsOffEventLoop:
    """The adapter is SYNC (redis-py): every queue call the dispatcher
    makes from its async cycles must run through ``asyncio.to_thread`` —
    observable as "never on the event loop thread"."""

    async def test_all_dispatcher_queue_call_points_run_off_the_loop_thread(
        self, db_engine, db_session
    ) -> None:
        loop_thread = threading.get_ident()
        seen: list[tuple[str, int]] = []

        class SpyQueue(FakeQueue):
            def _tick(self, op: str) -> None:
                seen.append((op, threading.get_ident()))

            def enqueue_task(self, payload: dict) -> None:
                self._tick("enqueue_task")
                super().enqueue_task(payload)

            def claim_statuses(self):
                self._tick("claim_statuses")
                return super().claim_statuses()

            def ack_status(self, item):
                self._tick("ack_status")
                super().ack_status(item)

            def claim_inbound(self):
                self._tick("claim_inbound")
                return super().claim_inbound()

            def ack_inbound(self, item):
                self._tick("ack_inbound")
                super().ack_inbound(item)

            def reclaim_hanging(self) -> None:
                self._tick("reclaim_hanging")
                super().reclaim_hanging()

        spy = SpyQueue()
        task = await _stage_queued_task(db_session)
        factory = _session_factory(db_engine)

        # enqueue point — the re-enqueue sweep
        _age_task(task.id)
        await dispatcher.reenqueue_stale_tasks(factory, spy)
        # claim + ack on both up-streams
        spy.push_status(_status_item(task.id, "sending"))
        spy.push_inbound({"channel": "telegram", "text": "hi"})
        await dispatcher.statuses_once(factory, spy)
        await dispatcher.inbound_once(spy)
        # process start
        stop = asyncio.Event()
        stop.set()
        await dispatcher.run_dispatcher(factory, spy, stop)

        assert {op for op, _ in seen} == {
            "enqueue_task",
            "claim_statuses",
            "ack_status",
            "claim_inbound",
            "ack_inbound",
            "reclaim_hanging",
        }
        assert all(tid != loop_thread for _, tid in seen)


class TestTransportFailureDoesNotKillCycles:
    """Spec §3.1: a connection failure never takes a cycle down — the
    typed error surfaces LOUD to the loop guard and the next tick
    retries. Also guards the ``to_thread`` transition: an unawaited
    wrapper would silence the claim instead of raising."""

    async def test_dead_claim_propagates_loud_never_reads_as_empty(self) -> None:
        broken = _TransportBrokenQueue()

        def unused_session_factory() -> None:
            raise AssertionError("session must not be touched on a dead claim")

        with pytest.raises(NotifyTransportError):
            await dispatcher.statuses_once(unused_session_factory, broken)  # type: ignore[arg-type]
        with pytest.raises(NotifyTransportError):
            await dispatcher.inbound_once(broken)

    async def test_run_loop_retries_after_transport_failures(self) -> None:
        stop = asyncio.Event()
        ticks: list[int] = []

        async def dead_transport() -> None:
            ticks.append(1)
            if len(ticks) >= 3:
                stop.set()
            raise NotifyTransportError(
                "notify queue transport failed during claim notify:statuses:"
                " ConnectionError: mock-dead-redis"
            )

        await dispatcher.run_loop("statuses", stop, 0.001, dead_transport)

        assert len(ticks) == 3  # every failed tick was followed by a retry
