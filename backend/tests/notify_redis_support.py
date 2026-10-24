"""Shared support for the marked notify-Redis test contour (GH #483 §3.6).

Not a test module (no ``test_`` prefix) — imported by
``tests/test_notify_redis_*.py``. Provides:

- the module-level ``redis`` marker + declarative ``skipif`` guard over
  ``REDIS_URL`` (pytest skips without the variable — the standard
  no-Redis run stays green, invariant US-7/S2);
- a per-test workspace: UNIQUE key prefix (isolation on a shared dev
  instance) + SCAN-scoped cleanup — never FLUSHDB of a foreign index;
- queue/client factories mirroring the adapter's client options.
"""

from __future__ import annotations

import logging
import os
import uuid
from contextlib import contextmanager
from typing import TYPE_CHECKING, Any

import pytest
from redis import Redis

from src.notify.redis_queue import RedisQueue

if TYPE_CHECKING:
    from collections.abc import Iterator

# ── contour guard: declarative skipif, no runtime pytest.skip calls ─────────

redis_env = os.environ.get("REDIS_URL")
#: Combined module mark: real-Redis contour + guard over ``REDIS_URL``.
redis_marks = [
    pytest.mark.redis,
    pytest.mark.skipif(
        not redis_env,
        reason="REDIS_URL not set — notify Redis contour skipped (GH #483 §3.6)",
    ),
]


def redis_url() -> str:
    """The contour endpoint — set by the runner (dev shell / CI job)."""
    return os.environ["REDIS_URL"]


#: Family §4.2 task payload sample (task_id — UUID string, #560 errata).
def make_task(task_id: str = "123e4567-e89b-12d3-a456-426614174000") -> dict[str, Any]:
    return {
        "task_id": task_id,
        "text": "Готовый текст",
        "channels": [{"name": "telegram", "address": "+79990001122"}],
        "created_at": "2026-10-20T10:00:00",
        "resend_of": None,
    }


#: Family §4.3 worker stage event sample.
def make_status(
    task_id: str = "123e4567-e89b-12d3-a456-426614174000",
    stage: str = "sending",
) -> dict[str, Any]:
    return {
        "task_id": task_id,
        "stage": stage,
        "channel": "telegram",
        "outcome": None,
        "error": None,
        "occurred_at": "2026-10-20T10:00:05",
    }


#: Part-2 spec §3.2 inbound reply sample.
def make_inbound(task_id: str = "123e4567-e89b-12d3-a456-426614174000") -> dict[str, Any]:
    return {
        "channel": "telegram",
        "external_address": "+79990001122",
        "kind": "text",
        "text": "Ответ клиента",
        "task_id": task_id,
        "occurred_at": "2026-10-20T10:01:00Z",
    }


def raw_client() -> Redis:
    """Plain redis-py client with the adapter's decoding options — the
    test-side view of the same streams (the part-3 worker stand-in)."""
    return Redis.from_url(redis_url(), decode_responses=True)


def cleanup_prefix(client: Redis, prefix: str) -> None:
    """Delete every key under ``prefix`` (SCAN-scoped — a shared instance
    keeps everything outside the prefix, incl. a live dev contour)."""
    batch: list[str] = []
    for key in client.scan_iter(match=f"{prefix}*"):
        batch.append(key)
        if len(batch) >= 200:
            client.delete(*batch)
            batch.clear()
    if batch:
        client.delete(*batch)


class RedisContour:
    """One test's workspace: unique key prefix, queue factory, cleanup.

    Each contour test module exposes this as its local ``contour``
    fixture (function-scoped, cleanup in the finalizer) — a fixture
    import into the module namespace collides with parameter names
    under ruff's F811, so the 6-line fixture is defined per file.
    """

    def __init__(self) -> None:
        self.client = raw_client()
        self.prefix = f"t483:{uuid.uuid4().hex[:12]}:"

    def queue(self, **kwargs: Any) -> RedisQueue:
        """A ``RedisQueue`` bound to this test's key prefix."""
        return RedisQueue(redis_url(), key_prefix=self.prefix, **kwargs)

    def cleanup(self) -> None:
        cleanup_prefix(self.client, self.prefix)
        self.client.close()


def contour_fixture() -> Any:
    """Decorator turning the shared workspace lifecycle into a local
    per-module fixture (keeps a single source of truth for setup)."""

    def factory() -> Iterator[RedisContour]:
        workspace = RedisContour()
        yield workspace
        workspace.cleanup()

    return pytest.fixture(factory)


# ── log assertions (repo constraint, same pattern as test_notify_dispatcher) ──


class _ListHandler(logging.Handler):
    """In-memory sink — caplog is unusable in this repo (the session
    schema setup runs alembic/env.py whose ``fileConfig`` defaults to
    ``disable_existing_loggers=True``, silently dropping records from
    collection-time loggers)."""

    def __init__(self) -> None:
        super().__init__()
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(record.getMessage())


@contextmanager
def capture_notify_logs(
    logger_name: str = "memo.notify.redis_queue",
) -> Iterator[list[str]]:
    """Attach an in-memory sink to a notify logger and force-enable it
    for the capture window (the alembic fileConfig disables collection
    time loggers — see above); state restored afterwards."""
    lg = logging.getLogger(logger_name)
    handler = _ListHandler()
    old_level, old_disabled = lg.level, lg.disabled
    lg.setLevel(logging.DEBUG)
    lg.disabled = False
    lg.addHandler(handler)
    try:
        yield handler.messages
    finally:
        lg.removeHandler(handler)
        lg.setLevel(old_level)
        lg.disabled = old_disabled
