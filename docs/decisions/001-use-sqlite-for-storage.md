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
- Simple deployment — just copy the `.db` file
- Fast development — no DB setup required
- Easy testing — in-memory SQLite for unit tests
- Low resource usage — no separate process

### Negative
- No concurrent writes — not suitable for multi-user (but we don't need it)
- Limited data types — no native JSON, array types (but we don't need them)
- No built-in replication — manual backup required

### Risks
- If we need multi-user later → migration to PostgreSQL required (but unlikely)
- Large file uploads could bloat the DB (mitigated: store files on disk, URLs in DB)

## References

- Backend architecture: `docs/specs/2026-05-28-backend-architecture-design.md`
- Data model: `docs/specs/2026-05-28-backend-data-model-design.md`
