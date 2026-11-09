"""Shared process mechanics of the long-running backend daemons: the
isolated run loop and the signal handlers.

MOVED from ``src/notify/process.py`` (#580 Task 4, spec §3.3/§3.6) into
the neutral util home so the domain-events relay reuses them without
importing the notification subsystem; its daemons (dispatcher/worker)
switched to this module by import, passing their
``log_prefix="notification dispatcher"`` — behavior identical to the
old hardcoded failure line.

- :func:`run_loop` — ``iteration`` until the stop-event, each iteration
  isolated in its own ``try/except`` (one crash is logged, never kills
  the process or the sibling loops). The caller passes its OWN family
  logger AND log prefix (``notification dispatcher`` / ``domain events
  relay``) so the loop-failure lines keep their process attribution.
- :func:`install_signal_handlers` — SIGTERM/SIGINT → the stop-event;
  moved verbatim (previously a duplicate in ``dispatcher.py`` /
  ``worker.py``, extracted by GH #484 part 3).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import signal
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

#: Default logger/prefix of this module; daemons pass their own family
#: logger and prefix (the notification convention: "memo.notification.<module>").
logger = logging.getLogger("memo.util.process")

#: Neutral default of the loop-failure prefix; the notification family
#: passes "notification dispatcher" so its log contract stays stable.
DEFAULT_LOG_PREFIX = "process"


async def run_loop(
    name: str,
    stop: asyncio.Event,
    interval: float,
    iteration: Callable[[], Awaitable[None]],
    log: logging.Logger = logger,
    log_prefix: str = DEFAULT_LOG_PREFIX,
) -> None:
    """Run ``iteration`` until the stop-event, each iteration isolated in
    its own ``try/except``: a crash is logged and the loop (and its
    siblings in the TaskGroup) keep running — a silently dead cycle in a
    live process would be an invisible stop of notifications (panel
    finding, §3.8). Only ``Exception`` is caught; cancellation and
    KeyboardInterrupt propagate so shutdown stays correct.

    ``log_prefix`` parameterizes the failure line (#580 §3.6): the old
    notify home had its prefix hardcoded; every daemon now
    states its own attribution."""
    while not stop.is_set():
        try:
            await iteration()
        except Exception:
            log.exception("%s: %s loop iteration failed", log_prefix, name)
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=interval)


def install_signal_handlers(stop: asyncio.Event) -> None:
    """SIGTERM/SIGINT → the stop-event (§3.8); the TaskGroup then winds
    the loops down. ``add_signal_handler`` is main-thread Unix — silently
    unsupported elsewhere (KeyboardInterrupt remains the fallback)."""
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, stop.set)
