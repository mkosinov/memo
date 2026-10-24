"""GH #484 Task 8 (spec §4 S6, §3.6) — the marked backend half of the
mock-delivery scenario: the ``RedisListRecorder`` delivery artifact.

The E2E leg (``frontend/admin/e2e/notify-s6-mock-delivery.spec.ts``)
proves the FULL enabled stack (dispatcher + worker +
``NOTIFY_CHANNEL_PRIORITY=mock``) drives the task row to ``sent`` with the
records UI unchanged. Per the S1-precedent split (spec §3.6) the DELIVERY
assertions live HERE, against the contour Redis:

- a hand-enqueued §4.2 payload — a REAL ``task_id`` of an existing
  ``NotifyTask`` row — with a PREFIX-FREE address (no ``fail-*``
  scripting: the plain-address delivery path) goes through ONE worker
  iteration (``delivery_once``) wired to the REAL ``RedisListRecorder``
  (the registry factory's artifact): the ``notify:mock:deliveries`` list
  under the contour's key prefix holds ``{address, text}`` with the
  ready text verbatim, and the task leaves delivery (acked);
- the recorder's ``LTRIM`` keeps the artifact bounded (spec §3.6): 1001
  ``record`` inserts → the list stays at the 1000-entry cap.

Marked ``redis`` with the declarative ``REDIS_URL`` guard (§3.6): each
test works in its own key-prefix workspace (``contour`` fixture) and
cleans up after itself — safe next to a live dev contour on the same
instance.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime

import src.models  # noqa: F401 — registration first; breaks the models↔notify import cycle
from src.notify import worker
from src.notify.channels.mock import (
    MOCK_DELIVERIES_CAP,
    MOCK_DELIVERIES_LIST,
    MockChannel,
    RedisListRecorder,
)
from src.notify.models import DomainEvent, NotifyTask
from src.notify.redis_queue import TASKS_STREAM, WORKER_GROUP
from tests.notify_redis_support import (
    RedisContour,
    contour_fixture,
    redis_marks,
    redis_url,
)

pytestmark = redis_marks

contour = contour_fixture()  # per-test isolated workspace fixture (§3.6)

_TEXT = "Готовый текст S6"
#: A prefix-FREE address — anything not starting with ``fail-transport:``
#: / ``fail-app:`` delivers (spec §3.6): the plain delivery path.
_ADDRESS = "+79990001199"


async def _stage_task(db_session) -> NotifyTask:
    """A real «queued» task row (the ``test_notify_dispatcher`` fixture
    pattern, as in the S7 module): the enqueued payload is hand-crafted,
    but it carries the row's REAL id — a valid §4.2 ``task_id``."""
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
        text=_TEXT,
        channels=[{"name": "mock", "address": _ADDRESS}],
        reenqueues=0,
    )
    db_session.add(task)
    await db_session.commit()
    return task


def _payload(task: NotifyTask) -> dict:
    """The §4.2 payload with the REAL task row id — exactly what the
    enabled dispatcher puts on the seam for a mock-priority channel."""
    return {
        "task_id": task.id,
        "text": _TEXT,
        "channels": [{"name": "mock", "address": _ADDRESS}],
        "created_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "resend_of": None,
    }


def _deliveries_key(workspace: RedisContour) -> str:
    """The ACTUAL list key the recorder writes: ``key_prefix +
    list_name`` (spec §3.6) — the same construction ``RedisListRecorder``
    performs, asserted through the contour's own client."""
    return f"{workspace.prefix}{MOCK_DELIVERIES_LIST}"


class TestMockDeliveryArtifact:
    async def test_worker_iteration_records_address_and_text(self, db_session, contour) -> None:
        """S6, the delivery half: one worker iteration delivers the
        prefix-free address through the mock channel into the REAL Redis
        list artifact — ``{address, text}`` with the ready text, the task
        acked out of the stream."""
        task = await _stage_task(db_session)

        queue = contour.queue()
        queue.ensure_worker_group()
        queue.enqueue_task(_payload(task))

        # The registry factory's recorder (spec §3.6), namespaced into
        # this test's workspace via the same key-prefix mechanism.
        recorder = RedisListRecorder(redis_url(), key_prefix=contour.prefix)
        await worker.delivery_once(queue, {"mock": MockChannel(recorder)}, asyncio.Event())

        entries = [
            json.loads(raw) for raw in contour.client.lrange(_deliveries_key(contour), 0, -1)
        ]
        assert len(entries) == 1  # delivered exactly once, no scripting
        assert entries[0]["address"] == _ADDRESS
        # the READY text is delivered verbatim (identity conversion, §3.6)
        assert entries[0]["text"] == _TEXT
        # the task left delivery: acked after the whole status publication
        pending = contour.client.xpending(f"{contour.prefix}{TASKS_STREAM}", WORKER_GROUP)[
            "pending"
        ]
        assert pending == 0


class TestRecorderBound:
    def test_ltrim_keeps_list_at_cap(self, contour) -> None:
        """S6, the observability bound (spec §3.6): the artifact list is
        an observability ceiling, not a log — 1001 inserts leave exactly
        the 1000-entry cap (LPUSH + LTRIM on every record)."""
        recorder = RedisListRecorder(redis_url(), key_prefix=contour.prefix)
        for index in range(MOCK_DELIVERIES_CAP + 1):
            recorder.record(f"+7999{index:07d}", f"текст {index}")

        length = contour.client.llen(_deliveries_key(contour))
        assert length == MOCK_DELIVERIES_CAP
