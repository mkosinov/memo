"""The mock channel and the delivery recorders (GH #484 part 3, spec
§3.6; family #476 US-4/US-5 enablers; rev.5 of #485 — spec §5.3/§6.1).

The mock is the observability channel of the notify contours: deliveries
land in a recorder artifact instead of a messenger. It is a PLAIN-TEXT
channel (spec §5.3: «мок — простой текст»): ``escape_mode = "none"``,
the text assembled by the worker goes out VERBATIM — under the rev.5
seam channels do not convert markup at all (ADR 014). Outcomes are
scripted by the ADDRESS PREFIX — the payload contract is never
extended: ``fail-transport:`` → ``ChannelTransportError`` (a
falling/healing channel for the fallback scenarios), ``fail-app:`` →
``ChannelAppError`` (the unresolvable-address analogue), anything else
delivers.

The mock also declares its OWN limit settings (``MOCK_LIMITS`` — a
small exhaustible ``daily_cap`` for the cap contour tests, spec §4.4:
«мок-канал наследует механизм для контурных тестов потолка»); the
limits MECHANISM itself is Task 3's registry machinery.

Recorders:

- ``InMemoryRecorder`` — the unit-test artifact (a list + a snapshot
  property);
- ``RedisListRecorder`` — ``LPUSH`` of the JSON ``{address, text,
  occurred_at}`` into a Redis list + ``LTRIM`` to the cap: the artifact
  stays bounded; the e2e contour reads it with ``LRANGE``. The recorder
  owns its redis-py client built with the SAME pool options as
  ``RedisQueue``; ``key_prefix`` is the same test-isolation mechanism. A
  Redis outage inside ``record`` surfaces as ``ChannelTransportError``
  (the recorder IS the mock's transport — an outage is retriable, not a
  channel bug).

The registry factory builds the Redis recorder from ``REDIS_URL``; tests
never call it — instances are injected directly through the ``main``
seam (Task 5).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Protocol

from redis import Redis
from redis.backoff import NoBackoff
from redis.connection import ConnectionPool
from redis.exceptions import RedisError
from redis.retry import Retry

from src.core.config import settings
from src.notify.channels.base import (
    ChannelAppError,
    ChannelLimits,
    ChannelTransportError,
)
from src.notify.channels.registry import CHANNELS
from src.notify.redis_queue import MAX_POOL_CONNECTIONS, SOCKET_TIMEOUT_SECONDS

if TYPE_CHECKING:
    from src.notify.assembly import EscapeMode

#: Bounded-artifact list of the Redis recorder (spec §3.6).
MOCK_DELIVERIES_LIST = "notify:mock:deliveries"
#: ``LTRIM`` ceiling of the Redis recorder (spec §3.6: 1000 entries).
MOCK_DELIVERIES_CAP = 1000

# ── the mock's OWN limit settings (spec §4.4/§6.3, plan Task 2 step 4) ──────
#
# Declaration only — the Task-3 registry mechanism consumes the fields;
# the mock inherits it «для контурных тестов потолка» (spec §4.4).

#: A deliberately SMALL daily ceiling: a notify-tests contour run can
#: exhaust the cap window without hundreds of deliveries (US-4 of the
#: family; Task 6 contours may also inject their own ``ChannelLimits``).
MOCK_DAILY_CAP = 25

#: No pause between sequential mock sends — the observability channel
#: must not slow the contours down (Telegram's 30 s is ITS own setting).
MOCK_SEND_PAUSE_SECONDS = 0.0

#: No service message by default — the admin-address seam is opt-in per
#: contour via an injected ``ChannelLimits``.
MOCK_ADMIN_ADDRESS: str | None = None

#: The declared default limits of the mock (spec §4.4).
MOCK_LIMITS = ChannelLimits(
    daily_cap=MOCK_DAILY_CAP,
    send_pause_seconds=MOCK_SEND_PAUSE_SECONDS,
    admin_address=MOCK_ADMIN_ADDRESS,
)


def _utc_now_iso_z() -> str:
    """UTC now → ISO 8601 with the ``Z`` suffix (the same serialization
    as the dispatcher/scenario modules — ``occurred_at`` convention)."""
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class Recorder(Protocol):
    """The delivery-artifact seam (spec §3.6): record one delivery."""

    def record(self, address: str, text: str) -> None: ...


class InMemoryRecorder:
    """Unit-test recorder: a plain list of ``{address, text}`` dicts plus
    the snapshot property ``deliveries``."""

    def __init__(self) -> None:
        self._deliveries: list[dict[str, str]] = []

    def record(self, address: str, text: str) -> None:
        self._deliveries.append({"address": address, "text": text})

    @property
    def deliveries(self) -> list[dict[str, str]]:
        """A snapshot copy — caller mutation never reaches the recorder."""
        return list(self._deliveries)


class RedisListRecorder:
    """``LPUSH`` the delivery JSON + ``LTRIM`` to ``cap`` entries.

    The same pool discipline as ``RedisQueue`` (spec §3.6): retries
    explicitly OFF, an explicit pool ceiling, ``socket_timeout``,
    decoded responses. ``key_prefix`` namespaces the list — the test
    contour's isolation on a shared instance, production keeps the
    default (no prefix).
    """

    def __init__(
        self,
        url: str,
        *,
        key_prefix: str = "",
        list_name: str = MOCK_DELIVERIES_LIST,
        cap: int = MOCK_DELIVERIES_CAP,
    ) -> None:
        self._list = f"{key_prefix}{list_name}"
        self._cap = cap
        self._pool = ConnectionPool.from_url(
            url,
            max_connections=MAX_POOL_CONNECTIONS,
            socket_timeout=SOCKET_TIMEOUT_SECONDS,
            decode_responses=True,
            retry=Retry(NoBackoff(), 0),
        )
        self._client: Redis = Redis(connection_pool=self._pool)

    def record(self, address: str, text: str) -> None:
        """LPUSH the JSON ``{address, text, occurred_at}``, then LTRIM to
        the cap — the newest entries survive, the artifact is bounded. A
        redis outage surfaces as ``ChannelTransportError``: the recorder
        is the mock's transport, an outage is retriable."""
        entry = json.dumps(
            {"address": address, "text": text, "occurred_at": _utc_now_iso_z()},
            ensure_ascii=False,
        )
        try:
            self._client.lpush(self._list, entry)
            self._client.ltrim(self._list, 0, self._cap - 1)
        except RedisError as exc:
            raise ChannelTransportError(
                f"mock recorder: transport failed ({type(exc).__name__}: {exc})"
            ) from exc


