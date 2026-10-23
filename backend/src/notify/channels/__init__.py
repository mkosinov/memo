"""The channels package (GH #484 part 3 of the notify family #476; spec
§3.2/§3.3; ADR 011 — registry-based channel extensions).

- ``base`` — the async channel protocol and the failure taxonomy;
- ``registry`` — the declarative ``CHANNELS`` registry and the
  channel-priority helpers (``parse_channel_priority`` lives here — the
  canonical home of the channel-name vocabulary);
- ``mock`` — the observability mock channel + delivery recorders; the
  module registers itself at the bottom and is NOT registered under
  ``ENV=production``.

Real channels (part 4) register the same way: a module + one bottom-of-
module registration line + settings, the core never changes.
"""
