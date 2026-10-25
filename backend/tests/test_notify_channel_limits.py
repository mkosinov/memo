"""GH #485 Task 3 (part 4 of the notify family #476; spec §4.4/§6.3) —
the common channel send-LIMITS mechanism: the daily cap window over the
Redis counter, the one-per-window admin service message, and the async
send pause.

Covered (unit — no Redis, no DB, no real clock; the pause and the
counters are faked at the seams, spec §13: «лимиты (пауза мокается,
потолок по Redis-счётчику, "админ не задан → сообщения нет", "второго
сообщения в окне нет")»):

- the §4.4 key templates ``notify:{channel}:cap:<ГГГГММДД>`` /
  ``notify:{channel}:cap-notified:<ГГГГММДД>`` and the 48 h TTL;
- the §6.3 admin service message text (channel-generic; for the
  ``telegram`` channel it IS the spec's exact sentence);
- the cap gate (``ChannelLimiter.governed_send``): under the ceiling —
  send + INCR; at/over the ceiling — ``ChannelAppError`` «суточный
  лимит исчерпан», NO send, NO INCR;
- the admin service message at the FIRST exhaustion of the window:
  goes to ``limits.admin_address`` via the SAME channel, does NOT
  increment the counter, the window flag is set only AFTER a
  successful send (a failure leaves it unset — the next exhaustion
  retries, the dup is accepted);
- «админ не задан → сообщения нет» — no admin send, the cap reason
  stays the task's app_error;
- «флаг стоит → второго сообщения в окне нет»;
- the send pause: an async hold between sequential sends of the
  channel in the worker process — the first send never waits, a send
  before the pause elapsed waits the remainder, the admin message
  respects the pause too;
- ``LimitedChannel`` — the registry wrapper proxying the channel
  surface and routing ``send`` through the limiter;
- ``build_instances(limiter=...)`` wraps every registry instance.
"""

import asyncio
from datetime import date, datetime
from typing import TYPE_CHECKING

import pytest

from src.notify.channels.base import (
    Channel,
    ChannelAppError,
    ChannelLimits,
    ChannelTransportError,
)
from src.notify.channels.limits import (
    CAP_KEY_TEMPLATE,
    CAP_NOTIFIED_KEY_TEMPLATE,
    CAP_WINDOW_TTL_SECONDS,
    DAILY_CAP_EXHAUSTED_MESSAGE,
    ChannelLimiter,
    admin_cap_message,
    cap_key,
    cap_notified_key,
)
from src.notify.queue import FakeQueue, StatusEvent, TaskPayload
from src.notify.worker import deliver_task

if TYPE_CHECKING:
    from src.notify.assembly import EscapeMode

pytestmark = pytest.mark.unit


# ── §4.4: the Redis key templates of the cap window ──────────────────────────


class TestCapWindowKeys:
    def test_cap_key_template_is_the_spec_shape(self) -> None:
        assert CAP_KEY_TEMPLATE == "notify:{channel}:cap:{yyyymmdd}"

    def test_cap_notified_key_template_is_the_spec_shape(self) -> None:
        assert CAP_NOTIFIED_KEY_TEMPLATE == "notify:{channel}:cap-notified:{yyyymmdd}"

    def test_cap_key_formats_channel_and_naive_utc_date(self) -> None:
        assert cap_key("telegram", date(2026, 10, 25)) == "notify:telegram:cap:20261025"

    def test_cap_notified_key_formats_channel_and_naive_utc_date(self) -> None:
        assert (
            cap_notified_key("mock", date(2026, 1, 2))
            == "notify:mock:cap-notified:20260102"
        )

    def test_window_ttl_is_48_hours(self) -> None:
        assert CAP_WINDOW_TTL_SECONDS == 48 * 3600


# ── §6.3: the admin service message text ─────────────────────────────────────


class TestAdminCapMessage:
    def test_message_is_channel_generic_spec_sentence(self) -> None:
        assert admin_cap_message("telegram") == (
            "Суточный лимит telegram исчерпан, уведомления не доставляются"
            " до конца окна"
        )

    def test_message_names_the_channel(self) -> None:
        assert "mock" in admin_cap_message("mock")


# ── test seams: the faked store, clock, and channel ──────────────────────────


