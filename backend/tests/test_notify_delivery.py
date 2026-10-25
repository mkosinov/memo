"""GH #484 Task 4 + #485 Task 1 (part 3/4 of the notify family #476;
spec §3.1/§3.2/§3.4/§3.5; §4.2/§4.3 rev.5) — the delivery core:
``parse_task_payload`` + ``deliver_task``.

Rev.5 (ADR 014): the task is ONE channel — the core assembles the text
from the frozen ``template_body`` + ``payload`` and delivers to the
task's single channel. Channel FALLBACK (next channel of the chain) is
dispatcher logic (part 4 Task 5) — here a failed channel task ends
``failed/not_delivered``.

Covered (the S9 core matrix, unit — no Redis, no DB, no real clock):

- validator: every family §4.2 rev.5 violation raises
  ``InvalidTaskPayload`` (a ``ValueError``); ``template_id``/
  ``root_task_id``/``created_at``/``resend_of`` are delivery-irrelevant
  and deliberately NOT checked;
- first-attempt success: ``sending``/``attempt`` → ``sent``/
  ``delivered``; ``sent_text`` (§4.3 rev.5) rides the sending/sent
  stages with the ASSEMBLED text;
- assembly failure (spec §5.4): ONE ``failed/app_error``
  («не удалось собрать текст уведомления: …»), no transport retries,
  ``send`` never called;
- a channel exhausting its transport budget: per-attempt
  ``failed``/``transport_error`` events, then ONE final ``failed``/
  ``not_delivered``;
- ``ChannelAppError``: exactly ONE attempt (never retried), then the
  final;
- pauses: ``retry_after`` above the cap is capped to 30 s with a
  journal line; a small ``retry_after`` passes through; the default
  pause is 1 s; after the LAST failed attempt there is NO pause (the
  budget is checked before sleeping);
- unavailable channel: ``failed``/``unavailable`` with NO ``sending``
  event and no burned attempt, then the final;
- a name missing from the channel instances: ``failed``/
  ``unknown_channel``, then the final;
- an unclassified ``send`` exception (a channel bug): ``failed``/
  ``app_error`` with the exception CLASS in ``error``, a traceback in
  the journal, the task itself does not crash, no retry;
- a publication transport failure (``NotifyTransportError``)
  propagates out of ``deliver_task`` — the task aborts without ack
  (§3.1: monitoring beats haste);
- message bodies never reach the journal — identifiers and outcomes
  only.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable, Iterator
from contextlib import contextmanager
from datetime import datetime
from typing import Any

import pytest

from src.notify.assembly import RenderError
from src.notify.channels.base import (
    Channel,
    ChannelAppError,
    ChannelTransportError,
)
from src.notify.channels.mock import InMemoryRecorder, MockChannel
from src.notify.queue import FakeQueue, StatusEvent, TaskPayload
from src.notify.redis_queue import NotifyTransportError
from src.notify.worker import (
    ASSEMBLY_ERROR_MESSAGE,
    RETRY_AFTER_CAP_SECONDS,
    TRANSPORT_RETRY_PAUSE_SECONDS,
    InvalidTaskPayload,
    deliver_task,
    parse_task_payload,
)

pytestmark = pytest.mark.unit

#: A literal frozen template (no variables) — the assembled text equals
#: its body; the delivery tests stay focused on delivery, assembly has
#: its own test below.
TEXT = "Готовый текст оповещения: мастер-класс в субботу"

#: The live seam id: ``NotifyTask.id`` is a UUID String(36) (AbstractModel
#: PK; scenarios/reenqueue enqueue ``task.id`` verbatim) — the canonical
#: part-3 shape is a non-empty string, ints are brak (#484 follow-up;
#: the original §4.2 int example was corrected by the #560 spec errata).
TASK_ID = "7f9c24e1-6f4a-4c0e-9a2b-3d1e5f7a9c01"


# ── test seams ──────────────────────────────────────────────────────────────


class SleepSpy:
    """The clock seam: records the requested pauses, never waits (the
    unit contour runs the whole retry budget in microseconds)."""

    def __init__(self) -> None:
        self.pauses: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.pauses.append(seconds)


class StubChannel:
    """Scripted channel for the core matrix: ``outcome`` one of
    ``deliver`` | ``transport`` | ``app`` | ``bug``; counts ``send``
    calls so tests assert the exact attempt count per channel."""

    def __init__(
        self,
        name: str,
        *,
        outcome: str = "deliver",
        retry_after: float | None = None,
        available: bool = True,
    ) -> None:
        self.name = name
        self._outcome = outcome
        self._retry_after = retry_after
        self._available = available
        self.send_calls = 0

    async def is_available(self) -> bool:
        return self._available

    async def send(self, address: str, text_neutral: str) -> None:
        self.send_calls += 1
        if self._outcome == "transport":
            raise ChannelTransportError(
                f"stub {self.name}: transport failure", retry_after=self._retry_after
            )
        if self._outcome == "app":
            raise ChannelAppError(f"stub {self.name}: app failure")
        if self._outcome == "bug":
            raise RuntimeError(f"stub {self.name}: channel bug")
        # deliver — no recorder needed, success is the absence of an error


class _RecordListHandler(logging.Handler):
    """In-memory sink of RAW records — caplog is unusable in this repo
    (the app logging setup strips pytest's capture handler; see
    test_notify_dispatcher), and the §3.2 test must assert on
    ``exc_info`` (the traceback), not just the message."""

    def __init__(self) -> None:
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


@contextmanager
def capture_worker_logs() -> Iterator[list[logging.LogRecord]]:
    """Attach the sink to the worker logger and force-enable it for the
    capture window (caplog is unusable in this repo — the app logging
    setup and the alembic fileConfig disable collection-time loggers;
    see test_notify_dispatcher). Yields RAW records so tests assert on
    ``exc_info`` — the §3.2 traceback requirement."""
    lg = logging.getLogger("memo.notify.worker")
    handler = _RecordListHandler()
    old_level, old_disabled = lg.level, lg.disabled
    lg.setLevel(logging.DEBUG)
    lg.disabled = False
    lg.addHandler(handler)
    try:
        yield handler.records
    finally:
        lg.removeHandler(handler)
        lg.setLevel(old_level)
        lg.disabled = old_disabled


# ── payload/task builders ───────────────────────────────────────────────────


def _payload(**overrides: Any) -> dict[str, Any]:
    """A §4.2 rev.5 task payload — ONE channel, frozen render data +
    template; the literal template keeps the assembled text == TEXT."""
    payload: dict[str, Any] = {
        "task_id": TASK_ID,
        "channel": "mock",
        "address": "+79990001122",
        "payload": {},
        "template_id": "06bd742e-56a7-4e4e-9f0e-3d5c0b6a1e11",
        "template_body": TEXT,
        "root_task_id": TASK_ID,
        "created_at": "2026-10-23T10:00:00Z",
        "resend_of": None,
    }
    payload.update(overrides)
    return payload


def _task(channel: str = "mock", **overrides: Any) -> TaskPayload:
    return _payload(channel=channel, **overrides)


async def _run(
    task: TaskPayload,
    channels: dict[str, Channel],
    *,
    retries: int = 3,
    publish: Callable[[StatusEvent], Awaitable[None]] | None = None,
) -> tuple[list[StatusEvent], SleepSpy]:
    """Run the core with the prod-shaped seams: a ``FakeQueue`` whose
    ``publish_status`` is wrapped in ``to_thread`` (the §3.1 wiring of
    the part-5 delivery loop), a pause-counting sleep, an unset stop."""
    queue = FakeQueue()

    async def default_publish(event: StatusEvent) -> None:
        await asyncio.to_thread(queue.publish_status, event)

    spy = SleepSpy()
    await deliver_task(
        task,
        channels,
        queue,
        retries=retries,
        sleep=spy,
        stop=asyncio.Event(),
        publish=publish or default_publish,
    )
    return queue.claim_statuses(), spy


def _trail(events: list[StatusEvent]) -> list[tuple[str, str, str]]:
    """(stage, outcome, channel) of the event chain — the §3.5 table."""
    return [(e["stage"], e["outcome"], e["channel"]) for e in events]


# ── parse_task_payload (§3.1: any violation = the whole task is brak) ───────


class TestParseTaskPayload:
    def test_invalid_payload_is_a_valueerror(self) -> None:
        assert issubclass(InvalidTaskPayload, ValueError)

    @pytest.mark.parametrize(
        ("case", "payload"),
        [
            ("no task_id", _payload(task_id=None)),
            ("task_id empty string", _payload(task_id="")),
            # The int spellings (the pre-errata §4.2 example showed one)
            # are NOT what the seam carries — NotifyTask.id is String(36).
            ("task_id int", _payload(task_id=456)),
            ("task_id negative int", _payload(task_id=-1)),
            ("task_id bool", _payload(task_id=True)),
            ("no channel", _payload(channel=None)),
            ("channel empty string", _payload(channel="")),
            ("channel not a string", _payload(channel=7)),
            ("no address", _payload(address=None)),
            ("address empty string", _payload(address="")),
            ("address not a string", _payload(address=5)),
            ("no payload", _payload(payload=None)),
            ("payload not a dict", _payload(payload="data")),
            ("payload is a list", _payload(payload=[1, 2])),
            ("no template_body", _payload(template_body=None)),
            ("template_body not a string", _payload(template_body=42)),
        ],
    )
    def test_violation_braks_the_whole_task(self, case: str, payload: dict[str, Any]) -> None:
        with pytest.raises(InvalidTaskPayload):
            parse_task_payload(payload)

    def test_valid_payload_returns_the_same_dict(self) -> None:
        payload = _payload()

        assert parse_task_payload(payload) is payload

    def test_delivery_irrelevant_keys_are_not_checked(self) -> None:
        """Plan §Task-4: ``template_id``/``root_task_id``/
        ``created_at``/``resend_of`` keep any shape — the validator
        never braks a task over them."""

        payload = _payload(
            template_id=None,
            root_task_id=17,
            created_at=None,
            resend_of=[{"weird": True}],
        )

        assert parse_task_payload(payload) is payload


# ── module constants (§3.4 — deliberately NOT settings) ─────────────────────


class TestPauseConstants:
    def test_default_pause_and_cap(self) -> None:
        assert TRANSPORT_RETRY_PAUSE_SECONDS == 1.0
        assert RETRY_AFTER_CAP_SECONDS == 30.0


# ── deliver_task — the §3.4 algorithm (one channel, rev.5) ──────────────────


class TestFirstAttemptSuccess:
    async def test_sending_then_sent_with_the_assembled_text(self) -> None:
        recorder = InMemoryRecorder()
        channels: dict[str, Channel] = {"mock": MockChannel(recorder)}
        task = _task()

        events, spy = await _run(task, channels)

        assert _trail(events) == [
            ("sending", "attempt", "mock"),
            ("sent", "delivered", "mock"),
        ]
        assert spy.pauses == []
        # §4.3 rev.5: the actually transmitted text rides sending/sent
        assert events[0]["sent_text"] == TEXT
        assert events[1]["sent_text"] == TEXT
        assert recorder.deliveries == [{"address": "+79990001122", "text": TEXT}]

    async def test_text_assembled_from_frozen_template_and_payload(self) -> None:
        """Rev.5: the worker assembles — ``{{ … }}`` from the frozen
        body with the frozen render data (strict undefineds)."""
        recorder = InMemoryRecorder()
        channels: dict[str, Channel] = {"mock": MockChannel(recorder)}
        task = _task(
            template_body="Запись: {{ service.title }} — {{ total_price | money }}",
            payload={"service": {"title": "Гончарный мастер-класс"}, "total_price": 2500},
        )

        events, _ = await _run(task, channels)

        assert events[1]["sent_text"] == "Запись: Гончарный мастер-класс — 2\u00a0500 ₽"
        assert recorder.deliveries[0]["text"] == events[1]["sent_text"]

    async def test_event_shape_is_the_section_4_3_contract(self) -> None:
        channels: dict[str, Channel] = {"mock": MockChannel(InMemoryRecorder())}
        task = _task()

        events, _ = await _run(task, channels)

        assert events[0].keys() == {
            "task_id",
            "stage",
            "channel",
            "outcome",
            "error",
            "sent_text",
            "occurred_at",
        }
        assert events[0]["task_id"] == TASK_ID
        assert events[0]["error"] is None
        # the reader parses occurred_at with fromisoformat (Z supported)
        datetime.fromisoformat(events[0]["occurred_at"])


class TestAssemblyFailure:
    async def test_broken_template_is_one_app_error_without_retries(self) -> None:
        """Spec §5.4: a deterministic assembly failure — ONE
        ``failed/app_error`` with the fixed russian phrase, ``send``
        never called, no transport retries."""
        stub = StubChannel("mock")
        channels: dict[str, Channel] = {"mock": stub}
        task = _task(template_body="{{ service.title }}", payload={})

        events, spy = await _run(task, channels)

        assert stub.send_calls == 0
        assert _trail(events) == [("failed", "app_error", "mock")]
        assert events[0]["error"] is not None
        assert events[0]["error"].startswith(ASSEMBLY_ERROR_MESSAGE)
        # a deterministic error never buys a pause
        assert spy.pauses == []

    async def test_assembly_failure_sent_text_is_none(self) -> None:
        """§4.3 rev.5: no transmission happened — ``sent_text`` NULL."""
        channels: dict[str, Channel] = {"mock": StubChannel("mock")}
        task = _task(template_body="{{ missing_key }}")

        events, _ = await _run(task, channels)

        assert events[0]["sent_text"] is None


class TestTransportBudget:
    async def test_budget_exhausted_then_final_not_delivered(self) -> None:
        """flaky burns the whole budget (3 × transport_error), then ONE
        final ``failed/not_delivered`` (rev.5: no next channel here —
        the dispatcher chain owns the fallback)."""
        flaky = StubChannel("flaky", outcome="transport")
        channels: dict[str, Channel] = {"flaky": flaky}
        task = _task(channel="flaky")

        events, spy = await _run(task, channels, retries=3)

        assert _trail(events) == [
            ("sending", "attempt", "flaky"),
            ("failed", "transport_error", "flaky"),
            ("sending", "attempt", "flaky"),
            ("failed", "transport_error", "flaky"),
            ("sending", "attempt", "flaky"),
            ("failed", "transport_error", "flaky"),
            ("failed", "not_delivered", "flaky"),
        ]
        assert flaky.send_calls == 3
        # pauses BETWEEN attempts only — none after the last failure
        assert spy.pauses == [TRANSPORT_RETRY_PAUSE_SECONDS, TRANSPORT_RETRY_PAUSE_SECONDS]
        # transmission stages carry the text; failures never do
        assert [e["sent_text"] for e in events] == [TEXT, None, TEXT, None, TEXT, None, None]


class TestAppErrorIsTerminal:
    async def test_app_error_not_retried_then_final(self) -> None:
        bad = StubChannel("bad", outcome="app")
        channels: dict[str, Channel] = {"bad": bad}
        task = _task(channel="bad")

        events, spy = await _run(task, channels)

        assert bad.send_calls == 1  # exactly ONE attempt — never retried
        assert _trail(events) == [
            ("sending", "attempt", "bad"),
            ("failed", "app_error", "bad"),
            ("failed", "not_delivered", "bad"),
        ]
        assert spy.pauses == []  # an app error never buys a pause

    async def test_app_error_message_lands_in_the_error_field(self) -> None:
        channels: dict[str, Channel] = {"bad": StubChannel("bad", outcome="app")}
        task = _task(channel="bad")

        events, _ = await _run(task, channels)

        app_errors = [e for e in events if e["outcome"] == "app_error"]
        assert app_errors[0]["error"] == "stub bad: app failure"


class TestPauseDiscipline:
    async def test_retry_after_above_cap_is_capped_with_journal_line(self) -> None:
        channels: dict[str, Channel] = {
            "rate": StubChannel("rate", outcome="transport", retry_after=300.0)
        }
        task = _task(channel="rate")

        with capture_worker_logs() as records:
            _events, spy = await _run(task, channels)

        assert spy.pauses == [RETRY_AFTER_CAP_SECONDS, RETRY_AFTER_CAP_SECONDS]
        assert any("capped" in r.getMessage() for r in records)

    async def test_small_retry_after_passes_through_uncapped(self) -> None:
        channels: dict[str, Channel] = {
            "rate": StubChannel("rate", outcome="transport", retry_after=2.5)
        }
        task = _task(channel="rate")

        with capture_worker_logs() as records:
            _events, spy = await _run(task, channels)

        assert spy.pauses == [2.5, 2.5]
        assert not any("capped" in r.getMessage() for r in records)

    async def test_no_pause_after_the_last_failed_attempt(self) -> None:
        """The budget is checked BEFORE sleeping — the last failure must
        not buy a pause (§3.4)."""
        channels: dict[str, Channel] = {
            "solo": StubChannel("solo", outcome="transport", retry_after=300.0)
        }
        task = _task(channel="solo")

        events, spy = await _run(task, channels, retries=2)

        # 2 attempts → exactly 1 pause (between them), none after
        assert spy.pauses == [RETRY_AFTER_CAP_SECONDS]
        assert _trail(events)[-1] == ("failed", "not_delivered", "solo")


class TestUnavailableChannel:
    async def test_unavailable_fails_without_sending_and_without_attempt(self) -> None:
        down = StubChannel("down", available=False)
        channels: dict[str, Channel] = {"down": down}
        task = _task(channel="down")

        events, _ = await _run(task, channels)

        assert down.send_calls == 0  # no attempt is burned
        assert _trail(events) == [
            ("failed", "unavailable", "down"),  # NO sending before it
            ("failed", "not_delivered", "down"),
        ]
        assert all(e["sent_text"] is None for e in events)


class TestUnknownChannel:
    async def test_name_outside_instances_fails_then_final(self) -> None:
        channels: dict[str, Channel] = {}  # the task's channel is absent
        task = _task(channel="ghost")

        events, _ = await _run(task, channels)

        assert _trail(events) == [
            ("failed", "unknown_channel", "ghost"),
            ("failed", "not_delivered", "ghost"),
        ]


class TestUnclassifiedSendException:
    async def test_channel_bug_closes_channel_as_app_error_with_traceback(self) -> None:
        buggy = StubChannel("buggy", outcome="bug")
        channels: dict[str, Channel] = {"buggy": buggy}
        task = _task(channel="buggy")

        with capture_worker_logs() as records:
            events, spy = await _run(task, channels)

        # the task does NOT crash: one attempt, app_error, the final
        assert buggy.send_calls == 1  # a bug is never retried
        assert _trail(events) == [
            ("sending", "attempt", "buggy"),
            ("failed", "app_error", "buggy"),
            ("failed", "not_delivered", "buggy"),
        ]
        assert events[1]["error"] == "RuntimeError"  # the class, §3.2
        # §3.2: a loud journal line WITH the traceback
        loud = [r for r in records if r.levelno >= logging.ERROR]
        assert any(r.exc_info is not None for r in loud)
        assert any("buggy" in r.getMessage() for r in loud)
        # message bodies never reach the journal (identifiers only)
        assert all(TEXT not in r.getMessage() for r in records)
        assert spy.pauses == []


class TestPublishTransportFailure:
    async def test_notify_transport_error_propagates_without_ack(self) -> None:
        """§3.1: a status-publication transport failure aborts the task
        — attempts do not continue status-less; the exception escapes
        ``deliver_task`` (the loop guard decides, the item keeps no
        ack)."""

        async def broken_publish(event: StatusEvent) -> None:
            raise NotifyTransportError("statuses stream is down")

        channels: dict[str, Channel] = {"mock": MockChannel(InMemoryRecorder())}
        task = _task()

        with pytest.raises(NotifyTransportError):
            await _run(task, channels, publish=broken_publish)
