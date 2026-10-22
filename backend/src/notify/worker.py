"""GH #483 Task 5 — the notify worker skeleton (spec §3.4; ADR 009).

Standalone entry ``python -m src.notify.worker`` — the SECOND process
entry of the notify family: unlike the dispatcher the worker has NO
database (ADR 009) and, as a skeleton, does not consume
``notify:tasks`` either — consuming with empty delivery logic would
create the group and strand every entry in its PEL unprocessed; the
``XREADGROUP`` loop and the ``worker`` consumer group ship in part 3
(#484). What the skeleton fixes (S5): the process starts, the fail-fast
gates and the signal handlers work, the transport link is up.

- Disabled subsystem (``NOTIFY_ENABLED=false``, the default): journal
  line + quiet exit 0 — symmetric to the dispatcher (family §3.3).
- Enabled: the SAME fail-fast gates as the dispatcher (spec §3.1) —
  ``connect_or_exit(REDIS_URL)`` refuses the process LOUDLY
  (``SystemExit(2)``, stable message, the URL value never disclosed)
  when the transport is not configured or does not answer PING;
  then SIGTERM/SIGINT handlers set the stop-event, one startup line
  «worker skeleton: delivery logic ships in #484» is journalled, and
  the process idles until a signal — quiet, exit 0 on shutdown.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import signal
from typing import TYPE_CHECKING

from src.core.config import settings
from src.notify.redis_queue import connect_or_exit

if TYPE_CHECKING:
    from src.notify.queue import NotifyQueue

# The notify family logger convention (src/notify/journal.py):
# "memo.notify.<module>", independent of import paths.
logger = logging.getLogger("memo.notify.worker")

# ── module constants (spec §3.4 — deliberately NOT settings) ────────────────

#: Idle tick of the skeleton loop: a periodic no-op wait, the pulse the
#: part-3 delivery loop will replace.
IDLE_TICK_SECONDS = 1.0

#: The one startup line of the skeleton (spec §3.4 verbatim).
SKELETON_MESSAGE = "worker skeleton: delivery logic ships in #484"


# ── concurrency: signal handlers + idle loop (§3.4, dispatcher §3.8) ────────


def _install_signal_handlers(stop: asyncio.Event) -> None:
    """SIGTERM/SIGINT → the stop-event (§3.4, as the dispatcher §3.8);
    the idle loop then winds down and the process exits 0.
    ``add_signal_handler`` is main-thread Unix — silently unsupported
    elsewhere (KeyboardInterrupt remains the fallback)."""
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, stop.set)


async def idle_loop(queue: NotifyQueue, stop: asyncio.Event) -> None:
    """The skeleton's idle wait: tick until the stop-event, NEVER read
    the queue (spec §3.4 — consumption is part 3; ``queue`` is received
    now so the part-3 loop replaces this body without re-plumbing the
    entry). Only the stop-event ends the process: SIGTERM/SIGINT set it
    (see :func:`_install_signal_handlers`), and the wait-for-stop form
    reacts within one tick instead of sleeping through a whole interval.
    """
    while not stop.is_set():
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=IDLE_TICK_SECONDS)


# ── process entry ───────────────────────────────────────────────────────────


async def main(queue: NotifyQueue | None = None) -> None:
    """``python -m src.notify.worker``. Disabled (``NOTIFY_ENABLED=false``,
    the default): log and return 0. Enabled: the fail-fast transport
    gate (spec §3.1), SIGTERM/SIGINT handlers, then the idle loop — the
    skeleton never consumes ``notify:tasks`` (part 3, #484). An
    explicitly injected queue (the test seam) skips gate selection.
    """
    if not settings.NOTIFY_ENABLED:
        logger.info(
            "notify worker: NOTIFY_ENABLED=false — exiting (the queue stays untouched)"
        )
        return

    if queue is None:
        # No FakeQueue fallback: an enabled worker with no configured or
        # unreachable transport must not idle silently — the gate exits
        # code 2 before the loop starts (spec §3.1, S5).
        queue = connect_or_exit(settings.REDIS_URL.get_secret_value())

    stop = asyncio.Event()
    _install_signal_handlers(stop)
    logger.info(SKELETON_MESSAGE)
    await idle_loop(queue, stop)


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    # KeyboardInterrupt ONLY: the transport gate's SystemExit(2) (spec §3.1,
    # S5) must propagate — the process exit code IS the fail-fast contract.
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("notify worker: interrupted — stopped")