class FakeCapStore:
    """In-memory ``CapStore`` — window bookkeeping without Redis; every
    call is recorded so tests assert the exact Redis-side effects."""

    def __init__(self, *, count: int = 0, notified: bool = False) -> None:
        self.count = count
        self.notified = notified
        self.counted: list[tuple[str, date]] = []
        self.registered: list[tuple[str, date]] = []
        self.flags_checked: list[tuple[str, date]] = []
        self.marked: list[tuple[str, date]] = []
        self.fail: Exception | None = None

    def window_count(self, channel: str, today: date) -> int:
        if self.fail is not None:
            raise self.fail
        self.counted.append((channel, today))
        return self.count

    def register_send(self, channel: str, today: date) -> None:
        if self.fail is not None:
            raise self.fail
        self.registered.append((channel, today))
        # Faithful to the Redis INCR: the window count grows with every
        # registered send, so a sequence of sends can cross the cap.
        self.count += 1

    def window_notified(self, channel: str, today: date) -> bool:
        if self.fail is not None:
            raise self.fail
        self.flags_checked.append((channel, today))
        return self.notified

    def mark_window_notified(self, channel: str, today: date) -> None:
        if self.fail is not None:
            raise self.fail
        self.notified = True
        self.marked.append((channel, today))


class SleepSpy:
    """The pause seam: records the requested holds, never waits."""

    def __init__(self) -> None:
        self.pauses: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.pauses.append(seconds)


class FakeClock:
    """The monotonic seam — advanced by hand between sends."""

    def __init__(self, start: float = 1000.0) -> None:
        self.value = start

    def __call__(self) -> float:
        return self.value

    def advance(self, seconds: float) -> None:
        self.value += seconds


class RecordingChannel:
    """A declarative-limits channel recording every ``send``; an
    optional scripted failure (``transport`` | ``app``) raises AFTER
    the recording — the pause stamp must survive failures."""

    def __init__(
        self,
        *,
        name: str = "mock",
        limits: ChannelLimits | None = None,
        fail: str | None = None,
        fail_addresses: set[str] | None = None,
    ) -> None:
        self.name = name
        self.escape_mode: EscapeMode = "none"
        self.limits = limits or ChannelLimits(daily_cap=25, send_pause_seconds=0.0)
        self._fail = fail
        self._fail_addresses = fail_addresses or set()
        self.sends: list[tuple[str, str]] = []

    async def is_available(self) -> bool:
        return True

    async def send(self, address: str, text: str) -> None:
        self.sends.append((address, text))
        if self._fail == "transport":
            raise ChannelTransportError("stub: transport failure")
        if self._fail == "app":
            raise ChannelAppError("stub: app failure")


#: A fixed naive-UTC ``now`` — the window date of every mechanism test.
FROZEN_NOW = datetime(2026, 10, 25, 12, 0, 0)
FROZEN_TODAY = FROZEN_NOW.date()


def _limiter(
    store: FakeCapStore,
    *,
    sleep: SleepSpy | None = None,
    clock: FakeClock | None = None,
) -> ChannelLimiter:
    return ChannelLimiter(
        store,
        sleep=sleep or SleepSpy(),
        now=lambda: FROZEN_NOW,
        monotonic=clock or FakeClock(),
    )


# ── §6.3: the cap gate — check before send, INCR after success ───────────────


