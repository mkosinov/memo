"""GH #485 Task 6 (spec §12 scenario 3: «Первый канал упал — доставка
проходит вторым каналом цепочки»; family #476 US-5) — the SECOND mock
channel: ``mock2``.

Covered (unit — no Redis, no DB):

- the registry canon: the package import hook registers ``mock`` +
  ``mock2`` + ``telegram``; ``mock2`` is registered STATICALLY — a
  bottom-of-module line with NO env gate (unlike ``mock`` whose
  ``is_mock_allowed`` gate keeps it out of the production registry): a
  channel outside the priority list never receives tasks, so the second
  mock is inert in any registry that does not name it;
- the registry factory builds a ``MockChannel``-shaped instance named
  ``mock2`` (the #484 canon — the recorder seam, ``escape_mode =
  "none"``), wired to mock2's OWN bounded Redis artifact list;
- the SAME marker semantics as mock (spec §3.6):
  ``fail-transport:`` → ``ChannelTransportError``, ``fail-app:`` →
  ``ChannelAppError``, anything else delivers the assembled text
  verbatim;
- an OWN ``ChannelLimits`` declaration (spec §4.4): the same small
  exhaustible ``daily_cap`` as mock's, zero pause, no admin address,
  the display name ``Mock 2`` for the §6.3 service sentence.
"""

import pytest
from pydantic import SecretStr

from src.core.config import settings
from src.notify.channels.base import (
    Channel,
    ChannelAppError,
    ChannelLimits,
    ChannelTransportError,
)
from src.notify.channels.mock import (
    MOCK_DAILY_CAP,
    MOCK_DELIVERIES_LIST,
    MOCK_LIMITS,
    InMemoryRecorder,
    MockChannel,
    RedisListRecorder,
)
from src.notify.channels.mock2 import (
    MOCK2_DELIVERIES_LIST,
    MOCK2_LIMITS,
    Mock2Channel,
)
from src.notify.channels.registry import CHANNELS

pytestmark = pytest.mark.unit

#: The same every-markup assembled text as the mock suite — mock2 must
#: deliver it verbatim too (plain-text channel).
_ASSEMBLED_TEXT = "**Привет**, _мир_! [ссылка](https://example.com) — `код`"


class TestRegistration:
    """The #484/#485 registration canon (ADR 011): a module + one
    bottom-of-module ``CHANNELS`` entry. The ``mock2`` entry is STATIC
    (no ``is_mock_allowed`` gate — the gate stays mock's own canon):
    outside the priority list the channel is inert; the enabled e2e
    stack names it explicitly via ``NOTIFY_CHANNEL_PRIORITY=mock,mock2``
    (``scripts/e2e-shard-start.sh``)."""

    def test_the_package_hook_registers_mock_mock2_and_telegram(self) -> None:
        import src.notify.channels  # noqa: F401 — the registration hook

        assert {"mock", "mock2", "telegram"} <= set(CHANNELS)

    def test_the_registry_factory_builds_the_mock2_channel(self) -> None:
        import src.notify.channels.mock2  # noqa: F401 — the registration import

        # REDIS_URL is empty under pytest — the factory canon says
        # tests never call it; here the WIRING is under test, so a
        # parseable URL rides the monkeypatch seam (the pool itself
        # stays lazy — nothing connects).
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(settings, "REDIS_URL", SecretStr("redis://127.0.0.1:6399/0"))
            instance = CHANNELS["mock2"]()

        assert instance.name == "mock2"
        assert isinstance(instance, Channel)
        assert isinstance(instance, MockChannel)

    def test_the_factory_recorder_writes_mock2s_own_artifact_list(self) -> None:
        """Wiring: mock2 deliveries land in their OWN bounded list — a
        blended artifact would lose the per-channel attribution that
        scenario 3 exists to prove (WHICH channel delivered). The
        recorder pool is lazy — the factory call connects to nothing
        (the construction-laziness canon of the mock suite)."""
        import src.notify.channels.mock2  # noqa: F401 — the registration import

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(settings, "REDIS_URL", SecretStr("redis://127.0.0.1:6399/0"))
            instance = CHANNELS["mock2"]()

        assert isinstance(instance, MockChannel)
        assert isinstance(instance._recorder, RedisListRecorder)
        assert instance._recorder._list == MOCK2_DELIVERIES_LIST
        assert MOCK2_DELIVERIES_LIST != MOCK_DELIVERIES_LIST


