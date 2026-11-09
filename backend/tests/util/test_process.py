"""GH #580 Task 4 (spec §3.3/§3.6) — the shared process mechanics moved
from ``src/notify/process.py`` to the neutral ``src/util/process.py``.

``run_loop`` gains a PARAMETERIZED log prefix (the notify home had
«notify dispatcher» hardcoded into the failure line); notify passes its
historical prefix so its log contract is unchanged, the domain-events
relay passes its own. ``install_signal_handlers`` moves verbatim.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import signal
from contextlib import contextmanager
from typing import TYPE_CHECKING

import pytest

from src.util.process import install_signal_handlers, run_loop

if TYPE_CHECKING:
    from collections.abc import Iterator

pytestmark = pytest.mark.pure_unit

_LOGGER = logging.getLogger("memo.test.util_process")


class _ListHandler(logging.Handler):
    """In-memory sink — caplog is unusable in this repo (the session
    schema setup runs alembic/env.py whose ``fileConfig`` defaults to
    ``disable_existing_loggers=True``, silently dropping records from
    collection-time loggers)."""

    def __init__(self) -> None:
        super().__init__()
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(record.getMessage())


@contextmanager
def capture_logs(log: logging.Logger) -> Iterator[list[str]]:
    handler = _ListHandler()
    old_level, old_disabled = log.level, log.disabled
    log.setLevel(logging.DEBUG)
    log.disabled = False
    log.addHandler(handler)
    try:
        yield handler.messages
    finally:
        log.removeHandler(handler)
        log.setLevel(old_level)
        log.disabled = old_disabled


class TestRunLoop:
    async def test_crashing_iteration_is_isolated_and_logged_with_prefix(
        self,
    ) -> None:
        """One crash is logged with the CALLER's prefix (spec §3.6: the
        prefix was hardcoded «notify dispatcher» at the old home) and
        never kills the loop — the next iteration still runs."""
        stop = asyncio.Event()
        calls = 0

        async def iteration() -> None:
            nonlocal calls
            calls += 1
            if calls < 3:
                raise RuntimeError("boom")
            stop.set()

        with capture_logs(_LOGGER) as messages:
            await run_loop(
                "cycle", stop, 0.001, iteration, log=_LOGGER, log_prefix="my process"
            )

        assert calls == 3
        assert any(
            "my process: cycle loop iteration failed" in m for m in messages
        ), messages

    async def test_notify_prefix_spells_the_historical_line(self) -> None:
        """The notify family's call keeps its historical message
        («notify dispatcher: …») — the move is behavior-identical for
        notify when it passes the prefix explicitly."""
        stop = asyncio.Event()

        async def iteration() -> None:
            stop.set()
            raise RuntimeError("boom")

        with capture_logs(_LOGGER) as messages:
            await run_loop(
                "delivery",
                stop,
                0.001,
                iteration,
                log=_LOGGER,
                log_prefix="notify dispatcher",
            )

        assert any(
            "notify dispatcher: delivery loop iteration failed" in m for m in messages
        ), messages

    async def test_stop_event_ends_the_loop_without_iteration(self) -> None:
        stop = asyncio.Event()
        stop.set()
        calls = 0

        async def iteration() -> None:
            nonlocal calls
            calls += 1

        await run_loop("cycle", stop, 0.001, iteration, log=_LOGGER)

        assert calls == 0


class TestInstallSignalHandlers:
    async def test_sigterm_sets_the_stop_event(self) -> None:
        """SIGTERM → the stop-event (§3.8); the TaskGroup then winds the
        loops down."""
        stop = asyncio.Event()
        install_signal_handlers(stop)
        try:
            os.kill(os.getpid(), signal.SIGTERM)
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=1.0)
            assert stop.is_set()
        finally:
            loop = asyncio.get_running_loop()
            for sig in (signal.SIGTERM, signal.SIGINT):
                with contextlib.suppress(NotImplementedError, ValueError):
                    loop.remove_signal_handler(sig)
