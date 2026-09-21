# ADR 007: Composite Reads Stay Free Functions in Owning Service Modules (No `queries/` Layer)

## Status

Accepted

**Date:** 2026-09-20

## Context

GH #217 (a post-production marker created 2026-08-18) asked whether the read side deserves a dedicated query layer (`backend/src/queries/` with finder classes). Its activation criterion — a second composite read query — was met long ago: at design time the backend had **7 composite reads** (cross-aggregate projections/enrichments) out of 113 endpoints:

| # | Composite | Form at decision time | Endpoints |
|---|-----------|----------------------|-----------|
| 1 | `list_clients_with_stats` | free function (canonical) | GET /clients |
| 2 | `RecordService.list_view` | class method | GET /records/view |
| 3 | `MasterViewService` | standalone class + 2 cached factories | GET /masters, /masters/all |
| 4 | `PhotoService.list` | class method | GET /photos, /photos/web |
| 5 | `get_payment_totals` | free function (canonical) | GET /payments/totals |
| 6 | `ActivityService.sum_active_seats_bulk` | class method | GET /activities (enrichment) |
| 7 | `MaterialService._attach_counts` | private class method | in-write-response enrichment |

Constraints and prior decisions:

- `BaseRepository.list / list_custom / list_entity` already own the **shared read mechanics** (count + order + slice; count runs on the unordered statement). GH #206 deliberately left `list_clients_with_stats` as an exception: its hand-written count avoids carrying four correlated stat subqueries into a count-over-subquery.
- The service-layer canon (docs/domain-rules/service-layer.md, rev3+) fixed corridor 3 — composite reads as free functions in the owning service's module — and delegated the read-layer question to #217.
- GH #171 (merged) added the `usecases` write layer and explicitly excluded composite reads from migration.
- Composite #7 is consumed *by the write path itself* (fresh counts ride in create/update/delete responses), so reads are not a branch reachable only from endpoints.
- Session lifecycle: an infrastructure dependency in `src/db` opens one session per HTTP request; services and free functions receive it as an argument; the service-layer `@transactional` decorator owns the write transaction boundary (commit before the response, single post-commit event emit point); repositories flush only.

Alternatives considered:

1. **Full CQRS split** — move *all* reads (including plain CRUD lists) into `queries/`, giving one top-level fork (read vs write). Rejected: a migration of dozens of endpoints with zero user-visible value at current scale, and the split is not actually clean — the material-counts read is woven into write responses, so services would import the query layer anyway (a library, not a layer) or the API contract would have to change.
2. **Repository as universal pipe** — every statement executes through a repository method. Rejected: composite reads cross aggregates and have no owning repository; the pipe degenerates into pass-through methods ("execute this") with no policy — repositories stop being aggregate owners and become SQL folders.
3. **A thin repository method for dict-shaped composites** — a generic `fetch_all(session, stmt)` so #5/#6/#7 formally "go through the repository". Rejected: it would be an alias of `session.execute()` owning no mechanics (the only shared bits are an empty-batch guard and a row-pair→dict fold, ~4 lines per function); and once a generic execute-anything door exists, unrelated statements drift through it "for uniformity".

## Decision

1. **No `queries/` layer.** Composite reads remain **free functions in the module of the owning service** (canon corridor 3). The five legacy-form composites (#2, #3, #4, #6, #7) are aligned to this form (plan of #217).
2. **Execution-path rule.** Queries shaped "page of rows + total" ride the repository list mechanics (`list_custom`); aggregate results — totals, id→value dicts, batch enrichments — execute directly on the session inside the corridor-3 function; writes go only through services/scenarios. The repository is the owner of reusable mechanics (CRUD of its entity, list count/slice), not a universal SQL pipe.
3. **Documented exception.** `list_clients_with_stats` keeps its hand-written count (GH #206 performance rationale); switching it to `list_custom` requires a measurement on real data first.
4. **No form guard.** Compliance is enforced by review, not an automated test; recorded as an accepted residual risk.

**Triggers to revisit (extract `queries/`)** — an extensible list; any one suffices:

- (a) the read model diverges from storage: caching, denormalization, a read replica;
- (b) the same composite is needed by two or more modules simultaneously;
- (c) N+1 growth forcing projections/materialized views;
- (d) analytics/reporting endpoints with a persistently different response shape;
- (e) API versioning with diverging read models.

## Consequences

### Positive

- One canonical form for all composite reads; canon rule 8 holds at 100% after alignment.
- No churn: mechanics stay where they already are; `list_custom` remains the single paging implementation.
- Placement decisions for new code stay mechanical (canon decision tree: foreign tables? page+total?).

### Negative

- Composite reads remain spread across service modules rather than in one discoverable folder (mitigated by the canon decision tree).
- The "service touches the session directly" smell remains for dict-shaped reads — accepted as normal relational reads under corridor 3.

### Risks

- Without a form guard, an eighth composite may appear as a class method; caught only by review.
- The #206 performance rationale for the one exception is unmeasured; if ever challenged, re-measure before switching.

## References

- Spec: docs/specs/2026-09-20-composite-reads-form-217-design.md (rev4)
- Canon: docs/domain-rules/service-layer.md (rev5, rule 8)
- GH #217 (this decision), #206 (pagination consolidation), #171 (usecases layer), #213 (records view composite), #263 (master scope), #239 (transactional decorator)
