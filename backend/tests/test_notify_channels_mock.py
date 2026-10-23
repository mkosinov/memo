"""GH #484 Task 2 (part 3 of the notify family #476; spec §3.6) — the
mock channel and its recorders.

Covered (S9, unit — no Redis, no DB):

- identity conversion: ``send`` writes the neutral text UNCHANGED (the
  channel owns markup conversion, part 3 ships the identity one);
- scripted outcomes by ADDRESS PREFIX (the payload contract is never
  extended): ``fail-transport:`` → ``ChannelTransportError`` with
  ``retry_after is None``; ``fail-app:`` → ``ChannelAppError``;
  anything else delivers;
- a successful send lands as ``{address, text}`` in the
  ``InMemoryRecorder``, and ``deliveries`` is a snapshot isolated from
  caller mutation;
- ``is_available`` is always true and the channel satisfies the
  ``Channel`` protocol;
- ``is_mock_allowed`` — the production gate of the registry entry (the
  mock is the observability channel, NOT part of the production
  registry, spec §3.3).
"""

import pytest

from src.core.config import settings
from src.notify.channels.base import (
    Channel,
    ChannelAppError,
    ChannelTransportError,
)
from src.notify.channels.mock import (
    InMemoryRecorder,
    MockChannel,
    is_mock_allowed,
)

pytestmark = pytest.mark.unit

#: Neutral-markdown text with every construct a channel may need to
#: convert — the mock must deliver it verbatim.
_NEUTRAL_TEXT = "**Привет**, _мир_! [ссылка](https://example.com) — `код`"


class TestMockChannelOutcomes:
    async def test_is_available_is_always_true(self) -> None:
        assert await MockChannel(InMemoryRecorder()).is_available() is True

    def test_channel_name_is_mock(self) -> None:
        assert MockChannel(InMemoryRecorder()).name == "mock"

    def test_satisfies_the_channel_protocol(self) -> None:
        assert isinstance(MockChannel(InMemoryRecorder()), Channel)

    async def test_send_is_the_identity_conversion(self) -> None:
        recorder = InMemoryRecorder()
        channel = MockChannel(recorder)

        await channel.send("+79990001122", _NEUTRAL_TEXT)

        assert recorder.deliveries == [{"address": "+79990001122", "text": _NEUTRAL_TEXT}]

    async def test_successes_accumulate_in_the_recorder(self) -> None:
        recorder = InMemoryRecorder()
        channel = MockChannel(recorder)

        await channel.send("a@example.com", "первое")
        await channel.send("b@example.com", "второе")

        assert recorder.deliveries == [
            {"address": "a@example.com", "text": "первое"},
            {"address": "b@example.com", "text": "второе"},
        ]

    async def test_fail_transport_prefix_raises_transport_error_without_retry_after(
        self,
    ) -> None:
        channel = MockChannel(InMemoryRecorder())

        with pytest.raises(ChannelTransportError) as exc_info:
            await channel.send("fail-transport:+79990001122", _NEUTRAL_TEXT)

        assert exc_info.value.retry_after is None
        assert "fail-transport:+79990001122" in str(exc_info.value)

    async def test_fail_app_prefix_raises_app_error(self) -> None:
        channel = MockChannel(InMemoryRecorder())

        with pytest.raises(ChannelAppError) as exc_info:
            await channel.send("fail-app:+79990001122", _NEUTRAL_TEXT)

        assert "fail-app:+79990001122" in str(exc_info.value)

    async def test_scripted_failure_records_nothing(self) -> None:
        recorder = InMemoryRecorder()
        channel = MockChannel(recorder)

        with pytest.raises(ChannelTransportError):
            await channel.send("fail-transport:x", "текст")
        with pytest.raises(ChannelAppError):
            await channel.send("fail-app:y", "текст")

        assert recorder.deliveries == []


class TestInMemoryRecorder:
    def test_deliveries_snapshot_is_isolated_from_caller_mutation(self) -> None:
        recorder = InMemoryRecorder()
        recorder.record("a@example.com", "текст")

        snapshot = recorder.deliveries
        snapshot.clear()

        assert recorder.deliveries == [{"address": "a@example.com", "text": "текст"}]


class TestMockRegistrationGate:
    """The registry entry is guarded by ``is_mock_allowed`` — tested as a
    function (module re-creation for the import-time ``if`` would be a
    heavier, order-fragile seam)."""

    def test_allowed_outside_production(self, monkeypatch) -> None:
        monkeypatch.setattr(settings, "ENV", "development")
        assert is_mock_allowed() is True

    def test_forbidden_in_production(self, monkeypatch) -> None:
        monkeypatch.setattr(settings, "ENV", "production")
        assert is_mock_allowed() is False
