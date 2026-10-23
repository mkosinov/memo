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

from collections.abc import Callable

from src.notify.channels.base import Channel

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
    registered — SystemExit(2) with a STABLE message before the group
    is created or the queue consumed."""
    known = registry if registry is not None else CHANNELS
    for name in names:
        if name not in known:
            raise SystemExit(2, NOT_REGISTERED_MESSAGE.format(name))


def build_instances(names: list[str]) -> dict[str, Channel]:
    """Instantiate ONLY the prioritized channels."""
    return {name: CHANNELS[name]() for name in names}
