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

``--republish-since <ISO>`` (Task 7, §3.3/§4.5) — the Redis-loss
RECOVERY run: re-emit the journal (the archive) from the loss point.
The dry-run count of matching rows is logged first, then the rows go
out in windows ≤ MAXLEN_APPROX with ``published_at`` marked and
committed BETWEEN windows (rev.2: one continuous flow would trim its
own head under the stream ceiling). The boundary is INCLUSIVE
(``occurred_at >= point``); re-delivered duplicates are absorbed by
subscriber idempotency (§4.3).

The relay is a PRODUCER only — no consumer groups, no claims; group
setup happens on the subscriber side (§3.4). Reuses ``run_loop`` /
``install_signal_handlers`` from ``src/util/process`` (§3.6) and the
engine pragmas of the standalone entries (``DBManager``, the ``seed``
pattern — busy_timeout + WAL are inherited).
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Protocol

from sqlalchemy import and_, func, or_, select

# ``import src.models`` FIRST — registration breaks the models↔notification
# import cycle (``src/models/__init__`` pulls notification models; the old
# ``DomainEvent`` re-export there died with #580 Task 6).
import src.models  # noqa: F401
from src.core.config import settings
from src.db.database import DBManager
from src.domain_events.models import DomainEvent
from src.domain_events.types import stream_key
from src.streams.transport import (
    MAXLEN_APPROX,
    StreamTransport,
    StreamTransportError,
    connect_or_exit,
)
from src.util.process import install_signal_handlers, run_loop
from src.util.utc import utc_now

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

# The domain-events logger convention (src/domain_events/journal.py):
# "memo.domain_events.<module>", independent of import paths.
logger = logging.getLogger("memo.domain_events.relay")

#: Relay batch (spec §3.3): rows per tick — deliberately a module
#: constant, NOT a setting (the batch/policy precedent of notification).
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


async def _publish_one(transport: _Publisher, event: DomainEvent, *, on_poison: str) -> None:
    """XADD one journal row into the stream of its type (§4.1; every
    Redis call goes through ``asyncio.to_thread``) with the §3.3-step-3
    failure volumes:

    - a TRANSPORT failure propagates — GLOBAL, not per-event: the caller
      leaves its batch/window unmarked and retries it whole;
    - a per-event NON-transport failure (an irreparable payload — a code
      bug) is isolated: ERROR log (``on_poison`` — the action tail of
      the line, loop vs recovery), and the CALLER marks the row
      published so one broken row cannot block the tail/window forever.
    """
    try:
        await asyncio.to_thread(transport.publish, stream_key(event.type), stream_record(event))
    except StreamTransportError:
        raise
    except Exception as exc:
        logger.error(
            "%s: event %s (type %s) failed with a non-transport error (%s: %s) — %s",
            LOG_PREFIX,
            event.id,
            event.type,
            type(exc).__name__,
            exc,
            on_poison,
        )


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
            # a transport failure propagates GLOBAL: nothing is marked,
            # nothing is committed — the session closes with the
            # uncommitted marks discarded, the next tick retries the
            # batch; a poisoned row is logged and marked (§3.3 step 3).
            await _publish_one(
                transport,
                event,
                on_poison=(
                    "marked published to unblock the tail; re-emit"
                    " with --republish-since after the fix"
                ),
            )
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


# ── Task 7 (§3.3/§4.5): --republish-since — the recovery run ─────────────────


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """The entry's CLI: the publish loop by default, the recovery flag
    aside. ``argv`` is normally injected by the caller: ``main`` passes
    ``[]`` on its programmatic seam (None → argparse would read the
    HOST process's ``sys.argv`` — under pytest that is pytest's own
    command line); only the ``__main__`` block hands over the real
    ``sys.argv[1:]``."""
    parser = argparse.ArgumentParser(
        prog="python -m src.domain_events.relay",
        description=(
            "Domain-events relay (spec §3.3): the journal→stream publish"
            " loop; --republish-since runs the Redis-loss recovery (§4.5)."
        ),
    )
    parser.add_argument(
        "--republish-since",
        metavar="ISO",
        default=None,
        help=(
            "recovery (§4.5): re-emit journal events with occurred_at >="
            " ISO — the dry-run count is printed first, then windows ≤"
            " MAXLEN; duplicate delivery is absorbed by subscriber"
            " idempotency"
        ),
    )
    return parser.parse_args(argv)


def parse_since(value: str) -> datetime:
    """Parse the ``--republish-since`` point into the journal's storage
    convention — naive UTC: an aware ISO instant (``Z`` or an explicit
    offset) is converted to UTC and stripped, a naive value is taken as
    UTC verbatim. Garbage fails LOUDLY (``ValueError``) — a silently
    mis-parsed recovery point would re-emit the wrong half of the
    journal."""
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"--republish-since: {value!r} is not an ISO datetime") from exc
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(UTC).replace(tzinfo=None)
    return parsed


