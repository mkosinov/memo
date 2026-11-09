"""GH #580 Task 5 (spec §3.4, §5 scenario 6) — the subscription API
``src/domain_events/subscribe.py`` against a REAL Redis.

Scenario 6 ``test_domain_events_registry_multi``: the registry accepts a
second type → its stream key → ``ensure``/``claim`` on it → a SECOND
group gets its own copies of that stream's entries, independently of
the first group; ``ensure`` on an UNREGISTERED stream name is a
validation error (the registry gate; the mark-side negative branch of
the scenario is Task 2's DoD).

Plus the §3.4 seams the DoD scenario composes: the claim ``count`` cap
(an XREADGROUP COUNT at the server — never a client-side slice, which
would orphan the cap-tail in the consumer's PEL), ``ack`` by ``qid``,
``reclaim`` (the RAW core XAUTOCLAIM — claimed entries are handed to
the caller, nothing is re-XADDed) and ``close`` with
``keep_if_pending``.

Marked ``redis`` with the declarative ``skipif`` guard over
``REDIS_URL``; per-test key-prefix workspace (tests/notify_redis_support).
"""

from __future__ import annotations

from typing import Any

import pytest

from src.domain_events.subscribe import Subscriber
from src.domain_events.types import STREAM_KEY_PREFIX, register_type, stream_key
from src.streams.transport import StreamTransport
from tests.notify_redis_support import (
    RedisContour,
    contour_fixture,
    redis_marks,
    redis_url,
)

pytestmark = redis_marks

contour = contour_fixture()  # per-test isolated workspace (GH #483 §3.6)

#: The synthetic second type of scenario 6 — registered on an ISOLATED
#: copy of the registry (the ``test_types.py`` pattern; never leaks).
PROBE_CODE = "probe_second_type"

PILOT_KEY = stream_key("new_record")
PROBE_KEY = stream_key(PROBE_CODE)


@pytest.fixture
def isolated_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    """Scenario-6 registry: an isolated copy carrying the synthetic
    second type (the ``register_type`` verb on a monkeypatched dict —
    restored afterwards, no leak into other tests)."""
    from src.domain_events import types

    monkeypatch.setattr(types, "_REGISTRY", dict(types._REGISTRY))
    register_type(PROBE_CODE, "synthetic second type (scenario 6 probe)")


def _record(event_type: str, seq: int) -> dict[str, Any]:
    """One §4.1 stream record."""
    return {
        "event_id": f"00000000-0000-0000-0000-{seq:012d}",
        "type": event_type,
        "occurred_at": "2026-11-09T12:00:00",
        "snapshot": {"seq": seq},
    }


def _ids(*seqs: int) -> list[str]:
    return [f"00000000-0000-0000-0000-{seq:012d}" for seq in seqs]


def _producer(contour: RedisContour) -> StreamTransport:
    """A raw producer transport on the test's contour — the relay-side
    publish stand-in (XADD only, no group)."""
    return StreamTransport(redis_url(), key_prefix=contour.prefix)


class TestScenario6RegistryMulti:
    def test_domain_events_registry_multi(
        self, contour: RedisContour, isolated_registry: None
    ) -> None:
        """The registry takes a second type → its stream key works end to
        end: a second group consumes that stream's entries independently
        of the first group; an unregistered stream name fails ensure."""
        # the second type is registered → its stream key (§3.2)
        assert f"{STREAM_KEY_PREFIX}:{PROBE_CODE}" == PROBE_KEY

        producer = _producer(contour)
        for seq in (1, 2):
            producer.publish(PILOT_KEY, _record("new_record", seq))
        for seq in (3, 4, 5):
            producer.publish(PROBE_KEY, _record(PROBE_CODE, seq))

        # group alpha subscribes to BOTH streams — a late group (entries
        # published before ensure) reads from id=0: the whole history
        alpha = Subscriber(redis_url(), group="alpha", key_prefix=contour.prefix)
        alpha.ensure([PILOT_KEY, PROBE_KEY])
        got_alpha = alpha.claim([PILOT_KEY, PROBE_KEY], 10)
        assert [e.event_id for e in got_alpha] == _ids(1, 2, 3, 4, 5)
        # §4.1 parsed: typed fields + the transport ack handle
        first_probe = got_alpha[2]
        assert first_probe.type == PROBE_CODE
        assert first_probe.occurred_at == "2026-11-09T12:00:00"
        assert first_probe.snapshot == {"seq": 3}
        assert first_probe.qid

        # group beta — a DIFFERENT group — gets its OWN copies of the
        # probe stream entries regardless of alpha's claims
        beta = Subscriber(redis_url(), group="beta", key_prefix=contour.prefix)
        beta.ensure([PROBE_KEY])
        got_beta = beta.claim([PROBE_KEY], 10)
        assert [e.event_id for e in got_beta] == _ids(3, 4, 5)

        # alpha's group is drained — and beta's reads are not alpha's
        # consumption (independent group offsets)
        assert alpha.claim([PILOT_KEY, PROBE_KEY], 10) == []

        # negative: ensure on an UNREGISTERED stream name — the registry gate
        with pytest.raises(ValueError, match="not_a_registered_type"):
            alpha.ensure(["domain_events:not_a_registered_type"])