class MockChannel:
    """Plain-text mock channel (spec §3.6/§5.3): ``escape_mode =
    "none"`` — the assembled text goes out VERBATIM; outcomes are
    scripted by the ADDRESS PREFIX — fail-transport:, fail-app:,
    anything else delivers to the recorder. Carries its OWN declarative
    limit settings (``limits`` — spec §4.4/§6.3, a small exhaustible
    cap for the Task-6 contour tests; the mechanism is Task 3's)."""

    name = "mock"
    escape_mode: EscapeMode = "none"

    def __init__(
        self, recorder: Recorder, *, limits: ChannelLimits | None = None
    ) -> None:
        self._recorder = recorder
        #: The declared limits (spec §4.4) — ``MOCK_LIMITS`` unless the
        #: contour injects its own window.
        self.limits: ChannelLimits = MOCK_LIMITS if limits is None else limits

    async def is_available(self) -> bool:
        return True

    async def send(self, address: str, text: str) -> None:
        if address.startswith("fail-transport:"):
            raise ChannelTransportError(f"mock: scripted transport failure for {address}")
        if address.startswith("fail-app:"):
            raise ChannelAppError(f"mock: scripted app failure for {address}")
        self._recorder.record(address, text)


def is_mock_allowed() -> bool:
    """The production gate of the mock registration (spec §3.3): the
    observability channel is NOT part of the production registry — a
    production priority naming ``mock`` gets the loud «not registered»
    startup error (enabled production notifying is opt-in until the real
    channels of part 4)."""
    return settings.ENV != "production"


# Registry entry (ADR 011 — bottom-of-module registration). The factory
# is never called in tests: instances are injected through the ``main``
# seam (Task 5); contours get the Redis artifact recorder from REDIS_URL.
if is_mock_allowed():
    CHANNELS["mock"] = lambda: MockChannel(
        RedisListRecorder(settings.REDIS_URL.get_secret_value())
    )
