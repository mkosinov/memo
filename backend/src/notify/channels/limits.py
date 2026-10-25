"""The common send-LIMITS mechanism of the registry channels (GH #485
Task 3; spec §4.4/§6.3) — the daily cap window, the one-per-window
admin service message, and the async send pause.

«Каналы в реестре декларируют свои параметры лимитов (потолок, пауза,
адрес служебных сообщений)» (spec §4.4): the DECLARATION lives on the
channel (``ChannelLimits``, ``base.py`` — Task 2); THIS module is the
MECHANISM that reads it — worker-side only (ADR 009: the worker
process owns the sends, so it owns their pacing; the dispatcher never
limits anything).

Pieces:

- the §4.4 Redis key templates ``notify:{channel}:cap:<ГГГГММДД>`` /
  ``notify:{channel}:cap-notified:<ГГГГММДД>`` (the date is the
  process's naive UTC — ``utc_now().date()`` after the #529 wave) and
  the shared 48 h window TTL;
- ``CapStore`` — the sync Redis seam of the window counters (ADR 013:
  sync ``redis-py`` like the queue/recorder, the async limiter wraps
  every call in ``to_thread``); ``RedisCapStore`` owns its client with
  the SAME pool discipline as ``RedisListRecorder`` and a
  ``key_prefix`` for the test contour's isolation on a shared
  instance;
- ``ChannelLimiter`` — the per-worker-process governor: the cap check
  BEFORE every send (exhausted → ``ChannelAppError`` «суточный лимит
  исчерпан», plus the one-per-window admin service message at the
  FIRST exhaustion), the INCR of the window counter AFTER every
  successful send, and the async pause between sequential sends of a
  channel (per §6.3 the pause is a per-process hold — ONE worker per
  Redis instance in the pilot, no distributed pacing);
- ``LimitedChannel`` — the registry wrapper routing ``send`` through
  the limiter (``build_instances(..., limiter=...)``); the delivery
  core (``worker.deliver_task``) stays limit-agnostic.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from typing import TYPE_CHECKING, Protocol

from redis import Redis
from redis.backoff import NoBackoff
from redis.connection import ConnectionPool
from redis.exceptions import RedisError
from redis.retry import Retry

from src.notify.channels.base import (
    Channel,
    ChannelAppError,
    ChannelLimits,
    ChannelTransportError,
)
from src.notify.redis_queue import MAX_POOL_CONNECTIONS, SOCKET_TIMEOUT_SECONDS
from src.util.utc import utc_now

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable, Generator
    from datetime import date, datetime

    from src.notify.assembly import EscapeMode

logger = logging.getLogger("memo.notify.limits")

# ── §4.4: the cap-window key templates and TTL ───────────────────────────────

#: Counter of the channel's sends of the UTC day (``{yyyymmdd}`` —
#: ГГГГММДД). Atomic INCR after every successful send; the FIRST INCR
#: of a window sets the 48 h EXPIRE (spec §4.4).
CAP_KEY_TEMPLATE = "notify:{channel}:cap:{yyyymmdd}"

#: Flag «the admin service message of this window was sent» (spec
#: §4.4) — set only AFTER a successful send, TTL 48 h.
CAP_NOTIFIED_KEY_TEMPLATE = "notify:{channel}:cap-notified:{yyyymmdd}"

#: Both window keys live 48 h — past the UTC-day boundary they cover,
#: then Redis drops them (transport, not retention: ADR 008/013).
CAP_WINDOW_TTL_SECONDS = 48 * 3600

#: The §6.3 app_error reason of an exhausted window — the attempt
#: journal's ``error`` text.
DAILY_CAP_EXHAUSTED_MESSAGE = "суточный лимит исчерпан"


def _yyyymmdd(today: date) -> str:
    return today.strftime("%Y%m%d")


def cap_key(channel: str, today: date) -> str:
    """The §4.4 counter key of ``channel``'s window of ``today``."""
    return CAP_KEY_TEMPLATE.format(channel=channel, yyyymmdd=_yyyymmdd(today))


def cap_notified_key(channel: str, today: date) -> str:
    """The §4.4 window-flag key of ``channel``'s window of ``today``."""
    return CAP_NOTIFIED_KEY_TEMPLATE.format(channel=channel, yyyymmdd=_yyyymmdd(today))


def admin_cap_message(channel: str, limits: ChannelLimits) -> str:
    """The §6.3 service-message text — the spec's exact sentence with
    the channel's HUMAN display name: «Суточный лимит Telegram
    исчерпан, уведомления не доставляются до конца окна». The display
    name comes from the declaration (``limits.display_name``); undeclared
    — the capitalized registry key (``telegram`` → ``Telegram``), so
    every channel gets a human name by default."""
    display = limits.display_name or channel.capitalize()
    return (
        f"Суточный лимит {display} исчерпан,"
        " уведомления не доставляются до конца окна"
    )


