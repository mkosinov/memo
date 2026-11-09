"""GH #580 Task 4 (spec §3.3) — the relay cycle, unit contour: a fake
publisher (no Redis) over the real test DB.

The batch mechanics under test:

- the batch predicate/ceiling: ``published_at IS NULL ORDER BY
  occurred_at, id LIMIT 20`` — one tick publishes at most 20;
- arrival order strictly ``(occurred_at, id)`` regardless of the
  INSERTION order (scenario 1 stage the reverse);
- a TRANSPORT failure aborts the batch UNMARKED (next tick re-publishes
  — the at-least-once duplicate of §4.3) and propagates to the loop
  guard;
- a per-event NON-transport failure (an irreparable payload — a code
  bug) marks its row published with an ERROR log: one broken row must
  not block the tail forever (§3.3 step 3);
- every tick logs the unpublished tail depth (rev.2, panel).
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

import src.models  # noqa: F401 — registration first; breaks the models↔notify import cycle
from src.domain_events import relay
from src.domain_events.models import DomainEvent
from src.streams.transport import StreamTransportError
from tests.conftest import query_db

if TYPE_CHECKING:
    from collections.abc import Iterator

pytestmark = pytest.mark.integration

_LOGGER_NAME = "memo.domain_events.relay"


class _ListHandler(logging.Handler):
    """In-memory sink — caplog is unusable in this repo (the session
    schema setup runs alembic/env.py whose ``fileConfig`` drops
    collection-time loggers)."""

    def __init__(self) -> None:
        super().__init__()
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(record.getMessage())


@contextmanager
def capture_relay_logs() -> Iterator[list[str]]:
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


class FakePublisher:
    """In-memory publisher seam — records ``(stream, payload)`` pairs."""

    def __init__(self) -> None:
        self.published: list[tuple[str, dict[str, Any]]] = []

    def publish(self, stream: str, payload: dict[str, Any]) -> None:
        self.published.append((stream, payload))


class CrashAfterFirstPublish(FakePublisher):
    """XADD #1 really lands, then the transport dies mid-batch (§4.3:
    the crash-between-XADD-and-mark window)."""

    def publish(self, stream: str, payload: dict[str, Any]) -> None:
        super().publish(stream, payload)
        if len(self.published) == 1:
            raise StreamTransportError(
                "streams transport failed during publish"
                " domain_events:new_record: ConnectionError: crash-after-xadd"
            )


class BrokenPayloadPublisher(FakePublisher):
    """Raises a NON-transport error for one poisoned row (snapshot
    ``seq == 1``) — the per-event brak branch (§3.3 step 3)."""

    def publish(self, stream: str, payload: dict[str, Any]) -> None:
        if payload["snapshot"]["seq"] == 1:
            raise ValueError("unserializable payload — a code bug")
        super().publish(stream, payload)


def _session_factory(db_engine):
    return async_sessionmaker(db_engine, expire_on_commit=False)


async def _stage_events(
    db_session, count: int, *, event_type: str = "new_record"
) -> list[DomainEvent]:
    """Stage ``count`` events INSERTED IN REVERSE ``(occurred_at, id)``
    order: the first row inserted carries the NEWEST ``occurred_at``
    (scenario 1 data — the insertion order must not leak into arrival)."""
    base = datetime.now(UTC).replace(tzinfo=None)
    events: list[DomainEvent] = []
    for i in range(count):
        event = DomainEvent(
            type=event_type,
            occurred_at=base - timedelta(seconds=i + 1),
            snapshot={"seq": i},
        )
        events.append(event)
        db_session.add(event)
    await db_session.commit()
    return events


def _counts() -> tuple[int, int]:
    rows = query_db(
        "SELECT"
        " SUM(CASE WHEN published_at IS NOT NULL THEN 1 ELSE 0 END) AS published,"
        " SUM(CASE WHEN published_at IS NULL THEN 1 ELSE 0 END) AS unpublished"
        " FROM domain_events"
    )
    row = rows[0]
    return int(row["published"] or 0), int(row["unpublished"] or 0)


class TestRelayBatch:
    async def test_batch_ceiling_is_20_per_tick(self, db_engine, db_session) -> None:
        await _stage_events(db_session, count=25)
        publisher = FakePublisher()

        await relay.relay_once(_session_factory(db_engine), publisher)

        assert len(publisher.published) == relay.POLL_BATCH_SIZE == 20
        published, unpublished = _counts()
        assert (published, unpublished) == (20, 5)

    async def test_arrival_order_is_strictly_occurred_at_id(
        self, db_engine, db_session
    ) -> None:
        await _stage_events(db_session, count=25)  # inserted REVERSE
        publisher = FakePublisher()
        factory = _session_factory(db_engine)

        while _counts()[1]:
            await relay.relay_once(factory, publisher)

        expected = [
            row["id"]
            for row in query_db(
                "SELECT id FROM domain_events ORDER BY occurred_at, id"
            )
        ]
        got = [payload["event_id"] for _stream, payload in publisher.published]
        assert got == expected
        # every record went to the stream of its type (§4.1)
        assert {stream for stream, _ in publisher.published} == {
            "domain_events:new_record"
        }

    async def test_idle_tick_publishes_nothing(self, db_engine) -> None:
        publisher = FakePublisher()

        await relay.relay_once(_session_factory(db_engine), publisher)

        assert publisher.published == []


class TestRelayTransportFailure:
    async def test_batch_left_unmarked_next_tick_republishes(
        self, db_engine, db_session
    ) -> None:
        """§4.3: a transport failure mid-batch → the WHOLE batch stays
        unmarked; the next tick re-publishes from the top — the already
        XADDed row is delivered TWICE (the accepted duplicate)."""
        await _stage_events(db_session, count=3)
        factory = _session_factory(db_engine)
        crash = CrashAfterFirstPublish()

        with pytest.raises(StreamTransportError):
            await relay.relay_once(factory, crash)

        # XADD #1 landed, but NOTHING is marked — the batch is whole
        assert len(crash.published) == 1
        assert _counts() == (0, 3)

        healthy = FakePublisher()
        healthy.published.extend(crash.published)  # same "stream" continuity
        await relay.relay_once(factory, healthy)

        # all marked, and the first row was published TWICE — 4 records
        assert _counts() == (3, 0)
        ids = [payload["event_id"] for _s, payload in healthy.published]
        assert len(ids) == len(set(ids)) + 1  # exactly one duplicate
        assert len(healthy.published) == 4


class TestRelayNonTransportFailure:
    async def test_poisoned_row_marked_published_and_tail_proceeds(
        self, db_engine, db_session
    ) -> None:
        """One irreparable row (a code bug, not a transport outage) is
        marked published with an ERROR log — a single broken row must
        not block the tail forever; the healthy siblings publish."""
        events = await _stage_events(db_session, count=3)
        poisoned = next(e for e in events if e.snapshot["seq"] == 1)
        publisher = BrokenPayloadPublisher()

        with capture_relay_logs() as messages:
            await relay.relay_once(_session_factory(db_engine), publisher)

        assert _counts() == (3, 0)  # the poisoned row is marked too
        # the rows are staged NEWEST-FIRST, so arrival is oldest-first:
        # seq 2, then the poisoned seq 1 (skipped), then seq 0
        seqs = [payload["snapshot"]["seq"] for _s, payload in publisher.published]
        assert seqs == [2, 0]  # siblings published in arrival order
        assert any(poisoned.id in m for m in messages), messages


class TestRelayTailDepthLog:
    async def test_every_tick_logs_the_unpublished_tail_depth(
        self, db_engine, db_session
    ) -> None:
        """rev.2 (panel): the backlog depth is visible to the operator
        every tick — after a ceiling-limited tick over 25 rows the tail
        of 5 is logged."""
        await _stage_events(db_session, count=25)

        with capture_relay_logs() as messages:
            await relay.relay_once(_session_factory(db_engine), FakePublisher())

        assert any("tail depth 5" in m for m in messages), messages
