# GH #213 — Records View Composite Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One server-side composite read endpoint (`GET /api/v1/records/view`) feeds the records table all display fields (names, dates, colors, private flag, paid sum), replacing 7 client-side lookup queries; archived entities resolve names; repo read family redesigned (`list_custom` row-core + `list_entity`); photos rides the core.

**Architecture:** Textbook read/write split per spec §2 — lean `GET /records` untouched; `RecordService.list_view()` shares a private query-builder with `list()` + 8 labeled select columns (correlated scalar subqueries, the `_sort_columns` idiom) → `BaseRepository.list_custom` (row-tuple core, §5.1) → `RecordViewResponse`. Frontend: RecordsContext becomes a pure view-list context; recordsColumns/RecordsTable read row fields; BookingFilters/ClientQuickCard/ActivityDetailsModal re-homed; schedule RecordsProvider removed.

**Tech Stack:** FastAPI + Pydantic v2 + SQLAlchemy 2.x (SQLite); TanStack Query v5 + zod (packages/api-client); Next.js 14 admin; pytest / vitest / Playwright.

**Spec:** `docs/specs/2026-09-02-records-view-endpoint-design.md` (single source; §4 = normative field table, §5.1/§5.2 = repo family + photos).

**Baseline note (fresh worktree):** run `uv sync --extra dev` in `backend/` before first pytest (pytest lives in the dev extra).

**Verification commands (local, fast suites — CI is the authoritative merge gate incl. both e2e shards):**
- Backend: `cd backend && uv run pytest tests/<file> -q` (full: `uv run pytest -q`)
- api-client: `cd packages/api-client && npm test`
- Admin unit: `cd frontend/admin && npm run test` (targeted: `npm run test -- <pattern>`); `npm run type-check && npm run lint`
- e2e specs (US-1..US-6): author locally, authoritative run on CI; if a local run is needed, request `tester` (env pre-flight owns the stack).

---

## Behavioral Delta

How this feature behaves for the user, mapped to spec acceptance criteria:

- **Records page display data** → the table loads all display info (names, dates, service, master, location, payment status) from ONE request; the page no longer silently caps at 100 clients/activities — a record for client #101 shows the real name (US-1, US-2).
- **Archived entities** → records referencing archived clients/masters/services/locations show their real names and the master's own color dot instead of «—»/gray (US-3).
- **Paid column** → filled from the row itself; adding/editing/deleting a payment in the detail panel updates the row badge without a reload (US-4).
- **Filters + search** → all existing filters and the `?q=` search box behave identically on the new endpoint (US-5).
- **Sorting** → every column sorts in the same order as before (US-6).
- **Schedule page** → stops firing 7 hidden records queries; its activity modal still resolves clients (verified by tests).
- **No visual regressions** → private-activity diamond, master color dots, payment badges, «—» fallbacks, pager behavior all render exactly as today (spec §11 checks).

---

## Task 1: Repo read family — `list_custom` row-core + `list_entity` wrapper + consumer migration

### Classification: standard

### Required Docs
- `docs/specs/2026-09-02-records-view-endpoint-design.md` §5.1 — the mandated family design
- `docs/domain-rules/records.md` §"Pagination mechanics" (:201) — current mechanics description (stays in sync; rewritten in Task 15)

### Task Description
Redesign `BaseRepository` read methods in `backend/src/repositories/generic.py`:

