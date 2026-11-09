"""GH #580 Task 7 (spec §3.3/§4.5, §5 Scenario 5) — Redis WIPED: the
recovery contour on a real transport.

The scenario (modelled on ``test_notify_redis_s8_recovery`` — a
marked-integration crash story on the real Redis):

- normal life first: the relay publishes the journal, the notification
  subscriber consumes through its group and materializes ONE root task
  per event (§3.5);
- THE WIPE: the stream key is deleted — entries AND the group are gone
  (the ``NOGROUP``/lost-delivery state of §4.5);
- the subscriber restart recreates the group on the MISSING key
  (``XGROUP CREATE id=0 MKSTREAM`` — the NOGROUP recovery already in
  the transport core; a claim on the recreated group is a clean empty
  reply, not an error);
- ``republish_since`` (the ``--republish-since`` engine) restores the
  delivery from the journal — the archive: the dry-run COUNT is logged
  first, then windows ≤ MAXLEN with ``published_at`` marked BETWEEN
  windows (window=2 over 3 rows → two windows, both visible in the
  log);
- the boundary is INCLUSIVE ``occurred_at >= point``: the event AT the
  point is re-emitted, the event OLDER than the point is NOT — neither
  into the stream nor re-stamped in the journal;
- the re-delivery is the accepted duplicate of §4.3: every re-claimed
  event already has its root — the §4.2 partial unique index
  ``uq_notify_tasks_event_scenario_root`` rejects the second root
  (IntegrityError → «already processed» → ack, the Task-6 loop), so
  exactly ONE root per event survives the whole story.

Marked ``redis`` with the declarative ``REDIS_URL`` guard (§3.6); each
test works in its own key-prefix workspace (``contour`` fixture) and
cleans up after itself.
"""

from __future__ import annotations

import json
import logging
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker

import src.models  # noqa: F401 — registration first; breaks the models↔notify import cycle
from src.domain_events import relay
from src.domain_events.models import DomainEvent
from src.domain_events.subscribe import Subscriber
from src.domain_events.types import stream_key
from src.notify.models import NotifyTask
from src.streams.transport import StreamTransport
from tests.conftest import query_db
from tests.notify_redis_support import (
    RedisContour,
    contour_fixture,
    redis_marks,
    redis_url,
)

if TYPE_CHECKING:
    from collections.abc import Iterator

pytestmark = redis_marks

contour = contour_fixture()  # per-test isolated workspace (§3.6)

#: The pilot type's stream — ``domain_events:new_record`` (§3.2).
_STREAM = stream_key("new_record")
#: The subscriber of the scenario — the dispatcher's group name
#: (``NOTIFICATION_GROUP``, §3.5); spelled here so the domain_events
#: test does not import the notify dispatcher module.
_GROUP = "notification"

#: The fixed recovery point (naive UTC — the journal storage
#: convention): one event before it, one AT it (the inclusive ``>=``
#: boundary), two after.
_POINT = datetime(2026, 11, 9, 12, 0, 0)


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
    lg = logging.getLogger("memo.domain_events.relay")
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


def _full(contour: RedisContour) -> str:
    return f"{contour.prefix}{_STREAM}"


def _stream_entries(contour: RedisContour) -> list[dict]:
    return [
        json.loads(fields["payload"])
        for _entry_id, fields in contour.client.xrange(_full(contour), min="-", max="+")
    ]


def _root(event_id: str) -> NotifyTask:
    """A §4.2 root task of one claimed event (the materialization the
    dispatcher performs before ack; ``status=skipped`` — the transport
    scenario needs no channel work)."""
    return NotifyTask(
        event_id=event_id,
        scenario="new_record",
        status="skipped",
        channel="mock",
        address="+79990001122",
        payload={},
        template_id=str(uuid.uuid4()),
        template_body="t",
    )


def _root_count() -> int:
    return int(
        query_db("SELECT COUNT(*) AS n FROM notify_tasks WHERE parent_task_id IS NULL")[0]["n"]
    )


