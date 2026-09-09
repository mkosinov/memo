"""GH #239 — EventHub unit tests (spec §3.1: fanout, dedupe, overflow-drop, unsubscribe).

Pure unit tests: no DB, no HTTP — the hub is an in-memory fanout primitive.
"""

import asyncio

import pytest

from src.events.hub import EventHub

pytestmark = pytest.mark.pure_unit


async def test_publish_fans_out_to_all_subscribers():
    """Every subscriber receives the same (entities, origin) payload."""
    hub = EventHub()
    q1, q2 = hub.subscribe(), hub.subscribe()
    hub.publish(["records"], origin={"type": "tab", "id": "abc"})
    assert await asyncio.wait_for(q1.get(), 1) == ({"records"}, {"type": "tab", "id": "abc"})
    assert await asyncio.wait_for(q2.get(), 1) == ({"records"}, {"type": "tab", "id": "abc"})


async def test_publish_batch_dedupes_entities():
    """Duplicate entity names in one publish collapse into a set."""
    hub = EventHub()
    q = hub.subscribe()
    hub.publish(["records", "records", "visits"], origin=None)
    entities, origin = await asyncio.wait_for(q.get(), 1)
    assert entities == {"records", "visits"} and origin is None


async def test_overflow_drops_slow_subscriber():
    """A full bounded queue drops that subscriber; the hub itself survives."""
    hub = EventHub(maxsize=2)
    q = hub.subscribe()
    for _ in range(5):
        hub.publish(["records"], origin=None)  # no awaiting consumer
    assert q not in hub._subscribers  # dropped, others survive
    # Pin "hub survives": a fresh subscribe AFTER the drop still receives
    # the next publish — overflow removed one subscriber, not the hub.
    q2 = hub.subscribe()
    hub.publish(["visits"], origin=None)
    assert await asyncio.wait_for(q2.get(), 1) == ({"visits"}, None)
    assert q2 in hub._subscribers


async def test_unsubscribe_stops_delivery():
    """An unsubscribed queue receives nothing after unsubscribe."""
    hub = EventHub()
    q = hub.subscribe()
    hub.unsubscribe(q)
    hub.publish(["records"], origin=None)
    assert q.empty()
