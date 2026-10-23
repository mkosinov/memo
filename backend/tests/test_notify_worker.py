"""GH #484 Task 5 (part 3 of the notify family #476; spec §3.1/§3.3/
§3.7) — the worker PROCESS: startup checks, the delivery loop, ack
after the statuses.

Unit contour only — no Redis (the S9 invariant: the whole worker
contract runs under ``-m "not redis"`` without ``REDIS_URL``), no DB,
no real retry pauses (``NOTIFY_SEND_RETRIES=1`` in the process tests —
the pause matrix of the core is Task 4's SleepSpy coverage):

- disabled subsystem → journal line + quiet exit 0 (unchanged);
- startup order: parse priority → validate LOUDLY (an unregistered name
  → ``SystemExit(2)`` with the stable registry message BEFORE the group
  is created) → transport gate (``connect_or_exit`` carries
  ``reclaim_min_idle_ms = NOTIFY_REENQUEUE_AFTER × 1000``) → injected
  or built channel instances → ``ensure_worker_group`` →
  ``reclaim_hanging_tasks`` → signal handlers → ``run_loop("delivery")``;
- one iteration: claim → validate (brak → identifiers-only journal +
  ack, no status; the batch continues) → the §3.4 core with statuses
  published through the queue seam → ack AFTER the statuses; the batch
  ends with the periodic hanging-task reclaim;
- ``NotifyTransportError`` from ``publish_status`` aborts the iteration
  (the record keeps its delivery ticket — not acked, the periodic
  reclaim returns it) and does NOT kill the process: the ``run_loop``
  guard journals it, a healed queue delivers on a later iteration;
- the S9 mixed matrix through the REAL process: first-attempt success,
  fallback after an exhausted transport budget, ``app_error`` final
  ``not_delivered``, a brak payload, a runtime ``unknown_channel``
  entry — deliveries recorded, full status chains, everything acked;
- ``__main__`` propagates the gates' exit codes (the registry gate
  fires BEFORE the transport gate; disabled → 0).
"""

import asyncio
import contextlib
import os
import subprocess
import sys
from collections.abc import Callable

import pytest
from pydantic import SecretStr

from src.core.config import settings
from src.notify import worker
from src.notify.channels.mock import InMemoryRecorder, MockChannel
from src.notify.channels.registry import NOT_REGISTERED_MESSAGE
from src.notify.queue import FakeQueue, StatusEvent, TaskPayload
from src.notify.redis_queue import (
    TRANSPORT_NOT_CONFIGURED_MESSAGE,
    NotifyTransportError,
)
from tests.conftest import BACKEND_DIR
from tests.notify_redis_support import capture_notify_logs

pytestmark = pytest.mark.unit

_WORKER_LOGGER = "memo.notify.worker"

#: A ready (§4.2) notification text — the leak probe of every journal
#: assertion: bodies never reach the worker's log.
TEXT = "Готовый текст оповещения: мастер-класс в субботу"

#: Unreachable endpoint: nothing listens on port 1; localhost refusal is
#: immediate. Credentials in the URL double as a leak probe.
_UNREACHABLE_URL = "redis://default:topsecret@127.0.0.1:1/0"
_SECRET = "topsecret"


# ── builders and seams ───────────────────────────────────────────────────────


def _entry(name: str, address: str) -> dict[str, str]:
    return {"name": name, "address": address}


def _task(
    task_id: str = "7f9c24e1-6f4a-4c0e-9a2b-3d1e5f7a9c01",
    entries: list[dict[str, str]] | None = None,
) -> TaskPayload:
    """A family §4.2 payload; ``task_id`` — the live seam spelling: a
    UUID String(36) (``NotifyTask.id``, AbstractModel PK — ints are
    brak, #484 follow-up). ``entries=None`` → one deliverable mock
    record, ``entries=[]`` → a brak task (empty channel list)."""
    return {
        "task_id": task_id,
        "text": TEXT,
        "channels": entries if entries is not None else [_entry("mock", "+79990001122")],
        "created_at": "2026-10-23T10:00:00Z",
        "resend_of": None,
    }


