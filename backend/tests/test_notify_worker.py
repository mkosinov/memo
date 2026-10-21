"""GH #483 Task 5 (spec §3.4; ADR 009 — worker without DB): the notify
worker skeleton.

S5 (spec §5): ``python -m src.notify.worker`` —

- disabled subsystem → journal line + quiet exit 0;
- enabled → the SAME fail-fast gates as the dispatcher (empty
  ``REDIS_URL`` → exit code 2 with the stable message; configured but
  unreachable Redis → loud PING refusal, exit code 2, no URL leak);
- SIGTERM/SIGINT handlers are installed on the running loop and set the
  stop-event (graceful shutdown contract);
- the idle loop ticks until the stop-event and NEVER reads the queue —
  consuming with empty logic would strand entries in a PEL (spec §3.4;
  reading ships in part 3);
- ``__main__`` does not swallow the gate's ``SystemExit(2)`` — the
  process exit code IS the fail-fast contract.

No live Redis and no DB: the unreachable-gate tests hit a refused
localhost port (connection refused is immediate), everything else runs
on ``FakeQueue`` and injected seams. Marked ``unit`` (fast, no DB).
"""

import asyncio
import os
import signal
import subprocess
import sys
import uuid

import pytest
from pydantic import SecretStr

from src.core.config import settings
from src.notify import worker
from src.notify.queue import FakeQueue
from src.notify.redis_queue import TRANSPORT_NOT_CONFIGURED_MESSAGE
from tests.conftest import BACKEND_DIR
from tests.notify_redis_support import capture_notify_logs

pytestmark = pytest.mark.unit

_WORKER_LOGGER = "memo.notify.worker"

#: The one startup line of the skeleton (spec §3.4 verbatim).
_SKELETON_LINE = "worker skeleton: delivery logic ships in #484"

#: Unreachable endpoint: nothing listens on port 1; localhost refusal is
#: immediate. Credentials in the URL double as a leak probe.
_UNREACHABLE_URL = "redis://default:topsecret@127.0.0.1:1/0"
_SECRET = "topsecret"


def _status_item() -> dict:
    return {
        "task_id": str(uuid.uuid4()),
        "stage": "sending",
        "channel": "telegram",
        "outcome": None,
        "error": None,
        "occurred_at": "2026-10-20T10:00:05Z",
    }


def _inbound_item() -> dict:
    return {"channel": "telegram", "text": "hi"}


class TestMainDisabled:
    async def test_disabled_logs_and_returns_without_touching_queue(
        self, monkeypatch
    ) -> None:
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


class TestMainGates:
    """Enabled without a configured/working transport is a LOUD exit
    code 2 (spec §3.1, S3/S5) — same gates as the dispatcher."""

    async def test_enabled_empty_url_exits_code_2_with_stable_message(
        self, monkeypatch
    ) -> None:
        monkeypatch.setattr(settings, "NOTIFY_ENABLED", True)
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
        monkeypatch.setattr(settings, "NOTIFY_ENABLED", True)
        monkeypatch.setattr(settings, "REDIS_URL", SecretStr(_UNREACHABLE_URL))
        with (
            capture_notify_logs("memo.notify.redis_queue") as messages,
            pytest.raises(SystemExit) as exit_info,
        ):
            await worker.main()
        assert exit_info.value.code == 2
        assert any("transport unavailable" in m for m in messages)
        assert all(_SECRET not in m for m in messages)


