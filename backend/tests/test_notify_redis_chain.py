"""#485 Task 5 — the CHANNEL CHAIN contour (part-4 spec §8, §13; family
#476 US-5) over the real ``RedisQueue``: первый канал упал → диспетчер
спавнит задачу следующего канала → успех/исчерпание с итогом на корне.

The S7 module (worker-side terminal failures) stops at «the NEXT
channel is the dispatcher chain, part 4 Task 5» — this module IS that
continuation, end to end through both real seam halves:

- worker half: ONE ``delivery_once`` per channel task (instances
  injected; the two channels differ by CLASS, not by address — the
  chain INHERITS the root address, so MockChannel's per-address
  scripting cannot script «fail on channel 1, deliver on channel 2»);
- dispatcher half: ``statuses_once`` applies the reports — spawns the
  continuation (fresh template freeze, inherited payload/address),
  enqueues it after the commit, and materializes the chain outcome on
  the root (``delivered`` / ``not_delivered``).

DoD (spec §13): цепочка (падение канала 1 → задача канала 2 → успех /
исчерпание с итогом на корне); повторный отчёт не дублирует задачу;
отчёты пишут ``sent_text`` в попытки.

Marked ``redis`` with the declarative ``REDIS_URL`` guard (§3.6): each
test works in its own key-prefix workspace (``contour`` fixture) and
cleans up after itself.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import async_sessionmaker

import src.models  # noqa: F401 — registration first; breaks the models↔notify import cycle
from src.core.config import settings
from src.notify import dispatcher, worker
from src.notify.channels.base import ChannelAppError, ChannelLimits
from src.notify.channels.mock import MOCK_LIMITS
from src.notify.models import DomainEvent, NotifyTask, NotifyTemplate
from src.notify.redis_queue import TASKS_STREAM
from tests.conftest import query_db
from tests.notify_redis_support import RedisContour, contour_fixture, redis_marks

if TYPE_CHECKING:
    from src.notify.assembly import EscapeMode

pytestmark = redis_marks

contour = contour_fixture()  # per-test isolated workspace fixture (§3.6)

_TEXT_ROOT = "Цепочка: замороженный текст канала 1"
_TEXT_SECOND = "Цепочка: свежая заморозка канала 2"
_ADDRESS = "+79990001122"


class _AppErrorChannel:
    """Channel 1 of the contour: every send is an application failure —
    closes the channel task after ONE attempt (no transport retries)."""

    name = "mock1"
    escape_mode: EscapeMode = "none"
    limits: ChannelLimits = MOCK_LIMITS

    async def is_available(self) -> bool:
        return True

    async def send(
        self, address: str, text: str, *, template_channel: str | None = None
    ) -> None:
        raise ChannelAppError(f"scripted app failure for {address}")


class _OkChannel:
    """Channel 2 of the contour: records the delivery."""

    name = "mock2"
    escape_mode: EscapeMode = "none"
    limits: ChannelLimits = MOCK_LIMITS

    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    async def is_available(self) -> bool:
        return True

    async def send(
        self, address: str, text: str, *, template_channel: str | None = None
    ) -> None:
        self.sent.append((address, text))


def _iso_z(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _session_factory(db_engine) -> async_sessionmaker:
    return async_sessionmaker(db_engine, expire_on_commit=False)


async def _stage_root_task(db_session) -> NotifyTask:
    """The queued FIRST task of a chain (channel ``mock1``) with the
    frozen root payload — the S7 staging pattern."""
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
        channel="mock1",
        address=_ADDRESS,
        payload={},
        template_id="06bd742e-56a7-4e4e-9f0e-3d5c0b6a1e11",
        template_body=_TEXT_ROOT,
        reenqueues=0,
    )
    db_session.add(task)
    await db_session.commit()
    return task


async def _seed_second_channel_template(db_session) -> str:
    """A channel-tier template for ``mock2`` — the FRESH freeze of the
    continuation. A literal body: the worker assembles from it against
    an empty payload, the assembled text is then assertable."""
    template = NotifyTemplate(
        event_type="new_record",
        channel="mock2",
        title="шаблон канала 2",
        body=_TEXT_SECOND,
    )
    db_session.add(template)
    await db_session.commit()
    return template.id


def _root_payload(task: NotifyTask) -> dict:
    """The hand-crafted §4.2 rev.5 payload of the root task (spec §3.6)."""
    return {
        "task_id": task.id,
        "channel": "mock1",
        "address": _ADDRESS,
        "payload": {},
        "template_id": task.template_id,
        "template_body": _TEXT_ROOT,
        "root_task_id": task.id,
        "created_at": _iso_z(datetime.now(UTC)),
        "resend_of": None,
    }


def _task_row(task_id: str, *cols: str) -> dict:
    col_list = ", ".join(cols)
    rows = query_db(f"SELECT {col_list} FROM notify_tasks WHERE id = '{task_id}'")
    assert rows, f"task {task_id} not found"
    return rows[0]


def _attempt_texts(task_id: str) -> list[tuple[str, str | None]]:
    """(stage, sent_text) of the append-only attempt journal in write
    order — the DoD check «отчёты пишут sent_text»."""
    rows = query_db(
        f"SELECT stage, sent_text FROM notify_task_attempts WHERE task_id = '{task_id}'"
        " ORDER BY occurred_at, rowid"
    )
    return [(r["stage"], r["sent_text"]) for r in rows]


def _stream_task_ids(contour: RedisContour) -> list[str]:
    """Task ids of every entry ever added to the contour's task stream
    (XRANGE — acking does not remove entries)."""
    entries = contour.client.xrange(f"{contour.prefix}{TASKS_STREAM}", min="-", max="+")
    return [json.loads(fields["payload"])["task_id"] for _id, fields in entries]


class TestChainSuccess:
    """Падение канала 1 → задача канала 2 → успех: the root ends
    ``delivered``, the continuation carries the fresh freeze, the
    delivery went out on the SECOND channel with the SECOND text."""

    async def test_first_channel_falls_second_delivers_root_delivered(
        self, db_engine, db_session, contour, monkeypatch
    ) -> None:
        monkeypatch.setattr(settings, "NOTIFY_CHANNEL_PRIORITY", "mock1,mock2")
        template_id = await _seed_second_channel_template(db_session)
        root = await _stage_root_task(db_session)

        queue = contour.queue()
        queue.ensure_worker_group()
        queue.ensure_consumer_groups()  # the dispatcher side reads the statuses
        queue.enqueue_task(_root_payload(root))

        ok = _OkChannel()
        channels = {"mock1": _AppErrorChannel(), "mock2": ok}

        # channel 1: one attempt, app error, terminal — reports published
        await worker.delivery_once(queue, channels, asyncio.Event())
        assert ok.sent == []  # nothing reached channel 2 yet

        # the dispatcher: applies the reports, spawns + enqueues mock2
        await dispatcher.statuses_once(_session_factory(db_engine), queue)

        rows = query_db(
            "SELECT id, status, root_task_id, parent_task_id, template_id,"
            " template_body, address FROM notify_tasks WHERE channel = 'mock2'"
        )
        assert len(rows) == 1
        spawned = rows[0]
        assert spawned["status"] == "queued"
        assert spawned["root_task_id"] == root.id
        assert spawned["parent_task_id"] == root.id
        assert spawned["template_id"] == template_id  # FRESH freeze
        assert spawned["template_body"] == _TEXT_SECOND
        assert spawned["address"] == _ADDRESS  # inherited, never re-resolved
        assert _task_row(root.id, "delivery_outcome")["delivery_outcome"] is None

        # channel 2: delivers the freshly-frozen text
        await worker.delivery_once(queue, channels, asyncio.Event())
        assert ok.sent == [(_ADDRESS, _TEXT_SECOND)]

        # the dispatcher: the chain outcome lands on the root
        await dispatcher.statuses_once(_session_factory(db_engine), queue)
        assert _task_row(root.id, "delivery_outcome")["delivery_outcome"] == "delivered"
        assert _task_row(spawned["id"], "status")["status"] == "sent"

        # DoD «отчёты пишут sent_text»: channel 2's attempts carry the
        # actually transmitted text; channel 1 failed AFTER handing the
        # text to its transport — its ``sending`` carries the frozen
        # root text, the failures carry NULL
        assert _attempt_texts(spawned["id"]) == [
            ("sending", _TEXT_SECOND),
            ("sent", _TEXT_SECOND),
        ]
        assert _attempt_texts(root.id) == [
            ("sending", _TEXT_ROOT),
            ("failed", None),
            ("failed", None),
        ]


class TestChainExhaustion:
    """Исчерпание каналов: single-channel priority — the terminal
    failure closes the chain ``not_delivered`` ON THE ROOT; no
    continuation is spawned."""

    async def test_last_channel_failure_closes_chain_on_root(
        self, db_engine, db_session, contour, monkeypatch
    ) -> None:
        monkeypatch.setattr(settings, "NOTIFY_CHANNEL_PRIORITY", "mock1")
        root = await _stage_root_task(db_session)

        queue = contour.queue()
        queue.ensure_worker_group()
        queue.ensure_consumer_groups()
        queue.enqueue_task(_root_payload(root))

        await worker.delivery_once(
            queue, {"mock1": _AppErrorChannel()}, asyncio.Event()
        )
        await dispatcher.statuses_once(_session_factory(db_engine), queue)

        assert _task_row(root.id, "delivery_outcome")["delivery_outcome"] == "not_delivered"
        assert query_db("SELECT id FROM notify_tasks WHERE channel = 'mock2'") == []
        # the reason is the attempt journal: the attempt, the app_error
        # close and the final not_delivered
        outcomes = [
            r["outcome"]
            for r in query_db(
                f"SELECT outcome FROM notify_task_attempts WHERE task_id = '{root.id}'"
            )
        ]
        assert outcomes == ["attempt", "app_error", "not_delivered"]


class TestSpawnIdempotency:
    """DoD «повторная доставка отчёта не дублирует задачу»: the
    at-least-once duplicate of the terminal report re-runs the chain
    reaction — still ONE continuation task, ONE stream entry for it."""

    async def test_duplicate_terminal_report_spawns_once(
        self, db_engine, db_session, contour, monkeypatch
    ) -> None:
        monkeypatch.setattr(settings, "NOTIFY_CHANNEL_PRIORITY", "mock1,mock2")
        await _seed_second_channel_template(db_session)
        root = await _stage_root_task(db_session)

        queue = contour.queue()
        queue.ensure_worker_group()
        queue.ensure_consumer_groups()
        queue.enqueue_task(_root_payload(root))

        channels = {"mock1": _AppErrorChannel(), "mock2": _OkChannel()}
        await worker.delivery_once(queue, channels, asyncio.Event())
        await dispatcher.statuses_once(_session_factory(db_engine), queue)

        after_first = _stream_task_ids(contour)
        spawned_rows = query_db("SELECT id FROM notify_tasks WHERE channel = 'mock2'")
        assert len(spawned_rows) == 1
        spawned_id = spawned_rows[0]["id"]

        # the at-least-once duplicate: the worker's terminal report is
        # delivered AGAIN (a reclaim, a crash after publish — §4.4)
        duplicate = {
            "task_id": root.id,
            "stage": "failed",
            "channel": "mock1",
            "outcome": "not_delivered",
            "error": "scripted app failure",
            "sent_text": None,
            "occurred_at": _iso_z(datetime.now(UTC)),
        }
        queue.publish_status(duplicate)
        await dispatcher.statuses_once(_session_factory(db_engine), queue)

        assert len(query_db("SELECT id FROM notify_tasks WHERE channel = 'mock2'")) == 1
        # the stream saw the spawn exactly once
        assert _stream_task_ids(contour).count(spawned_id) == 1
        # the chain is still in flight — no outcome flip
        assert _task_row(root.id, "delivery_outcome")["delivery_outcome"] is None
        assert after_first.count(root.id) == 1
