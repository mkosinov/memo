"""GH #484 Task 2 (part 3 of the notify family #476; spec §3.2/§3.3,
ADR 011) — the ``src/notify/channels`` package: the channel protocol
failure taxonomy and the channel registry.

Covered (S9, unit — no Redis, no DB):

- the §3.2 error taxonomy: both channel errors derive from
  ``ChannelError``; ``ChannelTransportError`` carries ``retry_after``
  (default ``None``, seconds from Retry-After when present);
- ``parse_channel_priority`` moved VERBATIM from ``dispatcher.py`` to
  ``registry.py`` (the canonical home of the channel-name vocabulary):
  same behavior (case-insensitive CSV, loud ``ValueError`` on empty /
  empty segment / duplicate) and the dispatcher re-exports the SAME
  function object — its own module tests keep working unchanged;
- ``validate_priority_channels`` — the loud startup gate (spec §3.3): a
  registered priority name is silent; an unregistered one raises
  ``SystemExit(2)`` with the STABLE message before any group is created
  or the queue consumed;
- ``build_instances`` instantiates ONLY the prioritized channels from
  the registry.
"""

import pytest

from src.notify import dispatcher
from src.notify.channels.base import (
    Channel,
    ChannelAppError,
    ChannelError,
    ChannelTransportError,
)
from src.notify.channels.registry import (
    CHANNELS,
    NOT_REGISTERED_MESSAGE,
    build_instances,
    parse_channel_priority,
    validate_priority_channels,
)
from tests.notify_redis_support import capture_notify_logs

pytestmark = pytest.mark.unit


class _StubChannel:
    """A minimal registry-test channel (the factory IS the class)."""

    name = "stub"

    async def is_available(self) -> bool:
        return True

    async def send(self, address: str, text_neutral: str) -> None:
        return None


# ── §3.2: the failure taxonomy ───────────────────────────────────────────────


class TestErrorTaxonomy:
    def test_app_and_transport_errors_derive_from_channel_error(self) -> None:
        assert issubclass(ChannelAppError, ChannelError)
        assert issubclass(ChannelTransportError, ChannelError)

    def test_transport_error_retry_after_defaults_to_none(self) -> None:
        exc = ChannelTransportError("mock: scripted transport failure")
        assert str(exc) == "mock: scripted transport failure"
        assert exc.retry_after is None

    def test_transport_error_carries_retry_after_seconds(self) -> None:
        exc = ChannelTransportError("mock: slow down", retry_after=17.5)
        assert exc.retry_after == 17.5


# ── §3.3: parse_channel_priority — moved verbatim from dispatcher.py ─────────


class TestParseChannelPriority:
    def test_csv_is_stripped_and_lowercased(self) -> None:
        assert parse_channel_priority("Telegram, WhatsApp") == ["telegram", "whatsapp"]

    def test_single_name_is_a_one_element_list(self) -> None:
        assert parse_channel_priority("telegram") == ["telegram"]

    def test_empty_value_is_a_loud_value_error(self) -> None:
        with pytest.raises(ValueError, match="NOTIFY_CHANNEL_PRIORITY is empty"):
            parse_channel_priority("")

    def test_empty_segment_is_a_loud_value_error(self) -> None:
        with pytest.raises(ValueError, match="NOTIFY_CHANNEL_PRIORITY has empty segments"):
            parse_channel_priority("telegram,,sms")

    def test_duplicate_is_a_loud_value_error(self) -> None:
        with pytest.raises(ValueError, match="duplicate channel 'telegram'"):
            parse_channel_priority("telegram, telegram")

    def test_dispatcher_reexports_the_same_function_object(self) -> None:
        """The move must not fork the behavior: the dispatcher name is
        the registry function (its module tests hit it through the old
        attribute path and keep passing unchanged)."""
        assert dispatcher.parse_channel_priority is parse_channel_priority


# ── §3.3: the loud startup gate ──────────────────────────────────────────────


class TestValidatePriorityChannels:
    def test_registered_name_is_silent(self) -> None:
        validate_priority_channels(["stub"], registry={"stub": _StubChannel})

    def test_unregistered_name_logs_and_exits_2_with_the_stable_message(self) -> None:
        """The ``connect_or_exit`` precedent (architect decision on the
        part-3 gate): the STABLE message goes to the module logger, the
        process exits with code 2 — a tuple-form ``SystemExit(2, msg)``
        would make the interpreter exit 1 and break the §3.3 contract."""
        with (
            capture_notify_logs("memo.notify.registry") as messages,
            pytest.raises(SystemExit) as exit_info,
        ):
            validate_priority_channels(["x"])
        assert exit_info.value.code == 2
        assert "notify worker: channel 'x' is not registered" in messages

    def test_message_constant_formats_the_name(self) -> None:
        assert NOT_REGISTERED_MESSAGE.format("x") == "notify worker: channel 'x' is not registered"

    def test_gate_names_the_first_unregistered_entry(self) -> None:
        """The message names the FIRST unregistered entry (iteration
        order) — the gate checks every priority name."""
        with (
            capture_notify_logs("memo.notify.registry") as messages,
            pytest.raises(SystemExit) as exit_info,
        ):
            validate_priority_channels(
                ["stub", "ghost"], registry={"stub": _StubChannel}
            )
        assert exit_info.value.code == 2
        assert "notify worker: channel 'ghost' is not registered" in messages


# ── §3.3: instance building ──────────────────────────────────────────────────


class TestBuildInstances:
    def test_builds_only_the_prioritized_channels(self, monkeypatch) -> None:
        monkeypatch.setitem(CHANNELS, "stub", _StubChannel)
        monkeypatch.setitem(CHANNELS, "other", _StubChannel)

        instances = build_instances(["stub"])

        assert list(instances) == ["stub"]
        assert isinstance(instances["stub"], _StubChannel)

    def test_instances_satisfy_the_channel_protocol(self, monkeypatch) -> None:
        monkeypatch.setitem(CHANNELS, "stub", _StubChannel)

        instances = build_instances(["stub"])

        assert isinstance(instances["stub"], Channel)
