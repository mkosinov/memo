"""GH #485 Task 3 (spec §4.4) — ``RedisCapStore`` against a REAL
Redis: the daily-cap window counter (INCR + the FIRST-INCR 48 h
EXPIRE) and the one-per-window notified flag.

Marked ``redis`` with a declarative ``skipif`` guard over ``REDIS_URL``
(the §3.6 contour convention): without the variable every test here
skips and the standard no-Redis run stays green. Each test works in
its own key-prefix workspace (``contour`` fixture) and cleans up —
safe on a machine where a dev contour lives on the same instance.
"""

from datetime import date

import pytest

from src.notify.channels.base import ChannelTransportError
from src.notify.channels.limits import (
    CAP_WINDOW_TTL_SECONDS,
    RedisCapStore,
    cap_key,
    cap_notified_key,
)
from tests.notify_redis_support import contour_fixture, redis_marks, redis_url

pytestmark = redis_marks

contour = contour_fixture()  # per-test isolated workspace fixture (§3.6)

#: A fixed window date — the store never reads the clock; keys are
#: pure functions of (channel, date), so a fixed date is the contract.
TODAY = date(2026, 10, 25)


class TestCapWindowCounter:
    def test_first_register_creates_the_window_with_48h_ttl(self, contour) -> None:
        store = RedisCapStore(redis_url(), key_prefix=contour.prefix)
        key = f"{contour.prefix}{cap_key('mock', TODAY)}"

        store.register_send("mock", TODAY)

        assert contour.client.get(key) == "1"
        assert 0 < contour.client.ttl(key) <= CAP_WINDOW_TTL_SECONDS

    def test_register_increments_and_count_reads_back(self, contour) -> None:
        store = RedisCapStore(redis_url(), key_prefix=contour.prefix)

        assert store.window_count("mock", TODAY) == 0  # missing key → 0
        store.register_send("mock", TODAY)
        store.register_send("mock", TODAY)

        assert store.window_count("mock", TODAY) == 2

    def test_windows_of_different_utc_days_are_independent(self, contour) -> None:
        store = RedisCapStore(redis_url(), key_prefix=contour.prefix)

        store.register_send("mock", TODAY)

        assert store.window_count("mock", date(2026, 10, 26)) == 0

    def test_windows_of_different_channels_are_independent(self, contour) -> None:
        store = RedisCapStore(redis_url(), key_prefix=contour.prefix)

        store.register_send("telegram", TODAY)
        store.register_send("telegram", TODAY)

        assert store.window_count("mock", TODAY) == 0


class TestWindowNotifiedFlag:
    def test_flag_unset_then_set_with_48h_ttl(self, contour) -> None:
        store = RedisCapStore(redis_url(), key_prefix=contour.prefix)
        key = f"{contour.prefix}{cap_notified_key('mock', TODAY)}"

        assert store.window_notified("mock", TODAY) is False

        store.mark_window_notified("mock", TODAY)

        assert store.window_notified("mock", TODAY) is True
        assert 0 < contour.client.ttl(key) <= CAP_WINDOW_TTL_SECONDS


class TestStoreOutage:
    def test_redis_outage_is_a_channel_transport_error(self) -> None:
        """The recorder precedent: the store is part of the channel's
        send path — an outage is RETRIABLE (a transport error), never
        an app error and never muted. Port 1: nothing listens, the
        refusal is immediate."""
        store = RedisCapStore("redis://127.0.0.1:1/0")

        with pytest.raises(ChannelTransportError):
            store.window_count("mock", TODAY)
