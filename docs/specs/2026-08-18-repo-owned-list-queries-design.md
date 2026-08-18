# Design — GH #206: Consolidate Pagination (Repo-Owned List Queries, Option C)

**Date:** 2026-08-18
**Issue:** GH #206
**Status:** Draft — awaiting G1b
**Decision lineage:** Two pre-DESIGN architectural consultations (scratchpad `ses_feace982effev2TmhnL3SoF411`): round 1 rejected `PaginatedResponse`-in-`BaseRepository` (violates SKILL.md:99 layering); round 2 approved **Option C (hybrid repo-owned list)**. This spec formalizes that decision; it does not re-open the A/B/C question.

---

## 1. Problem

Pagination mechanics (count query + slice) are currently implemented **five times** in the service layer:

1. `paginate_orm` (`services/generic.py` L40-57) — shared helper; callers: `GenericService._paginate` (the generic path), `RecordService.list`, and `ActivityService._list_by_date`.
2. `GenericService._list_stmt` + `_paginate` (`services/generic.py` L88-101) — generic path.
3. Inline duplicate in `ServiceService.list` (`services/service.py` L56-76).
4. Inline duplicate in `PaymentService.list` (`services/payment.py` L38-49).
5. Inline duplicate in `VisitService.list` (`services/visit.py` L43-51).

Meanwhile `BaseRepository` owns CRUD primitives but has **no paginated list capability** — its only list method (`list`, L29-31) is dead in production (zero prod callers; only 4 tests in `tests/test_soft_delete_repository.py` call `ArchiveRepository.list`).

Every new list endpoint re-implements count+slice or copy-pastes it. The repository layer — the natural home for SQL composition — owns none of it.

## 2. Goals

- Move list-query SQL composition (filter→count→order→slice) **down into the repository layer**.
- **10 of 12** list endpoints route through repository methods after the refactor (1 concession: clients §7; 1 out of scope: unpaginated photos). Equivalently: 10 of 11 paginated endpoints.
- Zero behavioral change: all existing list contracts (envelope shape, totals, ordering, status filtering, 422s) preserved. Existing contract tests are the safety net.
- Orthogonal cleanup: shared `PaginationParams` schema kills 9-router `Query()` boilerplate; `ClientListResponse` duplicate collapsed into `PaginatedResponse[ClientWithStats]`.

## 3. Non-Goals

