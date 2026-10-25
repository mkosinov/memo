"""The SECOND mock channel — ``mock2`` (GH #485 Task 6, spec §12
scenario 3: «Первый канал упал — доставка проходит вторым каналом
цепочки»; family #476 US-5).

The e2e leg of scenario 3 needs TWO mock channels in the enabled
stack's priority — the notify-tests contour covers the chain spawn with
INJECTED instances, the production registry of the e2e stack carries
this second STATIC mock (``NOTIFY_CHANNEL_PRIORITY=mock,mock2`` in
``scripts/e2e-shard-start.sh``). Everything else mirrors the #484 mock
canon (spec §3.6): outcomes scripted by the SAME address markers
(``fail-transport:`` / ``fail-app:``), the plain-text ``escape_mode =
"none"`` (rev.5 — ADR 014: channels convert no markup), deliveries into
a recorder artifact.

The deliberate differences from ``mock`` — and the reasons:

- STATIC registration, NO env gate: a channel outside the priority
  list never receives tasks, so a second mock in the registry is INERT
  in a production environment (the subsystem there is behind
  ``NOTIFY_ENABLED=false``; mock's own ``is_mock_allowed`` gate remains
  the #484 canon for the FIRST observability channel);
- mock2's OWN ``ChannelLimits`` (spec §4.4/§6.3): the same small
  exhaustible cap as mock's — a per-channel cap WINDOW is what lets a
  contour kill channel 1 while channel 2 still delivers — with the
  display name ``Mock 2`` for the §6.3 service sentence;
- mock2's OWN bounded Redis artifact list
  (``notify:mock2:deliveries``): per-channel attribution — the chain
  scenarios must see WHICH channel delivered; a blended list would
  lose exactly that.

The registry factory builds the Redis recorder from ``REDIS_URL``
(the pool is lazy — the factory call connects to nothing); tests never
call it — instances are injected directly through the ``main`` seam
(Task 5).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from src.core.config import settings
from src.notify.channels.base import ChannelLimits
from src.notify.channels.mock import (
    MOCK_DAILY_CAP,
    MOCK_SEND_PAUSE_SECONDS,
    MockChannel,
    RedisListRecorder,
)
from src.notify.channels.registry import CHANNELS

if TYPE_CHECKING:
    from src.notify.assembly import EscapeMode
    from src.notify.channels.mock import Recorder

#: Bounded-artifact list of mock2's Redis recorder — its OWN list,
#: never mock's (spec §12 scenario 3: per-channel attribution — WHICH
#: channel delivered).
MOCK2_DELIVERIES_LIST = "notify:mock2:deliveries"

# ── mock2's OWN limit settings (spec §4.4/§6.3) ──────────────────────────────
#
# The same values as mock's (the second observability instrument is
# calibrated identically), composed into an OWN declaration: the
# per-channel cap window of the limits mechanism keys by the channel
# NAME, so identical caps never interfere — exhausting ``mock``'s
# window leaves ``mock2``'s untouched (the scenario-3 lever).

#: The declared default limits of mock2 (spec §4.4): the small
#: exhaustible ``daily_cap`` (same as mock's — a contour run exhausts
#: the window without hundreds of deliveries), no pause, no admin
#: message, the display name ``Mock 2``.
MOCK2_LIMITS = ChannelLimits(
    daily_cap=MOCK_DAILY_CAP,
    send_pause_seconds=MOCK_SEND_PAUSE_SECONDS,
    admin_address=None,
    display_name="Mock 2",
)


class Mock2Channel(MockChannel):
    """A ``MockChannel`` named ``mock2``: the SAME marker semantics
    (``fail-transport:`` / ``fail-app:`` / anything else delivers —
    spec §3.6), the same recorder seam and the plain-text escape mode,
    all inherited from ``MockChannel``; the OWN registry name and the
    own default limits declaration are the only differences."""

    name = "mock2"
    escape_mode: EscapeMode = "none"

    def __init__(
        self, recorder: Recorder, *, limits: ChannelLimits | None = None
    ) -> None:
        # Only the DEFAULT window differs from the parent — the contour
        # injection seam (``limits=``) is unchanged (Task 6 contours
        # inject their own windows through it).
        super().__init__(recorder, limits=MOCK2_LIMITS if limits is None else limits)


# Registry entry (ADR 011 — bottom-of-module registration). STATIC, no
# env gate: outside the priority list the channel never receives tasks
# (inert in a production registry; the subsystem there is behind
# NOTIFY_ENABLED=false). The factory is never called in tests:
# instances are injected through the ``main`` seam (Task 5); the
# enabled e2e stack gets the Redis artifact recorder from REDIS_URL —
# into mock2's OWN list, never mock's.
CHANNELS["mock2"] = lambda: Mock2Channel(
    RedisListRecorder(
        settings.REDIS_URL.get_secret_value(),
        list_name=MOCK2_DELIVERIES_LIST,
    )
)