class TestClaimCount:
    def test_count_is_xreadgroup_count_not_a_slice(self, contour: RedisContour) -> None:
        """``count`` caps the batch AT THE SERVER (XREADGROUP COUNT): the
        entries beyond the cap are NOT claimed — a client-side slice of
        a full batch would orphan them in the consumer's PEL."""
        producer = _producer(contour)
        for seq in range(5):
            producer.publish(PILOT_KEY, _record("new_record", seq))
        full = f"{contour.prefix}{PILOT_KEY}"

        sub = Subscriber(redis_url(), group="cap", key_prefix=contour.prefix)
        sub.ensure([PILOT_KEY])
        got = sub.claim([PILOT_KEY], 2)
        assert len(got) == 2
        # exactly the RETURNED two sit in the PEL — the other three were
        # never claimed
        assert contour.client.xpending(full, "cap")["pending"] == 2


class TestAck:
    def test_ack_by_qid_removes_entry_from_redelivery(self, contour: RedisContour) -> None:
        """``ack`` confirms by ``qid`` after materialization; an unacked
        entry stays redeliverable through reclaim."""
        producer = _producer(contour)
        producer.publish(PILOT_KEY, _record("new_record", 1))
        producer.publish(PILOT_KEY, _record("new_record", 2))

        sub = Subscriber(redis_url(), group="acker", key_prefix=contour.prefix)
        sub.ensure([PILOT_KEY])
        first, second = sub.claim([PILOT_KEY], 10)
        sub.ack(PILOT_KEY, first.qid)

        # redelivery (immediate reclaim) returns ONLY the unacked entry
        hanging = sub.reclaim([PILOT_KEY], 0)
        assert [e.qid for e in hanging] == [second.qid]

        # the group's own claim sees nothing new either
        assert sub.claim([PILOT_KEY], 10) == []


class TestReclaim:
    def test_returns_hanging_entries_without_re_adding(self, contour: RedisContour) -> None:
        """``reclaim`` is the RAW core XAUTOCLAIM: claimed-but-unacked
        entries are handed to the caller as events — the stream does not
        grow (no re-XADD churn of the relay stream, §3.6 rev.2)."""
        producer = _producer(contour)
        producer.publish(PILOT_KEY, _record("new_record", 1))
        full = f"{contour.prefix}{PILOT_KEY}"

        sub = Subscriber(redis_url(), group="reclaimer", key_prefix=contour.prefix)
        sub.ensure([PILOT_KEY])
        (claimed,) = sub.claim([PILOT_KEY], 10)  # claimed, deliberately unacked

        hanging = sub.reclaim([PILOT_KEY], 0)
        assert [e.event_id for e in hanging] == [claimed.event_id]
        assert contour.client.xlen(full) == 1  # raw transfer, nothing re-XADDed


class TestClose:
    def test_close_keeps_consumer_with_nonempty_pel(self, contour: RedisContour) -> None:
        """keep_if_pending (§3.4): a consumer with unacked entries is NOT
        deregistered on close — ``XGROUP DELCONSUMER`` would destroy the
        delivery ledger; the pending entries must survive for the next
        start's reclaim."""
        producer = _producer(contour)
        for seq in (1, 2):
            producer.publish(PILOT_KEY, _record("new_record", seq))
        full = f"{contour.prefix}{PILOT_KEY}"

        sub = Subscriber(redis_url(), group="closer", key_prefix=contour.prefix)
        sub.ensure([PILOT_KEY])
        got = sub.claim([PILOT_KEY], 10)  # two unacked → non-empty PEL
        assert len(got) == 2
        sub.close()

        assert contour.client.xpending(full, "closer")["pending"] == 2


class TestPing:
    def test_ping_answers(self, contour: RedisContour) -> None:
        """The startup probe seam (the ``connect_or_exit`` gate of the
        Task-6 dispatcher process)."""
        Subscriber(redis_url(), group="pinger", key_prefix=contour.prefix).ping()
