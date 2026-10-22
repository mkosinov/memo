# ADR 013: Redis Streams + consumer groups as the queue transport

## Status

Accepted — supersedes ADR 010

**Date:** 2026-10-21

## Context

ADR 010 chose arq on Redis with a hand-rolled fallback (Streams). At the part-2 design (#483) the six-reviewer spec panel researched the ecosystem state and found:

- **arq is in maintenance-only mode** — pinned repository issue #510 (Oct 2025): "critical security fixes only"; last release v0.28.0 (2026-04-16); dependency ceiling `redis>=4.2,<6` — redis-py 6+ unsupported.
- **arq's client is async-only**, while the `NotifyQueue` port built in part 1 (#482) is a sync Protocol called by the dispatcher; bridging coroutine clients into a sync port is a known event-loop-affinity anti-pattern.
- **Named-queue routing is fragile**: `enqueue_job(..., _queue_name=...)` — a wrong keyword (e.g. `_queue_id`) is silently swallowed into the job payload by `**kwargs`; tasks land on the default queue and the worker never sees them (silent misroute, not a crash).
- ADR 010's design required a **second, hand-rolled reliability mechanism** (LIST + Lua claim-lists) for the `notify:statuses` / `notify:inbound` categories. Current Redis guidance steers at-least-once consumption to **Streams + consumer groups** (native pending-entry lists, `XACK`, `XAUTOCLAIM`) — no bespoke recovery code.

## Decision

The transport is **Redis Streams + consumer groups accessed directly through redis-py** (sync client), with no queue library:

- three streams: `notify:tasks` (down), `notify:statuses`, `notify:inbound` (up); writes via `XADD` with an approximate cap (`MAXLEN ~ 10000`) — the queue is transport only, retention lives in the DB (ADR 008);
- consumer groups: `worker` for tasks (arrives in part 3), `dispatcher` for statuses/inbound;
- claim = `XREADGROUP`, ack = `XACK`, reclaim of hanging entries = `XAUTOCLAIM` at consumer start; delivery semantics at-least-once, duplicates accepted (family spec §4.4);
- producer methods `publish_status` / `publish_inbound` live off-protocol (worker side, part 3), mirroring `FakeQueue.push_*`;
- the dispatcher wraps sync queue calls in `asyncio.to_thread` — the event loop is never blocked and the port stays sync.

Rejected alternatives:

- **arq** — maintenance-only upstream, redis-py ceiling, async-only client against the sync port, the `**kwargs` misroute footgun;
- **SAQ / streaq** — worker frameworks layering a second abstraction over a thin port; nothing beyond Streams primitives is needed;
- **LIST + Lua claim-lists** — orphaned servicing entries and a bespoke reaper; contrary to current Redis guidance.

## Consequences

### Positive

- one reliability mechanism for all three categories; crash recovery is native (PEL + `XAUTOCLAIM`);
- the sync client fits the sync port — no loop-affinity bridging;
- no frozen third-party dependency in the delivery path.

### Negative

- Streams semantics are hand-wired in the adapter (part 2 owns `XGROUP`/`XAUTOCLAIM` handling);
- `MAXLEN` trimming drops the oldest entries on overflow — accepted: the DB is the retention source and the dispatcher re-enqueues from task rows (ADR 008/009).

### Risks

- Single-instance assumption (one dispatcher, one worker per Redis instance) — documented in the #483 spec; no leader election in the pilot.

## References

- #483 spec `docs/specs/2026-10-21-notify-infra-483-design.md`; family spec rev.4 `docs/specs/2026-10-11-notify-system-476-design.md`; ADR 008–010.