def _status_item() -> dict:
    return {
        "task_id": "irrelevant",
        "stage": "sending",
        "channel": "telegram",
        "outcome": None,
        "error": None,
        "occurred_at": "2026-10-20T10:00:05Z",
    }


def _inbound_item() -> dict:
    return {"channel": "telegram", "text": "hi"}


def _mock_channels() -> tuple[dict[str, MockChannel], InMemoryRecorder]:
    recorder = InMemoryRecorder()
    return {"mock": MockChannel(recorder)}, recorder


def _enable(monkeypatch: pytest.MonkeyPatch, *, priority: str = "mock") -> None:
    """The unit contour's enabled worker: mock priority, a fast poll,
    a single-attempt budget (no retry pauses on the real clock seam)."""
    monkeypatch.setattr(settings, "NOTIFY_ENABLED", True)
    monkeypatch.setattr(settings, "NOTIFY_CHANNEL_PRIORITY", priority)
    monkeypatch.setattr(settings, "NOTIFY_POLL_INTERVAL", 0.01)
    monkeypatch.setattr(settings, "NOTIFY_SEND_RETRIES", 1)


def _capture_stop(monkeypatch: pytest.MonkeyPatch) -> dict[str, asyncio.Event]:
    """Spy the signal-handler installation and capture the stop-event —
    no real signals in tests; the event stays settable from the test."""
    captured: dict[str, asyncio.Event] = {}

    def spy(stop: asyncio.Event) -> None:
        captured["stop"] = stop

    monkeypatch.setattr(worker, "install_signal_handlers", spy)
    return captured