1. `list(...)` — UNCHANGED.
2. `list_custom(stmt)` — semantics CHANGED: becomes the row-tuple CORE. Keep existing mechanics verbatim (count on the loader-stripped unordered subquery, apply ORDER + LIMIT/OFFSET, offset conversion) but return `result.all()` (Row tuples) instead of `result.scalars().all()`. Signature accepts any service-built `Select` (`Select[tuple[Any, ...]]`).
3. `list_entity(stmt)` — NEW: `TypeVar ModelT`; accepts ONLY `Select[tuple[ModelT]]` (mypy honesty: a multi-column select must NOT typecheck against it — the type system routes devs to `list_custom`); thin wrapper:
```python
async def list_entity(self, stmt: Select[tuple[ModelT]]) -> tuple[list[ModelT], int]:
    rows, total = await self.list_custom(stmt)
    return [row[0] for row in rows], total
```
4. Migrate the 2 prod consumers of the old role: `RecordService.list` (`backend/src/services/record.py:62-113`) and `ActivityService.list` (`backend/src/services/activity.py`) — `list_custom` → `list_entity`, no other change. Migrate the 3 call sites in `backend/tests/test_repository_list.py`.
5. TDD:
- [ ] RED: new tests in `test_repository_list.py` — (a) `list_custom` with a two-column select (`Model, Model.name.label("name")`) returns Rows carrying BOTH columns; (b) `list_entity` on an entity select returns model instances + total; (c) mypy: a `Select[tuple[A, B]]` passed to `list_entity` is a type error (`uv run mypy` on a tiny negative-case snippet or assert via `reveal_type` test file — follow repo mypy setup).
- [ ] Run: `uv run pytest tests/test_repository_list.py -q` → RED for new cases.
- [ ] GREEN: implement the family; migrate consumers + test sites.
- [ ] Full backend suite: `uv run pytest -q` → 0 new failures (pre-existing skips allowed).
- [ ] `uv run mypy src` (repo config) clean.
- [ ] Commit: `refactor(repo): list_custom row-tuple core + list_entity entity wrapper (#213)`

**DoD:** family landed, both consumers migrated, tests green, mypy clean. `/records` + `/activities` behavior byte-identical (existing API tests prove it).

## Task 2: Photos migration onto the core

### Classification: standard

### Required Docs
- Spec §5.2; `docs/domain-rules/photos.md` (accepted-exception wording to retire)