class TestMock2ChannelOutcomes:
    """The SAME scripted-outcome semantics as mock (spec §3.6) —
    inherited from ``MockChannel``, asserted here through ``mock2`` so
    the e2e scenario-3 contract (the same address markers on BOTH
    channels) is pinned on the second channel itself."""

    async def test_is_available_is_always_true(self) -> None:
        assert await Mock2Channel(InMemoryRecorder()).is_available() is True

    def test_channel_name_is_mock2(self) -> None:
        assert Mock2Channel(InMemoryRecorder()).name == "mock2"

    def test_declares_the_plain_text_escape_mode_like_mock(self) -> None:
        assert Mock2Channel(InMemoryRecorder()).escape_mode == "none"

    def test_satisfies_the_channel_protocol(self) -> None:
        assert isinstance(Mock2Channel(InMemoryRecorder()), Channel)

    async def test_send_records_the_assembled_text_verbatim(self) -> None:
        recorder = InMemoryRecorder()
        channel = Mock2Channel(recorder)

        await channel.send("+79990001122", _ASSEMBLED_TEXT)

        assert recorder.deliveries == [
            {"address": "+79990001122", "text": _ASSEMBLED_TEXT}
        ]

    async def test_fail_transport_prefix_raises_transport_error(self) -> None:
        channel = Mock2Channel(InMemoryRecorder())

        with pytest.raises(ChannelTransportError) as exc_info:
            await channel.send("fail-transport:+79990001122", _ASSEMBLED_TEXT)

        assert exc_info.value.retry_after is None
        assert "fail-transport:+79990001122" in str(exc_info.value)

    async def test_fail_app_prefix_raises_app_error(self) -> None:
        channel = Mock2Channel(InMemoryRecorder())

        with pytest.raises(ChannelAppError) as exc_info:
            await channel.send("fail-app:+79990001122", _ASSEMBLED_TEXT)

        assert "fail-app:+79990001122" in str(exc_info.value)

    async def test_scripted_failure_records_nothing(self) -> None:
        recorder = InMemoryRecorder()
        channel = Mock2Channel(recorder)

        with pytest.raises(ChannelTransportError):
            await channel.send("fail-transport:x", "текст")
        with pytest.raises(ChannelAppError):
            await channel.send("fail-app:y", "текст")

        assert recorder.deliveries == []


class TestMock2LimitsDeclaration:
    """An OWN ``ChannelLimits`` (spec §4.4/§6.3) — the same shape as
    mock's: the small exhaustible cap (a per-channel cap WINDOW is what
    lets a contour kill channel 1 while channel 2 still delivers), zero
    pause, no admin address — plus the display name ``Mock 2``."""

    def test_limits_are_an_own_declaration_not_mocks_object(self) -> None:
        limits = Mock2Channel(InMemoryRecorder()).limits
        assert limits is MOCK2_LIMITS
        assert limits is not MOCK_LIMITS

    def test_same_small_exhaustible_cap_as_mock(self) -> None:
        limits = Mock2Channel(InMemoryRecorder()).limits
        assert limits.daily_cap == MOCK_DAILY_CAP
        assert 0 < limits.daily_cap <= 50

    def test_pause_is_zero_and_admin_unset_like_mock(self) -> None:
        limits = Mock2Channel(InMemoryRecorder()).limits
        assert limits.send_pause_seconds == 0.0
        assert limits.admin_address is None

    def test_display_name_is_mock_2(self) -> None:
        assert Mock2Channel(InMemoryRecorder()).limits.display_name == "Mock 2"

    def test_limits_are_injectable_per_instance(self) -> None:
        """The contour injection seam is unchanged from mock: Task 6
        contours inject instances with their own window — the
        constructor seam, not module mutation."""
        custom = ChannelLimits(daily_cap=2, send_pause_seconds=0.0)
        channel = Mock2Channel(InMemoryRecorder(), limits=custom)
        assert channel.limits is custom
