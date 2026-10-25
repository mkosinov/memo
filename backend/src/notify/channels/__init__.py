"""The channels package (GH #484 part 3 of the notify family #476; spec
§3.2/§3.3; ADR 011 — registry-based channel extensions).

- ``base`` — the async channel protocol and the failure taxonomy;
- ``limits`` — the common send-limits mechanism (#485 Task 3, spec
  §4.4/§6.3): the Redis cap-window store, the ``ChannelLimiter``
  governor (cap gate + admin service message + async pause), and the
  ``LimitedChannel`` registry wrapper;
- ``registry`` — the declarative ``CHANNELS`` registry and the
  channel-priority helpers (``parse_channel_priority`` lives here — the
  canonical home of the channel-name vocabulary);
- ``mock`` — the observability mock channel + delivery recorders; the
  module registers itself at the bottom and is NOT registered under
  ``ENV=production``;
- ``telegram`` — the REAL Telegram channel (#485 part 4, Telethon over
  MTProto); registers itself at the bottom with NO ENV gate — the
  production registry.

Real channels (part 4) register the same way: a module + one bottom-of-
module registration line + settings, the core never changes.
"""

from src.notify.channels import (
    mock,  # noqa: F401 — the registration import
    telegram,  # noqa: F401 — the registration import
)

# The registry populates at IMPORT time (ADR 011: a channel module
# registers itself at its bottom) — THIS package import is the hook
# pulling every shipped channel module in: ``from
# src.notify.channels.registry import ...`` (the worker's only channel
# import) imports the package first, so the process entry sees a filled
# registry. A part-4 channel adds one import line here.