class TestMainWiring:
    async def test_enabled_unwraps_url_installs_handlers_runs_idle(
        self, monkeypatch
    ) -> None:
        """Non-empty ``REDIS_URL`` → ``connect_or_exit(<unwrapped url>)``;
        SIGTERM/SIGINT handlers installed before the idle loop starts;
        the loop receives the built queue and the stop-event; exactly ONE
        startup skeleton line is journalled."""
        monkeypatch.setattr(settings, "NOTIFY_ENABLED", True)
        monkeypatch.setattr(settings, "REDIS_URL", SecretStr("redis://localhost:6379/0"))
        built = FakeQueue()
        seen: dict[str, str] = {}
        ran: dict[str, object] = {}

        def fake_connect(url: str, **kwargs: object) -> FakeQueue:
            seen["url"] = url
            return built

        async def fake_idle_loop(queue: FakeQueue, stop: asyncio.Event) -> None:
            ran["queue"] = queue
            ran["stop"] = stop

        loop = asyncio.get_running_loop()
        real_add = loop.add_signal_handler
        sig_calls: list[signal.Signals] = []

        def spy_add(sig: object, callback: object, *args: object) -> object:
            sig_calls.append(sig)  # type: ignore[arg-type]
            return real_add(sig, callback)  # type: ignore[arg-type]

        monkeypatch.setattr(loop, "add_signal_handler", spy_add)
        monkeypatch.setattr(worker, "connect_or_exit", fake_connect)
        monkeypatch.setattr(worker, "idle_loop", fake_idle_loop)

        with capture_notify_logs(_WORKER_LOGGER) as messages:
            await worker.main()

        assert seen["url"] == "redis://localhost:6379/0"
        assert ran["queue"] is built
        assert isinstance(ran["stop"], asyncio.Event)
        assert sig_calls == [signal.SIGTERM, signal.SIGINT]
        skeleton = [m for m in messages if _SKELETON_LINE in m]
        assert skeleton == [_SKELETON_LINE]


class TestSignalHandlers:
    async def test_install_signal_handlers_register_stop_setters(
        self, monkeypatch
    ) -> None:
        """SIGTERM/SIGINT both land on the loop, each callback sets the
        stop-event — firing it is the graceful-shutdown trigger."""
        loop = asyncio.get_running_loop()
        installed: dict[signal.Signals, object] = {}

        def spy_add(sig: object, callback: object, *args: object) -> None:
            installed[signal.Signals(sig)] = callback  # type: ignore[arg-type]

        monkeypatch.setattr(loop, "add_signal_handler", spy_add)

        stop = asyncio.Event()
        worker._install_signal_handlers(stop)

        assert set(installed) == {signal.SIGTERM, signal.SIGINT}
        for sig, callback in installed.items():
            assert not stop.is_set(), f"{sig!r} callback fired prematurely"
            callback()  # type: ignore[operator]
            assert stop.is_set(), f"{sig!r} callback must set the stop-event"
            stop.clear()


class TestIdleLoop:
    async def test_returns_immediately_when_stop_already_set(self) -> None:
        queue = FakeQueue()
        status, inbound = _status_item(), _inbound_item()
        queue.push_status(status)
        queue.push_inbound(inbound)

        stop = asyncio.Event()
        stop.set()
        await asyncio.wait_for(worker.idle_loop(queue, stop), timeout=1.0)

        assert queue.claim_statuses() == [status]
        assert queue.claim_inbound() == [inbound]

    async def test_ticks_until_stop_without_reading_queue(self, monkeypatch) -> None:
        """Several idle ticks happen before the stop-event; the queue is
        NEVER read — consuming with empty delivery logic would strand
        entries in a PEL (spec §3.4)."""
        monkeypatch.setattr(worker, "IDLE_TICK_SECONDS", 0.01)
        queue = FakeQueue()
        status, inbound = _status_item(), _inbound_item()
        queue.push_status(status)
        queue.push_inbound(inbound)

        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        loop.call_later(0.08, stop.set)
        await asyncio.wait_for(worker.idle_loop(queue, stop), timeout=5.0)

        assert queue.claim_statuses() == [status]
        assert queue.claim_inbound() == [inbound]


class TestMainExitCodePropagation:
    """S3/S5: the PROCESS exit code is the contract — ``__main__`` must
    not swallow the gate's ``SystemExit(2)``."""

    def test_python_m_exits_code_2_when_transport_not_configured(self) -> None:
        env = {k: v for k, v in os.environ.items() if k not in ("REDIS_URL", "ENV")}
        env.update(ENV="development", NOTIFY_ENABLED="true", REDIS_URL="")
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
        env = {k: v for k, v in os.environ.items() if k not in ("REDIS_URL", "ENV")}
        env.update(ENV="development", NOTIFY_ENABLED="false", REDIS_URL="")
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
