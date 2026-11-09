"""GH #482 Task 9 (spec §3.8; family #476 §4.3/§4.4): dispatcher process.

Three loops of one ``asyncio.TaskGroup`` over the queue port: the
re-enqueue sweep, ``notify:statuses`` reading (§4.3 derived state),
``notify:inbound`` reading (empty pilot registry). Covered (spec §5,
US-5–US-8):

- #580 Task 3: the journal-polling cycle and the event 3-attempts
  policy are GONE with the ``processed_at``/``attempts``/
  ``processing_error`` columns (the switchover migration dropped them;
  their tests are deleted with replacement — the group-input tests of
  #580 Task 6, spec §5.2);
- #580 Task 6: the dispatcher's INPUT is the ``notification`` consumer
  group on ``domain_events:new_record`` — claim batch → scenario → ack;
  a FOURTH periodic cycle returns hanging entries (attempts grow via
  the RETURN cycle, 3 failures park with an ack; an enqueue-point
  transport failure burns no attempt and leaves the entry unacked);
  startup: group ensure + immediate hanging return; consumer closed
  with keep_if_pending on stop. Redis-marked classes run against a real
  Redis (contour workspace), the rest against ``FakeSubscriber``;
- statuses: attempt rows appended, derived state per §4.3 (first
  ``sending`` → sending; first ``sent`` of ANY attempt → sent, terminal;
  final ``failed`` → failed), idempotent re-apply (duplicate redelivery
  harmless), ``reclaim_hanging()`` at dispatcher start;
- statuses brak rule (#484 spec §3.5, two layers): shape brak
  (absent/empty/wrong-type ``task_id``, stage out of the vocabulary,
  missing/empty ``channel``, unparseable ``occurred_at``) AND unknown
  task/stage after a valid form → logged (identifiers only) + ACKED —
  the reader never returns to brak; any OTHER error (DB down) → NOT
  acked, reclaimed at the next process start (hanging path preserved);
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
import json
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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker

import src.models  # noqa: F401 — registration first; breaks the models↔notify import cycle
from src.core.config import settings
from src.domain_events.models import DomainEvent
from src.domain_events.subscribe import ClaimedEvent, Subscriber
from src.notify import dispatcher
from src.notify.models import NotifyTask, NotifyTemplate
from src.notify.queue import FakeQueue, build_task_payload
from src.notify.redis_queue import TRANSPORT_NOT_CONFIGURED_MESSAGE, NotifyTransportError
from src.streams.transport import StreamTransport
from tests.conftest import BACKEND_DIR, query_db, query_db_params
from tests.notify_redis_support import (
    RedisContour,
    capture_notify_logs,
    contour_fixture,
    redis_marks,
    redis_url,
)

pytestmark = pytest.mark.integration

contour = contour_fixture()  # per-test Redis workspace (redis-marked classes)


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
        channel="telegram",
        address="+7OLD",
        payload={"client": {"name": "Анна"}},
        template_id=str(uuid.uuid4()),
        template_body="{{ client.name }}",
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


def _status_item(
    task_id: str,
    stage: str,
    *,
    channel: str = "telegram",
    outcome: str | None = None,
    sent_text: str | None = None,
) -> dict:
    return {
        "task_id": task_id,
        "stage": stage,
        "channel": channel,
        "outcome": outcome,
        "error": "boom" if stage == "failed" else None,
        "sent_text": sent_text,
        "occurred_at": _iso_z(datetime.now(UTC)),
    }


async def _stage_chain_task(
    db_session,
    *,
    channel: str = "telegram",
    status: str = "queued",
    root_task_id: str | None = None,
    parent_task_id: str | None = None,
    address: str = "+79990001122",
) -> NotifyTask:
    """A chain task row with explicit chain knobs (#485 Task 5): the
    first task of a chain passes ``root_task_id=None`` (the ORM default
    fills it with the row's own id); a continuation names its root and
    parent explicitly."""
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
        channel=channel,
        address=address,
        payload={"client": {"name": "Анна"}},
        template_id=str(uuid.uuid4()),
        template_body="{{ client.name }}",
        root_task_id=root_task_id,
        parent_task_id=parent_task_id,
    )
    db_session.add(task)
    await db_session.commit()
    return task


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
    The message mirrors the streams core's real failure text
    (``streams transport failed during <operation>:`` class + message,
    no bodies) with the core's own operation labels for the adapter's
    call paths."""

    def __init__(self, *, fail_enqueue: bool = True, fail_claim: bool = True) -> None:
        super().__init__()
        self._fail_enqueue = fail_enqueue
        self._fail_claim = fail_claim

    def enqueue_task(self, payload: dict) -> None:
        if self._fail_enqueue:
            raise NotifyTransportError(
                "streams transport failed during publish notify:tasks:"
                " ConnectionError: mock-dead-redis"
            )
        super().enqueue_task(payload)

    def claim_statuses(self):
        if self._fail_claim:
            raise NotifyTransportError(
                "streams transport failed during claim notify:statuses/dispatcher:"
                " ConnectionError: mock-dead-redis"
            )
        return super().claim_statuses()

    def claim_inbound(self):
        if self._fail_claim:
            raise NotifyTransportError(
                "streams transport failed during claim notify:inbound/dispatcher:"
                " ConnectionError: mock-dead-redis"
            )
        return super().claim_inbound()


class FakeSubscriber:
    """In-memory ``Subscriber`` double — the dispatcher's group seam
    without Redis (deterministic; the redis-marked classes exercise the
    real one). Mirrors the ``src/domain_events/subscribe.py`` surface the
    dispatcher calls: ensure/claim/ack/reclaim/close/ping."""

    def __init__(self, records: list[ClaimedEvent] | None = None) -> None:
        self.pending: list[ClaimedEvent] = list(records or [])
        self.acked: list[str] = []
        self.ensured: list[list[str]] = []
        self.reclaim_calls: list[int] = []
        self.closed = False

    def ensure(self, streams: list[str]) -> None:
        self.ensured.append(list(streams))

    def claim(self, streams: list[str], count: int) -> list[ClaimedEvent]:
        taken, self.pending = self.pending[:count], self.pending[count:]
        return taken

    def ack(self, stream: str, qid: str) -> None:
        self.acked.append(qid)

    def reclaim(self, streams: list[str], min_idle_ms: int) -> list[ClaimedEvent]:
        self.reclaim_calls.append(min_idle_ms)
        taken, self.pending = self.pending, []
        return taken

    def close(self) -> None:
        self.closed = True

    def ping(self) -> None:
        return None


# ── group-input helpers (#580 Task 6, spec §3.5/§5.2) ───────────────────────


def _stream_record(
    event_id: str,
    snapshot: dict,
    *,
    type: str = "new_record",
    occurred_at: str | None = None,
) -> dict:
    """One §4.1 stream record — the relay's ``stream_record`` shape."""
    return {
        "event_id": event_id,
        "type": type,
        "occurred_at": occurred_at
        or datetime.now(UTC).replace(tzinfo=None).isoformat(),
        "snapshot": snapshot,
    }


def _publish(contour: RedisContour, record: dict) -> None:
    """XADD ``record`` to the contour's ``new_record`` stream — the
    relay-side stand-in (a raw producer transport, no group)."""
    StreamTransport(redis_url(), key_prefix=contour.prefix).publish(
        dispatcher.NEW_RECORD_STREAM, record
    )


def _group_pending(contour: RedisContour) -> int:
    """The PEL size of the ``notification`` group on the contour's
    stream — the unacked-entry count."""
    return contour.client.xpending(
        f"{contour.prefix}{dispatcher.NEW_RECORD_STREAM}",
        dispatcher.NOTIFICATION_GROUP,
    )["pending"]


async def _stage_event_row(db_session, snapshot: dict) -> DomainEvent:
    """A journal ``new_record`` row carrying ``snapshot`` (committed) —
    the stream record's event_id must exist for the task/ledger FKs."""
    event = DomainEvent(
        type="new_record",
        occurred_at=datetime.now(UTC).replace(tzinfo=None),
        snapshot=snapshot,
    )
    db_session.add(event)
    await db_session.commit()
    return event


def _ledger(event_id: str) -> list[dict]:
    """The attempts-ledger row(s) of one event (empty = no row)."""
    return query_db(
        "SELECT attempts, last_error FROM notify_event_attempts"
        f" WHERE event_id = '{event_id}'"
    )


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
        the queue it returns is what the cycles run. The subscriber is
        built over the SAME unwrapped URL (group ``notification``) with
        its own fail-fast ping (#580 Task 6)."""
        monkeypatch.setattr(settings, "NOTIFY_ENABLED", True)
        monkeypatch.setattr(settings, "NOTIFY_CHANNEL_PRIORITY", "telegram")
        monkeypatch.setattr(settings, "REDIS_URL", SecretStr("redis://localhost:6379/0"))
        built = FakeQueue()
        seen: dict[str, str] = {}
        ran: dict[str, object] = {}

        def fake_connect(url: str, **kwargs: object) -> FakeQueue:
            seen["url"] = url
            return built

        class _StubSubscriber:
            def __init__(self, url: str, group: str) -> None:
                seen["sub_url"] = url
                seen["sub_group"] = group

            def ping(self) -> None:
                return None

        async def fake_run(
            session_factory: object,
            queue: FakeQueue,
            stop: asyncio.Event,
            subscriber: object,
        ) -> None:
            ran["queue"] = queue
            ran["subscriber"] = subscriber

        monkeypatch.setattr(dispatcher, "connect_or_exit", fake_connect)
        monkeypatch.setattr(dispatcher, "Subscriber", _StubSubscriber)
        monkeypatch.setattr(dispatcher, "run_dispatcher", fake_run)

        await dispatcher.main()

        assert seen["url"] == "redis://localhost:6379/0"
        assert seen["sub_url"] == "redis://localhost:6379/0"
        assert seen["sub_group"] == dispatcher.NOTIFICATION_GROUP
        assert ran["queue"] is built
        assert isinstance(ran["subscriber"], _StubSubscriber)

    async def test_injected_queue_skips_adapter_selection(self, monkeypatch) -> None:
        """Part-1 test seam (unchanged): an explicitly injected queue —
        and subscriber — is used as is; the gates never run for it."""
        monkeypatch.setattr(settings, "NOTIFY_ENABLED", True)
        monkeypatch.setattr(settings, "NOTIFY_CHANNEL_PRIORITY", "telegram")
        injected = FakeQueue()
        injected_sub = FakeSubscriber()
        ran: dict[str, object] = {}

        def forbidden_connect(url: str, **kwargs: object) -> FakeQueue:
            raise AssertionError("adapter selection must not run for an injected queue")

        async def fake_run(
            session_factory: object,
            queue: FakeQueue,
            stop: asyncio.Event,
            subscriber: object,
        ) -> None:
            ran["queue"] = queue
            ran["subscriber"] = subscriber

        monkeypatch.setattr(dispatcher, "connect_or_exit", forbidden_connect)
        monkeypatch.setattr(dispatcher, "run_dispatcher", fake_run)

        await dispatcher.main(injected, injected_sub)

        assert ran["queue"] is injected
        assert ran["subscriber"] is injected_sub


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
        subscriber = FakeSubscriber()
        stop = asyncio.Event()
        stop.set()  # loops exit immediately; only the start path runs

        await dispatcher.run_dispatcher(
            _session_factory(db_engine), queue, stop, subscriber
        )

        assert queue.reclaimed is True
        # the subscriber start duty (§3.5): group ensured, hanging entries
        # of a crashed predecessor returned IMMEDIATELY (idle 0), consumer
        # closed on the graceful stop
        assert subscriber.ensured == [[dispatcher.NEW_RECORD_STREAM]]
        assert subscriber.reclaim_calls == [0]
        assert subscriber.closed is True

    async def test_run_dispatcher_startup_reclaim_processes_hanging_entry(
        self, db_engine, db_session, create_activity, create_record
    ) -> None:
        """A crashed predecessor's hanging entry (its PEL) returns through
        the STARTUP path and is processed: the scenario decision
        materializes and the entry is acked — nothing waits out the
        periodic-cadence threshold at process start (§3.4/§3.5)."""
        activity = create_activity()
        record = create_record(
            activity_id=activity["id"],
            notify=False,
            visits=[{"name": "Гость", "price": 3500, "status": "waiting"}],
        )
        snapshot = {"event": {"record_id": record["id"]}}
        event = await _stage_event_row(db_session, snapshot)
        hanging = ClaimedEvent(
            qid="1-1",
            event_id=event.id,
            type="new_record",
            occurred_at=datetime.now(UTC).replace(tzinfo=None).isoformat(),
            snapshot=snapshot,
        )
        subscriber = FakeSubscriber([hanging])
        stop = asyncio.Event()
        stop.set()

        await dispatcher.run_dispatcher(
            _session_factory(db_engine), FakeQueue(), stop, subscriber
        )

        assert subscriber.acked == ["1-1"]
        assert query_db(
            "SELECT status, skip_reason FROM notify_tasks"
            f" WHERE event_id = '{event.id}'"
        ) == [{"status": "skipped", "skip_reason": "notify_off"}]


# ── channel chain — #485 Task 5 (part-4 spec §8; family §4.3 US-5) ───────────


async def _seed_channel_template(db_session, channel: str) -> NotifyTemplate:
    """A channel-tier ``new_record`` template — the autouse ``reset_db``
    truncate wipes the migration-seeded default, and a spawn test needs
    a findable tier for the NEXT channel."""
    template = NotifyTemplate(
        event_type="new_record",
        channel=channel,
        title=f"шаблон {channel}",
        body=f"{channel.upper()} TIER {{{{ client.name }}}}",
    )
    db_session.add(template)
    await db_session.commit()
    return template


class TestChainReaction:
    """The dispatcher's chain rules (part-4 spec §8.2): a TERMINAL
    failure of a channel task spawns the next priority channel (fresh
    template freeze, inherited payload/address — never re-resolved);
    channel exhaustion closes the chain ``not_delivered`` ON THE ROOT;
    the first ``sent`` of ANY chain task is ``delivered``. Spawn is
    idempotent (UNIQUE(root, channel) — at-least-once report redelivery
    never duplicates a task)."""

    async def test_terminal_failure_spawns_next_channel_task(
        self, db_engine, db_session, monkeypatch
    ) -> None:
        """падение канала 1 → задача канала 2: inherits the root's
        payload/address/ids, freezes the NEXT channel's template tier
        FRESH, and the §4.2 payload of the spawn reaches the queue."""
        monkeypatch.setattr(settings, "NOTIFY_CHANNEL_PRIORITY", "telegram,mock")
        template = NotifyTemplate(
            event_type="new_record",
            channel="mock",
            title="мок-канал",
            body="MOCK TIER {{ client.name }}",
        )
        db_session.add(template)
        await db_session.commit()
        root = await _stage_chain_task(db_session, channel="telegram")
        queue = FakeQueue()

        queue.push_status(_status_item(root.id, "failed", outcome="not_delivered"))
        await dispatcher.statuses_once(_session_factory(db_engine), queue)

        rows = query_db(
            "SELECT id, status, root_task_id, parent_task_id, address, payload,"
            " template_id, template_body, event_id, scenario, client_id,"
            " delivery_outcome FROM notify_tasks WHERE channel = 'mock'"
        )
        assert len(rows) == 1
        spawned = rows[0]
        assert spawned["status"] == "queued"
        assert spawned["root_task_id"] == root.id
        assert spawned["parent_task_id"] == root.id
        # inheritance from the ROOT (spec §8.2): payload/address frozen,
        # never re-resolved
        assert spawned["address"] == "+79990001122"
        assert json.loads(spawned["payload"]) == {"client": {"name": "Анна"}}
        assert spawned["event_id"] == root.event_id
        assert spawned["scenario"] == "new_record"
        assert spawned["client_id"] is None
        # FRESH freeze for the new channel: the mock channel tier, not
        # the root's frozen template
        assert spawned["template_id"] == template.id
        assert spawned["template_body"] == "MOCK TIER {{ client.name }}"
        # the chain is in flight — no outcome on the root yet
        assert _task_row(root.id, "delivery_outcome")["delivery_outcome"] is None
        # the spawn reached the queue after the commit (§4.2 payload)
        assert [p["task_id"] for p in queue.tasks] == [spawned["id"]]
        assert queue.tasks[0]["channel"] == "mock"
        assert queue.tasks[0]["root_task_id"] == root.id

    async def test_sent_of_any_chain_task_marks_root_delivered(
        self, db_engine, db_session
    ) -> None:
        root = await _stage_chain_task(db_session, channel="telegram")
        cont = await _stage_chain_task(
            db_session,
            channel="mock",
            root_task_id=root.id,
            parent_task_id=root.id,
        )
        queue = FakeQueue()

        queue.push_status(
            _status_item(cont.id, "sent", channel="mock", sent_text="текст доставки")
        )
        await dispatcher.statuses_once(_session_factory(db_engine), queue)

        assert _task_row(root.id, "delivery_outcome")["delivery_outcome"] == "delivered"
        assert _task_row(cont.id, "status")["status"] == "sent"

    async def test_channel_exhaustion_closes_chain_on_root(
        self, db_engine, db_session, monkeypatch
    ) -> None:
        """Исчерпание каналов: single-channel priority — the terminal
        failure closes the chain ``not_delivered`` ON THE ROOT (the
        reason lives in the attempt journal); nothing is spawned."""
        monkeypatch.setattr(settings, "NOTIFY_CHANNEL_PRIORITY", "telegram")
        root = await _stage_chain_task(db_session, channel="telegram")
        queue = FakeQueue()

        queue.push_status(_status_item(root.id, "failed", outcome="not_delivered"))
        await dispatcher.statuses_once(_session_factory(db_engine), queue)

        assert _task_row(root.id, "delivery_outcome")["delivery_outcome"] == "not_delivered"
        assert query_db("SELECT id FROM notify_tasks WHERE channel != 'telegram'") == []
        assert queue.tasks == []
        # the failure itself is in the append-only journal (part 5 reads
        # attempts for the reason — no reason column on the task)
        rows = query_db(
            f"SELECT outcome FROM notify_task_attempts WHERE task_id = '{root.id}'"
        )
        assert rows == [{"outcome": "not_delivered"}]

    async def test_intermediate_transport_failure_neither_spawns_nor_closes(
        self, db_engine, db_session, monkeypatch
    ) -> None:
        """A retry in progress is NOT a terminal failure: the intermediate
        ``failed/transport_error`` event spawns nothing and closes
        nothing."""
        monkeypatch.setattr(settings, "NOTIFY_CHANNEL_PRIORITY", "telegram,mock")
        task = await _stage_chain_task(db_session, channel="telegram")
        queue = FakeQueue()

        queue.push_status(_status_item(task.id, "failed", outcome="transport_error"))
        await dispatcher.statuses_once(_session_factory(db_engine), queue)

        assert query_db("SELECT id FROM notify_tasks WHERE channel = 'mock'") == []
        assert _task_row(task.id, "delivery_outcome")["delivery_outcome"] is None

    async def test_assembly_app_error_spawns_without_final_event(
        self, db_engine, db_session, monkeypatch
    ) -> None:
        """The assembly-error report (§5.4) carries ONE ``failed/
        app_error`` and NO final ``not_delivered`` — it must still
        continue the chain (domain rule: «цепочка идёт к следующему
        каналу»)."""
        monkeypatch.setattr(settings, "NOTIFY_CHANNEL_PRIORITY", "telegram,mock")
        await _seed_channel_template(db_session, "mock")
        root = await _stage_chain_task(db_session, channel="telegram")
        queue = FakeQueue()

        queue.push_status(
            _status_item(
                root.id,
                "failed",
                outcome="app_error",
                sent_text=None,
            )
        )
        await dispatcher.statuses_once(_session_factory(db_engine), queue)

        assert len(query_db("SELECT id FROM notify_tasks WHERE channel = 'mock'")) == 1
        assert len(queue.tasks) == 1

    async def test_duplicate_report_redelivery_does_not_duplicate_spawn(
        self, db_engine, db_session, monkeypatch
    ) -> None:
        """DoD: повторная доставка отчёта не дублирует задачу — the
        at-least-once duplicate of the terminal report re-runs the
        reaction idempotently: ONE continuation task, ONE queue payload,
        the root outcome stable."""
        monkeypatch.setattr(settings, "NOTIFY_CHANNEL_PRIORITY", "telegram,mock")
        await _seed_channel_template(db_session, "mock")
        root = await _stage_chain_task(db_session, channel="telegram")
        factory = _session_factory(db_engine)
        queue = FakeQueue()
        item = _status_item(root.id, "failed", outcome="not_delivered")

        queue.push_status(item)
        await dispatcher.statuses_once(factory, queue)
        queue.push_status(item)  # at-least-once duplicate (§4.4)
        await dispatcher.statuses_once(factory, queue)

        assert len(query_db("SELECT id FROM notify_tasks WHERE channel = 'mock'")) == 1
        assert len(queue.tasks) == 1
        assert _task_row(root.id, "delivery_outcome")["delivery_outcome"] is None

    async def test_send_app_error_then_final_no_close_while_next_in_flight(
        self, db_engine, db_session, monkeypatch
    ) -> None:
        """The send-failure sequence is ``failed/app_error`` FOLLOWED BY
        ``failed/not_delivered`` — both arrive after the spawn. The
        second event must NOT close the chain while the continuation is
        still in flight; the continuation's own terminal failure closes
        it."""
        monkeypatch.setattr(settings, "NOTIFY_CHANNEL_PRIORITY", "telegram,mock")
        await _seed_channel_template(db_session, "mock")
        root = await _stage_chain_task(db_session, channel="telegram")
        factory = _session_factory(db_engine)
        queue = FakeQueue()

        queue.push_status(_status_item(root.id, "failed", outcome="app_error"))
        await dispatcher.statuses_once(factory, queue)
        rows = query_db("SELECT id FROM notify_tasks WHERE channel = 'mock'")
        assert len(rows) == 1
        cont_id = rows[0]["id"]

        # the final of channel 1: the chain has a live task — no close
        queue.push_status(_status_item(root.id, "failed", outcome="not_delivered"))
        await dispatcher.statuses_once(factory, queue)
        assert _task_row(root.id, "delivery_outcome")["delivery_outcome"] is None

        # the continuation exhausts the chain — outcome on the root
        queue.push_status(_status_item(cont_id, "failed", channel="mock", outcome="not_delivered"))
        await dispatcher.statuses_once(factory, queue)
        assert _task_row(root.id, "delivery_outcome")["delivery_outcome"] == "not_delivered"

    async def test_candidate_without_template_is_skipped_loudly_next_spawns(
        self, db_engine, db_session, monkeypatch
    ) -> None:
        """The skip branch of ``_chain_reaction``: a candidate channel
        with NO template of any tier (channel/universal/default) is
        skipped LOUDLY (a log line naming it) and the chain lands on
        the NEXT candidate — a mid-chain template hole must not close
        the chain while a deliverable channel remains."""
        monkeypatch.setattr(settings, "NOTIFY_CHANNEL_PRIORITY", "telegram,mock1,mock2")
        # a template tier ONLY for mock2: mock1 has no channel tier, no
        # universal row, no default (reset_db wiped the seed) — skipped
        template = await _seed_channel_template(db_session, "mock2")
        root = await _stage_chain_task(db_session, channel="telegram")
        factory = _session_factory(db_engine)
        queue = FakeQueue()

        with capture_dispatcher_logs() as messages:
            queue.push_status(_status_item(root.id, "failed", outcome="not_delivered"))
            await dispatcher.statuses_once(factory, queue)

        # the spawn went to the NEXT candidate — never the hole
        rows = query_db(
            "SELECT id, channel, template_id, template_body FROM notify_tasks"
            " WHERE channel IN ('mock1', 'mock2')"
        )
        assert len(rows) == 1
        assert rows[0]["channel"] == "mock2"
        assert rows[0]["template_id"] == template.id
        assert rows[0]["template_body"] == "MOCK2 TIER {{ client.name }}"
        assert [p["task_id"] for p in queue.tasks] == [rows[0]["id"]]
        # the skip was loud: the hole is named in the journal log
        assert any(
            "no template for channel 'mock1'" in m for m in messages
        ), messages
        # the chain stays open — the continuation is in flight
        assert _task_row(root.id, "delivery_outcome")["delivery_outcome"] is None

    async def test_late_sent_after_close_flips_root_to_delivered(
        self, db_engine, db_session, monkeypatch
    ) -> None:
        """«Успех любой задачи — цепочка успешна»: a late ``sent`` (the
        accepted rare duplicate that actually delivered) re-opens the
        closed chain to ``delivered`` — truth wins, ``delivered`` is the
        terminal root outcome."""
        monkeypatch.setattr(settings, "NOTIFY_CHANNEL_PRIORITY", "telegram")
        root = await _stage_chain_task(db_session, channel="telegram")
        factory = _session_factory(db_engine)
        queue = FakeQueue()

        queue.push_status(_status_item(root.id, "failed", outcome="not_delivered"))
        await dispatcher.statuses_once(factory, queue)
        assert _task_row(root.id, "delivery_outcome")["delivery_outcome"] == "not_delivered"

        queue.push_status(_status_item(root.id, "sent"))
        await dispatcher.statuses_once(factory, queue)
        assert _task_row(root.id, "delivery_outcome")["delivery_outcome"] == "delivered"

    async def test_sent_task_late_failure_never_spawns_never_flips(
        self, db_engine, db_session, monkeypatch
    ) -> None:
        """``sent`` is TERMINAL on the task: a late terminal failure of
        an already-sent task (a re-enqueue duplicate) neither continues
        the chain nor flips the root outcome."""
        monkeypatch.setattr(settings, "NOTIFY_CHANNEL_PRIORITY", "telegram,mock")
        root = await _stage_chain_task(db_session, channel="telegram")
        factory = _session_factory(db_engine)
        queue = FakeQueue()

        queue.push_status(_status_item(root.id, "sent"))
        await dispatcher.statuses_once(factory, queue)
        assert _task_row(root.id, "delivery_outcome")["delivery_outcome"] == "delivered"

        queue.push_status(_status_item(root.id, "failed", outcome="not_delivered"))
        await dispatcher.statuses_once(factory, queue)

        assert query_db("SELECT id FROM notify_tasks WHERE channel = 'mock'") == []
        assert _task_row(root.id, "delivery_outcome")["delivery_outcome"] == "delivered"


class TestStatusesSentText:
    """DoD «отчёты пишут ``sent_text``»: the §4.3 rev.5 report carries
    the actually transmitted text — the dispatcher lands it on the
    append-only attempt rows (failures before transmission keep NULL)."""

    async def test_attempt_rows_carry_the_reported_sent_text(
        self, db_engine, db_session
    ) -> None:
        task = await _stage_chain_task(db_session, channel="telegram")
        factory = _session_factory(db_engine)
        queue = FakeQueue()

        queue.push_status(
            _status_item(task.id, "sending", sent_text="Готовый текст попытки")
        )
        queue.push_status(
            _status_item(task.id, "sent", sent_text="Готовый текст попытки")
        )
        queue.push_status(_status_item(task.id, "failed", outcome="not_delivered"))
        await dispatcher.statuses_once(factory, queue)

        rows = query_db(
            f"SELECT stage, sent_text FROM notify_task_attempts WHERE task_id = '{task.id}'"
            " ORDER BY occurred_at, rowid"
        )
        assert rows == [
            {"stage": "sending", "sent_text": "Готовый текст попытки"},
            {"stage": "sent", "sent_text": "Готовый текст попытки"},
            {"stage": "failed", "sent_text": None},
        ]


# ── statuses brak rule — #484 Task 6 (spec §3.5, two layers) ─────────────────


class TestStatusesBrakRule:
    """Layer 1 — shape pre-validation; layer 2 — ``ValueError`` from
    ``apply_status_event`` (unknown task/stage after a valid form). Both:
    journal (identifiers only) + ACK — brak leaves delivery forever,
    siblings of the same batch still proceed. Every OTHER error keeps the
    old hanging contract: logged, NOT acked, reclaimed at process start."""

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            pytest.param("task_id", None, id="task-id-missing"),
            pytest.param("task_id", "", id="task-id-empty"),
            pytest.param("task_id", 3.5, id="task-id-wrong-type"),
            # Canonical id shape (#484 follow-up): a non-empty UUID string
            # (NotifyTask.id String(36)) — the int/bool spellings of the
            # §4.2 sketch are malformed and must be acked away.
            pytest.param("task_id", 456, id="task-id-int"),
            pytest.param("task_id", True, id="task-id-bool"),
            pytest.param("stage", "delivered", id="stage-out-of-vocabulary"),
            pytest.param("stage", None, id="stage-missing"),
            pytest.param("channel", "", id="channel-empty"),
            pytest.param("channel", None, id="channel-missing"),
            pytest.param("occurred_at", "not-a-timestamp", id="occurred-at-unparseable"),
            pytest.param("occurred_at", None, id="occurred-at-missing"),
            pytest.param("occurred_at", 123, id="occurred-at-wrong-type"),
        ],
    )
    async def test_shape_brak_acked_sibling_processed(
        self, db_engine, db_session, field, value
    ) -> None:
        """Layer 1: any shape violation → the event is acked away BEFORE
        ``apply_status_event`` and writes nothing; the sibling of the same
        batch still applies. ``value=None`` removes the key entirely."""
        task = await _stage_queued_task(db_session)
        queue = FakeQueue()
        brak = _status_item(task.id, "sending")  # would apply fine uncorrupted
        if value is None:
            brak.pop(field)
        else:
            brak[field] = value

        queue.push_status(brak)
        queue.push_status(_status_item(task.id, "sent"))
        with capture_dispatcher_logs() as messages:
            await dispatcher.statuses_once(_session_factory(db_engine), queue)

        # the sibling applied; the brak wrote nothing (one attempt row)
        assert _task_row(task.id, "status")["status"] == "sent"
        assert (
            len(query_db(f"SELECT id FROM notify_task_attempts WHERE task_id = '{task.id}'")) == 1
        )
        # brak never comes back: nothing hanging after a reclaim
        queue.reclaim_hanging()
        assert queue.claim_statuses() == []
        assert any("malformed" in m for m in messages)

    async def test_nondict_event_is_shape_brak_acked(
        self, db_engine, db_session
    ) -> None:
        """A corrupt entry that is not even a mapping must not crash the
        reader (that would poison the claim forever) — it is shape brak."""
        task = await _stage_queued_task(db_session)
        queue = FakeQueue()
        queue.push_status("not-even-a-dict")  # type: ignore[arg-type]
        queue.push_status(_status_item(task.id, "sent"))

        with capture_dispatcher_logs() as messages:
            await dispatcher.statuses_once(_session_factory(db_engine), queue)

        assert _task_row(task.id, "status")["status"] == "sent"
        queue.reclaim_hanging()
        assert queue.claim_statuses() == []
        assert any("malformed" in m for m in messages)

    async def test_unknown_task_valid_form_acked_sibling_processed(
        self, db_engine, db_session
    ) -> None:
        """Layer 2: a VALID form naming a task that does not exist →
        ``ValueError`` from ``apply_status_event`` → acked (redelivery
        cannot fix it — the row commits before enqueue, #482); the
        sibling of the same batch still applies."""
        task = await _stage_queued_task(db_session)
        queue = FakeQueue()
        orphan = _status_item(str(uuid.uuid4()), "sending")

        queue.push_status(orphan)
        queue.push_status(_status_item(task.id, "sending"))
        with capture_dispatcher_logs() as messages:
            await dispatcher.statuses_once(_session_factory(db_engine), queue)

        assert _task_row(task.id, "status")["status"] == "sending"
        queue.reclaim_hanging()
        assert queue.claim_statuses() == []
        assert any("acked" in m for m in messages)

    async def test_db_error_leaves_event_unacked_for_reclaim(self) -> None:
        """The hanging path is PRESERVED: a non-ValueError failure (DB
        down) logs and leaves the event unacked — the reliable-list
        reclaim at the next process start redelivers it (§4.4)."""
        queue = FakeQueue()
        item = _status_item(str(uuid.uuid4()), "sending")
        queue.push_status(item)

        def dead_factory():
            raise RuntimeError("db down")

        with capture_dispatcher_logs() as messages:
            await dispatcher.statuses_once(dead_factory, queue)  # type: ignore[arg-type]

        assert any("not applied" in m for m in messages)
        queue.reclaim_hanging()
        assert queue.claim_statuses() == [item]  # hanging — never acked

    async def test_s9_reader_acks_brak_and_never_returns_to_it(
        self, db_engine, db_session
    ) -> None:
        """S9 (spec §4): a pass of the REAL ``statuses_once`` over
        ``FakeQueue.push_status`` brak — the reader confirms the brak and
        never returns to it; later passes are not disturbed."""
        task = await _stage_queued_task(db_session)
        queue = FakeQueue()
        brak = _status_item(task.id, "sending")
        brak["occurred_at"] = "not-a-timestamp"
        queue.push_status(brak)

        await dispatcher.statuses_once(_session_factory(db_engine), queue)

        queue.reclaim_hanging()
        assert queue.claim_statuses() == []  # the brak is gone for good

        # a later pass over a valid event applies normally
        queue.push_status(_status_item(task.id, "sent"))
        await dispatcher.statuses_once(_session_factory(db_engine), queue)
        assert _task_row(task.id, "status")["status"] == "sent"


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


# ── the events group cycle: domain_events:new_record (#580 Task 6, §3.5) ────


class TestEventsCycle:
    """The dispatcher's group input (spec §5.2 scenario 2): claim a batch
    of the ``notification`` group → scenario → ack. Real Redis (contour
    workspace): the claim/ack/PEL semantics are the object under test."""

    pytestmark = redis_marks

    async def test_claim_runs_scenario_and_acks_deleted_record(
        self, db_engine, db_session, contour
    ) -> None:
        """A snapshot whose record is gone (the deleted-record branch —
        here: no record id at all) yields NO task and the entry is ACKED:
        the closure is the absence of a task, redelivery is idempotent."""
        event = await _stage_event_row(db_session, {})
        _publish(contour, _stream_record(event.id, {}))
        subscriber = Subscriber(
            redis_url(), group=dispatcher.NOTIFICATION_GROUP, key_prefix=contour.prefix
        )
        subscriber.ensure([dispatcher.NEW_RECORD_STREAM])

        queue = FakeQueue()
        await dispatcher.events_once(_session_factory(db_engine), queue, subscriber)

        assert query_db("SELECT id FROM notify_tasks") == []
        assert queue.tasks == []
        # acked: no new deliveries AND an empty PEL
        assert subscriber.claim([dispatcher.NEW_RECORD_STREAM], 10) == []
        assert _group_pending(contour) == 0

    async def test_duplicate_delivery_one_task_both_acked(
        self, db_engine, db_session, create_activity, create_record, contour
    ) -> None:
        """At-least-once (§4.3): the relay may re-XADD an event it failed
        to mark — both entries arrive, ONE decision materializes (the
        partial root index is the dedup key), BOTH are acked."""
        activity = create_activity()
        record = create_record(
            activity_id=activity["id"],
            notify=False,
            visits=[{"name": "Гость", "price": 3500, "status": "waiting"}],
        )
        snapshot = {"event": {"record_id": record["id"]}}
        event = await _stage_event_row(db_session, snapshot)
        _publish(contour, _stream_record(event.id, snapshot))
        _publish(contour, _stream_record(event.id, snapshot))  # the duplicate

        subscriber = Subscriber(
            redis_url(), group=dispatcher.NOTIFICATION_GROUP, key_prefix=contour.prefix
        )
        subscriber.ensure([dispatcher.NEW_RECORD_STREAM])
        queue = FakeQueue()
        await dispatcher.events_once(_session_factory(db_engine), queue, subscriber)

        assert query_db(
            "SELECT status, skip_reason, root_task_id, parent_task_id FROM"
            f" notify_tasks WHERE event_id = '{event.id}'"
        ) == [
            {
                "status": "skipped",
                "skip_reason": "notify_off",
                "root_task_id": query_db(
                    f"SELECT id FROM notify_tasks WHERE event_id = '{event.id}'"
                )[0]["id"],
                "parent_task_id": None,
            }
        ]
        assert queue.tasks == []  # a skip enqueues nothing
        # both stream entries left delivery — nothing hangs
        assert _group_pending(contour) == 0
        assert subscriber.claim([dispatcher.NEW_RECORD_STREAM], 10) == []

    async def test_record_of_unhandled_type_is_acked_away(
        self, db_engine, contour
    ) -> None:
        """A handmade record whose ``type`` has no scenario handler (a
        corrupt payload — the registry gate keeps such types out of the
        stream) is logged (identifiers only) and acked away: redelivery
        cannot fix it, and it must not hang in the PEL forever."""
        _publish(contour, _stream_record(str(uuid.uuid4()), {}, type="alien_type"))
        subscriber = Subscriber(
            redis_url(), group=dispatcher.NOTIFICATION_GROUP, key_prefix=contour.prefix
        )
        subscriber.ensure([dispatcher.NEW_RECORD_STREAM])

        with capture_dispatcher_logs() as messages:
            await dispatcher.events_once(
                _session_factory(db_engine), FakeQueue(), subscriber
            )

        assert _group_pending(contour) == 0
        assert subscriber.claim([dispatcher.NEW_RECORD_STREAM], 10) == []
        assert any("alien_type" in m for m in messages), messages

    async def test_integrity_error_is_acked_as_already_processed(
        self, db_engine, db_session, create_activity, create_record, contour, monkeypatch
    ) -> None:
        """The idempotency seam of the partial root index (§3.5): a commit
        that hits ``uq_notify_tasks_event_scenario_root`` (a concurrent
        delivery won the race past the pre-check) means «already
        processed» — the entry is ACKED, the attempts ledger is NOT
        touched (this is not a scenario failure)."""
        activity = create_activity()
        record = create_record(
            activity_id=activity["id"],
            notify=False,
            visits=[{"name": "Гость", "price": 3500, "status": "waiting"}],
        )
        snapshot = {"event": {"record_id": record["id"]}}
        event = await _stage_event_row(db_session, snapshot)
        _publish(contour, _stream_record(event.id, snapshot))

        async def racer(event, session, queue):
            raise IntegrityError(
                "INSERT INTO notify_tasks",
                {},
                Exception("UNIQUE constraint failed: uq_notify_tasks_event_scenario_root"),
            )

        monkeypatch.setitem(dispatcher.SCENARIOS, "new_record", racer)

        subscriber = Subscriber(
            redis_url(), group=dispatcher.NOTIFICATION_GROUP, key_prefix=contour.prefix
        )
        subscriber.ensure([dispatcher.NEW_RECORD_STREAM])
        with capture_dispatcher_logs() as messages:
            await dispatcher.events_once(
                _session_factory(db_engine), FakeQueue(), subscriber
            )

        assert _group_pending(contour) == 0  # acked — already processed
        assert _ledger(event.id) == []  # the ledger stays untouched
        assert query_db("SELECT id FROM notify_tasks") == []
        assert any("already processed" in m for m in messages), messages


class TestScenarioAttemptsLedger:
    """Spec §5.2 scenario 4 — the DoD test ``test_notify_scenario_attempts_ledger``.

    A failing scenario grows the ``notify_event_attempts`` ledger via the
    RETURN CYCLE (not a manual invocation); the entry stays unacked until
    the 3rd failure parks it (ack); after parking the PEL is EMPTY for
    the event — a ``min_idle_ms=0`` return finds nothing. A re-delivered
    parked event re-parks immediately (the ledger is at the threshold —
    no second retry cycle). The TRANSPORT branch of the same test: an
    enqueue-point ``StreamTransportError`` burns no attempt and leaves
    the entry unacked (the committed task is picked up by the re-enqueue
    cycle)."""

    pytestmark = redis_marks

    async def test_notify_scenario_attempts_ledger(
        self,
        db_engine,
        db_session,
        create_activity,
        create_record,
        create_client,
        contour,
    ) -> None:
        factory = _session_factory(db_engine)
        subscriber = Subscriber(
            redis_url(), group=dispatcher.NOTIFICATION_GROUP, key_prefix=contour.prefix
        )
        subscriber.ensure([dispatcher.NEW_RECORD_STREAM])

        # A scenario that ALWAYS fails: every predicate passes but no
        # template of any tier exists → RenderError (§3.4: it propagates,
        # the ledger owns it).
        client = create_client(phone="+79990001122")
        activity = create_activity()
        record = create_record(
            activity_id=activity["id"],
            client_id=client["id"],
            notify=True,
            visits=[{"name": "Анна", "price": 3500, "status": "waiting"}],
        )
        # the snapshot's activity.start is NAIVE (the storage convention —
        # an aware ISO string would break the handler's naive comparison)
        future = (
            datetime.now(UTC).replace(tzinfo=None) + timedelta(days=1)
        ).isoformat()
        snapshot = {
            "event": {"record_id": record["id"]},
            "client": {"id": client["id"]},
            "activity": {"start": future},
        }
        event = await _stage_event_row(db_session, snapshot)
        _publish(contour, _stream_record(event.id, snapshot))

        # 1st failure — the CLAIM cycle: one increment, NO ack
        await dispatcher.events_once(factory, FakeQueue(), subscriber)
        ledger = _ledger(event.id)
        assert len(ledger) == 1
        assert ledger[0]["attempts"] == 1
        assert "RenderError" in ledger[0]["last_error"]
        assert _group_pending(contour) == 1  # hanging — not acked

        # 2nd failure — the RETURN cycle (idle 0: no 120 s wait in the test)
        await dispatcher.events_reclaim_once(factory, FakeQueue(), subscriber, min_idle_ms=0)
        assert _ledger(event.id)[0]["attempts"] == 2
        assert _group_pending(contour) == 1

        # 3rd failure — the threshold: parking WITH the ack
        await dispatcher.events_reclaim_once(factory, FakeQueue(), subscriber, min_idle_ms=0)
        assert _ledger(event.id)[0]["attempts"] == 3
        assert _group_pending(contour) == 0
        # DoD: PEL empty for the event — a min_idle_ms=0 return finds nothing
        assert subscriber.reclaim([dispatcher.NEW_RECORD_STREAM], 0) == []
        # nothing ever materialized — the parking row is the only trace
        assert query_db(f"SELECT id FROM notify_tasks WHERE event_id = '{event.id}'") == []

        # a re-delivered PARKED event re-parks without a retry cycle: the
        # ledger is already at the threshold → one increment + immediate ack
        _publish(contour, _stream_record(event.id, snapshot))
        await dispatcher.events_once(factory, FakeQueue(), subscriber)
        assert _ledger(event.id)[0]["attempts"] == 4
        assert _group_pending(contour) == 0

        # ── the transport branch (same test, §5.2): attempts NOT burned ──
        db_session.add(
            NotifyTemplate(
                event_type="new_record",
                title="шаблон",
                body="Текст {{ client.name }}",
                is_default=True,
            )
        )
        await db_session.commit()
        event2 = await _stage_event_row(db_session, snapshot)
        _publish(contour, _stream_record(event2.id, snapshot))

        broken = _TransportBrokenQueue()  # enqueue_task → NotifyTransportError
        await dispatcher.events_once(factory, broken, subscriber)

        # the task COMMITTED before the failed enqueue (§3.4 order) — the
        # re-enqueue cycle owns its delivery
        assert query_db(
            f"SELECT status FROM notify_tasks WHERE event_id = '{event2.id}'"
        ) == [{"status": "queued"}]
        # the ledger was NOT touched — a transport outage is not a
        # scenario failure (§3.5)
        assert _ledger(event2.id) == []
        # the entry stays UNACKED — the PEL return repeats it
        assert _group_pending(contour) == 1


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
        assert payload["channel"] == "telegram"
        assert payload["address"] == "+7OLD"
        # saved payload IN FULL — the frozen render data + template
        # verbatim, no re-resolution (§4.2 rev.5)
        assert payload["payload"] == {"client": {"name": "Анна"}}
        assert payload["template_id"] == task.template_id
        assert payload["template_body"] == "{{ client.name }}"
        assert payload["root_task_id"] == task.id
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


# ── re-enqueue × worker PEL — #485 Task 5 (family §3.3 rev.5) ────────────────


class TestReenqueueWorkerPEL:
    """The re-enqueue predicate's third leg: «не в PEL группы worker».
    A task the worker HOLDS (claimed, unacked — e.g. sleeping out a
    channel pause or a transport retry) is NOT hanging: the sweep must
    not duplicate it. Once the worker acks, the age predicate fires
    again on a later sweep."""

    async def test_task_held_by_worker_is_not_reenqueued(
        self, db_engine, db_session
    ) -> None:
        task = await _stage_queued_task(db_session, age_seconds=300)
        factory = _session_factory(db_engine)
        queue = FakeQueue()
        queue.enqueue_task(build_task_payload(task, _iso_z(datetime.now(UTC))))

        claimed = queue.claim_tasks()  # the worker's PEL holds the task
        assert [p["task_id"] for p in claimed] == [task.id]

        await dispatcher.reenqueue_stale_tasks(factory, queue)

        assert queue.tasks == []
        row = _task_row(task.id, "reenqueues", "updated_at")
        assert row["reenqueues"] == 0
        # no re-enqueue stamp either: the task stays eligible, the
        # updated_at is still inside the stale window
        assert datetime.fromisoformat(row["updated_at"]) < datetime.now(UTC).replace(
            tzinfo=None
        ) - timedelta(seconds=settings.NOTIFY_REENQUEUE_AFTER)

        # the worker is done — the next sweep re-enqueues normally
        queue.ack_task(claimed[0])
        await dispatcher.reenqueue_stale_tasks(factory, queue)
        assert len(queue.tasks) == 1
        assert _task_row(task.id, "reenqueues")["reenqueues"] == 1

    async def test_pel_probe_failure_aborts_sweep_without_burning(
        self, db_engine, db_session
    ) -> None:
        """A dead transport at the PROBE point aborts the whole sweep:
        nothing is enqueued, no counters move — the next tick retries.
        (A blind sweep would duplicate every task the worker holds.)"""
        task = await _stage_queued_task(db_session, age_seconds=300)

        class _ProbeBrokenQueue(FakeQueue):
            def pending_worker_task_ids(self) -> set[str]:
                raise NotifyTransportError(
                    "streams transport failed during pending notify:tasks/worker:"
                    " ConnectionError: mock-dead-redis"
                )

        with capture_dispatcher_logs() as messages:
            await dispatcher.reenqueue_stale_tasks(
                _session_factory(db_engine), _ProbeBrokenQueue()
            )

        assert _task_row(task.id, "reenqueues")["reenqueues"] == 0
        assert any("PEL" in m or "pending" in m for m in messages)


# ── enqueue-point transport failure — GH #483 Task 4 (spec §3.1) ────────────


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

        class SpySubscriber(FakeSubscriber):
            def _tick(self, op: str) -> None:
                seen.append((op, threading.get_ident()))

            def ensure(self, streams: list[str]) -> None:
                self._tick("sub_ensure")
                super().ensure(streams)

            def claim(self, streams: list[str], count: int) -> list[ClaimedEvent]:
                self._tick("sub_claim")
                return super().claim(streams, count)

            def ack(self, stream: str, qid: str) -> None:
                self._tick("sub_ack")
                super().ack(stream, qid)

            def reclaim(self, streams: list[str], min_idle_ms: int) -> list[ClaimedEvent]:
                self._tick("sub_reclaim")
                return super().reclaim(streams, min_idle_ms)

            def close(self) -> None:
                self._tick("sub_close")
                super().close()

        spy = SpyQueue()
        subscriber = SpySubscriber()
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
        # the events group cycle (claim path) + process start
        await dispatcher.events_once(factory, spy, subscriber)
        stop = asyncio.Event()
        stop.set()
        await dispatcher.run_dispatcher(factory, spy, stop, subscriber)

        assert {op for op, _ in seen} == {
            "enqueue_task",
            "claim_statuses",
            "ack_status",
            "claim_inbound",
            "ack_inbound",
            "reclaim_hanging",
            # the subscriber seam of the events cycles (#580 Task 6)
            "sub_ensure",
            "sub_claim",
            "sub_reclaim",
            "sub_close",
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
                "streams transport failed during claim notify:statuses/dispatcher:"
                " ConnectionError: mock-dead-redis"
            )

        await dispatcher.run_loop("statuses", stop, 0.001, dead_transport)

        assert len(ticks) == 3  # every failed tick was followed by a retry