class TestCapGate:
    async def test_send_under_cap_delivers_and_registers_the_window(
        self,
    ) -> None:
        store = FakeCapStore(count=0)
        channel = RecordingChannel(limits=ChannelLimits(daily_cap=25, send_pause_seconds=0.0))
        limiter = _limiter(store)

        await limiter.governed_send(channel, "+79990001122", "текст")

        assert channel.sends == [("+79990001122", "текст")]
        assert store.registered == [("mock", FROZEN_TODAY)]

    async def test_send_at_cap_is_refused_with_the_app_error_reason(self) -> None:
        store = FakeCapStore(count=25)
        channel = RecordingChannel(limits=ChannelLimits(daily_cap=25, send_pause_seconds=0.0))
        limiter = _limiter(store)

        with pytest.raises(ChannelAppError) as exc_info:
            await limiter.governed_send(channel, "+79990001122", "текст")

        assert str(exc_info.value) == DAILY_CAP_EXHAUSTED_MESSAGE
        assert channel.sends == []
        assert store.registered == []

    async def test_last_send_before_the_cap_is_allowed(self) -> None:
        store = FakeCapStore(count=24)
        channel = RecordingChannel(limits=ChannelLimits(daily_cap=25, send_pause_seconds=0.0))
        limiter = _limiter(store)

        await limiter.governed_send(channel, "+79990001122", "текст")

        assert channel.sends == [("+79990001122", "текст")]

    async def test_window_date_is_the_process_naive_utc(self) -> None:
        store = FakeCapStore(count=0)
        channel = RecordingChannel(limits=ChannelLimits(daily_cap=25, send_pause_seconds=0.0))
        limiter = _limiter(store)

        await limiter.governed_send(channel, "+79990001122", "текст")

        assert store.counted == [("mock", FROZEN_TODAY)]
        assert store.registered == [("mock", FROZEN_TODAY)]

    async def test_failed_send_does_not_consume_the_window(self) -> None:
        """Only a SUCCESSFUL send INCRs (§6.3 «успешная отправка —
        INCR»): a transport failure burns no window slot."""
        store = FakeCapStore(count=0)
        channel = RecordingChannel(
            limits=ChannelLimits(daily_cap=25, send_pause_seconds=0.0), fail="transport"
        )
        limiter = _limiter(store)

        with pytest.raises(ChannelTransportError):
            await limiter.governed_send(channel, "+79990001122", "текст")

        assert store.registered == []

    async def test_store_failure_propagates_out_of_the_gate(self) -> None:
        """A store (Redis) outage must NOT be muted and must NOT pose
        as an app error — it propagates as a channel transport error
        (the delivery core retries it per its budget)."""
        store = FakeCapStore(count=0)
        store.fail = ChannelTransportError("cap store: redis down")
        channel = RecordingChannel(limits=ChannelLimits(daily_cap=25, send_pause_seconds=0.0))
        limiter = _limiter(store)

        with pytest.raises(ChannelTransportError, match="redis down"):
            await limiter.governed_send(channel, "+79990001122", "текст")

        assert channel.sends == []


# ── §6.3: the admin service message at the first window exhaustion ──────────


class TestAdminServiceMessage:
    def _exhausted(
        self,
        *,
        admin_address: str | None,
        notified: bool = False,
        channel: RecordingChannel | None = None,
    ) -> tuple[RecordingChannel, FakeCapStore, ChannelLimiter]:
        store = FakeCapStore(count=25, notified=notified)
        chan = channel or RecordingChannel(
            limits=ChannelLimits(daily_cap=25, send_pause_seconds=0.0,
                                 admin_address=admin_address)
        )
        return chan, store, _limiter(store)

    async def test_first_exhaustion_sends_one_service_message(self) -> None:
        chan, store, limiter = self._exhausted(admin_address="+79995556677")

        with pytest.raises(ChannelAppError, match=DAILY_CAP_EXHAUSTED_MESSAGE):
            await limiter.governed_send(chan, "+79990001122", "текст")

        # via the SAME channel, to the admin address, the §6.3 sentence
        assert chan.sends == [("+79995556677", admin_cap_message("mock"))]
        # the flag is set AFTER the successful send, once
        assert store.marked == [("mock", FROZEN_TODAY)]

    async def test_service_message_does_not_increment_the_counter(self) -> None:
        chan, store, limiter = self._exhausted(admin_address="+79995556677")

        with pytest.raises(ChannelAppError):
            await limiter.governed_send(chan, "+79990001122", "текст")

        assert store.registered == []

    async def test_admin_unset_sends_no_message(self) -> None:
        """DoD: «админ не задан → сообщения нет» — the refusal reason
        stays in the attempt journal (the app_error text), nothing is
        sent through the channel."""
        chan, store, limiter = self._exhausted(admin_address=None)

        with pytest.raises(ChannelAppError, match=DAILY_CAP_EXHAUSTED_MESSAGE):
            await limiter.governed_send(chan, "+79990001122", "текст")

        assert chan.sends == []
        assert store.marked == []
        assert store.flags_checked == []

    async def test_flag_set_no_second_message_in_the_window(self) -> None:
        """DoD: «флаг стоит → второго сообщения в окне нет»."""
        chan, store, limiter = self._exhausted(
            admin_address="+79995556677", notified=True
        )

        with pytest.raises(ChannelAppError, match=DAILY_CAP_EXHAUSTED_MESSAGE):
            await limiter.governed_send(chan, "+79990001122", "текст")

        assert chan.sends == []
        assert store.marked == []

    async def test_admin_send_failure_leaves_the_flag_unset(self) -> None:
        """The flag goes up only AFTER a successful send (§6.3): a
        failing service message keeps the window «un-notified», so the
        NEXT exhaustion retries it (the accepted dup risk inverted —
        better a retry than silence)."""
        failing = RecordingChannel(
            limits=ChannelLimits(daily_cap=25, send_pause_seconds=0.0,
                                 admin_address="+79995556677"),
            fail="transport",
        )
        chan, store, limiter = self._exhausted(
            admin_address="+79995556677", channel=failing
        )

        with pytest.raises(ChannelAppError, match=DAILY_CAP_EXHAUSTED_MESSAGE):
            await limiter.governed_send(chan, "+79990001122", "текст")

        assert len(chan.sends) == 1  # the admin message WAS attempted
        assert store.marked == []
        assert store.notified is False

        # the next exhaustion retries the service message
        with pytest.raises(ChannelAppError):
            await limiter.governed_send(chan, "+79990001122", "текст")
        assert len(chan.sends) == 2


