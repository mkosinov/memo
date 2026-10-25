"""#485 Task 6 — the CAP-LIMITS contour (part-4 spec §12 scenario 4,
§13 contour line; family #476 US-4) over the real Redis cap store:
«счётчик потолка + служебное сообщение + флаг окна» — a mock channel
with a small ceiling THROUGH THE COMMON MECHANISM (``ChannelLimiter`` +
``RedisCapStore``, spec §4.4/§6.3 — «мок-канал с малым потолком через
общий механизм»).

The chain/lifetime halves of the mechanism are already covered: the
cap GATE and the admin-message rules run as units over the ``FakeCapStore``
(``test_notify_channel_limits.py``), the store itself as a contour
(``test_notify_redis_cap_store.py``). What only the FULL contour
proves is the three halves agreeing on ONE real window: the delivery
core burning an attempt with «суточный лимит исчерпан», the admin
service message flying exactly ONCE through the same channel, the
window flag in Redis suppressing the second notice, and the counter
never counting the notice itself.

Marked ``redis`` with the declarative ``REDIS_URL`` guard (§3.6): the
cap-store keys live under the test's key-prefix workspace (``contour``
fixture) and are cleaned up with it.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy.ext.asyncio import async_sessionmaker

import src.models  # noqa: F401 — registration first; breaks the models↔notify import cycle
from src.core.config import settings
from src.notify import dispatcher, worker
from src.notify.channels.base import ChannelLimits
from src.notify.channels.limits import (
    DAILY_CAP_EXHAUSTED_MESSAGE,
    ChannelLimiter,
    RedisCapStore,
    cap_key,
    cap_notified_key,
)
from src.notify.channels.mock import InMemoryRecorder, MockChannel
from src.notify.models import DomainEvent, NotifyTask
from src.util.utc import utc_now
from tests.conftest import query_db
from tests.notify_redis_support import contour_fixture, redis_marks, redis_url

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

    from src.notify.channels.mock import Recorder

pytestmark = redis_marks

contour = contour_fixture()  # per-test isolated workspace fixture (§3.6)

_ADDRESS_A = "+79990001122"
_ADDRESS_B = "+79990001133"
_ADDRESS_C = "+79990001144"
_ADMIN_ADDRESS = "+79990000000"
#: «Суточный лимит Mock исчерпан, …» — the §6.3 sentence with the
#: capitalized fallback display name of the ``mock`` channel.
_ADMIN_MESSAGE = (
    "Суточный лимит Mock исчерпан, уведомления не доставляются до конца окна"
)


def _iso_z(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _session_factory(db_engine: AsyncEngine) -> async_sessionmaker:
    return async_sessionmaker(db_engine, expire_on_commit=False)


async def _stage_root_task(db_session: AsyncSession, address: str) -> NotifyTask:
    """A queued SINGLE-CHANNEL root task (``mock``) with a literal
    frozen body — the S7/chain staging pattern; each call is its own
    chain (own event, own root)."""
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
        channel="mock",
        address=address,
        payload={},
        template_id="06bd742e-56a7-4c4e-9f0e-3d5c0b6a1e11",
        template_body=f"Текст уведомления для {address}",
        reenqueues=0,
    )
    db_session.add(task)
    await db_session.commit()
    return task


def _root_payload(task: NotifyTask) -> dict[str, Any]:
    """The §4.2 rev.5 payload of a root task (spec §3.6)."""
    return {
        "task_id": task.id,
        "channel": "mock",
        "address": task.address,
        "payload": {},
        "template_id": task.template_id,
        "template_body": task.template_body,
        "root_task_id": task.id,
        "created_at": _iso_z(datetime.now(UTC)),
        "resend_of": None,
    }


def _outcome_row(task_id: str, *cols: str) -> dict:
    col_list = ", ".join(cols)
    rows = query_db(f"SELECT {col_list} FROM notify_tasks WHERE id = '{task_id}'")
    assert rows, f"task {task_id} not found"
    return rows[0]


def _attempt_outcomes(task_id: str) -> list[tuple[str, str | None]]:
    """(outcome, error) of the append-only attempt journal in write
    order — the §6.3 reason of a cap refusal lives HERE."""
    rows = query_db(
        f"SELECT outcome, error FROM notify_task_attempts WHERE task_id = '{task_id}'"
        " ORDER BY occurred_at, rowid"
    )
    return [(r["outcome"], r["error"]) for r in rows]


class TestCapWindowContour:
    """The §12 scenario-4 chain over the real cap store: the FIRST send
    of the window delivers and counts; the SECOND hits the ceiling —
    ONE admin service message, the attempt journal carries «суточный
    лимит исчерпан», the chain closes ``not_delivered``; the THIRD
    hits the SAME window flag — no second notice."""

    async def test_cap_counter_admin_notice_and_window_flag(
        self, db_engine, db_session, contour, monkeypatch
    ) -> None:
        monkeypatch.setattr(settings, "NOTIFY_CHANNEL_PRIORITY", "mock")
        today = utc_now().date()

        # the common mechanism (§6.3) around an observable mock with a
        # ONE-send ceiling: window keys under the contour prefix
        recorder: Recorder = InMemoryRecorder()
        channel = MockChannel(
            recorder,
            limits=ChannelLimits(
                daily_cap=1,
                send_pause_seconds=0.0,
                admin_address=_ADMIN_ADDRESS,
            ),
        )
        limiter = ChannelLimiter(
            RedisCapStore(redis_url(), key_prefix=contour.prefix),
            sleep=asyncio.sleep,
        )
        # the wrapped channel satisfies the delivery seam structurally
        # (the LimitedChannel wrapper never subclasses the base — the
        # same spelling as the unit contour of the mechanism)
        channels: dict[str, Any] = {"mock": limiter.wrap(channel)}

        queue = contour.queue()
        queue.ensure_worker_group()
        queue.ensure_consumer_groups()
        factory = _session_factory(db_engine)

        # 1) the window's FIRST send: delivers, INCRs the counter to 1
        task_a = await _stage_root_task(db_session, _ADDRESS_A)
        queue.enqueue_task(_root_payload(task_a))
        await worker.delivery_once(queue, channels, asyncio.Event())
        await dispatcher.statuses_once(factory, queue)

        assert recorder.deliveries == [
            {"address": _ADDRESS_A, "text": f"Текст уведомления для {_ADDRESS_A}"}
        ]
        assert _outcome_row(task_a.id, "delivery_outcome")["delivery_outcome"] == (
            "delivered"
        )
        assert contour.client.get(f"{contour.prefix}{cap_key('mock', today)}") == "1"

        # 2) the SECOND send: the window is exhausted — the attempt
        # burns as «суточный лимит исчерпан», the admin gets the ONE
        # service message (not counted against the cap), the flag goes
        # up, the chain closes not_delivered on the root
        task_b = await _stage_root_task(db_session, _ADDRESS_B)
        queue.enqueue_task(_root_payload(task_b))
        await worker.delivery_once(queue, channels, asyncio.Event())
        await dispatcher.statuses_once(factory, queue)

        assert recorder.deliveries == [
            {"address": _ADDRESS_A, "text": f"Текст уведомления для {_ADDRESS_A}"},
            {"address": _ADMIN_ADDRESS, "text": _ADMIN_MESSAGE},
        ]
        assert _attempt_outcomes(task_b.id) == [
            ("attempt", None),
            ("app_error", DAILY_CAP_EXHAUSTED_MESSAGE),
            ("not_delivered", None),
        ]
        assert _outcome_row(task_b.id, "delivery_outcome")["delivery_outcome"] == (
            "not_delivered"
        )
        # the notice does NOT count against the cap (§6.3): the counter
        # still holds the one client send of step 1
        assert contour.client.get(f"{contour.prefix}{cap_key('mock', today)}") == "1"
        # the window flag is UP — set after the successful notice
        assert (
            contour.client.get(f"{contour.prefix}{cap_notified_key('mock', today)}")
            == "1"
        )

        # 3) the THIRD send: the same exhausted window — the flag
        # suppresses the second notice; the journal reason repeats
        task_c = await _stage_root_task(db_session, _ADDRESS_C)
        queue.enqueue_task(_root_payload(task_c))
        await worker.delivery_once(queue, channels, asyncio.Event())
        await dispatcher.statuses_once(factory, queue)

        assert len(recorder.deliveries) == 2  # no second admin message
        assert _attempt_outcomes(task_c.id) == [
            ("attempt", None),
            ("app_error", DAILY_CAP_EXHAUSTED_MESSAGE),
            ("not_delivered", None),
        ]
        assert _outcome_row(task_c.id, "delivery_outcome")["delivery_outcome"] == (
            "not_delivered"
        )