async def _until(condition: Callable[[], bool], *, what: str, timeout: float = 5.0) -> None:
    """Poll ``condition`` every 10 ms until true — fails loudly with
    ``what`` on timeout (the unit contour never sleeps real seconds)."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while not condition():
        if loop.time() > deadline:
            raise AssertionError(f"timeout waiting for {what}")
        await asyncio.sleep(0.01)


async def _join_worker(process: asyncio.Task, stop: asyncio.Event | None) -> None:
    """Set the captured stop-event (if any) and await the process task —
    the cleanup path of every real-loop test (idempotent)."""
    if stop is not None:
        stop.set()
    with contextlib.suppress(Exception):
        await asyncio.wait_for(process, timeout=5.0)


class RecordingQueue(FakeQueue):
    """FakeQueue + the startup/loop-duty ledger: which worker-side duty
    calls arrived and in what order (the group must exist BEFORE the
    loop starts; the periodic reclaim runs after every batch)."""

    def __init__(self) -> None:
        super().__init__()
        self.duty_calls: list[str] = []

    def ensure_worker_group(self) -> None:
        self.duty_calls.append("ensure_worker_group")

    def reclaim_hanging_tasks(self) -> None:
        self.duty_calls.append("reclaim_hanging_tasks")
        super().reclaim_hanging_tasks()


class FlakyQueue(FakeQueue):
    """Stub transport for the §3.1 outage drill: ``publish_status``
    raises ``NotifyTransportError`` while ``broken`` — claiming and
    acking stay fine, only the publication path is down."""

    def __init__(self) -> None:
        super().__init__()
        self.broken = True

    def publish_status(self, event: StatusEvent) -> None:
        if self.broken:
            raise NotifyTransportError("stub queue: publication transport down")
        super().publish_status(event)


# ── disabled subsystem (unchanged part-2 behavior) ──────────────────────────


class TestMainDisabled:
    async def test_disabled_logs_and_returns_without_touching_queue(self, monkeypatch) -> None:
        monkeypatch.setattr(settings, "NOTIFY_ENABLED", False)
        queue = FakeQueue()
        status, inbound = _status_item(), _inbound_item()
        queue.push_status(status)
        queue.push_inbound(inbound)

        def forbidden_connect(url: str, **kwargs: object) -> FakeQueue:
            raise AssertionError("gates must not run while the subsystem is disabled")

        monkeypatch.setattr(worker, "connect_or_exit", forbidden_connect)

        with capture_notify_logs(_WORKER_LOGGER) as messages:
            await worker.main(queue)

        assert any("NOTIFY_ENABLED" in m for m in messages)
        # quiet exit 0 means main returned — and the queue stayed untouched
        assert queue.claim_statuses() == [status]
        assert queue.claim_inbound() == [inbound]


# ── startup checks (spec §3.1/§3.3) ─────────────────────────────────────────


class TestStartupGates:
    async def test_unknown_priority_name_exits_2_before_group_creation(self, monkeypatch) -> None:
        """The registry gate (§3.3): an unregistered priority name is a
        LOUD ``SystemExit(2)`` with the stable message, BEFORE the group
        is created or anything consumed."""
        _enable(monkeypatch, priority="mock,ghost")
        queue = RecordingQueue()
        channels, _ = _mock_channels()

        with (
            capture_notify_logs("memo.notify.registry") as messages,
            pytest.raises(SystemExit) as exit_info,
        ):
            await worker.main(queue=queue, channels=channels)

        assert exit_info.value.code == 2
        assert any(NOT_REGISTERED_MESSAGE.format("ghost") in m for m in messages)
        assert queue.duty_calls == []  # ensure_worker_group never ran

    async def test_enabled_empty_url_exits_code_2_with_stable_message(self, monkeypatch) -> None:
        _enable(monkeypatch)
        monkeypatch.setattr(settings, "REDIS_URL", SecretStr(""))
        with (
            capture_notify_logs("memo.notify.redis_queue") as messages,
            pytest.raises(SystemExit) as exit_info,
        ):
            await worker.main()
        assert exit_info.value.code == 2
        assert any(TRANSPORT_NOT_CONFIGURED_MESSAGE in m for m in messages)

    async def test_enabled_unreachable_redis_exits_code_2_loudly_without_url_leak(
        self, monkeypatch
    ) -> None:
        """Configured but dead Redis: the PING gate refuses the process
        loudly, before any loop starts; the URL value never appears."""
        _enable(monkeypatch)
        monkeypatch.setattr(settings, "REDIS_URL", SecretStr(_UNREACHABLE_URL))
        with (
            capture_notify_logs("memo.notify.redis_queue") as messages,
            pytest.raises(SystemExit) as exit_info,
        ):
            await worker.main()
        assert exit_info.value.code == 2
        assert any("transport unavailable" in m for m in messages)
        assert all(_SECRET not in m for m in messages)


class TestStartupWiring:
    async def test_gate_passes_reclaim_threshold_in_ms(self, monkeypatch) -> None:
        """``connect_or_exit`` is built with ``reclaim_min_idle_ms =
        NOTIFY_REENQUEUE_AFTER × 1000`` (the setting is seconds,
        XAUTOCLAIM wants milliseconds — spec §3.1)."""
        _enable(monkeypatch)
        monkeypatch.setattr(settings, "NOTIFY_REENQUEUE_AFTER", 120)
        monkeypatch.setattr(settings, "REDIS_URL", SecretStr("redis://localhost:6379/0"))
        seen: dict[str, object] = {}

        def fake_connect(url: str, **kwargs: object) -> RecordingQueue:
            seen["url"] = url
            seen["kwargs"] = kwargs
            return RecordingQueue()

        async def fake_run_loop(
            name: str,
            stop: asyncio.Event,
            interval: float,
            iteration: Callable[[], object],
            log: object = None,
        ) -> None:
            return None

        monkeypatch.setattr(worker, "connect_or_exit", fake_connect)
        monkeypatch.setattr(worker, "run_loop", fake_run_loop)
        _capture_stop(monkeypatch)

        await worker.main()

        assert seen["url"] == "redis://localhost:6379/0"
        assert seen["kwargs"] == {"reclaim_min_idle_ms": 120_000}

    async def test_duties_run_before_loop_with_loop_arguments(self, monkeypatch) -> None:
        """``ensure_worker_group`` → ``reclaim_hanging_tasks`` → the
        delivery loop (§3.1: XAUTOCLAIM needs the group to exist); the
        loop is ``run_loop("delivery", …)`` on the poll interval with
        the worker's own logger."""
        _enable(monkeypatch)
        queue = RecordingQueue()
        channels, _ = _mock_channels()
        ran: dict[str, object] = {}

        async def fake_run_loop(
            name: str,
            stop: asyncio.Event,
            interval: float,
            iteration: Callable[[], object],
            log: object = None,
        ) -> None:
            queue.duty_calls.append(f"run_loop:{name}")
            ran.update(name=name, stop=stop, interval=interval, log=log)

        monkeypatch.setattr(worker, "run_loop", fake_run_loop)
        _capture_stop(monkeypatch)

        await worker.main(queue=queue, channels=channels)

        assert queue.duty_calls == [
            "ensure_worker_group",
            "reclaim_hanging_tasks",
            "run_loop:delivery",
        ]
        assert isinstance(ran["stop"], asyncio.Event)
        assert ran["interval"] == settings.NOTIFY_POLL_INTERVAL
        assert ran["log"] is worker.logger

    async def test_channels_built_from_priority_when_not_injected(self, monkeypatch) -> None:
        _enable(monkeypatch)
        built: dict[str, list[str]] = {}
        channels, _ = _mock_channels()

        def fake_build(names: list[str]) -> dict[str, MockChannel]:
            built["names"] = names
            return channels

        async def fake_run_loop(
            name: str,
            stop: asyncio.Event,
            interval: float,
            iteration: Callable[[], object],
            log: object = None,
        ) -> None:
            return None

        monkeypatch.setattr(worker, "build_instances", fake_build)
        monkeypatch.setattr(worker, "run_loop", fake_run_loop)
        _capture_stop(monkeypatch)

        await worker.main(queue=RecordingQueue(), channels=None)

        assert built["names"] == ["mock"]

    async def test_injected_channels_skip_building(self, monkeypatch) -> None:
        _enable(monkeypatch)

        def forbidden_build(names: list[str]) -> dict[str, MockChannel]:
            raise AssertionError("injected channels must be used as-is")

        async def fake_run_loop(
            name: str,
            stop: asyncio.Event,
            interval: float,
            iteration: Callable[[], object],
            log: object = None,
        ) -> None:
            return None

        monkeypatch.setattr(worker, "build_instances", forbidden_build)
        monkeypatch.setattr(worker, "run_loop", fake_run_loop)
        _capture_stop(monkeypatch)
        channels, _ = _mock_channels()

        await worker.main(queue=RecordingQueue(), channels=channels)