# ── §6.3: the async pause between sequential sends ───────────────────────────


class TestSendPause:
    def _paused(self, *, store: FakeCapStore | None = None, **channel_kwargs: object
    ) -> tuple[RecordingChannel, ChannelLimiter, SleepSpy, FakeClock]:
        clock = FakeClock()
        sleep = SleepSpy()
        chan = RecordingChannel(
            limits=ChannelLimits(daily_cap=25, send_pause_seconds=30.0,
                                 **channel_kwargs)  # type: ignore[arg-type]
        )
        limiter = _limiter(store or FakeCapStore(), sleep=sleep, clock=clock)
        return chan, limiter, sleep, clock

    async def test_first_send_never_waits(self) -> None:
        chan, limiter, sleep, _clock = self._paused()

        await limiter.governed_send(chan, "+79990001122", "текст")

        assert sleep.pauses == []

    async def test_second_send_waits_the_whole_pause(self) -> None:
        chan, limiter, sleep, _clock = self._paused()

        await limiter.governed_send(chan, "+79990001122", "раз")
        await limiter.governed_send(chan, "+79990001122", "два")

        assert sleep.pauses == [30.0]

    async def test_send_after_the_pause_elapsed_does_not_wait(self) -> None:
        chan, limiter, sleep, clock = self._paused()

        await limiter.governed_send(chan, "+79990001122", "раз")
        clock.advance(30.0)
        await limiter.governed_send(chan, "+79990001122", "два")

        assert sleep.pauses == []

    async def test_partially_elapsed_pause_waits_the_remainder(self) -> None:
        chan, limiter, sleep, clock = self._paused()

        await limiter.governed_send(chan, "+79990001122", "раз")
        clock.advance(10.0)
        await limiter.governed_send(chan, "+79990001122", "два")

        assert sleep.pauses == [20.0]

    async def test_failed_send_still_engages_the_pause(self) -> None:
        """The transport WAS hit by a failing send — the next send of
        the channel still holds the pause."""
        chan = RecordingChannel(
            limits=ChannelLimits(daily_cap=25, send_pause_seconds=30.0),
            fail="transport",
        )
        clock = FakeClock()
        sleep = SleepSpy()
        limiter = _limiter(FakeCapStore(), sleep=sleep, clock=clock)

        with pytest.raises(ChannelTransportError):
            await limiter.governed_send(chan, "+79990001122", "раз")
        chan._fail = None
        await limiter.governed_send(chan, "+79990001122", "два")

        assert sleep.pauses == [30.0]

    async def test_admin_message_respects_the_pause(self) -> None:
        """§6.3: the service message «соблюдает паузу отправок» — it
        holds the remainder after the task send that preceded it."""
        store = FakeCapStore(count=24)  # send #1 under the cap, INCR -> 25
        chan, limiter, sleep, _clock = self._paused(
            store=store, admin_address="+79995556677"
        )
        await limiter.governed_send(chan, "+79990001122", "раз")  # under cap

        with pytest.raises(ChannelAppError):
            await limiter.governed_send(chan, "+79990001122", "два")  # exhausted

        assert sleep.pauses == [30.0]  # held before the ADMIN message
        assert chan.sends[1] == ("+79995556677", admin_cap_message("mock"))

    async def test_exhausted_window_with_flag_set_holds_no_pause(self) -> None:
        """Nothing transmits (flag already set) — no pause is held."""
        store = FakeCapStore(count=24, notified=True)  # send #1 -> 25, then exhausted
        chan, limiter, sleep, _clock = self._paused(
            store=store, admin_address="+79995556677"
        )
        await limiter.governed_send(chan, "+79990001122", "раз")

        with pytest.raises(ChannelAppError):
            await limiter.governed_send(chan, "+79990001122", "два")

        assert sleep.pauses == []

    async def test_zero_pause_never_waits(self) -> None:
        """The mock's declaration (pause 0.0) — sends never hold."""
        store = FakeCapStore()
        chan = RecordingChannel(
            limits=ChannelLimits(daily_cap=25, send_pause_seconds=0.0)
        )
        sleep = SleepSpy()
        limiter = _limiter(store, sleep=sleep)

        await limiter.governed_send(chan, "+79990001122", "раз")
        await limiter.governed_send(chan, "+79990001122", "два")

        assert sleep.pauses == []


