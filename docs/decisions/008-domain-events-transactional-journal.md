# ADR 008: Domain events are a transactional journal in the main DB

## Status

Accepted

**Date:** 2026-10-11

## Context

The notification system (#476) needs domain events as its input: "new record" and (later) "reset password" reactions start from the fact that a domain change happened. The question was where an event lives between the domain transaction and the async consumers.

Constraints:

- memo runs on a single-file SQLite database; the deployment today is bare uvicorn (no docker compose in prod, no broker service).
- A notification must never be sent for a change that rolled back, and a committed change must never silently lose its notification (monitoring requirement: every delivery is traceable).
- Redis is acceptable as a transport, but it is not a durable journal by default (RDB snapshots lose up to a minute on crash).

## Decision

Domain events are written as rows into the main SQLite database **inside the same transaction as the domain change** (an events accumulator in the `@transactional` pattern, next to the existing audit accumulator), carrying a self-sufficient JSON snapshot of the data at the moment of the event. A separate background process (the event dispatcher) polls the journal and applies reaction scenarios.

Rejected alternatives:

- **Publish directly to the queue before commit** — a rollback produces a phantom notification about a change that never happened (worse than a missed one).
- **Publish directly to the queue after commit** — a crash/redeploy in the window between commit and publish loses the event silently, with no row anywhere to monitor or replay.
- **Event only in Redis** — broker crash loses unprocessed events; Redis is a transport, not a journal.

## Consequences

### Positive
- The fact "change happened" and "system owes a notification" are atomic: no phantoms, no silent losses.
- Redis outage is survivable: the journal and task rows stay in the DB, the queue is re-filled from them.
- The journal is a single source of truth for any future subscriber, not only notifications.

### Negative
- One extra local INSERT per domain scenario (no network, no external calls — same cost class as the existing audit row).
- The dispatcher polls the DB (about 1 s cadence) instead of being pushed.

### Risks
- Snapshot assembly adds reads inside the transaction; SQLite local reads are cheap, but the scenario must not call external services while building the snapshot.

## References

- #476 (notification system container), spec `docs/specs/2026-10-11-notify-system-476-design.md`
- Reference implementation: cmbot (event row → handler → sender task)
- SQLite may later be migrated to networked PostgreSQL (user decision 2026-10-11); this decision does not depend on the engine.