# ── one iteration: claim → validate → deliver → ack after statuses ──────────


class TestDeliveryOnce:
    async def test_brak_payload_acked_without_status_batch_continues(
        self,
    ) -> None:
        """§3.1 brak contract: loud journal (task_id + keys, NEVER the
        text) + ack — no status event; the batch continues with the
        next task."""
        queue = RecordingQueue()
        channels, recorder = _mock_channels()
        good_id = "7f9c24e1-6f4a-4c0e-9a2b-3d1e5f7a9101"
        brak_id = "7f9c24e1-6f4a-4c0e-9a2b-3d1e5f7a9789"
        good, brak = _task(task_id=good_id), _task(task_id=brak_id, entries=[])
        queue.enqueue_task(brak)
        queue.enqueue_task(good)

        with capture_notify_logs(_WORKER_LOGGER) as messages:
            await worker.delivery_once(queue, channels, asyncio.Event())

        # snapshot BEFORE the manual reclaim below joins the ledger
        assert queue.duty_calls == ["reclaim_hanging_tasks"]  # the periodic one
        queue.reclaim_hanging_tasks()
        assert queue.tasks == []  # BOTH acked — nothing hanging
        assert recorder.deliveries == [{"address": "+79990001122", "text": TEXT}]
        statuses = queue.claim_statuses()
        assert [e["task_id"] for e in statuses] == [good_id, good_id]  # brak published nothing
        assert [(e["stage"], e["outcome"]) for e in statuses] == [
            ("sending", "attempt"),
            ("sent", "delivered"),
        ]
        brak_lines = [m for m in messages if "brak" in m]
        assert brak_lines and brak_id in brak_lines[0] and "'channels'" in brak_lines[0]
        assert all(TEXT not in m for m in messages)  # no body leak

    async def test_publish_outage_aborts_iteration_task_keeps_ticket(self) -> None:
        """§3.1: a ``NotifyTransportError`` from ``publish_status``
        aborts the WHOLE iteration — no status-less ack; the record
        keeps its delivery ticket for the periodic reclaim."""
        queue = FlakyQueue()
        channels, _ = _mock_channels()
        task = _task(task_id="7f9c24e1-6f4a-4c0e-9a2b-3d1e5f7a9555")
        queue.enqueue_task(task)

        with pytest.raises(NotifyTransportError):
            await worker.delivery_once(queue, channels, asyncio.Event())

        assert queue.claim_statuses() == []  # nothing was published
        queue.reclaim_hanging_tasks()
        assert queue.tasks == [task]  # NOT acked — back in delivery


