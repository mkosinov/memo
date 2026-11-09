"""GH #580 Task 4 (spec §3.3, §5.1/§5.3) — the relay against a REAL
Redis: the two DoD scenarios.

Scenario 1 ``test_domain_events_redis_publish``: журнал → XADD →
``published_at``. 25 events of one type inserted in REVERSE
``(occurred_at, id)`` order — the stream arrival is STRICTLY
``(occurred_at, id)`` and the batch ceiling is 20 per tick (the
successor of the notify poll test ``test_poll_respects_batch_size_and_
occurred_at_order``).

Scenario 3 ``test_domain_events_relay_restart``: the relay crashed
between XADD and the batch mark — the restart republishes the unmarked
row; the stream holds TWO entries of the event (the duplicate is REALLY
delivered — the test does not pass vacuously, §5.3 rev.2) and the
subscriber-side root-task uniqueness (the §4.2 partial unique index
``uq_notify_tasks_event_scenario_root``) absorbs it: ONE root task.

Marked ``redis`` with the declarative ``skipif`` guard over
``REDIS_URL``; per-test key-prefix workspace (tests/notify_redis_support).
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker

import src.models  # noqa: F401 — registration first; breaks the models↔notify import cycle
from src.domain_events import relay
from src.domain_events.models import DomainEvent
from src.notify.models import NotifyTask
from src.streams.transport import StreamTransport, StreamTransportError
from tests.conftest import query_db
from tests.notify_redis_support import (
    RedisContour,
    contour_fixture,
    redis_marks,
    redis_url,
)

pytestmark = redis_marks

contour = contour_fixture()  # per-test isolated workspace (GH #483 §3.6)


def _session_factory(db_engine):
    return async_sessionmaker(db_engine, expire_on_commit=False)


async def _stage_events(
    db_session, count: int, *, event_type: str = "new_record"
) -> list[DomainEvent]:
    """Scenario-1 data: rows INSERTED in REVERSE ``(occurred_at, id)``
    order — the first insert is the NEWEST; arrival must not inherit
    the insertion order."""
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


def _stream_entries(contour: RedisContour) -> list[dict]:
    full = f"{contour.prefix}domain_events:new_record"
    return [
        json.loads(fields["payload"])
        for _entry_id, fields in contour.client.xrange(full, min="-", max="+")
    ]


class _CrashAfterPublish:
    """The crash-between-XADD-and-mark stand-in (§5.3): the XADD REALLY
    lands in Redis, then the tick dies with the typed transport error —
    the batch is left unmarked."""

    def __init__(self, inner: StreamTransport) -> None:
        self._inner = inner

    def publish(self, stream: str, payload: dict) -> None:
        self._inner.publish(stream, payload)
        raise StreamTransportError(
            "streams transport failed during publish"
            " domain_events:new_record: ConnectionError: crash-after-xadd"
        )


class TestScenario1JournalToStream:
    async def test_domain_events_redis_publish(
        self, db_engine, db_session, contour: RedisContour
    ) -> None:
        full = f"{contour.prefix}domain_events:new_record"
        await _stage_events(db_session, count=25)
        factory = _session_factory(db_engine)
        transport = StreamTransport(redis_url(), key_prefix=contour.prefix)

        # tick 1 — the batch ceiling: exactly POLL_BATCH_SIZE goes out
        await relay.relay_once(factory, transport)
        assert contour.client.xlen(full) == relay.POLL_BATCH_SIZE == 20
        marked = query_db(
            "SELECT COUNT(*) AS n FROM domain_events WHERE published_at IS NOT NULL"
        )[0]["n"]
        assert marked == 20

        # tick 2 — the remainder drains, everything marked
        await relay.relay_once(factory, transport)
        assert contour.client.xlen(full) == 25
        assert (
            query_db(
                "SELECT COUNT(*) AS n FROM domain_events WHERE published_at IS NULL"
            )[0]["n"]
            == 0
        )

        # arrival — STRICTLY (occurred_at, id), insertion order reversed
        expected = [
            row["id"]
            for row in query_db("SELECT id FROM domain_events ORDER BY occurred_at, id")
        ]
        assert [record["event_id"] for record in _stream_entries(contour)] == expected

        # §4.1 record contract — the first arrival is self-sufficient
        first = _stream_entries(contour)[0]
        row = query_db(
            f"SELECT id, type, occurred_at, snapshot FROM domain_events"
            f" WHERE id = '{first['event_id']}'"
        )[0]
        assert set(first) == {"event_id", "type", "occurred_at", "snapshot"}
        assert first["type"] == "new_record"
        assert first["occurred_at"] == datetime.fromisoformat(row["occurred_at"]).isoformat()
        assert first["snapshot"] == json.loads(row["snapshot"])


class TestScenario3RelayRestart:
    async def test_domain_events_relay_restart(
        self, db_engine, db_session, contour: RedisContour
    ) -> None:
        (event,) = await _stage_events(db_session, count=1)
        # captured BEFORE the rollback below — rollback expires ORM
        # instances and a later sync attribute access would lazy-refresh
        # outside an awaitable context (MissingGreenlet).
        event_id = event.id
        factory = _session_factory(db_engine)
        healthy = StreamTransport(redis_url(), key_prefix=contour.prefix)
        full = f"{contour.prefix}domain_events:new_record"

        # the crash: XADD landed, the batch never marked
        with pytest.raises(StreamTransportError):
            await relay.relay_once(factory, _CrashAfterPublish(healthy))
        assert contour.client.xlen(full) == 1  # the XADD really happened
        assert (
            query_db(
                "SELECT COUNT(*) AS n FROM domain_events WHERE published_at IS NULL"
            )[0]["n"]
            == 1
        )

        # the restart: the unmarked row republishes (duplicate) + marks
        await relay.relay_once(factory, healthy)
        entries = _stream_entries(contour)
        assert len(entries) == 2  # the duplicate is REALLY delivered (§5.3)
        assert {record["event_id"] for record in entries} == {event_id}
        assert (
            query_db(
                "SELECT COUNT(*) AS n FROM domain_events WHERE published_at IS NULL"
            )[0]["n"]
            == 0
        )

        # the duplicate does NOT create a second root task: the §4.2
        # partial unique index uq_notify_tasks_event_scenario_root (the
        # subscriber idempotency seam, wired into the group loop by
        # #580 Task 6) rejects the second root of the same event.
        root = NotifyTask(
            event_id=event_id,
            scenario="new_record",
            status="skipped",
            channel="mock",
            address="+79990001122",
            payload={},
            template_id=str(uuid.uuid4()),
            template_body="t",
        )
        db_session.add(root)
        await db_session.commit()

        duplicate = NotifyTask(
            event_id=event_id,
            scenario="new_record",
            status="skipped",
            channel="mock",
            address="+79990001122",
            payload={},
            template_id=str(uuid.uuid4()),
            template_body="t",
        )
        db_session.add(duplicate)
        with pytest.raises(IntegrityError):
            await db_session.flush()
        await db_session.rollback()

        roots = query_db(
            f"SELECT id FROM notify_tasks WHERE event_id = '{event_id}'"
            f" AND parent_task_id IS NULL"
        )
        assert len(roots) == 1  # ONE root task despite the duplicate delivery
