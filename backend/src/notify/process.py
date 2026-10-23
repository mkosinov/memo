"""Shared process mechanics of the notify family: the isolated run loop
and the signal handlers (part 3 #484, spec §3.7; source — the part-1
dispatcher, moved here verbatim so the delivery worker reuses them).

- :func:`run_loop` — ``iteration`` until the stop-event, each iteration
  isolated in its own ``try/except`` (one crash is logged, never kills
  the process or the sibling loops). The caller passes its OWN family
  logger (``memo.notify.dispatcher`` / ``memo.notify.worker``) so the
  loop-failure lines keep their process attribution.
- :func:`install_signal_handlers` — SIGTERM/SIGINT → the stop-event;
  previously a verbatim duplicate in ``dispatcher.py`` and ``worker.py``.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import signal
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

# The notify family logger convention (src/notify/journal.py):
# "memo.notify.<module>", independent of import paths.
logger = logging.getLogger("memo.notify.process")


async def run_loop(
    name: str,
    stop: asyncio.Event,
    interval: float,
    iteration: Callable[[], Awaitable[None]],
    log: logging.Logger = logger,
) -> None:
    """Run ``iteration`` until the stop-event, each iteration isolated in
    its own ``try/except``: a crash is logged and the loop (and its
    siblings in the TaskGroup) keep running — a silently dead cycle in a
    live process would be an invisible stop of notifications (panel
    finding, §3.8). Only ``Exception`` is caught; cancellation and
    KeyboardInterrupt propagate so shutdown stays correct."""
    while not stop.is_set():
        try:
            await iteration()
        except Exception:
            log.exception("notify dispatcher: %s loop iteration failed", name)
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
