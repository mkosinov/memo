"""GH #239 — in-memory event hub for cache invalidation fanout (spec §3.1).

Transport-agnostic pub/sub: SSE connections subscribe today; a future WS
endpoint subscribes identically. Module-level singleton — services are
``@lru_cache`` singletons with no app reference, so ``app.state`` is
unreachable from the ``@transactional`` decorator; lifespan/router/decorator
all import the SAME ``hub`` object below.

Single-event-loop assumption: ``asyncio.Queue`` binds to the running loop on
first await, so ``subscribe()``/``publish()`` must be called on the app's ONE
event loop (FastAPI/uvicorn guarantee this — all handlers share it).
``publish()`` is sync and ``put_nowait``-only BY DESIGN: it is called from
``@transactional`` wrappers after commit and must never block or await there.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, TypedDict

if TYPE_CHECKING:
    from collections.abc import Iterable


class Origin(TypedDict):
    """Who caused the write (spec §2.4 envelope). Only ``"tab"`` exists today.

    Future writer types (``user``, ``client``, ``system``, ``external``) extend
    this envelope when they appear — documented, not built.
    """

    type: str
    id: str | None


class EventHub:
    """In-memory fanout with drop-on-overflow backpressure (spec §2.8).

    Each subscriber owns a bounded queue (~64 events). A slow consumer whose
    queue fills is dropped — its connection closes, the client reconnects and
    blanket-invalidates (convergence, spec §2.3).
    """

    def __init__(self, maxsize: int = 64) -> None:
        self._maxsize = maxsize
        self._subscribers: set[asyncio.Queue[tuple[set[str], Origin | None]]] = set()

    def subscribe(self) -> asyncio.Queue[tuple[set[str], Origin | None]]:
        """Register a new subscriber and return its bounded queue."""
        q: asyncio.Queue[tuple[set[str], Origin | None]] = asyncio.Queue(maxsize=self._maxsize)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[tuple[set[str], Origin | None]]) -> None:
        """Remove a subscriber (client disconnect); missing queues are ignored."""
        self._subscribers.discard(q)

    def publish(self, entities: Iterable[str], origin: Origin | None) -> None:
        """Fan one event out to every subscriber.

        The payload is ``(deduped entity-name set, origin)``. A full queue
        drops that subscriber (it reconnects and blanket-invalidates).
        """
        payload = (set(entities), origin)
        for q in list(self._subscribers):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                self._subscribers.discard(q)  # drop slow consumer; it reconnects


hub = EventHub()  # module singleton; lifespan/router/decorator all import THIS object
