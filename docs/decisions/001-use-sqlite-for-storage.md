# ADR 001: Use SQLite for storage

## Status

Accepted

**Date:** 2026-05-20

## Context

Memo is a small-scale studio management system for a single art studio (Colour Mountains). We need persistent storage for entities: Masters, Services, Activities, Records, Clients, Visitors, Payments.

**Constraints:**
- Single-user application (studio admin)
- Low data volume (< 10k records)
- No need for concurrent writes
- Simple deployment (no separate DB server)
- Fast development iteration

**Alternatives considered:**
- PostgreSQL — overkill for single-user, requires separate server
- MySQL — same as PostgreSQL
- JSON files — no query capability, no ACID
- In-memory only — data lost on restart

## Decision

Use **SQLite** as the primary database.

**Rationale:**
- Zero configuration — no separate server process
- File-based — easy backup, migration, debugging
- ACID compliant — data integrity guaranteed
- SQL support — complex queries, joins, aggregations
- Fast enough for our data volume
- Works with SQLAlchemy ORM (same code could migrate to PostgreSQL later)

## Consequences

### Positive
- Simple deployment — just copy the `.db` file (see WAL backup caveat below)
- Fast development — no DB setup required
- Easy testing — in-memory SQLite for unit tests
- Low resource usage — no separate process

### Negative
- No concurrent writes — not suitable for multi-user (but we don't need it)
- Limited data types — no native JSON, array types (but we don't need them)
- No built-in replication — manual backup required
- **WAL backup caveat (since #108, 2026-07-17):** WAL journal mode is enabled for concurrency. A raw copy of the `.db` file alone can lose uncheckpointed writes held in the `-wal`/`-shm` sidecar files. To back up safely, either run `PRAGMA wal_checkpoint(TRUNCATE)` first, or copy the `.db`, `.db-wal`, and `.db-shm` files together (or use `sqlite3 <db> ".backup <dest>"`). See `docs/specs/2026-07-17-e2e-infra-roots-108-126-design.md`.

### Risks
- If we need multi-user later → migration to PostgreSQL required (but unlikely)
- Large file uploads could bloat the DB (mitigated: store files on disk, URLs in DB)

## References

- Backend architecture: `docs/specs/2026-05-28-backend-architecture-design.md`
- Data model: `docs/specs/2026-05-28-backend-data-model-design.md`
