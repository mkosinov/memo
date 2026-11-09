"""GH #580 Task 4 (spec §3.3) — the domain-events relay process.

``python -m src.domain_events.relay`` — the ONLY reader of the journal
tail: one tick takes a batch of unpublished rows (``published_at IS
NULL ORDER BY occurred_at, id LIMIT POLL_BATCH_SIZE``), XADDs each into
the stream of its type (``domain_events:<type>`` via the shared streams
transport, every Redis call through ``asyncio.to_thread``), then marks
the WHOLE batch with ONE commit — the cursor is the row state, not a
remembered id («no id > last», the dispatcher precedent).

Failure volumes (spec §3.3 step 3):

- TRANSPORT failure on an XADD is GLOBAL, not per-event: the batch
  stays unmarked (no ``finally`` marking, no per-row bookkeeping) and
  the whole batch is retried on the next tick — rows already XADDed are
  delivered again, the at-least-once duplicate of §4.3 that subscriber
  idempotency absorbs. The typed error propagates to the run-loop
  guard, which logs it and keeps the process alive.
- A per-event NON-transport failure (an irreparable payload — a code
  bug) is isolated: the row is marked published with an ERROR log so
  one broken row cannot block the tail forever. The journal keeps the
  data; ``--republish-since`` (Task 7) re-emits it after the fix.

Every tick logs the depth of the unpublished tail (rev.2, panel): the
backlog is visible to the operator before it becomes a loss.

The relay is a PRODUCER only — no consumer groups, no claims; group
setup happens on the subscriber side (§3.4). Reuses ``run_loop`` /
``install_signal_handlers`` from ``src/util/process`` (§3.6) and the
engine pragmas of the standalone entries (``DBManager``, the ``seed``
pattern — busy_timeout + WAL are inherited).
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import TYPE_CHECKING, Any, Protocol

from sqlalchemy import func, select

# ``import src.models`` FIRST — registration breaks the models↔notify
# import cycle (``src/models/__init__`` pulls notify models which re-export
# ``DomainEvent`` from this package; the re-export dies with #580 Task 6).
import src.models  # noqa: F401
from src.core.config import settings
from src.db.database import DBManager
from src.domain_events.models import DomainEvent
from src.domain_events.types import stream_key
from src.streams.transport import StreamTransport, StreamTransportError, connect_or_exit
from src.util.process import install_signal_handlers, run_loop
from src.util.utc import utc_now

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

# The domain-events logger convention (src/domain_events/journal.py):
# "memo.domain_events.<module>", independent of import paths.
logger = logging.getLogger("memo.domain_events.relay")

#: Relay batch (spec §3.3): rows per tick — deliberately a module
#: constant, NOT a setting (the batch/policy precedent of notify).
POLL_BATCH_SIZE = 20

#: Stable fail-fast message of the relay's transport gate; the URL value
#: NEVER appears next to it (the streams-core failure volume, §3.6).
RELAY_NOT_CONFIGURED_MESSAGE = "domain events relay: transport not configured"

#: The relay's attribution in the run-loop failure lines (§3.6: the
#: prefix parameterized at the util home).
LOG_PREFIX = "domain events relay"


class _Publisher(Protocol):
    """The publish seam the relay needs from the streams core (§3.6) —
    ``StreamTransport`` satisfies it structurally; tests bring fakes."""

    def publish(self, stream: str, payload: dict[str, Any]) -> None: ...


def stream_record(event: DomainEvent) -> dict[str, Any]:
    """The §4.1 stream record of one journal event — self-sufficient:
    the subscriber reads ``domain_events`` only for its own predicates,
    never for content. ``occurred_at`` is ISO naive UTC (the repository
    storage convention serialized); the snapshot rides verbatim."""
    return {
        "event_id": event.id,
        "type": event.type,
        "occurred_at": event.occurred_at.isoformat(),
        "snapshot": event.snapshot,
    }


async def relay_once(
    session_factory: async_sessionmaker[AsyncSession], transport: _Publisher
) -> None:
    """One relay tick (spec §3.3): batch → XADD per row → ONE commit
    marking the batch. A :class:`StreamTransportError` propagates to the
    run-loop guard with the batch left UNMARKED (the next tick retries
    it whole — duplicates accepted, §4.3); a non-transport per-event
    failure marks only its row published with an ERROR log. The tick
    closes by logging the unpublished tail depth."""
    async with session_factory() as session:
        batch = (
            (
                await session.execute(
                    select(DomainEvent)
                    .where(DomainEvent.published_at.is_(None))
                    .order_by(DomainEvent.occurred_at, DomainEvent.id)
                    .limit(POLL_BATCH_SIZE)
                )
            )
            .scalars()
            .all()
        )
        marked_at = utc_now()
        for event in batch:
            try:
                # one Redis call per row, off the event loop (§3.3)
                await asyncio.to_thread(
                    transport.publish, stream_key(event.type), stream_record(event)
                )
            except StreamTransportError:
                # GLOBAL, not per-event: nothing is marked, nothing is
                # committed — the session closes with the uncommitted
                # marks discarded, the next tick retries the batch.
                raise
            except Exception as exc:
                # An irreparable payload is a code bug, not an outage:
                # the row is marked published so ONE broken row cannot
                # block the tail forever (§3.3 step 3). If a transport
                # failure follows later in the same batch, the whole
                # commit is still discarded — the transport rule wins.
                logger.error(
                    "%s: event %s (type %s) failed with a non-transport"
                    " error (%s: %s) — marked published to unblock the"
                    " tail; re-emit with --republish-since after the fix",
                    LOG_PREFIX,
                    event.id,
                    event.type,
                    type(exc).__name__,
                    exc,
                )
                event.published_at = marked_at
            else:
                event.published_at = marked_at
        if batch:
            await session.commit()
        depth = (
            await session.execute(
                select(func.count())
                .select_from(DomainEvent)
                .where(DomainEvent.published_at.is_(None))
            )
        ).scalar_one()
        # rev.2 (panel): the backlog depth is visible every tick —
        # INFO while a tail exists, DEBUG on a drained journal (a 1s
        # INFO heartbeat of zeros would drown the operator's log).
        logger.log(
            logging.INFO if depth else logging.DEBUG,
            "%s: unpublished tail depth %d",
            LOG_PREFIX,
            depth,
        )


async def run_relay(
    session_factory: async_sessionmaker[AsyncSession],
    transport: _Publisher,
    stop: asyncio.Event,
) -> None:
    """The relay loop: ``relay_once`` every
    ``DOMAIN_EVENTS_POLL_INTERVAL`` until the stop-event; one crashing
    tick (e.g. a transport outage) is logged and never kills the
    process — the next tick retries the batch (§3.3)."""
    await run_loop(
        "relay",
        stop,
        settings.DOMAIN_EVENTS_POLL_INTERVAL,
        lambda: relay_once(session_factory, transport),
        log=logger,
        log_prefix=LOG_PREFIX,
    )


async def main(transport: _Publisher | None = None) -> None:
    """``python -m src.domain_events.relay``. Disabled
    (``DOMAIN_EVENTS_ENABLED=false``, the default): log and return 0 —
    events keep accumulating in the journal (§4.5: the cursor is the
    row state, so a later start publishes everything).

    Adapter selection (the ``connect_or_exit`` gate, §3.6): no injected
    transport → build the streams core over ``REDIS_URL`` and refuse
    the process LOUDLY (``SystemExit(2)``, stable message, the URL
    value never disclosed) when the transport is not configured or
    unreachable. An explicitly injected transport (the test seam)
    skips selection entirely."""
    if not settings.DOMAIN_EVENTS_ENABLED:
        logger.info(
            "%s: DOMAIN_EVENTS_ENABLED=false — exiting (domain events keep"
            " accumulating in the journal)",
            LOG_PREFIX,
        )
        return

    logger.info("%s starting", LOG_PREFIX)

    if transport is None:
        transport = connect_or_exit(
            settings.REDIS_URL.get_secret_value(),
            transport_factory=StreamTransport,
            logger=logger,
            not_configured_message=RELAY_NOT_CONFIGURED_MESSAGE,
        )

    # Standalone-entry engine (the ``seed``/dispatcher pattern): the
    # repo connection pragmas — busy_timeout + WAL — are inherited.
    database_url = os.environ.get("DATABASE_URL", "sqlite+aiosqlite:///./memo.db")
    manager = DBManager(database_url)
    stop = asyncio.Event()
    install_signal_handlers(stop)
    try:
        await run_relay(manager.async_session, transport, stop)
    finally:
        await manager.engine.dispose()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    # KeyboardInterrupt ONLY: the transport gate's SystemExit(2) must
    # propagate — the process exit code IS the fail-fast contract.
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("%s: interrupted — stopped", LOG_PREFIX)
