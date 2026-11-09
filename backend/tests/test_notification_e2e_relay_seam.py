"""GH #580 — seam guard: the notify e2e contour wires the domain-events relay.

The CI incident class this pins is the ``dev.sh`` ↔ shard-script drift:
Task 4 wired the relay into ``dev.sh --notify`` ONLY, so the enabled
contour of ``scripts/e2e-shard-start.sh`` started backend + dispatcher +
worker but NOT the relay — and never exported ``DOMAIN_EVENTS_ENABLED``
(default False → the relay child would exit 0 anyway). The post-#580
chain is journal mark → relay XADD → dispatcher group consumer → task
row; without the relay the S1 predicate can never become true (the
deterministic 30s timeout of ``e2e/notify-s1-enabled-stack.spec.ts:64``).

Plain text assertions on the script content (no bash execution): the
seam, not the runtime, is what drifted. The three legs of the wiring —
the relay child spawn, the gate export, and the ``RELAY_PID`` lifecycle
in the trap cleanup — are each asserted separately so a future partial
revert names the missing leg.
"""

from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

#: Repo root — ``backend/tests/<this>.py`` → repo root (same resolution
#: as test_notification_redis_s1_queue.py).
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent

_SHARD_SCRIPT = _REPO_ROOT / "scripts" / "e2e-shard-start.sh"

#: The relay child spawn — the same exec form as the dispatcher/worker
#: spawns (``$!`` is the REAL process; TERM teardown reaches it).
_RELAY_SPAWN = (
    '(cd "$BACKEND_DIR" && ENV_FILE=.env.test '
    'exec .venv/bin/python -m src.domain_events.relay) &'
)
_RELAY_KILL = '[ -n "$RELAY_PID" ] && kill "$RELAY_PID" 2>/dev/null || true'
_RELAY_WAIT = '[ -n "$RELAY_PID" ] && wait "$RELAY_PID" 2>/dev/null || true'
_WORKER_KILL = '[ -n "$WORKER_PID" ] && kill "$WORKER_PID" 2>/dev/null || true'
_REDIS_KILL = '[ -n "$REDIS_PID" ] && kill "$REDIS_PID" 2>/dev/null || true'


def test_enabled_contour_wires_the_domain_events_relay() -> None:
    """All three relay legs of the enabled contour are present."""
    text = _SHARD_SCRIPT.read_text(encoding="utf-8")

    # Leg 1 — the relay child spawn (the third consumer of the contour).
    assert _RELAY_SPAWN in text, "relay child spawn missing from the enabled contour"

    # Leg 2 — the gate export: without it the relay child exits 0
    # (DOMAIN_EVENTS_ENABLED defaults to False in the backend config).
    assert "export DOMAIN_EVENTS_ENABLED=true" in text, (
        "DOMAIN_EVENTS_ENABLED=true export missing — the relay child would exit 0"
    )

    # Leg 3 — the PID lifecycle: init, capture, kill+wait in the trap
    # cleanup, ordered worker → relay → redis (the dev.sh convention).
    assert 'RELAY_PID=""' in text
    assert "RELAY_PID=$!" in text
    assert _RELAY_KILL in text, "cleanup never kills RELAY_PID (orphaned relay)"
    assert _RELAY_WAIT in text, "cleanup never waits RELAY_PID"
    assert text.index(_WORKER_KILL) < text.index(_RELAY_KILL) < text.index(_REDIS_KILL), (
        "cleanup kill order must stay dispatcher → worker → relay → redis (dev.sh convention)"
    )
