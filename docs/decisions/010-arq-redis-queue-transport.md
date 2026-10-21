# ADR 010: arq + Redis as the queue transport

## Status

Superseded by ADR 013 (2026-10-21) — at the #483 design arq turned out maintenance-only with a redis-py ceiling and an async-only client against the sync port; the transport switched to Redis Streams + consumer groups. Kept for history.

**Date:** 2026-10-11

## Context

The notification system needs an async job queue between the event dispatcher and the delivery worker. The user's reference (cmbot) uses RQ; the user asked to consider alternatives ("не обязательно это должен быть rq").

Constraints:

- Async operation is a hard requirement (#476).
- The stack is FastAPI + asyncio + pydantic v2; the queue must fit naturally.
- Redis becomes a new infrastructure service (dev/e2e stacks, settings); the subsystem must be switchable off in the testing env.

## Decision

Use **arq** (async RQ-style worker library, by the pydantic author) on Redis:

- asyncio-native worker process (the separate-process decision) out of the box;
- pydantic-friendly payloads (serializable dicts);
- three queue categories: `notify:tasks` (down), `notify:statuses` (up), `notify:inbound` (webhook-normalized inbound events);
- arq's built-in job retries are disabled (`max_tries=1`) and result storage is turned off — per the user decision there are no queue-level auto-retries, and statuses travel on their own queue (ADR 009), not via job results.

Rejected alternatives:

- **RQ** (cmbot's choice) — synchronous workers; contradicts the async requirement.
- **Celery** — heavy multi-broker framework; configuration surface far beyond need.
- **Redis Streams hand-rolled** — no library dependency and full control, but at-least-once delivery, consumer groups, acks and recovery would all be hand-written.

## Consequences

### Positive
- One small dependency; worker code looks like ordinary async functions.
- Fits the future "worker on another machine" topology unchanged.

### Negative
- New Redis service in dev/e2e stacks and deployment (part 2 of the #476 decomposition).
- Queue tasks carry pickled-serializable dicts only — mitigated by the thin "task reference + snapshot" payload discipline (ADR 009).

### Risks
- Redis persistence defaults (RDB snapshots) lose recent queue entries on crash — mitigated by re-enqueueing from DB task rows (ADR 008/009).

## References

- #476, spec `docs/specs/2026-10-11-notify-system-476-design.md`