- **No response-envelope move.** `PaginatedResponse` (Pydantic) stays in the service layer. Repository returns ORM objects + count only (`tuple[list[ModelType], int]`), per `.opencode/skills/fastapi-clean-architecture/SKILL.md` L95-107: repositories are forbidden from importing `src.schemas.*`.
- **No API contract change.** Query params, envelope keys, defaults (`page=1`, `per_page=20`, `le=100`), and 422 semantics are unchanged.
- **No new endpoints, no frontend pagination behavior change.** Photos endpoint stays unpaginated (tracked by #211). Server-side search `?q=` stays out of scope (tracked by #212).
- **`list_all` paths untouched** (`GenericService.list_all`, `ArchiveService.list_all`, `ServiceService.list_all`) — they keep `_list_stmt` + the `BARE_LIST_MAX_ROWS+1` probe; different semantics from pagination.
- **`ClientWithStats` list NOT migrated** (see §7 concession).
- Old dead `BaseRepository.list` / `ArchiveRepository.list` NOT kept — they are **replaced** by the new paginated `list` (§9).
- Dead `get_generic_repository()` (zero callers) NOT removed — noted, kept out of scope to keep the diff tight.

## 4. Current State (verified 2026-08-18)

### Repository layer (`src/repositories/generic.py`)

- `BaseRepository` (L23-114): `list` (dead), `get`, `create`, `update`, `patch`, `delete`, `reorder`.
- `ArchiveRepository(BaseRepository)` (L117-166): overrides `list` (dead) and `reorder` (live, is_active-guarded).
- `ModelType = TypeVar("ModelType", bound=Base)` (L20). Repositories import nothing from `src.schemas` — invariant already holds.
- Singletons: `get_base_repository()`, `get_archive_repository()` (`@lru_cache`, live). `get_generic_repository()` dead.

### Service layer (`src/services/`)

- `paginate_orm` (generic.py L40-57): count via `select(func.count()).select_from(stmt.subquery())`, then `order_by` applied **after** count, then `limit/offset`. Callers: `RecordService.list` (record.py L73-77), `ActivityService._list_by_date` (activity.py L54-69).
- `GenericService.list` (L103-114) → `_paginate` (L96-101) → `_list_stmt` (L88-94, equality filters, `None` skipped). `list_all` (L116-139) reuses `_list_stmt`.
- `ArchiveService.list` (L242-254) → `_list_stmt(status=...)` override (L234-240) mapping `ArchiveStatus` to `is_active` / `not_(is_active)`.
- Inline duplicators (quoted in §1): `ServiceService.list` (adds `selectinload(Service.tariffs), selectinload(Service.tags)` + status), `PaymentService.list`, `VisitService.list` (`record_id` filter + manual `VisitResponse` field mapping).
- `RecordService.list` (record.py L41-80): custom stmt `select(Record).join(Activity).options(selectinload(Record.visits))` + dynamic sort via `_sort_columns` (L82-132) — correlated `scalar_subquery()` sort keys (client name, service title, master name, location name, `total_price`, `paid_sum`, `payment_bucket`), whitelist map, `nullsfirst/nullslast`, `Record.id.asc()` tiebreak.
- `list_clients_with_stats` (client.py L76-262): non-ORM projection (flat columns + 4 correlated scalar subqueries), **separate** `count_query = select(func.count(Client.id))` without the stat subqueries, manual row mapping.

### Routers (`src/api/v1/`) — 12 list endpoints

| # | Router | Endpoint | Service path today | Pagination params |
|---|--------|----------|--------------------|-------------------|
| 1 | activities.py L49 | `GET ""` | `ActivityService.list` (date range → `paginate_orm`) | `Query(1,ge=1)` / `Query(20,ge=1,le=100)` L53-54 |
| 2 | payments.py L27 | `GET ""` | `PaymentService.list` (inline dup) | L31-32 |
| 3 | locations.py L70 | `GET ""` | `ArchiveService.list` + `order_by` | L74-75 |
| 4 | visits.py L57 | `GET ""` | `VisitService.list` (inline dup) | L61-62 |
| 5 | visitors.py L26 | `GET ""` | `GenericService.list` | L30-31 |
| 6 | services.py L70 | `GET ""` | `ServiceService.list` (inline dup + eager loads) | L74-75 |
| 7 | tags.py L53 | `GET ""` | `GenericService.list` + `order_by` | L57-58 |
| 8 | materials.py L65 | `GET ""` | `ArchiveService.list` + `order_by` | L69-70 |
| 9 | masters.py L69 | `GET ""` | `ArchiveService.list` + `order_by` | L73-74 |
| 10 | records.py L72 | `GET ""` | `RecordService.list` (custom stmt → `paginate_orm`) | `Annotated[RecordListParams, Query()]` L76 |
| 11 | clients.py L63 | `GET ""` | `list_clients_with_stats` (service-owned) | `ClientListParams = Depends()` L66 |
| 12 | photos.py L46 | `GET ""` | unpaginated `list[PhotoResponse]` | **none** (out of scope) |

### Schemas

- `PaginatedResponse` (`schemas/common.py` L15-21): `items/total/page/per_page`, `Generic[ItemT]`. `SortOrder` Literal at L12.
- `ClientListResponse` (`schemas/client.py` L118-124): field-for-field duplicate of `PaginatedResponse[ClientWithStats]`. Used in `clients.py` (response_model L63), `services/client.py` (return type), `tests/test_client_stats.py`, frontend `ClientsContext.tsx` L19/L103.
- No shared pagination-params schema exists. `RecordListParams` (record.py L122-146) and `ClientListParams` (client.py L97-115) each declare their own `page`/`per_page` fields.

## 5. Design

### 5.1 New repository methods (`BaseRepository`)

Two methods, both returning `tuple[list[ModelType], int]` — ORM instances + total count. **Never** the Pydantic envelope.

**Naming decision (G1b):** the paginated method takes the name **`list`** — it **replaces** the old dead unbounded `list` on the same name (signature and return type change; the old method is NOT kept alongside). `list_custom` is the intent-revealing "custom statement" variant; both return the same shape.

```python
async def list(
    self,
    session: AsyncSession,
    table: type[ModelType],
    *,
    filters: dict | None = None,
    order_by=None,
    limit: int | None = None,
    offset: int = 0,
    options=None,
) -> tuple[list[ModelType], int]:
    """Select base table with equality filters, count, order, slice."""
```

Semantics:
- Builds `select(table)`, applies `options` (a sequence of SQLAlchemy loader options, e.g. `[selectinload(Service.tariffs)]`; exact typing pinned in the plan) if given.
- Applies equality filters from `filters` (`None` values skipped — identical semantics to today's `_list_stmt`).
- Count: `select(func.count()).select_from(stmt.subquery())` — computed on the **unordered** stmt. Loader options do not affect the count (`stmt.subquery()` strips them; `selectinload` is a loader option, not a query mutation).
- `order_by` applied **after** the count, then `limit`/`offset` slice.
- `limit=None` means **no LIMIT clause** (unbounded). All service list paths always pass `limit=per_page`; the `None` sentinel exists for completeness and is not used by any list endpoint.
- Returns `(list(result.scalars().all()), total)`.

```python
async def list_custom(
    self,
    session: AsyncSession,
    stmt,
    *,
    order_by=None,
    limit: int | None = None,
    offset: int = 0,
) -> tuple[list[ModelType], int]:
    """Wrap any caller-built statement with count + slice."""
```

Semantics:
- This is `paginate_orm`'s exact mechanics, moved: count on `stmt.subquery()` **before** `order_by` is applied (invariant preserved: correlated sort-key subqueries are never evaluated inside the count query), then order, then slice.
- **Precondition (stated in the docstring):** the caller-built `stmt` must carry **no** pre-baked `order_by`/`limit`/`offset` — ordering and slicing are owned by this method. A pre-limited stmt would make the count return the page size, not the total; a pre-ordered stmt would force per-row evaluation of correlated sort subqueries inside the count.
- Used for complex service-built statements (JOINs, dynamic sort) — Record and Activity.
- Typing note: unlike `list` (where `table: type[ModelType]` binds the TypeVar), `list_custom` has no `table` param; the plan pins the exact return annotation (method-level TypeVar or unparameterized `list`).

### 5.2 `ArchiveRepository` override

```python
async def list(
    self,
    session: AsyncSession,
    table: type[ModelType],
    *,
    status: ArchiveStatus = ArchiveStatus.ACTIVE,
    filters: dict | None = None,
    order_by=None,
    limit: int | None = None,
    offset: int = 0,
    options=None,
) -> tuple[list[ModelType], int]:
```

- Adds the `is_active` / `not_(is_active)` predicate for `ACTIVE`/`ARCHIVED` (`ALL` adds none) — same mapping as today's `ArchiveService._list_stmt`.
- This override likewise **replaces** `ArchiveRepository`'s old dead `list` (which had `status` + `**filters` kwargs and returned a plain `list`).
- `list_custom` inherited **unmodified**.

### 5.3 Service rewiring

- **`GenericService.list`** — calls `self._repository.list(session, self._model, filters=filters, order_by=order_by, limit=per_page, offset=(page-1)*per_page)`, then maps ORM→`_response_schema` and builds the `PaginatedResponse` envelope. Service keeps: page↔offset conversion, ORM→Pydantic mapping, envelope.
- **`ArchiveService.list`** — same, passing `status` to the repo override.
- **`_list_stmt` STAYS** — still used by `list_all`. `_paginate` and `paginate_orm` are **retired** (deleted) once all callers migrate.
- **`ServiceService.list`** — collapsed to `repo.list(..., status=status, filters=filters, options=[selectinload(Service.tariffs), selectinload(Service.tags)], order_by=...)`.
- **`PaymentService.list`** — collapsed to `repo.list(..., filters=filters)`.
- **`VisitService.list`** — collapsed to `repo.list(..., filters={"record_id": record_id})`; manual `VisitResponse` field-by-field mapping stays in the service (mapping is a service concern). **Note:** `VisitService` is the one service without a repository dependency today (standalone class, no `__init__`, factory `get_visit_service()` returns bare `VisitService()`; tests instantiate it directly) — migrating it requires adding a constructor-injected repository, updating the factory, and fixing direct test instantiations (see §5.4).
- **`ActivityService.list`** (`_list_by_date`) — service keeps building its date-range stmt; count+slice moves to `repo.list_custom(stmt, order_by=..., limit=..., offset=...)`.
- **`RecordService.list`** — unchanged stmt construction (JOIN + `selectinload(Record.visits)` + `_sort_columns` whitelist); `paginate_orm(...)` call replaced by `repo.list_custom(stmt, order_by=self._sort_columns(params), limit=params.per_page, offset=(params.page-1)*params.per_page)`.

### 5.4 Repository access from services

All services except `VisitService` already hold a repository dependency (CRUD methods dispatch through it today). **`VisitService` is the exception:** it gains a constructor-injected repository (`get_base_repository()` — visits are not archivable), its factory is updated, and tests that instantiate bare `VisitService()` are adjusted. This is the only new DI plumbing; exact attribute/constructor wiring is pinned in the plan.

### 5.5 Orthogonal: `PaginationParams` shared schema

- New `src/schemas/pagination.py`:

```python
class PaginationParams(BaseModel):
    page: int = Field(default=1, ge=1)
    per_page: int = Field(default=20, ge=1, le=100)
```

- **9 routers** (activities, payments, locations, visits, visitors, services, materials, masters, tags) replace the duplicated `Query(1, ge=1)` / `Query(20, ge=1, le=100)` pair with a single injected `pagination: PaginationParams = Depends()`.
- **Injection-idiom rationale:** the documented modern idiom is `Annotated[PaginationParams, Query()]` (FastAPI ≥0.115 Query Parameter Models, PR #12199) — but a query-param model currently **cannot coexist with other scalar query params in one handler** (fastapi PR #12481, open), and 8 of the 9 routers mix pagination with `status`/`sort_by`/`sort_order`/`date_from`/`date_to`/`record_id`/`record_ids`. `Depends()` with a Pydantic model is the established workaround and already proven in this codebase (`clients.py` L66, `ClientListParams = Depends()`). We therefore use **`Depends()` uniformly across all 9 routers** — including visitors, which is pagination-only and could use the `Query()` idiom, but stays `Depends()` for one-idiom consistency. When PR #12481 lands, migrating all 10 to `Annotated[..., Query()]` is a mechanical follow-up.
- `RecordListParams` and `ClientListParams` **inherit** from `PaginationParams` and **delete their own redeclared `page`/`per_page` fields** (Pydantic v2 child-field re-declaration would silently shadow the parent — the redeclarations must go). Their injection styles stay unchanged (`Annotated[..., Query()]` for records, `Depends()` for clients).
- **OpenAPI parity requirement:** flattened query params (`page`, `per_page`) with identical defaults/constraints. Verified by existing API contract tests (`test_list_invalid_params_returns_422`, `test_default_pagination_envelope`).

### 5.6 Orthogonal: collapse `ClientListResponse`

- `clients.py` response_model and `services/client.py` return type become `PaginatedResponse[ClientWithStats]`. `ClientListResponse` class deleted.
- api-client: TS type updated to match (parity-tested by api-client suite). Frontend impact confined to `ClientsContext.tsx` (L19 import, L103 `useQuery<...>` type) — updated to `PaginatedResponse<ClientWithStats>`; no visual change.

### 5.7 Endpoint routing after refactor

| # | Endpoint | New path |
|---|----------|----------|
| 1 | activities | date-range path: service-built stmt → `repo.list_custom`; no-date path: `GenericService.list` → `repo.list` |
| 2 | payments | `repo.list` |
| 3 | locations | `ArchiveRepository.list(status, order_by)` |
| 4 | visits | `repo.list(filters={record_id})` |
| 5 | visitors | `GenericService.list` → `repo.list` |
| 6 | services | `ArchiveRepository.list(status, options=[selectinload×2], order_by)` |
| 7 | tags | `GenericService.list` → `repo.list(order_by)` |
| 8 | materials | `ArchiveRepository.list(status, order_by)` |
| 9 | masters | `ArchiveRepository.list(status, order_by)` |
| 10 | records | service-built JOIN stmt → `repo.list_custom` |
| 11 | clients | **concession** — service-owned (§7) |
| 12 | photos | unpaginated — out of scope |

**Result: 10/12 list endpoints route through repository methods** (clients = accepted concession §7; photos = unpaginated, out of scope).

## 6. Layering Invariants (must hold after refactor)

- `src/repositories/` imports nothing from `src.schemas` — enforced by review (and stays trivially true: methods return ORM tuples).
- COUNT invariant: count computed on the statement **without** `order_by` — so correlated sort subqueries (records) and stat subqueries are never part of the count query.
- Loader options (`selectinload`) never affect the count (stripped by `stmt.subquery()`).
- Page↔offset conversion, ORM→Pydantic mapping, and the envelope stay exclusively in the service layer.
- Sort whitelisting (`_sort_columns`, `_service_order_by`, `_location_order_by`) stays in the service layer — the repo accepts opaque `order_by` clauses and never parses sort strings.

## 7. Accepted Exception (Concession): `ClientWithStats`

`list_clients_with_stats` (clients endpoint, 1 of 12) **stays service-owned**. Concrete blocker:

1. **Non-ORM projection** — returns flat columns (`Client.id/name/...` + 4 labeled stat columns), not `Client` ORM instances; a repo method returning `list[ModelType]` cannot express it without leaking schema-shaped rows into the repo.
2. **Separate count query** — `count_query = select(func.count(Client.id))` deliberately excludes the correlated stat subqueries (performance). Forcing this through `list_custom` would evaluate the stat subqueries inside the count, regressing query cost.

Documented as an accepted exception. Follow-up **GH #217** tracks evaluating a CQRS read-side layer if a second composite query appears.

## 8. Migration Order

1. Add the new paginated `list` / `list_custom` to `BaseRepository` + `list` override in `ArchiveRepository` (replacing the dead `list`s in place), with new repo-level unit tests (TDD: tests first) — including the **rewrite** of the 4 `test_soft_delete_repository.py` tests under the new contract (§9).
2. Rewire `GenericService.list` / `ArchiveService.list` (keeps `_list_stmt` for `list_all`).
3. Collapse the 3 inline duplicators (Service, Payment, Visit).
4. Migrate `RecordService` + `ActivityService` off `paginate_orm` onto `repo.list_custom`.
5. Delete `paginate_orm` and `_paginate`.
6. Add `PaginationParams`, migrate 9 routers, make `RecordListParams`/`ClientListParams` inherit it.
7. Collapse `ClientListResponse` → `PaginatedResponse[ClientWithStats]` (backend + api-client + 2 frontend lines).
8. Sync domain-rules docs (`records.md` L148-187 pagination mechanics, and any entity file referencing `paginate_orm`/list mechanics).

Each step lands green before the next starts.

## 9. Old Dead `list()` — Disposition

The old unbounded `BaseRepository.list` / `ArchiveRepository.list` are **replaced in place** by the new paginated `list` (§5.1/§5.2) — same name, new keyword-only signature, return type changed from `list[ModelType]` to `tuple[list[ModelType], int]`. There is no "two methods side by side" state and no separate deprecation step.

The 4 existing test callers in `tests/test_soft_delete_repository.py` (L60, L69, L78, L90 — covering `ArchiveRepository` active/archived/all/default-status behavior) **will break on the new contract, and that is intended**: they are **rewritten** under the new `list` signature — pass `status`/`filters`/`limit`/`offset`, assert on the `(items, total)` tuple (items plus expected total). The soft-delete coverage is preserved, not deleted.

## 10. Testing Strategy

- **Existing suites are the contract** (must stay green with zero edits to assertions, except import/type renames in §5.6):
  - Generic service list contract ×8 entities (`tests/services/test_generic_service_contract.py` — envelope, slicing, totals, out-of-range, id filter).
  - Generic API list contract (`tests/test_generic_api_contract.py` — envelope keys, 422s, defaults).
  - Archive status semantics (`tests/test_soft_delete_service.py`, 6 tests).
  - Duplicator services (`test_service_service.py`, `test_visit_service.py` incl. `test_visit_service_list`).
  - Records (`test_record_service.py`, `test_api_records.py`, query-count boundedness `test_list_activities_query_count.py`).
  - Clients stats/pagination (`test_client_stats.py` incl. `TestClientListPagination`).
  - Repo-level soft-delete status behavior (`tests/test_soft_delete_repository.py`, 4 tests — **rewritten** under the new `list` contract per §9).
- **New repo-level unit tests** for `list`/`list_custom`: equality filters + `None` skip, archive status mapping, order applied after count, limit/offset slicing, `options=[selectinload(...)]` does not break count, `list_custom` count excludes `order_by`.
- api-client parity suite stays green (type rename in §5.6).

## 11. Visual Compliance Checks

**N/A — backend-only refactor.** The only frontend touch is a 2-line type rename in `ClientsContext.tsx` with zero visual/behavioral impact. Gate G4.5 will be skipped per protocol (spec marks it N/A).

## 12. Acceptance Criteria

- [ ] `BaseRepository.list` (paginated, replacing the dead `list`) + `list_custom` exist with the semantics of §5.1; `ArchiveRepository.list` override per §5.2.
- [ ] `paginate_orm` and `GenericService._paginate` deleted; zero references remain.
- [ ] 4 `test_soft_delete_repository.py` tests rewritten under the new `list` contract (status/filters/limit/offset, `(items, total)` assertions).
- [ ] 3 inline duplicators (service/payment/visit) route through `repo.list`.
- [ ] Record + Activity (date-range path) route through `repo.list_custom`; count invariant (§6) preserved.
- [ ] 10/12 list endpoints route through repo methods; `list_clients_with_stats` untouched (concession documented in code comment).
- [ ] `PaginationParams` in `schemas/pagination.py`; 9 routers migrated; `RecordListParams`/`ClientListParams` inherit it; OpenAPI query params unchanged.
- [ ] `ClientListResponse` deleted; clients endpoint returns `PaginatedResponse[ClientWithStats]`; frontend `ClientsContext.tsx` updated.
- [ ] Full backend suite green (baseline 1259p/6s); api-client suite green (197p/4f, 4 = known #188); admin vitest + tsc green.
- [ ] Domain-rules docs synced (records.md pagination mechanics).
- [ ] No `src.schemas` import anywhere under `src/repositories/`.

## 13. Open Questions

None. All design questions were resolved in consultation rounds 1-2 (see Decision lineage).
