"""GH #580 Task 1 (spec §3.6): the generic streams transport core
``src/streams/transport.py`` — the raw-XAUTOCLAIM contract.

The core's ``autoclaim`` is a RAW PEL transfer: claimed entries move to
the calling consumer's PEL and are handed to the caller as stored — the
core NEVER re-XADDs them back to the stream. Notify's ``RedisQueue``
wraps the transfer with re-XADD + ack for its fresh-delivery semantics;
the #580 subscribers redeliver by processing the claimed entry directly
(a re-XADD on every reclaim would churn the relay stream, spec §3.6).

Marked ``redis`` with the declarative ``skipif`` guard over
``REDIS_URL``; per-test key-prefix workspace (tests/notify_redis_support).
"""

import json

from src.streams.transport import ENVELOPE_KEY, PAYLOAD_FIELD, StreamTransport
from tests.notify_redis_support import (
    RedisContour,
    contour_fixture,
    make_status,
    redis_marks,
    redis_url,
)

pytestmark = redis_marks

contour = contour_fixture()  # per-test isolated workspace (GH #483 §3.6)


def _core(contour: RedisContour, **kwargs: object) -> StreamTransport:
    """A core transport bound to this test's key prefix — generic stream
    names (the core knows no notify vocabulary)."""
    return StreamTransport(redis_url(), key_prefix=contour.prefix, **kwargs)


class TestRawAutoclaim:
    def test_transfers_pel_without_re_adding_entries_to_stream(
        self, contour: RedisContour
    ) -> None:
        """The #580 task-1 seam: a claimed-but-unacked entry is returned
        to the CALLER via XAUTOCLAIM — the stream entry count must not
        grow (no re-XADD in the core), the entry stays unacked in the
        new consumer's PEL (ack is the caller's decision)."""
        stream_name = "notify:statuses"  # any name — the core is generic
        group = "dispatcher"
        dead = _core(contour, consumer_name="core-dead")
        dead.ensure_group(stream_name, group)
        dead.publish(stream_name, make_status(task_id="core-7"))
        (claimed,) = dead.claim(stream_name, group)
        full_stream = f"{contour.prefix}{stream_name}"
        assert contour.client.xlen(full_stream) == 1
        assert contour.client.xpending(full_stream, group)["pending"] == 1

        fresh = _core(contour, consumer_name="core-fresh", reclaim_min_idle_ms=0)
        entries = [entry for page in fresh.autoclaim(stream_name, group) for entry in page]

        # THE contract: raw transfer only — exactly the original entry
        # remains in the stream, no fresh-delivery copy was XADDed.
        assert contour.client.xlen(full_stream) == 1
        # the transfer happened: the entry moved to the new consumer's
        # PEL, still unacked.
        assert contour.client.xpending(full_stream, group)["pending"] == 1
        held = contour.client.xpending_range(
            full_stream, group, min="-", max="+", count=10, consumername="core-fresh"
        )
        assert [entry["message_id"] for entry in held] == [claimed[ENVELOPE_KEY]]
        # the caller receives the entry as stored (id + verbatim fields);
        # re-XADD / ack wrapping is the caller's, not the core's.
        (entry_id, fields) = entries[0]
        assert entry_id == claimed[ENVELOPE_KEY]
        assert json.loads(fields[PAYLOAD_FIELD])["task_id"] == "core-7"
