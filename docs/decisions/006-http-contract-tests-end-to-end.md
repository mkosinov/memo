# ADR 006: HTTP Contract Tests Are End-to-End (TestClient + Test SQLite), Not Mocked-Service

## Status

Accepted

**Date:** 2026-08-03

## Context

The HTTP layer of the 8 generic CRUD entities needed contract coverage (GH #185), complementing the service-level contract (#184). Candidate architectures:

1. **Endpoint-boundary tests with a mocked `GenericService`** — fast, no DB; asserts the router calls the service correctly.
2. **End-to-end tests through `TestClient` against the real test SQLite** — the full request path: routing, DI binding, schema validation, `response_model` serialization, service, repository, DB.
3. **Mainstream e2e variants** (considered within option 2): the official FastAPI/SQLModel guidance of a *function-scoped* fresh DB with `app.dependency_overrides`, and `httpx.ASGITransport` + `AsyncClient` for async tests. The repo instead standardizes on a *session-scoped* sync `TestClient` + per-test table truncation (`reset_db`) — a recognized minority pattern, speed-justified (no per-test engine/app rebuild).

## Decision

Adopt (2) end-to-end TestClient + test SQLite, keeping the repo's existing session-scoped client + truncation pattern.

Rationale: the dominant HTTP-layer risk in this codebase is **wiring across 8 entities** — per-entity router prefix mounting in `main.py`, per-router DI bindings, `response_model` on each route, status codes (201/200/204), per-entity `<ENTITY>_NOT_FOUND` error codes (ADR-005 body shape). A mocked service verifies none of that. The marginal cost of SQLite is low (~1–2 s on the whole set). Semantic depth (soft-delete rules, is_active stickiness, pagination slicing) is deliberately **not** re-asserted here — the service-level contract (#184) owns semantics; this contract owns transport only. Option (1) rejected: it tests the mock, not the wiring. Option (3)'s per-test fresh DB rejected: heavier and slower with no isolation gain over truncation for this suite; async client rejected: the suite is sync throughout.

## Consequences

### Positive
- Router miswiring fails loudly per entity (a new generic entity gets full HTTP+service coverage from one config entry)
- ~930 lines of duplicated HTTP tests collapse into one parametrized file (net ≈ −350)
- The two contract levels are complementary, not overlapping

### Negative
- Contract cases run through the DB (net collected ≈ −8 cases, suite stays ≈5 s)
- Triage rule needed: if the HTTP contract fails and the service contract is green, the bug is in routing/schemas
- One blind spot: a `response_model=` kwarg dropped without changing the route's return value is undetectable at body level (services return validated schema instances)

### Risks
- Future non-uniform endpoint (a third response shape) breaks the exact-envelope assertion — that is the contract working as intended; add to exceptions only with a documented reason
- Isolation correctness rides on `reset_db` delete-order (`reversed(Base.metadata.sorted_tables)`; the `PRAGMA foreign_keys=OFF` inside the transaction is a no-op) and IDs are not reset (`sqlite_sequence` high-water marks persist) — a table-ordering regression there breaks all contract tests

## References

- Issue: GH #185; spec `docs/specs/2026-08-03-generic-api-crud-contract-design.md`
- Service-level contract: GH #184, `docs/specs/2026-08-03-generic-service-crud-contract-design.md`
- ADR-005 (error contract codes); GH #175 (patch contract)