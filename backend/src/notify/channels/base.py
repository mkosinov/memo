"""The channel protocol and its failure taxonomy (GH #484 part 3, spec
§3.2; family #476 §3.5; ADR 011).

A channel is the ASYNC seam between the worker and a messenger
transport: the worker process is asyncio-native and the pilot channel of
part 4 (Telethon/MTProto) is async-native — a sync seam would force an
async→sync bridge, rejected for the transport by ADR 013 for the same
reason.

Markup conversion is CHANNEL ownership: the worker hands the neutral
text (the Markdown denominator) over verbatim, the channel converts
inside ``send`` — every messenger has its own control syntax. Part 3
ships the identity conversion of the mock; Markdown→Telegram HTML is
part 4; there is deliberately no shared converter (YAGNI — one channel).

Failure taxonomy (spec §3.2): the worker counts retries, the channel
classifies the failure — it is the only one that knows the transport.
An unclassified exception escaping ``send``/``is_available`` (a channel
bug, NOT a ``ChannelError``) is handled by the worker as an application
error: loud trace + the channel closes without retries (spec §3.2).
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable


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


@runtime_checkable
class Channel(Protocol):
    """The delivery seam (family §3.5, ADR 011): ``name`` — the registry
    key and the payload channel record value; ``is_available`` — the
    cheap "setting filled AND transport answers" probe (no attempt is
    burned on an unavailable channel); ``send`` — convert the neutral
    markup and deliver; returning without an exception = delivered."""

    name: str

    async def is_available(self) -> bool: ...

    async def send(self, address: str, text_neutral: str) -> None: ...
