"""GH #483 Task 8 (spec §3.6, §4 S1) — the post-scenario queue check.

Runs AFTER the S1 Playwright scenario against the SAME enabled e2e stack
(``scripts/e2e-shard-start.sh`` in ``NOTIFY_E2E_ENABLED=1`` mode): the
scenario created a record with the «отправлять оповещения» checkbox, the
stack's dispatcher turned the journaled event into a task and enqueued
it. This check reads the REAL ``notify:tasks`` stream of that stack:

- the stream holds **≥ 1** task (never an exact count — the re-enqueue
  cycle may legitimately add a duplicate, family §4.4);
- every payload satisfies the family §4.2 rev.5+errata contract: the
  exact ten contract keys (``template_channel`` added by the errata of
  PR #569 — the template's origin channel, frozen into the task because
  the DB-less worker cannot resolve it from ``template_id``; ``null``
  means a universal template), ``task_id`` resolving into the stack's
  DB, non-empty frozen ``channel``/``address``, render ``payload``
  object, non-empty ``template_body``, ISO ``created_at``,
  ``resend_of: null``;
- at least ONE payload is FULLY correct: the DB row behind ``task_id``
  reached the queue (status in queued/sending/sent — #484 Task 8: the
  stack's worker may already have delivered it) and its frozen
  text/channels match the payload verbatim (the enqueue uses the frozen
  task values, never re-resolved).

Isolation profile (differs from the unit-contour modules on purpose):
this check consumes the stack's PRODUCTION vocabulary (no key prefix —
spec §3.5: the enabled stack runs unprefixed) and is therefore bound to
the enabled-stack environment, not to a scratch workspace. The runner
(CI notify job / local enabled-stack session) provides BOTH variables:

- ``REDIS_URL``    — the stack's Redis (CI service container / the local
  ephemeral child the stack spawned);
- ``TEST_DB_PATH`` — the stack's SQLite DB (payload ↔ row correlation).

Without either variable the module skips (declarative guard, US-7: the
standard no-Redis run stays green; the tracker sees no dynamic skips).
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
from typing import TYPE_CHECKING, Any

import pytest

from tests.notify_redis_support import raw_client

if TYPE_CHECKING:
    from redis import Redis

pytestmark = [
    pytest.mark.redis,
    pytest.mark.skipif(
        not os.environ.get("REDIS_URL") or not os.environ.get("TEST_DB_PATH"),
        reason=(
            "S1 post-scenario queue check needs the enabled e2e stack env: "
            "REDIS_URL (the stack's Redis) + TEST_DB_PATH (the stack's DB) — "
            "GH #483 §3.6"
        ),
    ),
]

#: How long the check waits for the dispatcher to surface the S1 task in
#: the stream: the scenario commits the event, the dispatcher polls every
#: ``NOTIFY_POLL_INTERVAL`` (1 s default) — seconds, not minutes. The
#: wait is LAG TOLERANCE, not a timer feature (the dispatcher's cadence
#: is the elapsed-seconds semantics here).
WAIT_SECONDS = 30

#: Task-row statuses that prove the pipeline reached the queue (#484
#: Task 8): the dispatcher CREATES the row as ``queued``; with the worker
#: now part of the enabled stack, the row may legitimately have advanced
#: to ``sending``/``sent`` by the time this check reads it. ``failed`` is
#: a genuine delivery failure and fails the check.
QUEUE_REACHED_STATUSES = {"queued", "sending", "sent"}

#: Family §4.2 rev.5+errata task payload — the exact key set of the
#: contract (one channel, frozen render data + template — ADR 014;
#: ``template_channel`` — the template's origin channel, errata PR #569:
#: frozen at enqueue time because the DB-less send worker cannot
#: resolve it from ``template_id``; ``null`` = universal template).
PAYLOAD_KEYS = {
    "task_id",
    "channel",
    "address",
    "payload",
    "template_id",
    "template_body",
    "template_channel",
    "root_task_id",
    "created_at",
    "resend_of",
}


def _stream_payloads(client: Redis) -> list[dict[str, Any]]:
    """Every payload of the stack's ``notify:tasks`` (DEFAULT key — the
    production stream vocabulary; no contour prefix, spec §3.5)."""
    entries = client.xrange("notify:tasks")
    return [json.loads(fields["payload"]) for _entry_id, fields in entries]


def _payload_problem(payload: Any) -> str | None:
    """Family §4.2 shape check — None if the payload satisfies the
    contract, otherwise a human-readable problem description."""
    if not isinstance(payload, dict):
        return f"payload is not an object: {payload!r}"
    if set(payload) != PAYLOAD_KEYS:
        return f"key set {sorted(payload)} != contract {sorted(PAYLOAD_KEYS)}"
    task_id = payload["task_id"]
    if not isinstance(task_id, str) or len(task_id) != 36:
        return f"task_id is not a UUID string: {task_id!r}"
    if not isinstance(payload["channel"], str) or not payload["channel"].strip():
        return "channel is empty or not a string"
    if not isinstance(payload["address"], str) or not payload["address"].strip():
        return "address is empty or not a string"
    if not isinstance(payload["payload"], dict):
        return "payload (render data) is not an object"
    if not isinstance(payload["template_body"], str) or not payload["template_body"].strip():
        return "template_body is empty or not a string"
    # Errata PR #569 (rev.5 §4.2): template_channel is the template's
    # origin channel frozen into the task — str, or None for a universal
    # template. Deliberately NOT correlated with payload["channel"]: a
    # telegram task carrying a universal template holds
    # template_channel=None while channel="telegram".
    template_channel = payload["template_channel"]
    if template_channel is not None and (
        not isinstance(template_channel, str) or not template_channel.strip()
    ):
        return f"template_channel is neither null nor a non-empty string: {template_channel!r}"
    if not isinstance(payload["created_at"], str) or not payload["created_at"]:
        return "created_at is empty or not a string"
    if payload["resend_of"] is not None:
        return f"resend_of is not null: {payload['resend_of']!r}"
    return None


#: Repo root — the stack resolves a relative TEST_DB_PATH against it
#: (e2e-shard-start.sh: ``ABS_DB_PATH="$ROOT_DIR/$TEST_DB_PATH"``).
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _db_task_row(task_id: str) -> dict[str, Any] | None:
    """The stack-DB row behind a payload ``task_id`` (read-only handle —
    the LIVE stack backend owns the file; busy_timeout rides the URI)."""
    db_path = os.environ["TEST_DB_PATH"]
    if not os.path.isabs(db_path):
        db_path = os.path.join(_REPO_ROOT, db_path)
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=10)
    try:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT id, status, channel, address, template_body"
            " FROM notify_tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        return dict(row) if row is not None else None
    finally:
        conn.close()


def test_s1_stream_holds_valid_task_payload() -> None:
    """≥ 1 stream entry, §4.2-correct, correlated with the stack DB."""
    client = raw_client()
    deadline = time.monotonic() + WAIT_SECONDS
    problems: list[str] = []

    while True:
        problems.clear()
        for payload in _stream_payloads(client):
            problem = _payload_problem(payload)
            if problem is not None:
                problems.append(f"shape: {problem}")
                continue
            row = _db_task_row(payload["task_id"])
            if row is None:
                problems.append(f"task {payload['task_id']} not in the stack DB")
            elif row["status"] not in QUEUE_REACHED_STATUSES:
                problems.append(
                    f"task {payload['task_id']} status {row['status']!r} not in"
                    f" {sorted(QUEUE_REACHED_STATUSES)}"
                )
            elif row["channel"] != payload["channel"]:
                problems.append(f"task {payload['task_id']} channel != payload channel")
            elif row["address"] != payload["address"]:
                problems.append(f"task {payload['task_id']} address != payload address")
            elif row["template_body"] != payload["template_body"]:
                problems.append(
                    f"task {payload['task_id']} template_body != payload template_body"
                )
            else:
                # One fully-correct, DB-correlated payload ends the wait.
                assert row["id"] == payload["task_id"]
                return
        if time.monotonic() >= deadline:
            break
        time.sleep(1)

    pytest.fail(
        "no §4.2-correct task correlated with the stack DB within "
        f"{WAIT_SECONDS}s; stream payload problems: {problems or ['stream empty']}"
    )