class CapStore(Protocol):
    """The Redis seam of the cap windows (spec §4.4) — sync by ADR 013
    (the async limiter wraps every call in ``to_thread``). All methods
    take the window date precomputed by the caller — the store never
    reads the clock (testability + one date per governed send)."""

    def window_count(self, channel: str, today: date) -> int:
        """Sends of ``channel`` already counted in the window."""
        ...

    def register_send(self, channel: str, today: date) -> None:
        """INCR the window counter; the FIRST INCR of a key sets the
        48 h EXPIRE (spec §4.4)."""
        ...

    def window_notified(self, channel: str, today: date) -> bool:
        """True — the admin service message of the window was sent."""
        ...

    def mark_window_notified(self, channel: str, today: date) -> None:
        """Set the window flag with the 48 h TTL (§4.4) — the caller
        does this only AFTER a successful admin send (§6.3)."""
        ...


class RedisCapStore:
    """``CapStore`` over the sync ``redis-py`` client (spec §4.4, ADR
    013).

    The ``RedisListRecorder`` precedent: the store owns its client
    with the queue's pool discipline — retries explicitly OFF (a
    silent retry would hide an outage the limiter must see), an
    explicit pool ceiling, ``socket_timeout``, decoded responses;
    ``key_prefix`` namespaces the keys — the test contour's isolation
    on a shared instance, production keeps the default. A Redis
    outage surfaces as ``ChannelTransportError``: the store IS part
    of the channel's send path, an outage is retriable, not a channel
    bug — and never an ``app_error`` (an infra blip must not close a
    task deterministically).
    """

    def __init__(self, url: str, *, key_prefix: str = "") -> None:
        self._prefix = key_prefix
        self._pool = ConnectionPool.from_url(
            url,
            max_connections=MAX_POOL_CONNECTIONS,
            socket_timeout=SOCKET_TIMEOUT_SECONDS,
            decode_responses=True,
            retry=Retry(NoBackoff(), 0),
        )
        self._client: Redis = Redis(connection_pool=self._pool)

    def _key(self, key: str) -> str:
        return f"{self._prefix}{key}"

    @contextlib.contextmanager
    def _transport(self, operation: str) -> Generator[None]:
        """Normalize every redis error to ``ChannelTransportError``
        and let it PROPAGATE — muting is forbidden (the queue adapter's
        failure-volume discipline, spec §3.1)."""
        try:
            yield
        except RedisError as exc:
            raise ChannelTransportError(
                f"notify limits: cap store failed during {operation}:"
                f" {type(exc).__name__}: {exc}"
            ) from exc

    def window_count(self, channel: str, today: date) -> int:
        with self._transport("window_count"):
            value = self._client.get(self._key(cap_key(channel, today)))
        return int(value) if value is not None else 0

    def register_send(self, channel: str, today: date) -> None:
        """Atomic INCR of the window counter; the FIRST INCR of a key
        (result 1) sets the 48 h EXPIRE (spec §4.4)."""
        with self._transport("register_send"):
            key = self._key(cap_key(channel, today))
            value = self._client.incr(key)
            if value == 1:
                self._client.expire(key, CAP_WINDOW_TTL_SECONDS)

    def window_notified(self, channel: str, today: date) -> bool:
        with self._transport("window_notified"):
            return bool(
                self._client.exists(self._key(cap_notified_key(channel, today)))
            )

    def mark_window_notified(self, channel: str, today: date) -> None:
        with self._transport("mark_window_notified"):
            self._client.set(
                self._key(cap_notified_key(channel, today)),
                "1",
                ex=CAP_WINDOW_TTL_SECONDS,
            )