async def republish_since(
    session_factory: async_sessionmaker[AsyncSession],
    transport: _Publisher,
    since: datetime,
    *,
    window: int = MAXLEN_APPROX,
) -> int:
    """The recovery run behind ``--republish-since`` (§3.3/§4.5).

    Redis lost — wiped streams/groups, or a subscriber backlogged past
    the MAXLEN trim: re-emit the journal, the archive, from the loss
    point. The boundary is INCLUSIVE — ``occurred_at >= since`` (rows
    before the point are never touched). The matching rows are counted
    and logged FIRST (the dry-run count), then re-emitted in windows of
    at most ``window`` rows (default MAXLEN_APPROX — rev.2: one
    continuous flow would trim its own head under the stream ceiling)
    with ``published_at`` marked and committed BETWEEN windows: a
    completed window stays durable when the run dies mid-window, and
    the resume re-emits from the top — at-least-once, the duplicates of
    §4.3 that subscriber idempotency absorbs.

    Returns the dry-run count of matching rows.
    """
    async with session_factory() as session:
        total = (
            await session.execute(
                select(func.count())
                .select_from(DomainEvent)
                .where(DomainEvent.occurred_at >= since)
            )
        ).scalar_one()
        logger.info(
            "%s: --republish-since %s — dry-run count: %d row(s) match (occurred_at >= point)",
            LOG_PREFIX,
            since.isoformat(),
            total,
        )
        # Keyset cursor over (occurred_at, id): the matching rows are
        # usually ALREADY published (Redis died, not the journal), so
        # the ``published_at IS NULL`` state of relay_once cannot be
        # the cursor here — windows advance by row position.
        cursor_occurred: datetime | None = None
        cursor_id: str | None = None
        done = 0
        window_no = 0
        while True:
            stmt = (
                select(DomainEvent)
                .where(DomainEvent.occurred_at >= since)
                .order_by(DomainEvent.occurred_at, DomainEvent.id)
                .limit(window)
            )
            if cursor_occurred is not None and cursor_id is not None:
                stmt = stmt.where(
                    or_(
                        DomainEvent.occurred_at > cursor_occurred,
                        and_(
                            DomainEvent.occurred_at == cursor_occurred,
                            DomainEvent.id > cursor_id,
                        ),
                    )
                )
            batch = (await session.execute(stmt)).scalars().all()
            if not batch:
                break
            marked_at = utc_now()
            for event in batch:
                # a transport failure propagates GLOBAL: the window
                # stays unmarked — the completed windows behind it stay
                # committed; re-run the recovery after the outage,
                # duplicates are absorbed (§4.3).
                await _publish_one(
                    transport,
                    event,
                    on_poison=("marked published during republish — the window keeps moving"),
                )
                event.published_at = marked_at
            # the keyset cursor is captured BEFORE commit — an
            # expire-on-commit session must not turn the next window's
            # continuation into a lazy refresh
            last = batch[-1]
            cursor_occurred, cursor_id = last.occurred_at, last.id
            await session.commit()
            window_no += 1
            done += len(batch)
            logger.info(
                "%s: republish window %d complete — %d/%d row(s) re-emitted",
                LOG_PREFIX,
                window_no,
                done,
                total,
            )
            if len(batch) < window:
                break
        return total


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


async def main(transport: _Publisher | None = None, argv: list[str] | None = None) -> None:
    """``python -m src.domain_events.relay [--republish-since <ISO>]``.

    Default (no flag): the publish loop. Disabled
    (``DOMAIN_EVENTS_ENABLED=false``, the default): log and return 0 —
    events keep accumulating in the journal (§4.5: the cursor is the
    row state, so a later start publishes everything).

    ``--republish-since <ISO>`` (§4.5): the one-shot Redis-loss
    recovery — :func:`republish_since`, then exit. An EXPLICIT operator
    action, so it does NOT wait for ``DOMAIN_EVENTS_ENABLED``: during
    an incident the typed flag IS the intent, and a silent no-op would
    hide the recovery behind an env toggle.

    Adapter selection (the ``connect_or_exit`` gate, §3.6): no injected
    transport → build the streams core over ``REDIS_URL`` and refuse
    the process LOUDLY (``SystemExit(2)``, stable message, the URL
    value never disclosed) when the transport is not configured or
    unreachable. An explicitly injected transport (the test seam)
    skips selection entirely.

    ``argv`` — the CLI args; ``None`` (the programmatic/test seam) means
    NO flags: the loop path. Only the ``__main__`` block injects the
    real ``sys.argv[1:]`` (argparse's implicit pickup would read the
    host process's command line — under pytest, pytest's own)."""
    args = parse_args(argv if argv is not None else [])

    if args.republish_since is not None:
        try:
            since = parse_since(args.republish_since)
        except ValueError as exc:
            raise SystemExit(f"error: {exc}") from None
        logger.info(
            "%s starting (recovery: --republish-since %s)",
            LOG_PREFIX,
            since.isoformat(),
        )
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
        try:
            await republish_since(manager.async_session, transport, since)
        finally:
            await manager.engine.dispose()
        return

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
        asyncio.run(main(argv=sys.argv[1:]))
    except KeyboardInterrupt:
        logger.info("%s: interrupted — stopped", LOG_PREFIX)
