"""GH #239 — SSE endpoint ``GET /api/v1/events`` (spec §3.2, §2.3, §2.9).

FastAPI ≥0.141 routing-native SSE: the path operation is an async GENERATOR
yielding :class:`~fastapi.sse.ServerSentEvent` items, declared with
``response_class=EventSourceResponse``. The routing layer then:

* encodes each item via ``format_sse_event`` (``event:``/``data:``/``retry:``
  wire fields — W3C framing);
* inserts ``: ping`` keepalive comments after ~15s of idle (spec §2.9
  heartbeat — no manual ping loop needed here);
* sets ``Content-Type: text/event-stream``, ``Cache-Control: no-cache`` and
  ``X-Accel-Buffering: no``;
* cancels the generator on client disconnect, running its ``finally`` —
  where the hub queue is unsubscribed (no leaked subscribers).

Contract on the wire:

* first frame — ``event: ready``, ``data: {}`` and ``retry: 5000`` (server-
  paced reconnect delay; the browser default ~3s is too aggressive, §2.9);
* subsequent frames — ``event: invalidate`` with
  ``data: {"entities": [...], "origin": ...}`` from the hub (spec §2.4);
* deliberately NO ``id:`` fields — replay/Last-Event-ID is a rejected
  feature (spec §2.3): missed events are covered by reconnect convergence
  (blanket invalidation client-side).
"""

from collections.abc import AsyncIterator

from fastapi import APIRouter
from fastapi.sse import EventSourceResponse, ServerSentEvent

from src.events.hub import hub

router = APIRouter(tags=["events"])

# Server-paced reconnect delay for the browser's EventSource (spec §2.9).
_RETRY_MS = 5000


@router.get("/events", response_class=EventSourceResponse)
async def events() -> AsyncIterator[ServerSentEvent]:
    """Stream cache-invalidation hints (GH #239, spec §3.2)."""
    queue = hub.subscribe()
    try:
        # Connection-start frame: paces reconnect (retry) and lets the client
        # distinguish "connected" from "connecting". data={} serializes as a
        # JSON object, not a quoted string.
        yield ServerSentEvent(event="ready", data={}, retry=_RETRY_MS)
        while True:
            entities, origin = await queue.get()
            yield ServerSentEvent(
                event="invalidate",
                data={"entities": sorted(entities), "origin": origin},
            )
            # Idle gaps are covered by the routing-native ": ping"
            # keepalive — nothing to do on timeout here.
    finally:
        # Client disconnect cancels the generator; never leak the queue.
        hub.unsubscribe(queue)
