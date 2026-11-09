"""GH #580 Task 4 (spec §3.3/§4.4) — the relay process entry ``main()``
and the ``DOMAIN_EVENTS_*`` settings.

Mirrors the notify dispatcher's gate tests (``TestMain`` /
``TestMainTransportGates`` of ``test_notify_dispatcher.py``):

- disabled (``DOMAIN_EVENTS_ENABLED=false``, the default) → log and
  return WITHOUT touching the transport;
- enabled + empty ``REDIS_URL`` → the fail-fast gate ``SystemExit(2)``
  with a stable message (the URL value never appears);
- adapter selection: no injected transport → ``connect_or_exit`` over
  the unwrapped ``REDIS_URL``; the transport it builds is what the loop
  runs;
- the settings mirror ``NOTIFY_ENABLED``: default off, and the testing
  profile forces an accidental opt-in off (a standard pytest pass must
  not require Redis — family US-7/S2).
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import TYPE_CHECKING

import pytest
from pydantic import SecretStr

from src.core.config import Settings, settings
from src.domain_events import relay

if TYPE_CHECKING:
    import asyncio
    from collections.abc import Iterator

pytestmark = pytest.mark.integration

_LOGGER_NAME = "memo.domain_events.relay"


class _ListHandler(logging.Handler):
    """In-memory sink — caplog is unusable in this repo (see
    tests/test_notify_dispatcher.py for the alembic fileConfig story)."""

    def __init__(self) -> None:
        super().__init__()
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(record.getMessage())


@contextmanager
def capture_relay_logs() -> Iterator[list[str]]:
    lg = logging.getLogger(_LOGGER_NAME)
    handler = _ListHandler()
    old_level, old_disabled = lg.level, lg.disabled
    lg.setLevel(logging.DEBUG)
    lg.disabled = False
    lg.addHandler(handler)
    try:
        yield handler.messages
    finally:
        lg.removeHandler(handler)
        lg.setLevel(old_level)
        lg.disabled = old_disabled


class _ForbiddenTransport:
    """Stand-in that fails the test if the gate ever touches it."""

    def publish(self, stream: str, payload: dict) -> None:
        raise AssertionError("the disabled relay must not publish anything")


class TestMainGate:
    async def test_disabled_main_logs_and_returns_without_transport(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "DOMAIN_EVENTS_ENABLED", False)

        def forbidden_connect(*args: object, **kwargs: object) -> None:
            raise AssertionError("adapter selection must not run when disabled")

        monkeypatch.setattr(relay, "connect_or_exit", forbidden_connect)

        with capture_relay_logs() as messages:
            await relay.main()

        assert any("DOMAIN_EVENTS_ENABLED" in m for m in messages), messages

    async def test_enabled_empty_url_exits_code_2_with_stable_message(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "DOMAIN_EVENTS_ENABLED", True)
        monkeypatch.setattr(settings, "REDIS_URL", SecretStr(""))

        with (
            capture_relay_logs() as messages,
            pytest.raises(SystemExit) as exit_info,
        ):
            await relay.main()

        assert exit_info.value.code == 2
        assert any(relay.RELAY_NOT_CONFIGURED_MESSAGE in m for m in messages), messages

    async def test_enabled_unreachable_redis_exits_code_2_without_url_leak(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "DOMAIN_EVENTS_ENABLED", True)
        monkeypatch.setattr(
            settings, "REDIS_URL", SecretStr("redis://default:topsecret@127.0.0.1:1/0")
        )

        with (
            capture_relay_logs() as messages,
            pytest.raises(SystemExit) as exit_info,
        ):
            await relay.main()

        assert exit_info.value.code == 2
        assert any("unavailable" in m for m in messages), messages
        # hygiene: the URL value never appears (the §3.6 failure volume)
        assert all("topsecret" not in m for m in messages)

    async def test_adapter_selection_unwraps_secret_url_and_runs_built_transport(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """No injected transport → ``connect_or_exit(<unwrapped url>)``;
        the transport it returns is what the relay loop runs."""
        monkeypatch.setattr(settings, "DOMAIN_EVENTS_ENABLED", True)
        monkeypatch.setattr(settings, "REDIS_URL", SecretStr("redis://localhost:6379/0"))
        built = _ForbiddenTransport()  # never publishes: the loop is faked
        seen: dict[str, str] = {}
        ran: dict[str, object] = {}

        def fake_connect(url: str, **kwargs: object) -> _ForbiddenTransport:
            seen["url"] = url
            return built

        async def fake_run(
            session_factory: object, transport: _ForbiddenTransport, stop: asyncio.Event
        ) -> None:
            ran["transport"] = transport

        monkeypatch.setattr(relay, "connect_or_exit", fake_connect)
        monkeypatch.setattr(relay, "run_relay", fake_run)

        await relay.main()

        assert seen["url"] == "redis://localhost:6379/0"
        assert ran["transport"] is built


class TestDomainEventsSettings:
    def test_defaults_mirror_notify_gate(self) -> None:
        s = Settings(_env_file=None, ENV="development")
        assert s.DOMAIN_EVENTS_ENABLED is False
        assert s.DOMAIN_EVENTS_POLL_INTERVAL == 1.0

    def test_testing_profile_forces_an_accidental_opt_in_off(self) -> None:
        s = Settings(_env_file=None, ENV="testing", DOMAIN_EVENTS_ENABLED=True)
        assert s.DOMAIN_EVENTS_ENABLED is False


class TestStreamRecord:
    def test_record_carries_the_section_4_1_contract(self) -> None:
        """§4.1: ``event_id``/``type``/``occurred_at`` (ISO NAIVE UTC)/
        ``snapshot`` — the event is self-sufficient, nothing else rides."""
        from datetime import datetime

        from src.domain_events.models import DomainEvent

        event = DomainEvent(
            type="new_record",
            occurred_at=datetime(2026, 11, 9, 12, 0, 0),
            snapshot={"client": {"name": "Анна"}},
        )
        event.id = "00000000-0000-0000-0000-000000000001"

        record = relay.stream_record(event)

        assert record == {
            "event_id": "00000000-0000-0000-0000-000000000001",
            "type": "new_record",
            "occurred_at": "2026-11-09T12:00:00",
            "snapshot": {"client": {"name": "Анна"}},
        }