### Task Description
`backend/src/services/photo.py`:
1. Replace the hand-rolled count+slice (~L93-99, the block the docstring at L60-67 documents as bypassing `BaseRepository.list_custom` because it "drops the extra column") with `rows, total = await self.repo.list_custom(stmt)` from Task 1. Keep: stmt construction (ilike / tag-EXISTS / service-OR predicates), the `client_name` labeled column, Row→`PhotoResponse` mapping (~L102-105), pagination envelope assembly.
2. Effect (assert in tests): count now computed on the UNordered stmt via the core — photos' count-order deviation fixed by construction.
3. Update the docstring (L60-67) — exception retired, photos rides the core.
4. `docs/domain-rules/photos.md`: update the exception paragraph (the wording describing PhotoService bypassing the repo list; explore-pinned at :17/:49-50 area — locate "list_custom"/"bypass" mentions) to state photos now uses the shared row-core.
5. NOT `list_clients_with_stats` — untouched (its separate `count_query` excludes stat subqueries deliberately; cf. #217).
6. TDD:
- [ ] RED: existing photos tests keep passing is the floor; add one test asserting `total` is computed pre-order (multi-page fixture where ordered-count would differ, or assert count query shape via the core's behavior).
- [ ] GREEN: migration.
- [ ] `uv run pytest tests/ -q -k photo` green; full suite green.
- [ ] Commit: `refactor(photos): PhotoService.list rides repo list_custom core (#213)`

## Task 3: `RecordViewResponse` schema + `RecordService.list_view()`

### Classification: standard

### Required Docs
- Spec §4 (normative field table), §5 (service design); `docs/domain-rules/records.md` §list contract; `docs/domain-rules/payments.md` (paid semantics)

### Task Description
1. `backend/src/schemas/record.py` — add:
```python
class RecordViewResponse(RecordResponse):
    client_name: str | None = None
    activity_start: str | None = None   # ISO string, byte-identical serialization to ActivityResponse.start
    service_title: str | None = None
    master_name: str | None = None      # «Фамилия Имя» — same composition as displayMasterName (lib/utils.ts:4-6)
    location_name: str | None = None
    master_color: str | None = None
    is_private: bool = False
    paid: int = 0                        # COALESCE(SUM(Payment.amount), 0); payments are hard-deleted, no is_active
```
2. `backend/src/services/record.py`:
- Extract query assembly from `list()` (L62-113) into `_build_list_stmt(params)`: Activity INNER join, business filters, `q` predicates (Client/Service LEFT OUTER joins ONLY when `q` present), `selectinload(Record.visits)`, sort expressions from the SAME `_sort_columns` whitelist, same repo calling convention as today. `list()` behavior byte-identical.
- `list_view(params)`: same stmt + `stmt.add_columns(...)` with 8 LABELED columns:
```python
client_name  = select(Client.name).where(Record.client_id == Client.id).scalar_subquery().label("client_name")
activity_start = Activity.start.label("activity_start")     # direct column (INNER-joined)
is_private   = Activity.is_private.label("is_private")     # direct column
service_title = select(Service.title).where(Activity.service_id == Service.id).scalar_subquery().label("service_title")
master_name  = select(Master.last_name + " " + Master.first_name).where(Activity.master_id == Master.id).scalar_subquery().label("master_name")  # «Фамилия Имя» — same correlated-subquery idiom as _sort_columns (record.py:119-148)
location_name = select(Location.name).where(Activity.location_id == Location.id).scalar_subquery().label("location_name")
master_color = select(Master.color).where(Activity.master_id == Master.id).scalar_subquery().label("master_color")
paid = select(func.coalesce(func.sum(Payment.amount), 0)).where(Payment.record_id == Record.id).scalar_subquery().label("paid")
```
NO `is_active` filters anywhere (archived resolves — US-3).
- Execute via `list_custom` (row-tuple core); map Row → `RecordViewResponse`: base fields via existing `_map_record(row[0])` (visits included via selectinload), display fields by named-label unpacking (`row.client_name` etc.); `activity_start` serialized through the SAME helper/format `ActivityResponse.start` uses (find the activity mapping — byte-parity is load-bearing for `parseActivityStart`).
- Returns `PaginatedResponse[RecordViewResponse]` (page↔offset conversion same as `list()`).
3. TDD (service-level, `backend/tests/test_service_record_view.py` or repo convention):
- [ ] RED: display-field correctness — archived client/master/service/location resolve names (seed archived entities + a record); anonymous record → `client_name None`; `master_name` == «Фамилия Имя»; `paid` none/partial/full → 0/sum/total; `is_private` passthrough; `activity_start` string equals the activity endpoint's serialization for the same row.
- [ ] GREEN: implement; [ ] refactor if the builder extraction drifted.
- [ ] `uv run pytest -q` green; mypy clean.
- [ ] Commit: `feat(records): RecordViewResponse + RecordService.list_view (#213)`

## Task 4: Router `GET /records/view` + API tests

### Classification: standard

### Required Docs
- Spec §4 (contract), §5; `docs/domain-rules/records.md` §list contract (422 matrix, sort table)

### Task Description
1. `backend/src/api/v1/records.py` — declare BEFORE `GET /{record_id}` (route order — `/view` would be captured by the id path param):
```python
@router.get("/view", response_model=PaginatedResponse[RecordViewResponse])
async def list_records_view(params: Annotated[RecordListParams, Query()], ...deps as siblings...):
    return await service.list_view(params)
```
Same injection idiom as `GET ""` (`Annotated[RecordListParams, Query()]` — NOT Depends, fastapi#4974).
2. TDD (`backend/tests/test_api_records_view.py`):
- [ ] RED, then GREEN for: route order (GET `/api/v1/records/view` returns 200 page, NOT the 422/`{record_id}` path); pagination envelope `{items,total,page,per_page}`; 422 parity matrix (bad status/sort_by/sort_order/page/per_page/q-length/date_from>date_to) — same outcomes as `/records` (parametrize against shared cases if repo convention exists); filters + `q` parity on view; sort parity loop — for EVERY sort_by key × both orders: id sequence from `/records/view` == id sequence from `/records` on the same fixture (US-5/US-6); display fields present in items (incl. archived-entity names — US-3 API-level).
- [ ] Full: `uv run pytest -q` green; mypy clean.
- [ ] Commit: `feat(api): GET /api/v1/records/view composite read endpoint (#213)`

## Task 5: api-client — `RecordViewResponseSchema`, `getRecordsView()`, `getClientById()`

### Classification: small

### Required Docs
- Spec §7; `packages/api-client/src/endpoints.ts` (getRecords :300-331 as pattern; `getClientByPhone` :542 as by-id/param pattern), `schemas.ts` (`RecordResponseSchema`, `paginatedSchema` :515-522)

### Task Description
1. `schemas.ts`:
```ts
export const RecordViewResponseSchema = RecordResponseSchema.extend({
  client_name: z.string().nullable(),
  activity_start: z.string().nullable(),
  service_title: z.string().nullable(),
  master_name: z.string().nullable(),
  location_name: z.string().nullable(),
  master_color: z.string().nullable(),
  is_private: z.boolean(),
  paid: z.number().int(),
});
export type RecordView = z.infer<typeof RecordViewResponseSchema>;
```
2. `endpoints.ts`: `getRecordsView(params)` — mirror `getRecords` param serialization + URL `GET /records/view`, parse via `paginatedSchema(RecordViewResponseSchema)`. `getClientById(id)` — `GET /clients/{id}`, response schema mirroring the backend route's `response_model` (check `backend/src/api/v1/clients.py:73-89`; verified missing from api-client today — do NOT reuse getClients/getClientsPaged).
3. TDD:
- [ ] RED: schema parse test (valid fixture incl. nulls + paid int; reject missing display field), getRecordsView URL/params test, getClientById URL test — follow existing api-client test file conventions.
- [ ] GREEN; `npm test` green; type-check clean.
- [ ] Commit: `feat(api-client): RecordViewResponseSchema + getRecordsView + getClientById (#213)`

## Task 6: RecordsContext — records query swaps to `getRecordsView()` (maps stay, transitional)

### Classification: small

### Required Docs
- Spec §6.1; `frontend/admin/contexts/RecordsContext.tsx` (query L99-117, key L100, page-clamp L149-154); vitest-playwright-patterns skill

### Task Description
1. In `RecordsContext.tsx`: records query fetcher `getRecords` → `getRecordsView` (same params); `records` typed `RecordView[]`; query KEY unchanged `['records', page, perPage, dateFrom, dateTo, filters, sortBy, sortOrder]`; `placeholderData: keepPreviousData` and page-clamp effect unchanged. The 6 maps + payments query STAY untouched in this task (transitional compile-green state — other consumers still read them).
2. TDD:
- [ ] RED→GREEN: update RecordsContext tests — records come from `getRecordsView` mock; map fields still provided.
- [ ] `cd frontend/admin && npm run test -- RecordsContext` green; `npm run type-check` clean.
- [ ] Commit: `feat(records): context records query -> getRecordsView (#213)`

## Task 7: recordsColumns row-field rendering + RecordsTable detail panel/delete dialog

### Classification: standard

### Required Docs
- Spec §6.2, §6.3 (cell table incl. fallbacks, DiamondIcon, dot, badges); `frontend/admin/app/(main)/records/components/recordsColumns.tsx` (:47-55 seam, :64-153 cells), `RecordsTable.tsx` (:62-76 factory call, :84-85/:133/:164/:177 detail, :240 delete dialog); vitest-playwright-patterns skill

### Task Description
1. `recordsColumns.tsx`: DELETE the `RecordColumnLookup` seam (:47-55); factory takes no lookup — pure `ColumnDef<RecordView>[]`. Cells per spec §6.2:
- date: `parseActivityStart`/`formatDateRu`/`formatTime` over `row.activity_start`; `'—'` when null.
- client: `row.client_name` in the same button (opens ClientQuickCard via `row.client_id` — wiring unchanged); `'—'` fallback.
- service: `row.service_title` + `<DiamondIcon/>` when `row.is_private`; `'—'` fallback.
- master: dot `backgroundColor: row.master_color ?? '#999'}` + `title` tooltip `row.master_name`; no tooltip when null.
- location: `row.location_name` ?? `'—'`.
- payment: badges `✓ Оплачено` / `Частично (N₽)` / `Не оплачено` — logic unchanged, source `row.paid` (was `payments.get(id) ?? 0`).
2. `RecordsTable.tsx`: stop destructuring `clients/activities/masters/services/locations/payments` and passing them to the factory; detail panel reads the selected `RecordView` row (`row.client_name ?? '—'`, `row.service_title` + DiamondIcon at :133, `row.master_name`, `row.location_name`); delete dialog `formatRecordLabel(deleteTarget.record.activity_start)` (:240 — crash if missed).
3. TDD:
- [ ] RED→GREEN: update recordsColumns/RecordsTable tests — row-field rendering, all fallbacks, dot color, DiamondIcon, badges; detail panel; delete dialog label.
- [ ] `npm run test -- records` green; type-check + lint clean.
- [ ] Commit: `feat(records): columns + detail panel read view row fields (#213)`

## Task 8: BookingFilters — direct raw dict queries on canonical keys

### Classification: small

### Required Docs
- Spec §6.4 (R2 rationale — raw shapes, NOT shared hooks); `BookingFilters.tsx` (:47 destructure, :49-51 `!archived`, labels :141/:157/:173); api-client `getAllLocations/getAllServices/getAllMasters` (endpoints.ts:763-771, raw shapes carry `archived`/`first_name`)

### Task Description
1. Replace `const { locations, services, masters } = useRecords()` with three direct queries (KEEP `filters/setFilters/resetFilters` from useRecords):
```ts
const { data: locations } = useQuery({ queryKey: ['locations'], queryFn: () => getAllLocations(), staleTime: 5 * 60 * 1000 });
// same for ['services'] -> getAllServices(), ['masters'] -> getAllMasters()
```
Canonical keys = TanStack dedupe with all other consumers. Dropdown behavior byte-identical: `!archived` filters and `l.name`/`s.title`/`m.first_name` labels stay verbatim (raw responses carry those fields). Do NOT use `useLocations()/useServices()/useMasters()` hooks (their transforms drop `archived`, rename `first_name`→`shortName`) and do NOT modify those hooks/transformers.
2. TDD:
- [ ] RED→GREEN: BookingFilters tests — options from own queries, active-only filtering preserved.
- [ ] `npm run test -- BookingFilters` green; type-check clean.
- [ ] Commit: `feat(records): BookingFilters owns selection data via canonical-key queries (#213)`

## Task 9: ClientQuickCard — by-id client + shared hooks for service/location labels

### Classification: standard

### Required Docs
- Spec §6.5; `ClientQuickCard.tsx` (:35 destructure, :55/:84-100 header, :61-62/:131/:139 records-list labels)

### Task Description
1. Remove `useRecords()` from ClientQuickCard. Header: `useQuery({ queryKey: ['client', clientId], queryFn: () => getClientById(clientId), enabled: !!clientId })` — name/phone from the response. Records-list labels: `useServices()` / `useLocations()` shared hooks (transformed domain objects carry `title`/`name` — verify; if a needed field is missing, fall back to the Task-8 raw-canonical-key pattern — do NOT modify transformers).
2. Own queries (records/activities/payments-totals) unchanged.
3. TDD:
- [ ] RED→GREEN: ClientQuickCard tests — header from getClientById mock; labels from hooks; no useRecords dependency.
- [ ] `npm run test -- ClientQuickCard` green; type-check clean.
- [ ] Commit: `feat(records): ClientQuickCard re-homed off RecordsContext (#213)`

## Task 10: ActivityDetailsModal by-id fallback + schedule RecordsProvider removal

### Classification: standard

### Required Docs
- Spec §6.6 (Amendment 3: removal CONFIRMED + verification); `ActivityDetailsModal.tsx` (:29, :80 fallback chain, :201 direct), `frontend/admin/app/(main)/schedule/page.tsx` (:33-37 provider wrap); vitest-playwright-patterns skill

### Task Description
1. Modal: remove `useRecords()`; client resolution becomes `useClients()` paged map FIRST (existing), then per-id fallback `useQuery({ queryKey: ['client', record.client_id ?? ''], queryFn: () => getClientById(record.client_id!), enabled: !!record.client_id })` — same precedence as today (:80 chain, :201 direct both re-homed).
2. `schedule/page.tsx`: REMOVE the `<RecordsProvider>` wrapper (L33-37) — demote to plain children under remaining providers. After this + Task 9, ZERO non-records-page consumers of `useRecords()` remain.
3. Verification (Amendment 3): update/extend schedule-page unit tests (modal client resolution both paths); run existing ActivityDetailsModal tests; confirm no test still renders RecordsProvider on /schedule.
4. TDD:
- [ ] RED→GREEN: modal tests re-homed; schedule page test compiles without RecordsProvider.
- [ ] `npm run test -- ActivityDetailsModal` + `npm run test -- schedule` green; type-check clean.
- [ ] Commit: `feat(schedule): ActivityDetailsModal by-id clients fallback; RecordsProvider removed (#213)`

## Task 11: RecordsContext — delete all 6 maps + payments query

### Classification: small

### Required Docs
- Spec §6.1 (deletion scope), §6.4-6.6 (re-homing rationale — consumers gone after Tasks 8-10)

### Task Description
1. Delete from `RecordsContext.tsx`: all 6 lookup queries + map construction (L169-245: activities per_page:100, masters, services, locations, clients getClients, payments totals incl. `recordIds` memo), map-loading flags, `payments` field, now-unused imports (`getActivities`, `getClients`, `getPaymentTotals`, `getAllMasters`, `getAllServices`, `getAllLocations`).
2. Context value: `records: RecordView[]` + filters/sort/pagination state + setters + `refetch` (+ records-loading flags). Nothing else.
3. Sanity: `grep -rn "useRecords(" frontend/admin/src frontend/admin/app` — remaining consumers destructure ONLY state/records/refetch (page.tsx, RecordsTable).
4. TDD:
- [ ] RED→GREEN: RecordsContext tests — no map fields in context value; no `getClients`/`getActivities`/`getPaymentTotals` mocks needed.
- [ ] `npm run test` (full admin unit) green; type-check + lint clean.
- [ ] Commit: `refactor(records): delete display lookup maps from RecordsContext (#213)`

## Task 12: Payment mutations invalidate `['records']`

### Classification: small

### Required Docs
- Spec §6.7/R4; `frontend/admin/hooks/useRecordMutations.ts` (:202-218 add, :220-229 delete, :327-336 patch, :382-411 deferred — commit at :406)

### Task Description
1. Add `queryClient.invalidateQueries({ queryKey: ['records'] })` to all FOUR payment paths: `addPayment`, `deletePayment`, `patchPayment`, `deletePaymentDeferred` (on the COMMIT path — not on defer). Keep existing `['record', id]` invalidation and optimistic cache writes.
2. TDD:
- [ ] RED→GREEN: mutation tests — all four paths trigger `['records']` invalidation.
- [ ] `npm run test -- useRecordMutations` green; type-check clean.
- [ ] Commit: `feat(records): payment mutations invalidate records list (#213)`

## Task 13: E2E US-1..US-3 (beyond-cap, one-request, archived)

### Classification: standard

### Required Docs
- Spec §8 US-1/US-2/US-3; vitest-playwright-patterns skill (Full Cycle pattern, fixtures/factories)

### Task Description
Author Playwright specs in `frontend/admin/e2e/` (repo naming convention — check existing records specs):
1. US-1: seed ≥101 clients; record for client #101 → table shows that client's name. E2E test for scenario US-1 passes (RED-GREEN-REFACTOR: write RED against current main behavior — empty name — then it goes GREEN after backend+frontend tasks; if implementing post-hoc, verify GREEN against the finished stack).
2. US-2: intercept API calls on records page load — exactly ONE `/records/view`; ZERO `/clients?per_page=100`, `/activities?...per_page=100`, `/payments/totals`; dropdowns populate and filter (US-2 request taxonomy per spec §8).
3. US-3: record referencing archived client + archived master → real names + master's own dot color; record with dangling service → `'—'`.
- [ ] Local author + targeted run via `tester` (owns the stack; standalone BACKEND_URL per infra lessons); authoritative run on CI.
- [ ] Commit: `test(e2e): US-1..US-3 records view scenarios (#213)`

## Task 14: E2E US-4..US-6 (paid freshness, filter parity, sort parity)

### Classification: standard

### Required Docs
- Spec §8 US-4/US-5/US-6; vitest-playwright-patterns skill

### Task Description
1. US-4: payment column filled from row; add payment in detail panel → badge updates without reload (Task-12 invalidation).
2. US-5: each filter (client/activity/date range/location/service/master/status) + `?q=` → identical results as before (fixture-driven; can assert against API responses for parity + UI smoke).
3. US-6: sorting by all current columns × asc/desc — API-level order parity (`/records/view` vs stored expectations) + UI sort indicators unchanged.
- [ ] As Task 13: tester-run locally, CI authoritative.
- [ ] Commit: `test(e2e): US-4..US-6 records view scenarios (#213)`

## Task 15: Domain-rules docs sync

### Classification: trivial

### Required Docs
- Spec §13; `docs/domain-rules/records.md` (:137-201), `docs/domain-rules/photos.md` (done in Task 2 — verify), `docs/domain-rules/activities.md:48-56` (label pin — no change, cross-check)

### Task Description
1. `records.md`: add `GET /api/v1/records/view` row to the API Endpoints table; add a view-contract subsection (fields table from spec §4, archived-resolution rule, paid semantics, route-order note); REWRITE the :201 pagination-mechanics paragraph for the §5.1 family (`list_custom` row-core + `list_entity`).
2. Cross-check: photos.md wording updated (Task 2); activities.md label pin untouched (no third format introduced).
- [ ] Commit: `docs: sync domain rules for records view + repo family (#213)`

---

## Task summary

| # | Task | Class | Reviewer pipeline |
|---|---|---|---|
| 1 | Repo read family + migration | standard | two-stage |
| 2 | Photos onto core | standard | two-stage |
| 3 | RecordViewResponse + list_view | standard | two-stage |
| 4 | Router /view + API tests | standard | two-stage |
| 5 | api-client additions | small | spec-review only |
| 6 | Context query swap (transitional) | small | spec-review only |
| 7 | Columns + panel + delete dialog | standard | two-stage |
| 8 | BookingFilters re-home | small | spec-review only |
| 9 | ClientQuickCard re-home | standard | two-stage |
| 10 | Modal fallback + schedule provider removal | standard | two-stage |
| 11 | Map deletion | small | spec-review only |
| 12 | Payment invalidations | small | spec-review only |
| 13 | E2E US-1..US-3 | standard | two-stage |
| 14 | E2E US-4..US-6 | standard | two-stage |
| 15 | Domain-rules docs | trivial | spot-check |

Dependency chain: 1→2,3,4 (backend core first); 5 after 4; 6 after 5; 7 after 6; 8,9,10 independent of 6-7 but MUST land before 11; 11 after 7-10; 12 any time after 5; 13,14 after 11-12; 15 last.
