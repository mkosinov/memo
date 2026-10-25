"""GH #483 Task 6 (spec §4 S4, §3.1; family #476 §4.2/§4.4): surviving a
FULL Redis wipe — the dispatcher's DB re-enqueue cycle against the real
adapter.

The scenario: a «queued» notify task lives in the DB (part-1 models);
its payload was already handed to the real stream (the enqueue point).
The transport is then wiped COMPLETELY — ``FLUSHDB`` of the contour's
own dedicated DB index, harder than any partial failure: no streams, no
groups, no PEL. Once ``updated_at`` ages past
``NOTIFY_REENQUEUE_AFTER`` (aged directly via raw SQL — determinism, no
two-minute wait), one run of ``reenqueue_stale_tasks`` must bring the
task back into the stream: ≥ 1 entry with the correct §4.2 payload —
NOT an exact count (an at-least-once duplicate is accepted, family
§4.4). A task whose ``updated_at`` is fresh is NOT re-enqueued by the
same sweep — nothing crosses the threshold «не раньше
NOTIFY_REENQUEUE_AFTER».

Isolation (§3.6): the module owns a DEDICATED DB index of the
``REDIS_URL`` instance (``_WIPE_DB_INDEX``) — the FLUSHDB target, wiped
before AND after every test. A dev contour on the default index
(dev.sh uses db 0) is untouched; redis defaults to 16 databases.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit, urlunsplit

import pytest
from redis import Redis
from sqlalchemy.ext.asyncio import async_sessionmaker

import src.models  # noqa: F401 — registration first; breaks the models↔notify import cycle
from src.notify import dispatcher
from src.notify.models import DomainEvent, NotifyTask
from src.notify.redis_queue import RedisQueue
from tests.conftest import query_db, query_db_params
from tests.notify_redis_support import redis_marks, redis_url

if TYPE_CHECKING:
    from collections.abc import Iterator

pytestmark = redis_marks

#: The S4 full-wipe DB index — FLUSHDB target owned by this module alone
#: (spec §3.6 dedicated-index isolation; a dev contour lives on db 0).
_WIPE_DB_INDEX = 15
#: Key prefix of the contour's streams inside the dedicated index.
_PREFIX = "t483s4:"
#: Re-enqueue window crossing is staged via raw SQL aging (300 s ≫ the
#: 120 s default of ``NOTIFY_REENQUEUE_AFTER``) — no waiting (§4 S4).
_AGE_SECONDS = 300


def _flush_url() -> str:
    """``REDIS_URL`` rewritten to the dedicated full-wipe index."""
    parts = urlsplit(redis_url())
    return urlunsplit(parts._replace(path=f"/{_WIPE_DB_INDEX}"))


@pytest.fixture
def wipe_client() -> Iterator[Redis]:
    """Raw client of the dedicated index — flushed before and after each
    test (the module owns the whole index: FLUSHDB is its own cleanup)."""
    client = Redis.from_url(_flush_url(), decode_responses=True)
    client.flushdb()
    yield client
    client.flushdb()
    client.close()


@pytest.fixture
def wipe_queue() -> Iterator[RedisQueue]:
    """The real adapter bound to the dedicated index — the producer of
    the pre-wipe enqueue and the queue the dispatcher cycle runs on."""
    queue = RedisQueue(_flush_url(), key_prefix=_PREFIX)
    yield queue
    queue.close()


def _session_factory(db_engine) -> async_sessionmaker:
    return async_sessionmaker(db_engine, expire_on_commit=False)


async def _stage_queued_task(db_session) -> NotifyTask:
    """A «queued» task row with frozen payload fields (the part-1
    shape); aging to the re-enqueue window is a separate raw-SQL step."""
    event = DomainEvent(
        type="new_record",
        occurred_at=datetime.now(UTC).replace(tzinfo=None),
        snapshot={},
    )
    db_session.add(event)
    await db_session.flush()
    task = NotifyTask(
        event_id=event.id,
        scenario="new_record",
        status="queued",
        channel="telegram",
        address="+7OLD",
        payload={"client": {"name": "Анна"}},
        template_id="06bd742e-56a7-4e4e-9f0e-3d5c0b6a1e11",
        template_body="{{ client.name }}",
        reenqueues=0,
    )
    db_session.add(task)
    await db_session.commit()
    return task


def _age_task(task_id: str, age_seconds: int = _AGE_SECONDS) -> None:
    """Rewind ``updated_at`` behind the re-enqueue predicate (raw SQL —
    determinism without waiting out ``NOTIFY_REENQUEUE_AFTER``, §4 S4)."""
    stale = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=age_seconds)
    query_db_params(
        "UPDATE notify_tasks SET updated_at = :u WHERE id = :i",
        {"u": stale.strftime("%Y-%m-%d %H:%M:%S.%f"), "i": task_id},
    )


def _dispatcher_payload(task: NotifyTask) -> dict[str, Any]:
    """The §4.2 rev.5 shape the dispatcher's enqueue point hands the
    adapter (one channel, frozen render data + template)."""
    return {
        "task_id": task.id,
        "channel": task.channel,
        "address": task.address,
        "payload": task.payload,
        "template_id": task.template_id,
        "template_body": task.template_body,
        "root_task_id": task.root_task_id,
        "created_at": "2026-10-21T10:00:00Z",
        "resend_of": task.resend_of,
    }


def _stream_payloads(client: Redis) -> list[dict[str, Any]]:
    """Everything currently in the task stream — the observation surface
    (XRANGE; after a FLUSHDB every entry can only come from the cycle)."""
    stream = f"{_PREFIX}notify:tasks"
    return [
        json.loads(fields["payload"])
        for _entry_id, fields in client.xrange(stream, min="-", max="+")
    ]


class TestRedisWipeSurvival:
    """S4: a full transport wipe is survived by the DB re-enqueue cycle."""

    async def test_aged_queued_task_returns_to_stream_after_full_wipe(
        self, db_engine, db_session, wipe_client, wipe_queue
    ) -> None:
        stale = await _stage_queued_task(db_session)
        fresh = await _stage_queued_task(db_session)
        for task in (stale, fresh):
            wipe_queue.enqueue_task(_dispatcher_payload(task))

        assert _stream_payloads(wipe_client) != []  # setup sanity: transport held both

        wipe_client.flushdb()  # THE wipe: streams, groups, PEL — everything
        assert _stream_payloads(wipe_client) == []  # the wipe actually wiped

        _age_task(stale.id)  # crosses the window; the fresh task does not

        await dispatcher.reenqueue_stale_tasks(_session_factory(db_engine), wipe_queue)

        payloads = _stream_payloads(wipe_client)
        assert len(payloads) >= 1  # ≥ 1, NOT an exact count — duplicates accepted (§4.4)
        for payload in payloads:
            assert payload["task_id"] == stale.id  # «не раньше»: fresh never crosses
            assert payload["channel"] == "telegram"
            assert payload["address"] == "+7OLD"
            assert payload["template_body"] == "{{ client.name }}"
            assert payload["resend_of"] is None
            assert payload["created_at"]
        row = query_db(f"SELECT status, reenqueues FROM notify_tasks WHERE id = '{stale.id}'")
        assert row == [{"status": "queued", "reenqueues": 1}]
        fresh_row = query_db(f"SELECT reenqueues FROM notify_tasks WHERE id = '{fresh.id}'")
        assert fresh_row[0]["reenqueues"] == 0

    async def test_immediate_second_sweep_does_not_reenqueue_again(
        self, db_engine, db_session, wipe_client, wipe_queue
    ) -> None:
        """«Не раньше NOTIFY_REENQUEUE_AFTER»: the re-enqueue stamp
        (``updated_at`` refresh) holds against the real transport — the
        very next sweep after the wipe adds no duplicate churn."""
        task = await _stage_queued_task(db_session)
        wipe_queue.enqueue_task(_dispatcher_payload(task))
        wipe_client.flushdb()  # full wipe, the task survives in the DB only
        _age_task(task.id)

        factory = _session_factory(db_engine)
        await dispatcher.reenqueue_stale_tasks(factory, wipe_queue)
        first = _stream_payloads(wipe_client)
        assert len(first) >= 1

        await dispatcher.reenqueue_stale_tasks(factory, wipe_queue)  # the next tick

        assert _stream_payloads(wipe_client) == first


class TestReenqueueWorkerPEL:
    """#485 Task 5 (family §3.3 rev.5): the predicate leg «не в PEL группы
    worker» — over the REAL adapter. A task the worker claimed and holds
    (channel pause, retry sleep) is NOT re-enqueued however stale its
    ``updated_at`` is; once the worker acks, the next sweep picks it up
    (no stamp was written while held)."""

    async def test_held_task_skipped_released_task_reenqueued(
        self, db_engine, db_session, wipe_client, wipe_queue
    ) -> None:
        task = await _stage_queued_task(db_session)
        wipe_queue.ensure_worker_group()
        wipe_queue.enqueue_task(_dispatcher_payload(task))

        claimed = wipe_queue.claim_tasks()  # the PEL of the worker group
        assert [p["task_id"] for p in claimed] == [task.id]
        _age_task(task.id)

        await dispatcher.reenqueue_stale_tasks(_session_factory(db_engine), wipe_queue)

        # held: exactly the ORIGINAL entry — no duplicate, no counter
        assert len(_stream_payloads(wipe_client)) == 1
        row = query_db(f"SELECT reenqueues FROM notify_tasks WHERE id = '{task.id}'")
        assert row[0]["reenqueues"] == 0

        wipe_queue.ack_task(claimed[0])  # the worker is done — ticket released
        await dispatcher.reenqueue_stale_tasks(_session_factory(db_engine), wipe_queue)

        assert len(_stream_payloads(wipe_client)) == 2  # the re-enqueue landed
        row = query_db(f"SELECT reenqueues FROM notify_tasks WHERE id = '{task.id}'")
        assert row[0]["reenqueues"] == 1

    async def test_missing_worker_group_probes_empty_and_proceeds(
        self, db_engine, db_session, wipe_client, wipe_queue
    ) -> None:
        """NOGROUP (a wiped transport, the worker group never created):
        the probe reads an EMPTY PEL — nothing was ever claimed — and
        the sweep proceeds (wipe survival, §4.4)."""
        task = await _stage_queued_task(db_session)
        wipe_queue.enqueue_task(_dispatcher_payload(task))
        wipe_client.flushdb()  # streams AND groups gone
        _age_task(task.id)

        assert wipe_queue.pending_worker_task_ids() == set()

        await dispatcher.reenqueue_stale_tasks(_session_factory(db_engine), wipe_queue)

        assert [p["task_id"] for p in _stream_payloads(wipe_client)] == [task.id]