class TestScenario5WipeRecovery:
    async def test_domain_events_wipe_recovery(
        self, db_engine, db_session, contour: RedisContour
    ) -> None:
        full = _full(contour)
        factory = async_sessionmaker(db_engine, expire_on_commit=False)
        transport = StreamTransport(redis_url(), key_prefix=contour.prefix)

        # ── stage: the boundary data around the recovery point ──────
        old = DomainEvent(
            type="new_record",
            occurred_at=_POINT - timedelta(hours=1),
            snapshot={"who": "old"},
        )
        at_point = DomainEvent(type="new_record", occurred_at=_POINT, snapshot={"who": "at"})
        after1 = DomainEvent(
            type="new_record",
            occurred_at=_POINT + timedelta(minutes=1),
            snapshot={"who": "after1"},
        )
        after2 = DomainEvent(
            type="new_record",
            occurred_at=_POINT + timedelta(minutes=2),
            snapshot={"who": "after2"},
        )
        db_session.add_all([old, at_point, after1, after2])
        await db_session.commit()
        # captured before any rollback expires the ORM instances
        old_id, at_id = old.id, at_point.id
        matching = [at_id, after1.id, after2.id]

        # ── normal life: the relay publishes, the subscriber consumes ─
        await relay.relay_once(factory, transport)
        assert contour.client.xlen(full) == 4
        old_stamp = query_db(f"SELECT published_at FROM domain_events WHERE id = '{old_id}'")[0][
            "published_at"
        ]

        first = Subscriber(redis_url(), _GROUP, key_prefix=contour.prefix)
        first.ensure([_STREAM])
        claimed = first.claim([_STREAM], count=10)
        assert len(claimed) == 4  # the whole pre-wipe history (id=0 group)
        for event in claimed:
            db_session.add(_root(event.event_id))
            first.ack(_STREAM, event.qid)
        await db_session.commit()
        first.close()
        assert _root_count() == 4

        # ── THE WIPE: the stream key dies — entries AND the group ────
        contour.client.delete(full)
        assert not contour.client.exists(full)

        # ── subscriber restart: the group is recreated on the missing
        # key (XGROUP CREATE id=0 MKSTREAM — the NOGROUP path of the
        # core); a claim on the recreated group is clean and empty.
        second = Subscriber(redis_url(), _GROUP, key_prefix=contour.prefix)
        second.ensure([_STREAM])
        assert second.claim([_STREAM], count=10) == []

        # ── the recovery run: dry-run count → windows, marked between ─
        with capture_relay_logs() as messages:
            total = await relay.republish_since(factory, transport, _POINT, window=2)

        assert total == 3
        assert any("dry-run count: 3 row(s) match" in m for m in messages), messages
        # window=2 over 3 rows → TWO windows, each marked before the next
        assert any("window 1 complete — 2/3" in m for m in messages), messages
        assert any("window 2 complete — 3/3" in m for m in messages), messages

        # the stream holds EXACTLY the rows >= point, in (occurred_at, id)
        # order — the older event is NOT re-emitted
        assert [record["event_id"] for record in _stream_entries(contour)] == matching
        # ...and its journal row keeps the original mark (never touched)
        assert (
            query_db(f"SELECT published_at FROM domain_events WHERE id = '{old_id}'")[0][
                "published_at"
            ]
            == old_stamp
        )

        # ── re-delivery: the recreated group hands out the recovery ──
        redelivered = second.claim([_STREAM], count=10)
        assert [event.event_id for event in redelivered] == matching

        # the duplicate delivery is ABSORBED: every root already exists
        # (§4.2 partial unique index — IntegrityError → «already
        # processed» → ack, the Task-6 dispatcher loop)
        for event in redelivered:
            db_session.add(_root(event.event_id))
            with pytest.raises(IntegrityError):
                await db_session.flush()
            await db_session.rollback()
            second.ack(_STREAM, event.qid)
        assert _root_count() == 4  # ONE root per event — no duplicates

        assert second.claim([_STREAM], count=10) == []  # drained
        second.close()