# ── the real loop: isolation and recovery through run_loop ──────────────────


class TestProcessLoop:
    async def test_process_survives_publish_outage_and_delivers_after_heal(
        self, monkeypatch
    ) -> None:
        """Iteration isolation (S9): the outage crashes iterations into
        the ``run_loop`` guard (journaled), the task stays unacked, and
        once the queue heals, a later iteration delivers it — exactly
        once, statuses then ack."""
        _enable(monkeypatch)
        queue = FlakyQueue()
        channels, recorder = _mock_channels()
        task = _task(task_id="7f9c24e1-6f4a-4c0e-9a2b-3d1e5f7a9606")
        queue.enqueue_task(task)
        captured = _capture_stop(monkeypatch)

        process = asyncio.create_task(worker.main(queue=queue, channels=channels))
        try:
            with capture_notify_logs(_WORKER_LOGGER) as messages:
                await _until(
                    lambda: any("delivery loop iteration failed" in m for m in messages),
                    what="the guard journal of the crashed iteration",
                )
                # mid-outage: the record is still in delivery (not acked)
                queue.reclaim_hanging_tasks()
                assert queue.tasks == [task]
                queue.broken = False  # heal the transport
                await _until(lambda: bool(recorder.deliveries), what="delivery after the heal")
            await _join_worker(process, captured.get("stop"))
        finally:
            await _join_worker(process, captured.get("stop"))

        assert recorder.deliveries == [{"address": "+79990001122", "text": TEXT}]
        statuses = queue.claim_statuses()
        assert [(e["stage"], e["outcome"]) for e in statuses] == [
            ("sending", "attempt"),
            ("sent", "delivered"),
        ]
        queue.reclaim_hanging_tasks()
        assert queue.tasks == []  # delivered → acked
        assert not process.cancelled() and process.exception() is None

    async def test_full_matrix_one_contour_without_redis(self, monkeypatch) -> None:
        """S9 through the REAL process — one batch, the core matrix plus
        the process rules: first-attempt success, transport-budget
        fallback, ``app_error`` final ``not_delivered``, a brak payload
        (acked, no status), a runtime ``unknown_channel`` entry."""
        _enable(monkeypatch)
        queue = FakeQueue()
        channels, recorder = _mock_channels()
        # Realistic UUID-string ids — the NotifyTask.id seam spelling.
        t1 = "7f9c24e1-6f4a-4c0e-9a2b-3d1e5f7a9101"
        t2 = "7f9c24e1-6f4a-4c0e-9a2b-3d1e5f7a9202"
        t3 = "7f9c24e1-6f4a-4c0e-9a2b-3d1e5f7a9303"
        t4 = "7f9c24e1-6f4a-4c0e-9a2b-3d1e5f7a9404"
        t5 = "7f9c24e1-6f4a-4c0e-9a2b-3d1e5f7a9505"
        for task in (
            _task(t1, [_entry("mock", "+70000000001")]),
            _task(
                t2,
                [_entry("mock", "fail-transport:+70000000002"), _entry("mock", "+70000000003")],
            ),
            _task(t3, [_entry("mock", "fail-app:+70000000004")]),
            _task(t4, entries=[]),  # brak
            _task(t5, [_entry("ghost", "+70000000005")]),  # not a priority instance
        ):
            queue.enqueue_task(task)
        captured = _capture_stop(monkeypatch)

        process = asyncio.create_task(worker.main(queue=queue, channels=channels))
        try:
            await _until(
                lambda: len(recorder.deliveries) == 2,
                what="both deliveries recorded",
            )
        finally:
            await _join_worker(process, captured.get("stop"))

        assert [(d["address"], d["text"]) for d in recorder.deliveries] == [
            ("+70000000001", TEXT),
            ("+70000000003", TEXT),
        ]
        by_task: dict[str, list[tuple[str, object, str]]] = {}
        for event in queue.claim_statuses():
            by_task.setdefault(event["task_id"], []).append(
                (event["stage"], event["outcome"], event["channel"])
            )
        assert by_task[t1] == [
            ("sending", "attempt", "mock"),
            ("sent", "delivered", "mock"),
        ]
        assert by_task[t2] == [
            ("sending", "attempt", "mock"),
            ("failed", "transport_error", "mock"),
            ("sending", "attempt", "mock"),
            ("sent", "delivered", "mock"),
        ]
        assert by_task[t3] == [
            ("sending", "attempt", "mock"),
            ("failed", "app_error", "mock"),
            ("failed", "not_delivered", "mock"),
        ]
        assert t4 not in by_task  # brak → no status
        assert by_task[t5] == [
            ("failed", "unknown_channel", "ghost"),
            ("failed", "not_delivered", "ghost"),
        ]
        queue.reclaim_hanging_tasks()
        assert queue.tasks == []  # every task (brak included) acked


