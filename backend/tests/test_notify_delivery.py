"""GH #484 Task 4 (part 3 of the notify family #476; spec §3.1/§3.2/
§3.4/§3.5) — the delivery core: ``parse_task_payload`` +
``deliver_task``.

Covered (the S9 core matrix, unit — no Redis, no DB, no real clock:

- validator: every family §4.2 violation raises ``InvalidTaskPayload``
  (a ``ValueError``); ``created_at``/``resend_of`` are
  delivery-irrelevant and deliberately NOT checked;
- first-attempt success: ``sending``/``attempt`` → ``sent``/
  ``delivered``, the remaining channel records are never tried, no
  final event;
- fallback: a channel exhausting its transport budget (every attempt
  ``failed``/``transport_error``) hands over to the next record which
  delivers — the full event chain, still no final event;
- every record failing: ONE final ``failed``/``not_delivered`` carrying
  the LAST record's channel name;
- ``ChannelAppError``: exactly ONE attempt (never retried), next
  record;
- pauses: ``retry_after`` above the cap is capped to 30 s with a
  journal line; a small ``retry_after`` passes through; the default
  pause is 1 s; after the LAST failed attempt there is NO pause (the
  budget is checked before sleeping);
- unavailable channel: ``failed``/``unavailable`` with NO ``sending``
  event and no burned attempt;
- a name missing from the channel instances: ``failed``/
  ``unknown_channel``, next record;
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

from src.notify.channels.base import (
    Channel,
    ChannelAppError,
    ChannelTransportError,
)
from src.notify.channels.mock import InMemoryRecorder, MockChannel
from src.notify.queue import FakeQueue, StatusEvent, TaskPayload
from src.notify.redis_queue import NotifyTransportError
from src.notify.worker import (
    RETRY_AFTER_CAP_SECONDS,
    TRANSPORT_RETRY_PAUSE_SECONDS,
    InvalidTaskPayload,
    deliver_task,
    parse_task_payload,
)

pytestmark = pytest.mark.unit

#: A ready (already rendered) notification text — §4.2 fixes it in the
#: payload; the core hands it over verbatim and never journals it.
TEXT = "Готовый текст оповещения: мастер-класс в субботу"

TASK_ID = 456


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


def _entry(name: str, address: str) -> dict[str, str]:
    return {"name": name, "address": address}


def _payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "task_id": TASK_ID,
        "text": TEXT,
        "channels": [_entry("mock", "+79990001122")],
        "created_at": "2026-10-23T10:00:00Z",
        "resend_of": None,
    }
    payload.update(overrides)
    return payload


def _task(entries: list[dict[str, Any]]) -> TaskPayload:
    return _payload(channels=entries)


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
            ("task_id string", _payload(task_id="456")),
            ("task_id zero", _payload(task_id=0)),
            ("task_id negative", _payload(task_id=-1)),
            ("no text", _payload(text=None)),
            ("text not a string", _payload(text=123)),
            ("no channels", _payload(channels=None)),
            ("channels not a list", _payload(channels="mock")),
            ("channels empty list", _payload(channels=[])),
            ("entry not a dict", _payload(channels=["mock"])),
            ("entry without name", _payload(channels=[{"address": "a"}])),
            ("entry name empty", _payload(channels=[_entry("", "a")])),
            ("entry name not a string", _payload(channels=[{"name": 7, "address": "a"}])),
            ("entry without address", _payload(channels=[{"name": "mock"}])),
            ("entry address empty", _payload(channels=[_entry("mock", "")])),
            ("entry address not a string", _payload(channels=[{"name": "m", "address": 5}])),
            (
                "second entry broken",
                _payload(channels=[_entry("mock", "a"), {"name": ""}]),
            ),
        ],
    )
    def test_violation_braks_the_whole_task(self, case: str, payload: dict[str, Any]) -> None:
        with pytest.raises(InvalidTaskPayload):
            parse_task_payload(payload)

    def test_valid_payload_returns_the_same_dict(self) -> None:
        payload = _payload()

        assert parse_task_payload(payload) is payload

    def test_created_at_and_resend_of_are_not_checked(self) -> None:
        """Plan §Task-4: delivery-irrelevant keys keep any shape — the
        validator never braks a task over them."""

        payload = _payload(created_at=None, resend_of=[{"weird": True}])

        assert parse_task_payload(payload) is payload


# ── module constants (§3.4 — deliberately NOT settings) ─────────────────────


class TestPauseConstants:
    def test_default_pause_and_cap(self) -> None:
        assert TRANSPORT_RETRY_PAUSE_SECONDS == 1.0
        assert RETRY_AFTER_CAP_SECONDS == 30.0


# ── deliver_task — the §3.4 algorithm ───────────────────────────────────────


class TestFirstAttemptSuccess:
    async def test_sending_then_sent_and_rest_of_channels_not_tried(self) -> None:
        recorder = InMemoryRecorder()
        backup = StubChannel("backup")
        channels: dict[str, Channel] = {"mock": MockChannel(recorder), "backup": backup}
        task = _task([_entry("mock", "+79990001122"), _entry("backup", "b@x.io")])

        events, spy = await _run(task, channels)

        assert _trail(events) == [
            ("sending", "attempt", "mock"),
            ("sent", "delivered", "mock"),
        ]
        assert backup.send_calls == 0
        assert spy.pauses == []
        assert recorder.deliveries == [{"address": "+79990001122", "text": TEXT}]

    async def test_event_shape_is_the_section_4_3_contract(self) -> None:
        channels: dict[str, Channel] = {"mock": MockChannel(InMemoryRecorder())}
        task = _task([_entry("mock", "+79990001122")])

        events, _ = await _run(task, channels)

        assert events[0].keys() == {
            "task_id",
            "stage",
            "channel",
            "outcome",
            "error",
            "occurred_at",
        }
        assert events[0]["task_id"] == TASK_ID
        assert events[0]["error"] is None
        # the reader parses occurred_at with fromisoformat (Z supported)
        datetime.fromisoformat(events[0]["occurred_at"])


class TestTransportFallback:
    async def test_budget_exhausted_then_second_channel_delivers(self) -> None:
        """flaky burns the whole budget (3 × transport_error), the next
        record delivers: full chain, NO final event."""
        flaky = StubChannel("flaky", outcome="transport")
        recorder = InMemoryRecorder()
        channels: dict[str, Channel] = {"flaky": flaky, "mock": MockChannel(recorder)}
        task = _task([_entry("flaky", "f@x.io"), _entry("mock", "+79990001122")])

        events, spy = await _run(task, channels, retries=3)

        assert _trail(events) == [
            ("sending", "attempt", "flaky"),
            ("failed", "transport_error", "flaky"),
            ("sending", "attempt", "flaky"),
            ("failed", "transport_error", "flaky"),
            ("sending", "attempt", "flaky"),
            ("failed", "transport_error", "flaky"),
            ("sending", "attempt", "mock"),
            ("sent", "delivered", "mock"),
        ]
        assert flaky.send_calls == 3
        # pauses BETWEEN attempts only — none after the last failure,
        # none for the successful channel
        assert spy.pauses == [TRANSPORT_RETRY_PAUSE_SECONDS, TRANSPORT_RETRY_PAUSE_SECONDS]
        assert recorder.deliveries == [{"address": "+79990001122", "text": TEXT}]


class TestFinalNotDelivered:
    async def test_all_records_fail__one_final_with_last_name(self) -> None:
        flaky = StubChannel("flaky", outcome="transport")
        broken = StubChannel("broken", outcome="app")
        channels: dict[str, Channel] = {"flaky": flaky, "broken": broken}
        task = _task([_entry("flaky", "f@x.io"), _entry("broken", "b@x.io")])

        events, spy = await _run(task, channels)

        assert _trail(events) == [
            ("sending", "attempt", "flaky"),
            ("failed", "transport_error", "flaky"),
            ("sending", "attempt", "flaky"),
            ("failed", "transport_error", "flaky"),
            ("sending", "attempt", "flaky"),
            ("failed", "transport_error", "flaky"),
            ("sending", "attempt", "broken"),
            ("failed", "app_error", "broken"),
            ("failed", "not_delivered", "broken"),
        ]
        # the final carries the LAST record's name and arrives exactly once
        finals = [e for e in events if e["outcome"] == "not_delivered"]
        assert len(finals) == 1
        assert finals[0]["channel"] == "broken"
        assert spy.pauses == [TRANSPORT_RETRY_PAUSE_SECONDS] * 2

    async def test_final_after_unknown_last_record_carries_its_name(self) -> None:
        channels: dict[str, Channel] = {}
        task = _task([_entry("ghost", "g@x.io")])

        events, _ = await _run(task, channels)

        assert _trail(events) == [
            ("failed", "unknown_channel", "ghost"),
            ("failed", "not_delivered", "ghost"),
        ]


class TestAppErrorIsTerminal:
    async def test_app_error_not_retried_and_moves_to_next_record(self) -> None:
        bad = StubChannel("bad", outcome="app")
        recorder = InMemoryRecorder()
        channels: dict[str, Channel] = {"bad": bad, "mock": MockChannel(recorder)}
        task = _task([_entry("bad", "fail-app:111"), _entry("mock", "+79990001122")])

        events, spy = await _run(task, channels)

        assert bad.send_calls == 1  # exactly ONE attempt — never retried
        assert _trail(events) == [
            ("sending", "attempt", "bad"),
            ("failed", "app_error", "bad"),
            ("sending", "attempt", "mock"),
            ("sent", "delivered", "mock"),
        ]
        assert spy.pauses == []  # an app error never buys a pause

    async def test_app_error_message_lands_in_the_error_field(self) -> None:
        channels: dict[str, Channel] = {"bad": StubChannel("bad", outcome="app")}
        task = _task([_entry("bad", "fail-app:111")])

        events, _ = await _run(task, channels)

        app_errors = [e for e in events if e["outcome"] == "app_error"]
        assert app_errors[0]["error"] == "stub bad: app failure"


class TestPauseDiscipline:
    async def test_retry_after_above_cap_is_capped_with_journal_line(self) -> None:
        channels: dict[str, Channel] = {
            "rate": StubChannel("rate", outcome="transport", retry_after=300.0)
        }
        task = _task([_entry("rate", "r@x.io")])

        with capture_worker_logs() as records:
            _events, spy = await _run(task, channels)

        assert spy.pauses == [RETRY_AFTER_CAP_SECONDS, RETRY_AFTER_CAP_SECONDS]
        assert any("capped" in r.getMessage() for r in records)

    async def test_small_retry_after_passes_through_uncapped(self) -> None:
        channels: dict[str, Channel] = {
            "rate": StubChannel("rate", outcome="transport", retry_after=2.5)
        }
        task = _task([_entry("rate", "r@x.io")])

        with capture_worker_logs() as records:
            _events, spy = await _run(task, channels)

        assert spy.pauses == [2.5, 2.5]
        assert not any("capped" in r.getMessage() for r in records)

    async def test_no_pause_after_the_last_failed_attempt(self) -> None:
        """The budget is checked BEFORE sleeping — the last failure of
        the last record must not buy a pause (§3.4)."""
        channels: dict[str, Channel] = {
            "solo": StubChannel("solo", outcome="transport", retry_after=300.0)
        }
        task = _task([_entry("solo", "s@x.io")])

        events, spy = await _run(task, channels, retries=2)

        # 2 attempts → exactly 1 pause (between them), none after
        assert spy.pauses == [RETRY_AFTER_CAP_SECONDS]
        assert _trail(events)[-1] == ("failed", "not_delivered", "solo")


class TestUnavailableChannel:
    async def test_unavailable_fails_without_sending_and_without_attempt(self) -> None:
        down = StubChannel("down", available=False)
        recorder = InMemoryRecorder()
        channels: dict[str, Channel] = {"down": down, "mock": MockChannel(recorder)}
        task = _task([_entry("down", "d@x.io"), _entry("mock", "+79990001122")])

        events, _ = await _run(task, channels)

        assert down.send_calls == 0  # no attempt is burned
        assert _trail(events) == [
            ("failed", "unavailable", "down"),  # NO sending before it
            ("sending", "attempt", "mock"),
            ("sent", "delivered", "mock"),
        ]


class TestUnknownChannel:
    async def test_name_outside_instances_fails_and_continues(self) -> None:
        recorder = InMemoryRecorder()
        channels: dict[str, Channel] = {"mock": MockChannel(recorder)}
        task = _task([_entry("ghost", "g@x.io"), _entry("mock", "+79990001122")])

        events, _ = await _run(task, channels)

        assert _trail(events) == [
            ("failed", "unknown_channel", "ghost"),
            ("sending", "attempt", "mock"),
            ("sent", "delivered", "mock"),
        ]


class TestUnclassifiedSendException:
    async def test_channel_bug_closes_channel_as_app_error_with_traceback(self) -> None:
        buggy = StubChannel("buggy", outcome="bug")
        channels: dict[str, Channel] = {"buggy": buggy}
        task = _task([_entry("buggy", "b@x.io")])

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
        task = _task([_entry("mock", "+79990001122")])

        with pytest.raises(NotifyTransportError):
            await _run(task, channels, publish=broken_publish)