# ── the registry wrapper: ``LimitedChannel`` ──────────────────────────────────


class TestLimitedChannel:
    async def test_proxies_the_channel_surface(self) -> None:
        limits = ChannelLimits(daily_cap=3, send_pause_seconds=0.0)
        chan = RecordingChannel(name="mock", limits=limits)

        wrapped = _limiter(FakeCapStore()).wrap(chan)

        assert wrapped.name == "mock"
        assert wrapped.escape_mode == "none"
        assert wrapped.limits == limits
        assert isinstance(wrapped, Channel)
        assert await wrapped.is_available() is True

    async def test_send_is_routed_through_the_limiter(self) -> None:
        store = FakeCapStore(count=25)
        chan = RecordingChannel(limits=ChannelLimits(daily_cap=25, send_pause_seconds=0.0))
        wrapped = _limiter(store).wrap(chan)

        with pytest.raises(ChannelAppError, match=DAILY_CAP_EXHAUSTED_MESSAGE):
            await wrapped.send("+79990001122", "текст")

        assert chan.sends == []
        assert store.registered == []

    async def test_successful_wrapped_send_registers_the_window(self) -> None:
        store = FakeCapStore(count=0)
        chan = RecordingChannel(limits=ChannelLimits(daily_cap=25, send_pause_seconds=0.0))
        wrapped = _limiter(store).wrap(chan)

        await wrapped.send("+79990001122", "текст")

        assert chan.sends == [("+79990001122", "текст")]
        assert store.registered == [("mock", FROZEN_TODAY)]


# ── the delivery core through a limited channel (the DoD end-shape) ──────────


class TestDeliveryThroughLimitedChannel:
    """The delivery core (``deliver_task``) stays limit-agnostic — a
    wrapped channel makes the cap refusal a plain ``ChannelAppError``,
    so the §3.4 core matrix semantics apply unchanged."""

    async def _deliver(
        self, channels: dict[str, object]
    ) -> list[StatusEvent]:
        queue = FakeQueue()
        task: TaskPayload = {
            "task_id": "7f9c24e1-6f4a-4c0e-9a2b-3d1e5f7a9c01",
            "channel": "mock",
            "address": "+79990001122",
            "payload": {},
            "template_id": "06bd742e-56a7-4e4e-9f0e-3d5c0b6a1e11",
            "template_body": "Готовый текст оповещения",
            "root_task_id": "7f9c24e1-6f4a-4c0e-9a2b-3d1e5f7a9c01",
            "created_at": "2026-10-23T10:00:00Z",
            "resend_of": None,
        }
        await deliver_task(  # type: ignore[arg-type]
            task,
            channels,  # type: ignore[arg-type]
            queue,
            retries=3,
            sleep=SleepSpy(),
            stop=asyncio.Event(),
            publish=lambda event: asyncio.to_thread(queue.publish_status, event),
        )
        return queue.claim_statuses()

    async def test_exhausted_channel_task_ends_as_app_error_with_reason(
        self,
    ) -> None:
        store = FakeCapStore(count=25)
        chan = RecordingChannel(limits=ChannelLimits(daily_cap=25, send_pause_seconds=0.0))
        wrapped = _limiter(store).wrap(chan)

        events = await self._deliver({"mock": wrapped})

        assert (events[-2]["stage"], events[-2]["outcome"]) == ("failed", "app_error")
        assert events[-2]["error"] == DAILY_CAP_EXHAUSTED_MESSAGE
        assert (events[-1]["stage"], events[-1]["outcome"]) == (
            "failed",
            "not_delivered",
        )
        assert chan.sends == []

    async def test_under_cap_channel_task_delivers(self) -> None:
        store = FakeCapStore(count=0)
        chan = RecordingChannel(limits=ChannelLimits(daily_cap=25, send_pause_seconds=0.0))
        wrapped = _limiter(store).wrap(chan)

        events = await self._deliver({"mock": wrapped})

        assert (events[-1]["stage"], events[-1]["outcome"]) == ("sent", "delivered")
        assert chan.sends == [("+79990001122", "Готовый текст оповещения")]
        assert store.registered == [("mock", FROZEN_TODAY)]
