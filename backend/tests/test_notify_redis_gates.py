"""GH #483 Task 3 (spec §3.1): fail-fast startup gates and the failure
volume of the notify Redis transport.

- empty ``REDIS_URL`` → exit code 2 with the stable message «notify:
  transport not configured» (the value itself NEVER appears anywhere);
- configured but unreachable Redis → PING at start fails loudly, exit
  code 2 — never silent loop rotation;
- transport failures are NEVER muted: every redis error surfaces as the
  typed ``NotifyTransportError`` (the dispatcher tells a transport
  outage from a scenario error by that class — Task 4).

The seams under test live in ``src/notify/redis_queue.py``
(``connect_or_exit`` + ``RedisQueue.ping``); the dispatcher/worker
processes consume them in Tasks 4/5.

Marked ``redis`` with the declarative ``skipif`` guard over
``REDIS_URL`` (§3.6); each test works in its own key-prefix workspace.
"""

import pytest
from redis.exceptions import RedisError

from src.notify.queue import NotifyQueue
from src.notify.redis_queue import (
    TRANSPORT_NOT_CONFIGURED_MESSAGE,
    NotifyTransportError,
    RedisQueue,
    connect_or_exit,
)
from tests.notify_redis_support import (
    RedisContour,
    capture_notify_logs,
    contour_fixture,
    redis_marks,
    redis_url,
)

pytestmark = redis_marks

contour = contour_fixture()  # per-test isolated workspace fixture (§3.6)

#: Unreachable endpoint: nothing listens on port 1; localhost refusal is
#: immediate (no timeout wait). Credentials in the URL double as a leak probe.
_UNREACHABLE_URL = "redis://default:topsecret@127.0.0.1:1/0"
_SECRET = "topsecret"


class TestEmptyUrlGate:
    def test_exits_code_2_with_stable_message(self) -> None:
        with (
            capture_notify_logs("memo.notify.redis_queue") as messages,
            pytest.raises(SystemExit) as exit_info,
        ):
            connect_or_exit("")
        assert exit_info.value.code == 2
        assert any(TRANSPORT_NOT_CONFIGURED_MESSAGE in m for m in messages)


class TestUnreachableGate:
    def test_ping_failure_exits_code_2_loudly(self) -> None:
        """Configured but dead Redis: the PING gate refuses to start the
        process — loud failure, exit code 2, not silent rotation."""
        with (
            capture_notify_logs("memo.notify.redis_queue") as messages,
            pytest.raises(SystemExit) as exit_info,
        ):
            connect_or_exit(_UNREACHABLE_URL)
        assert exit_info.value.code == 2
        # loud: the original exception class is in the journal (§3.1)
        assert any("ConnectionError" in m or "TimeoutError" in m for m in messages)

    def test_url_value_never_leaks_into_logs_or_error(self) -> None:
        with (
            capture_notify_logs("memo.notify.redis_queue") as messages,
            pytest.raises(SystemExit),
        ):
            connect_or_exit(_UNREACHABLE_URL)
        assert all(_SECRET not in m for m in messages)
        assert all("/0" not in m for m in messages)  # no URL tail anywhere


class TestConfiguredGate:
    def test_reachable_redis_returns_protocol_ready_queue(
        self, contour: RedisContour
    ) -> None:
        q = connect_or_exit(redis_url(), key_prefix=contour.prefix)
        try:
            assert isinstance(q, RedisQueue)
            assert isinstance(q, NotifyQueue)  # runtime_checkable protocol
        finally:
            q.close()


class TestTransportFailureVolume:
    """Spec §3.1: transport exceptions are never muted and never
    masquerade as an empty queue — they surface TYPED and LOUD."""

    def _dead_queue(self) -> RedisQueue:
        return RedisQueue(_UNREACHABLE_URL, key_prefix="t483dead:")

    def test_enqueue_failure_is_typed_and_loud(self) -> None:
        with pytest.raises(NotifyTransportError) as exc_info:
            self._dead_queue().enqueue_task({"task_id": 1})
        message = str(exc_info.value)
        assert "ConnectionError" in message or "TimeoutError" in message
        assert _SECRET not in message

    def test_claim_failure_never_masquerades_as_empty_queue(self) -> None:
        """A silent ``[]`` would read as "no events" — the outage must
        propagate to the dispatcher's per-tick handler instead."""
        with pytest.raises(NotifyTransportError):
            self._dead_queue().claim_statuses()
        with pytest.raises(NotifyTransportError):
            self._dead_queue().claim_inbound()

    def test_transport_error_is_distinct_from_redis_errors(self) -> None:
        """The typed boundary: the dispatcher filters on
        ``NotifyTransportError`` exactly — it must not be a redis-py
        error class itself (that would blur the scenario/transport split)."""
        assert not issubclass(NotifyTransportError, RedisError)

    def test_adapter_failure_does_not_kill_caller_context(self) -> None:
        """Failure volume (§3.1): a raising transport call leaves the
        caller alive — the next tick retries; nothing is swallowed in
        between (the exception is seen, then handled by the caller)."""
        q = self._dead_queue()
        seen: list[BaseException] = []
        for _tick in range(3):  # dispatcher-style: raise → log → next tick
            try:
                q.ping()
            except NotifyTransportError as exc:  # Task 4's catch shape
                seen.append(exc)
        assert len(seen) == 3
        assert all(type(exc) is NotifyTransportError for exc in seen)