class ChannelLimiter:
    """The per-worker-process send governor (spec §6.3) — the limit
    MECHANISM reading the channel's ``limits`` declaration.

    ``governed_send`` wraps ONE actual send of a channel:

    - the cap window is read BEFORE the send (§6.3: «перед отправкой —
      проверка счётчика»): ``count >= daily_cap`` → the §6.3 admin
      service message (below) + ``ChannelAppError`` «суточный лимит
      исчерпан» — the delivery core closes the attempt as an app
      error, never a transport retry;
    - a send under the cap goes through the ASYNC PAUSE first, then
      ``channel.send``; a SUCCESSFUL return INCRs the window counter
      (the first INCR of a key sets the 48 h EXPIRE — the store's
      job); a failed send consumes nothing;
    - the admin service message at the FIRST exhaustion of a window
      (flag not set): one message to ``limits.admin_address`` via the
      SAME channel — it does NOT count against the cap («единственное
      допускаемое нарушение потолка»), it HOLDS the pause like any
      send, and the window flag is set only AFTER a successful send
      (a crash between the send and the flag may duplicate the message
      on retry — accepted: «лучше дубль, чем молчание»); a FAILED
      service message leaves the flag unset — the next exhaustion
      retries it; ``admin_address is None`` → no message at all, the
      refusal reason stays in the attempt journal (the app_error
      text).

    State: the pause timestamps live in THIS process only (§6.3: ONE
    worker per Redis instance in the pilot — no distributed pacing);
    the cap windows live in the ``CapStore``. Seams: ``sleep`` — the
    pause hold (production wires the stop-event-interruptible wait so
    SIGTERM never waits out a pause's tail); ``now`` — the naive-UTC
    wall clock of the window date; ``monotonic`` — the pause clock.
    """

    def __init__(
        self,
        store: CapStore,
        *,
        sleep: Callable[[float], Awaitable[None]],
        now: Callable[[], datetime] = utc_now,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._store = store
        self._sleep = sleep
        self._now = now
        self._monotonic = monotonic
        #: The last send completion per channel name (monotonic
        #: seconds) — the in-process pause state.
        self._last_send: dict[str, float] = {}

    def wrap(self, channel: Channel) -> LimitedChannel:
        """Wrap one declared channel — the registry wiring
        (``build_instances(..., limiter=...)``): the wrapper proxies
        the channel surface and routes every send through
        :meth:`governed_send`."""
        return LimitedChannel(channel, self)

    async def governed_send(
        self,
        channel: Channel,
        address: str,
        text: str,
        *,
        template_channel: str | None = None,
    ) -> None:
        """One governed send: cap gate → pause → send → INCR (see the
        class docstring). The frozen template ORIGIN passes through
        VERBATIM (spec §6.2) — the wrapper never interprets it. Store
        failures propagate as the store raised them
        (``ChannelTransportError`` from ``RedisCapStore``) — the
        delivery core retries transport failures per its budget."""
        name = channel.name
        limits = channel.limits
        today = self._now().date()

        count = await asyncio.to_thread(self._store.window_count, name, today)
        if count >= limits.daily_cap:
            await self._send_admin_notice(channel, today)
            raise ChannelAppError(DAILY_CAP_EXHAUSTED_MESSAGE)

        await self._hold_pause(name, limits.send_pause_seconds)
        try:
            await channel.send(address, text, template_channel=template_channel)
        finally:
            # The transport WAS engaged — the pause clock advances on
            # failures too (a failing send still hit the messenger).
            self._stamp_send(name)
        await asyncio.to_thread(self._store.register_send, name, today)

    async def _send_admin_notice(self, channel: Channel, today: date) -> None:
        """The §6.3 one-per-window service message at the first
        exhaustion — never counted against the cap, always
        pause-governed, flagged only after a successful send."""
        name = channel.name
        limits = channel.limits
        if limits.admin_address is None:
            # «адрес не задан — сообщения нет, причина остаётся в
            # журнале»: the refusal reason rides the app_error status.
            return
        if await asyncio.to_thread(self._store.window_notified, name, today):
            return
        await self._hold_pause(name, limits.send_pause_seconds)
        try:
            await channel.send(limits.admin_address, admin_cap_message(name, limits))
        except Exception as exc:
            # The notice must never mask the cap refusal: log loudly,
            # keep the flag DOWN — the next exhaustion retries (the
            # spec accepts a dup over silence).
            logger.warning(
                "notify limits: admin service message of channel %r failed"
                " (%s: %s) — window flag NOT set, the next exhaustion retries",
                name,
                type(exc).__name__,
                exc,
            )
        else:
            await asyncio.to_thread(self._store.mark_window_notified, name, today)
        finally:
            self._stamp_send(name)

    async def _hold_pause(self, name: str, pause_seconds: float) -> None:
        """Wait out the remainder of the channel's pause since its
        last send in THIS process; the first send of a channel (and a
        zero pause) never waits."""
        if pause_seconds <= 0:
            return
        last = self._last_send.get(name)
        if last is None:
            return
        remaining = pause_seconds - (self._monotonic() - last)
        if remaining > 0:
            await self._sleep(remaining)

    def _stamp_send(self, name: str) -> None:
        self._last_send[name] = self._monotonic()


class LimitedChannel:
    """The registry wrapper routing one channel's sends through the
    limits mechanism (spec §4.4/§6.3 — «механизм лимитов в реестре
    каналов»).

    The delivery core (``worker.deliver_task``) stays limit-agnostic:
    a wrapped channel is a plain ``Channel`` whose ``send`` now (a)
    refuses exhausted windows with ``ChannelAppError`` «суточный
    лимит исчерпан» (the core closes it as an app error — no
    transport retries), (b) holds the channel's pause between
    sequential sends, (c) counts successful sends in the window.
    The surface (``name`` / ``escape_mode`` / ``limits`` /
    ``is_available``) is the inner channel's, proxied verbatim.
    """

    def __init__(self, inner: Channel, limiter: ChannelLimiter) -> None:
        self._inner = inner
        self._limiter = limiter
        self.name: str = inner.name
        self.escape_mode: EscapeMode = inner.escape_mode
        self.limits: ChannelLimits = inner.limits

    async def is_available(self) -> bool:
        return await self._inner.is_available()

    async def send(
        self, address: str, text: str, *, template_channel: str | None = None
    ) -> None:
        await self._limiter.governed_send(
            self._inner, address, text, template_channel=template_channel
        )
