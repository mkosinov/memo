"""The channel protocol and its failure taxonomy (GH #484 part 3, spec
§3.2; family #476 §3.5; ADR 011; rev.5 of #485 — spec §6.1, ADR 014).

A channel is the ASYNC seam between the worker and a messenger
transport: the worker process is asyncio-native and the pilot channel of
part 4 (Telethon/MTProto) is async-native — a sync seam would force an
async→sync bridge, rejected for the transport by ADR 013 for the same
reason.

Text assembly is WORKER ownership (ADR 014): the channel DECLARES its
escape mode (``EscapeMode`` — ``none | html``) and the worker assembles
the task text keyed by it BEFORE the send; ``send`` receives the
ASSEMBLED text and hands it to the transport verbatim. The old «the
channel converts the neutral markup» clause is retired with the neutral
markup itself — a channel's template is written directly in the
channel's format, values are escaped at substitution per channel format
(spec §5.3): markup belongs to the template, data stays data.

Failure taxonomy (spec §3.2): the worker counts retries, the channel
classifies the failure — it is the only one that knows the transport.
An unclassified exception escaping ``send``/``is_available`` (a channel
bug, NOT a ``ChannelError``) is handled by the worker as an application
error: loud trace + the channel closes without retries (spec §3.2).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol, runtime_checkable

if TYPE_CHECKING:
    from src.notify.assembly import EscapeMode


class ChannelError(Exception):
    """Base of channel-delivery failures (part 3 #484, spec §3.2)."""


class ChannelAppError(ChannelError):
    """Application-level failure (bad address, refused, blocked — the
    4xx analogue): NOT retried, the channel attempt ends here."""


class ChannelTransportError(ChannelError):
    """Transport failure (disconnect/timeout/5xx/429): retried up to
    NOTIFY_SEND_RETRIES. ``retry_after`` — seconds from Retry-After."""

    def __init__(self, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


@dataclass(frozen=True)
class ChannelLimits:
    """The DECLARATIVE limit settings of a channel (spec §4.4/§6.3, rev.5
    of #485): «каналы в реестре декларируют свои параметры лимитов
    (потолок, пауза, адрес служебных сообщений)».

    Declaration only — the MECHANISM (Redis counter
    ``notify:{channel}:cap:<ГГГГММДД>`` with the 48 h EXPIRE, the send
    pause between sequential sends, the one-per-window admin message on
    first exhaustion) is Task 3's registry machinery reading these
    fields; nothing here counts, sleeps, or sends:

    - ``daily_cap`` — the per-day send ceiling; an exhausted window
      fails the attempt as an ``app_error`` («суточный лимит
      исчерпан»);
    - ``send_pause_seconds`` — the async hold between sequential sends
      of the channel in the worker process (Telegram: 30 s);
    - ``admin_address`` — where the one-per-window service message
      goes via the SAME channel; ``None`` — no service message (the
      reason stays in the journal).
    """

    daily_cap: int
    send_pause_seconds: float
    admin_address: str | None = None


@runtime_checkable
class Channel(Protocol):
    """The delivery seam (family §3.5, ADR 011; rev.5 — spec §6.1, ADR
    014): ``name`` — the registry key and the payload channel record
    value; ``escape_mode`` — the DECLARED escape mode the worker keys
    the text assembly by (``none`` — plain text, ``html`` — payload
    values HTML-escaped at substitution); ``limits`` — the DECLARED
    limit settings of the channel (spec §4.4/§6.3: ceiling, send pause,
    service-message address) read by the limits mechanism
    (``channels/limits.py`` — #485 Task 3), never enforced by the
    channel itself; ``is_available`` — the cheap "setting filled AND
    transport answers" probe (no attempt is burned on an unavailable
    channel); ``send`` — deliver the text ASSEMBLED BY THE WORKER (no
    channel-side markup conversion — the neutral markup is retired);
    returning without an exception = delivered."""

    name: str
    escape_mode: EscapeMode
    limits: ChannelLimits

    async def is_available(self) -> bool: ...

    async def send(self, address: str, text: str) -> None: ...
