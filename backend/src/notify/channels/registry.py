"""The declarative channel registry (GH #484 part 3, spec §3.3; ADR 011
— the ``SCENARIOS`` pattern of part 1).

``CHANNELS`` maps a channel name to a zero-argument factory. A new
channel is a module + one bottom-of-module registration line + its
settings — the delivery core never changes (ADR 011). The mock channel
(``src.notify/channels/mock.py``) is registered only outside production
(spec §3.3): the observability channel is not part of the production
registry, a production priority naming it gets the loud «not registered»
startup error — honest until the real channels of part 4.

``parse_channel_priority`` lives here — the canonical home of the
channel-name vocabulary — and is moved VERBATIM from ``dispatcher.py``:
the worker must not import the dispatcher (it would pull the SQLAlchemy
graph against ADR 009); the dispatcher re-imports the function from
here, its behavior unchanged.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import TYPE_CHECKING

from src.notify.channels.base import Channel

if TYPE_CHECKING:
    from src.notify.channels.limits import ChannelLimiter

# The notify family logger convention (src/notify/journal.py):
# "memo.notify.<module>", independent of import paths.
logger = logging.getLogger("memo.notify.registry")

#: Zero-argument factory of a channel instance (the registry value).
ChannelFactory = Callable[[], Channel]

#: The declarative registry (ADR 011). Entries are added at the BOTTOM
#: of each channel module — never mutated at runtime outside import time
#: and tests.
CHANNELS: dict[str, ChannelFactory] = {}

#: Stable startup-gate message (spec §3.3). Formats the channel name.
NOT_REGISTERED_MESSAGE = "notify worker: channel {!r} is not registered"


# ── channel priority parsing (family §4.5; moved verbatim from dispatcher) ───


def parse_channel_priority(raw: str) -> list[str]:
    """Parse ``NOTIFY_CHANNEL_PRIORITY`` (CSV, case-insensitive).

    An empty string (or an empty segment) or duplicate names are a LOUD
    startup error: the setting must never produce an empty/duplicated
    channel list in task payloads. Channel NAMES are not validated here
    — an unregistered channel is the worker's loud startup error
    (family §3.5, part 3).
    """
    names = [part.strip().lower() for part in raw.strip().split(",")]
    if not any(names):
        raise ValueError(
            f"NOTIFY_CHANNEL_PRIORITY is empty — at least one channel is required (got {raw!r})"
        )
    if any(not name for name in names):
        raise ValueError(f"NOTIFY_CHANNEL_PRIORITY has empty segments (got {raw!r})")
    seen: set[str] = set()
    for name in names:
        if name in seen:
            raise ValueError(f"NOTIFY_CHANNEL_PRIORITY duplicate channel {name!r} (got {raw!r})")
        seen.add(name)
    return names


# ── startup gate + instance building (spec §3.3) ─────────────────────────────


def validate_priority_channels(
    names: list[str], registry: dict[str, ChannelFactory] | None = None
) -> None:
    """Loud startup gate (spec §3.3): every priority name must be
    registered — the STABLE message is logged (module logger) and the
    process exits with code 2 BEFORE the group is created or the queue
    consumed. The ``connect_or_exit`` precedent: a tuple-form
    ``SystemExit(2, msg)`` would make the interpreter exit 1 and break
    the exit-code contract."""
    known = registry if registry is not None else CHANNELS
    for name in names:
        if name not in known:
            logger.error(NOT_REGISTERED_MESSAGE.format(name))
            raise SystemExit(2)


def build_instances(
    names: list[str], *, limiter: ChannelLimiter | None = None
) -> dict[str, Channel]:
    """Instantiate ONLY the prioritized channels. With ``limiter``
    (#485 Task 3, spec §4.4/§6.3) every instance is wrapped by the
    send-limits mechanism — the worker's production wiring; without it
    the raw registry instances come back (tests inject instances
    as-is and wrap them explicitly when a contour wants limits)."""
    instances: dict[str, Channel] = {name: CHANNELS[name]() for name in names}
    if limiter is not None:
        return {name: limiter.wrap(channel) for name, channel in instances.items()}
    return instances