# ── the process entry: exit codes ARE the contract ──────────────────────────


def _proc_env(**overrides: str) -> dict[str, str]:
    """A hermetic subprocess env: the notify/transport variables of the
    outer shell never leak in — each test pins its own."""
    env = {k: v for k, v in os.environ.items() if not k.startswith(("REDIS_URL", "ENV", "NOTIFY_"))}
    env.update(overrides)
    return env


class TestMainExitCodePropagation:
    def test_python_m_registry_gate_exits_2_before_transport_gate(self) -> None:
        """A configured transport does not matter: the registry gate
        fires FIRST (§3.3) — exit 2 with the registry message, no
        transport line."""
        env = _proc_env(
            ENV="development",
            NOTIFY_ENABLED="true",
            REDIS_URL="redis://localhost:6379/0",
            NOTIFY_CHANNEL_PRIORITY="ghost",
        )
        proc = subprocess.run(
            [sys.executable, "-m", "src.notify.worker"],
            cwd=str(BACKEND_DIR),
            env=env,
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )
        assert proc.returncode == 2
        output = proc.stdout + proc.stderr
        assert NOT_REGISTERED_MESSAGE.format("ghost") in output
        assert TRANSPORT_NOT_CONFIGURED_MESSAGE not in output

    def test_python_m_exits_code_2_when_transport_not_configured(self) -> None:
        env = _proc_env(
            ENV="development",
            NOTIFY_ENABLED="true",
            REDIS_URL="",
            NOTIFY_CHANNEL_PRIORITY="mock",
        )
        proc = subprocess.run(
            [sys.executable, "-m", "src.notify.worker"],
            cwd=str(BACKEND_DIR),
            env=env,
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )
        assert proc.returncode == 2
        assert TRANSPORT_NOT_CONFIGURED_MESSAGE in proc.stdout + proc.stderr

    def test_python_m_disabled_exits_zero_quietly(self) -> None:
        env = _proc_env(ENV="development", NOTIFY_ENABLED="false", REDIS_URL="")
        proc = subprocess.run(
            [sys.executable, "-m", "src.notify.worker"],
            cwd=str(BACKEND_DIR),
            env=env,
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )
        assert proc.returncode == 0
