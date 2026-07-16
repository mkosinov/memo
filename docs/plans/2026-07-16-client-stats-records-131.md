# #131 client-stats refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename клиентскую статистику с «визитов» на «записи» как единую смысловую единицу — `records_count` / `missed_records` / `last_record` — через весь стек (backend SQL → Pydantic → Zod → UI), с упрощением SQL-логики (без Visit-джойнов, через персистируемый `Record.status`).

**Architecture:** Single PR, две последовательные фазы: backend (T1) → frontend (T2-T4) → docs (T5). Backend переименовывает 3 поля в `ClientWithStats` + 2 параметра API (`min/max_visits` → `min/max_records`) и переписывает 2 subqueries (`missed_records` через `Record.status`, `last_record` = `MAX(Activity.start)` без фильтра статуса). Frontend догоняет rename в Zod-схеме, компонентах, фильтрах, UI-текстах и тестах. Domain-rules doc обновляется (T5).

**Tech Stack:** FastAPI + SQLAlchemy (backend), Next.js 14 + TypeScript + Zod + Tailwind (frontend), pytest (backend tests), vitest + Playwright (frontend tests)

---

## Behavioral Delta

How this feature behaves for the user, mapped to spec acceptance criteria:

- **Колонка «Всего записей»** → Администратор видит в таблице клиентов колонку «Всего записей» (вместо «Кол-во визитов») с числом записей каждого клиента. Число не меняется — только название.
- **Колонка «Последняя запись»** → Администратор видит дату последнего мероприятия, на которое клиент был записан — даже если клиент отменил или пропустил эту запись (раньше показывалась только дата посещённого мероприятия).
- **Фильтр «Записи»** → Администратор фильтрует клиентов по «Записей: от N» (вместо «Визиты: от N»). Параметр `min_records`/`max_records` в API.
- **Карточка клиента** → Статистика в карточке клиента показывает «Записей: N», «Пропущено: N», «Последняя: дата» (вместо «Визитов»/«Последний визит»).
- **Сортировка** → Администратор сортирует по «Всего записей» / «Последняя запись» / «Пропущено» — API принимает `sort_by=records_count`/`last_record`/`missed_records`.
- **Пропущенные = записи** → «Пропущено» теперь считает записи со статусом `missed` (не отдельные визиты со статусом `missed`). Запись с 1 visited + 1 missed → НЕ считается пропущенной (статус записи = `visited`).

---

## File Structure

### Backend (T1)
| File | Responsibility | Change |
|------|---------------|-------|
| `backend/src/schemas/client.py` | Pydantic schemas `ClientWithStats`, `ClientListParams` | Rename 3 fields + 2 filter params |
| `backend/src/services/client.py` | `list_clients_with_stats` SQL + response mapping | Rewrite 2 subqueries, rename labels/sort/filter maps, response mapping |
| `backend/tests/test_client_stats.py` | Backend stat tests | Rename field references, update `last_record` semantics test, update `missed_records` semantics test |
| `backend/tests/test_schemas_client.py` | Schema validation tests | Rename field references |

### Frontend (T2-T4)
| File | Responsibility | Change |
|------|---------------|-------|
| `packages/api-client/src/schemas.ts` | Zod schema `ClientWithStatsSchema` | Rename 3 fields (line 285-288) |
| `frontend/admin/app/(main)/clients/components/ClientsTable.tsx` | Column defs, cell rendering | Rename column keys + labels, update cell reads |
| `frontend/admin/app/(main)/clients/components/ClientInfoTab.tsx` | Stats mapping (raw→camel) | Rename 3 mappers |
| `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx` | Stats mapping (raw→camel) | Rename 3 mappers |
| `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx` | Stats mapping + type guard | Rename 3 mappers + type guard key |
| `frontend/admin/app/components/shared/record/blocks/ClientStatistics.tsx` | Component prop interface + labels | Rename 3 props + 2 display labels |
| `frontend/admin/contexts/ClientsContext.tsx` | Filter interface + query param passthrough | Rename `min_visits`/`max_visits` → `min_records`/`max_records` |
| `frontend/admin/app/(main)/clients/components/ClientsFilters.tsx` | Filter UI + labels | Rename bindings + label "Визиты"→"Записи" |
| `frontend/admin/__tests__/helpers/mockData.ts` | Mock data fixture | Rename 3 fields |
| `frontend/admin/__tests__/helpers/mockContexts.ts` | Mock context defaults | Rename `min_visits`/`max_visits` → `min_records`/`max_records` |
| `frontend/admin/__tests__/ClientsTable.test.tsx` | Table unit tests | Rename 16 refs |
| `frontend/admin/__tests__/ClientsPage.test.tsx` | Page unit tests | Rename 3 refs |
| `frontend/admin/__tests__/ClientsIntegration.test.tsx` | Integration tests | Rename 5 refs |
| `frontend/admin/__tests__/ClientInfoTab.test.tsx` | Info tab tests | Rename 2 refs |
| `frontend/admin/__tests__/ClientCardModal.test.tsx` | Card modal tests | Rename 3 refs |
| `frontend/admin/__tests__/ClientsFilters.test.tsx` | Filter tests | Rename 8 refs + label asserts |
| `frontend/admin/e2e/clients.spec.ts` | E2E clients page | Rename 2 column header asserts |

### Docs (T5)
| File | Change |
|------|--------|
| `docs/domain-rules/clients.md` | Update field names + `last_record` definition |

---

## Task 1: Backend — rename fields + rewrite subqueries

### Classification: standard
### Required Docs
- `docs/specs/2026-07-16-client-stats-records-131-design.md` — §1 (target semantics), §2 (API params), §4 (test updates), §5 (no migration)
- `docs/domain-rules/clients.md` — current stats field definitions (to verify what changes)
- `docs/domain-rules/records.md` — `compute_record_status` derivation rule (priority: visited > missed > cancelled > waiting)

### Context
This is the first task — backend rename. After this task, backend tests pass with new field names. Frontend will be broken until T2-T4 (expected — single PR, backend first).

**Record.status is already persisted** (migration `4d5e6f7a8b9c` backfilled all rows, `recompute_record_status()` called on every CRUD). We rely on it for `missed_records`.

### Files
- `backend/src/schemas/client.py` (modify)
- `backend/src/services/client.py` (modify)
- `backend/tests/test_client_stats.py` (modify)
- `backend/tests/test_schemas_client.py` (modify)

### Steps

#### 1a. Schema rename (`schemas/client.py`)

- [ ] Rename `ClientWithStats` fields (lines 63-66):
  - `visits_count: int = 0` → `records_count: int = 0`
  - `last_visit: str | None = None` → `last_record: str | None = None`
  - `missed_visits: int = 0` → `missed_records: int = 0`
  - `total_paid: int = 0` — no change
- [ ] Rename `ClientListParams` fields (lines 80-81):
  - `min_visits: int | None = None` → `min_records: int | None = None`
  - `max_visits: int | None = None` → `max_records: int | None = None`
  - `missed_from`/`missed_to`/`min_paid`/`max_paid`/`sort_by`/`sort_order` — no change

#### 1b. Rewrite subqueries (`services/client.py`)

- [ ] `records_count_sq` (lines 41-45) — NO LOGIC CHANGE. Only the label changes in step 1c.
- [ ] Replace `last_visit_sq` (lines 47-58) with `last_record_sq`:
  ```python
  last_record_sq = (
      select(func.max(Activity.start))
      .select_from(Record)
      .join(Activity, Record.activity_id == Activity.id)
      .where(
          Record.client_id == Client.id,
          Record.is_active == True,  # noqa: E712
      )
      .correlate(Client)
      .scalar_subquery()
  )
  ```
  Key changes: no `Visit` join, no `Visit.status == "visited"` filter. `select_from(Record)` instead of `select_from(Visit)`.
- [ ] Replace `missed_visits_sq` (lines 60-71) with `missed_records_sq`:
  ```python
  missed_records_sq = (
      select(func.count(Record.id))
      .where(
          Record.client_id == Client.id,
          Record.is_active == True,  # noqa: E712
          Record.status == "missed",
      )
      .correlate(Client)
      .scalar_subquery()
  )
  ```
  Key changes: no `Visit` join, uses `Record.status == "missed"` (persisted column from #98).
- [ ] Rename column labels (lines 81-83):
  - `visits_count_col = records_count_sq.label("visits_count")` → `records_count_col = records_count_sq.label("records_count")`
  - `last_visit_col = last_visit_sq.label("last_visit")` → `last_record_col = last_record_sq.label("last_record")`
  - `missed_visits_col = missed_visits_sq.label("missed_visits")` → `missed_records_col = missed_records_sq.label("missed_records")`
  - `total_paid_col` — no change
- [ ] Update `base_cols` (lines 96-99): replace `visits_count_col`/`last_visit_col`/`missed_visits_col` → `records_count_col`/`last_record_col`/`missed_records_col`
- [ ] Update `stats_filter_map` (lines 144-150):
  - `"min_visits"` → `"min_records"`, value still `records_count_sq`
  - `"max_visits"` → `"max_records"`, value still `records_count_sq`
  - `"missed_from": missed_visits_sq` → `"missed_from": missed_records_sq`
  - `"missed_to": missed_visits_sq` → `"missed_to": missed_records_sq`
  - `min_paid`/`max_paid` — no change
- [ ] Update `ops_map` (lines 153-158):
  - `"min_visits"` → `"min_records"`, `"max_visits"` → `"max_records"`
  - `missed_from`/`missed_to` — no change (keys unchanged, just different subquery)
- [ ] Update `sort_column_map` (lines 175-178):
  - `"visits_count": records_count_sq` → `"records_count": records_count_sq`
  - `"last_visit": last_visit_sq` → `"last_record": last_record_sq`
  - `"missed_visits": missed_visits_sq` → `"missed_records": missed_records_sq`
  - `name`/`total_paid`/`created_at`/`updated_at` — no change
- [ ] Update response mapping (lines 198-215):
  - `last_visit = None` → `last_record = None`
  - `if row.last_visit:` → `if row.last_record:`
  - `last_visit = row.last_visit.isoformat(...)` → `last_record = row.last_record.isoformat(...)`
  - `visits_count=row.visits_count or 0` → `records_count=row.records_count or 0`
  - `last_visit=last_visit` → `last_record=last_record`
  - `missed_visits=row.missed_visits or 0` → `missed_records=row.missed_records or 0`

#### 1c. TDD — Write/Update backend tests

- [ ] Write RED test `test_records_count_renamed` in `test_client_stats.py`:
  - Create client with 2 records → `GET /api/v1/clients` → assert `records_count == 2` (field renamed)
  - Assert `visits_count` key does NOT exist in response
  - Run: `cd backend && uv run pytest tests/test_client_stats.py::test_records_count_renamed -x` → expect RED (field still old name)
  - NOTE: after implementing 1a+1b, this test goes GREEN

- [ ] Write RED test `test_missed_records_uses_record_status` in `test_client_stats.py`:
  - Create client with 1 record, add 2 visits both `status='missed'` → `recompute_record_status` sets `Record.status='missed'`
  - `GET /api/v1/clients` → assert `missed_records == 1` (the RECORD, not visits)
  - Create another client with 1 record, 1 visit `visited` + 1 visit `missed` → `Record.status='visited'` (priority rule)
  - Assert `missed_records == 0` (NOT counted — record status is `visited`, not `missed`)
  - This test validates the semantic shift from "count visits with status=missed" to "count records with status=missed"
  - Run: expect RED → GREEN after 1b

- [ ] Write RED test `test_last_record_uses_activity_start_no_status_filter` in `test_client_stats.py`:
  - Create client with 2 records:
    - Record A: Activity.start = 2026-01-10, Visit status=`visited`
    - Record B: Activity.start = 2026-01-20, Visit status=`cancelled`
  - `GET /api/v1/clients` → assert `last_record` = 2026-01-10T... (Activity.start of record B, the LATEST by Activity.start, even though cancelled)
  - Old behavior: `last_visit` would return 2026-01-10 (only visited). New: 2026-01-20 (no status filter).
  - Run: expect RED → GREEN after 1b

- [ ] Write RED test `test_all_cancelled_records_missed_zero` (US-7 edge case) in `test_client_stats.py`:
  - Create client with 2 records, all visits `status='cancelled'` → `Record.status='cancelled'` for both
  - Record A: Activity.start = 2026-01-10
  - Record B: Activity.start = 2026-01-22
  - `GET /api/v1/clients` → assert:
    - `missed_records == 0` (both records have status `cancelled`, NOT `missed`)
    - `last_record` = Activity.start of Record B (2026-01-22, the latest, even though cancelled)
  - This validates US-7: all-cancelled client → `missed_records=0`, `last_record` = MAX(Activity.start) of latest cancelled
  - Run: expect RED → GREEN after 1b

- [ ] Update all existing test references in `test_client_stats.py` (44 lines):
  - `visits_count` → `records_count` (field name in JSON asserts)
  - `last_visit` → `last_record`
  - `missed_visits` → `missed_records`
  - `sort_by='visits_count'` → `sort_by='records_count'`
  - `sort_by='last_visit'` → `sort_by='last_record'`
  - `sort_by='missed_visits'` → `sort_by='missed_records'`
  - `min_visits=X` query param → `min_records=X`
  - `max_visits=X` → `max_records=X`
  - `missed_from`/`missed_to` — no change (key names unchanged)
  - Update tests that assert `last_visit` = specific date: check if test setup has only visited records → date stays same. If test has mixed statuses → update assert to new semantics (all records, no status filter)

- [ ] Update `test_schemas_client.py` (lines 163-189):
  - `visits_count` → `records_count`
  - `last_visit` → `last_record`
  - `missed_visits` → `missed_records`
  - `min_visits` → `min_records`
  - `max_visits` → `max_records`

- [ ] Run full backend test suite: `cd backend && uv run pytest -q`
  - Expected: all tests pass (659 from baseline; 3 new tests added = 662 total)
  - Verify zero failures

- [ ] Commit: `git add -A && git commit -m "refactor(#131): rename client-stats to records-based semantics (backend)"`

### Definition of Done
- [ ] `ClientWithStats` has `records_count`/`last_record`/`missed_records` fields
- [ ] `ClientListParams` has `min_records`/`max_records`
- [ ] `last_record_sq` uses `MAX(Activity.start)` over all active records, no Visit join, no status filter
- [ ] `missed_records_sq` uses `Record.status == 'missed'`, no Visit join
- [ ] `sort_column_map` keys are `records_count`/`last_record`/`missed_records`
- [ ] `stats_filter_map` keys are `min_records`/`max_records`/`missed_from`/`missed_to`
- [ ] 4 new TDD tests pass: `test_records_count_renamed`, `test_missed_records_uses_record_status`, `test_last_record_uses_activity_start_no_status_filter`, `test_all_cancelled_records_missed_zero`
- [ ] All existing backend tests pass (renamed)
- [ ] `uv run pytest -q` → 0 failures

---

## Task 2: Frontend — Zod schema + mock data + mock contexts

### Classification: small
### Required Docs
- `docs/specs/2026-07-16-client-stats-records-131-design.md` — §3 (frontend layers)

### Context
Backend is renamed (T1 done). Now frontend starts. This task updates the public API contract (Zod schema) and all test fixtures. After this task, TypeScript compilation will fail in components (expected — fixed in T3). But Zod schema + mock data are self-contained and can be updated independently.

### Files
- `packages/api-client/src/schemas.ts` (modify)
- `frontend/admin/__tests__/helpers/mockData.ts` (modify)
- `frontend/admin/__tests__/helpers/mockContexts.ts` (modify)

### Steps

- [ ] Update Zod schema (`packages/api-client/src/schemas.ts:284-289`):
  - `visits_count: z.number()` → `records_count: z.number()`
  - `last_visit: z.string().nullable()` → `last_record: z.string().nullable()`
  - `missed_visits: z.number()` → `missed_records: z.number()`
  - `total_paid: z.number()` — no change
  - Type `ClientWithStats` auto-updates via `z.infer`

- [ ] Update `mockData.ts` (line 103-106):
  - `visits_count: 5` → `records_count: 5`
  - `last_visit: '2026-05-15T14:00:00'` → `last_record: '2026-05-15T14:00:00'`
  - `missed_visits: 1` → `missed_records: 1`

- [ ] Update `mockContexts.ts` (lines 150-155):
  - `min_visits: null` → `min_records: null`
  - `max_visits: null` → `max_records: null`
  - `missed_from: null` — no change
  - `missed_to: null` — no change

- [ ] Verify Zod schema compiles: `cd frontend && npx tsc --noEmit --project packages/api-client/tsconfig.json` (if separate tsconfig) OR `cd frontend && npx tsc --noEmit` (if monorepo). Expect errors in component files (not yet updated — that's T3). Verify NO errors in `schemas.ts` itself.

- [ ] Commit: `git add -A && git commit -m "refactor(#131): rename Zod schema + mock data to records-based names"`

### Definition of Done
- [ ] `ClientWithStatsSchema` has `records_count`/`last_record`/`missed_records`
- [ ] `mockData.ts` fixture uses new field names
- [ ] `mockContexts.ts` uses `min_records`/`max_records`
- [ ] Zod schema file itself compiles cleanly

---

## Task 3: Frontend — Component rename (ClientsTable, ClientInfoTab, ClientRecordTab, ClientTab, ClientStatistics, ClientsContext, ClientsFilters)

### Classification: standard
### Required Docs
- `docs/specs/2026-07-16-client-stats-records-131-design.md` — §3 (frontend layers)
- `docs/domain-rules/clients.md` — field names to verify

### Context
T2 renamed Zod schema + mocks. Now update all components that read `client.visits_count`/`client.last_visit`/`client.missed_visits` and map them to `ClientStatistics` props. After this task, TypeScript compiles and components render with new field names. Unit tests will fail until T4 updates them.

### Files
- `frontend/admin/app/(main)/clients/components/ClientsTable.tsx` (modify)
- `frontend/admin/app/(main)/clients/components/ClientInfoTab.tsx` (modify)
- `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx` (modify)
- `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx` (modify)
- `frontend/admin/app/components/shared/record/blocks/ClientStatistics.tsx` (modify)
- `frontend/admin/contexts/ClientsContext.tsx` (modify)
- `frontend/admin/app/(main)/clients/components/ClientsFilters.tsx` (modify)

### Steps

#### 3a. ClientsTable.tsx

- [ ] Update `COLUMNS` array (lines 14-15):
  - `{ key: 'visits_count', label: 'Кол-во визитов', ... }` → `{ key: 'records_count', label: 'Всего записей', ... }`
  - `{ key: 'last_visit', label: 'Последний визит', ... }` → `{ key: 'last_record', label: 'Последняя запись', ... }`
- [ ] Update `hasActiveFilters` (lines 40-41):
  - `filters.min_visits !== null` → `filters.min_records !== null`
  - `filters.max_visits !== null` → `filters.max_records !== null`
- [ ] Update cell rendering (lines 137-147):
  - `visibleKeys.includes('visits_count')` → `visibleKeys.includes('records_count')`
  - `client.visits_count` → `client.records_count`
  - `visibleKeys.includes('last_visit')` → `visibleKeys.includes('last_record')`
  - `client.last_visit` → `client.last_record` (both the condition and the `new Date(client.last_visit)`)

#### 3b. ClientStatistics.tsx

- [ ] Update interface (lines 3-8):
  - `visitsCount?: number` → `recordsCount?: number`
  - `missedVisits?: number` → `missedRecords?: number`
  - `lastVisit?: string | null` → `lastRecord?: string | null`
  - `totalPaid?: number` — no change
- [ ] Update display references (lines 22-38):
  - `stats?.visitsCount` → `stats?.recordsCount` (line 22)
  - Label `Визитов` → `Записей` (line 24)
  - `stats?.missedVisits` → `stats?.missedRecords` (line 28)
  - `stats?.lastVisit` → `stats?.lastRecord` (lines 34-35, both the condition and the `new Date(stats.lastVisit)`)
  - Label `Последний` → `Последняя` (line 38) — gender agreement with "запись" (feminine)

#### 3c. ClientInfoTab.tsx

- [ ] Update stats mapping (lines 169-171):
  - `visitsCount: client.visits_count` → `recordsCount: client.records_count`
  - `missedVisits: client.missed_visits` → `missedRecords: client.missed_records`
  - `lastVisit: client.last_visit` → `lastRecord: client.last_record`

#### 3d. ClientRecordTab.tsx

- [ ] Update stats mapping (lines 201-203):
  - `visitsCount: client.visits_count` → `recordsCount: client.records_count`
  - `missedVisits: client.missed_visits` → `missedRecords: client.missed_records`
  - `lastVisit: client.last_visit` → `lastRecord: client.last_record`

#### 3e. ClientTab.tsx (ActivityDetailsModal)

- [ ] Update type guard (line 164):
  - `client && 'visits_count' in client` → `client && 'records_count' in client`
- [ ] Update stats mapping (lines 166-168):
  - `visitsCount: client.visits_count` → `recordsCount: client.records_count`
  - `missedVisits: client.missed_visits` → `missedRecords: client.missed_records`
  - `lastVisit: client.last_visit` → `lastRecord: client.last_record`

#### 3f. ClientsContext.tsx

- [ ] Update `ClientFilters` interface:
  - `min_visits: number | null` → `min_records: number | null`
  - `max_visits: number | null` → `max_records: number | null`
  - `missed_from`/`missed_to` — no change
- [ ] Update default values:
  - `min_visits: null` → `min_records: null`
  - `max_visits: null` → `max_records: null`
- [ ] Update query param passthrough (wherever `sort_by` or filter params are sent to API):
  - `min_visits: filters.min_visits` → `min_records: filters.min_records`
  - `max_visits: filters.max_visits` → `max_records: filters.max_records`
  - Check `sortBy` values: if any default or constant uses `'visits_count'`/`'last_visit'`/`'missed_visits'` → update to `'records_count'`/`'last_record'`/`'missed_records'`

#### 3g. ClientsFilters.tsx

- [ ] Update input bindings (lines 57-60):
  - `min_visits` → `min_records` (field name in `filters.min_visits` reads and setter calls)
  - `max_visits` → `max_records`
- [ ] Update group label (line 55):
  - `Визиты` → `Записи`
- [ ] `missed_from`/`missed_to` bindings — no change

- [ ] Verify: `cd frontend && npx tsc --noEmit` → expect 0 errors (all component renames done)
- [ ] Commit: `git add -A && git commit -m "refactor(#131): rename client-stats in frontend components + filters"`

### Definition of Done
- [ ] `ClientsTable` columns use `records_count`/`last_record` keys with labels "Всего записей"/"Последняя запись"
- [ ] `ClientStatistics` interface uses `recordsCount`/`missedRecords`/`lastRecord` props, labels "Записей"/"Последняя"
- [ ] `ClientInfoTab`/`ClientRecordTab`/`ClientTab` map `client.records_count` → `recordsCount` etc.
- [ ] Type guard in `ClientTab.tsx` checks `'records_count' in client`
- [ ] `ClientsContext` interface uses `min_records`/`max_records`
- [ ] `ClientsFilters` label says "Записи", binds `min_records`/`max_records`
- [ ] `tsc --noEmit` → 0 errors

---

## Task 4: Frontend — Update unit tests + E2E test

### Classification: standard
### Required Docs
- `docs/specs/2026-07-16-client-stats-records-131-design.md` — §4 (test updates), §8 (user scenarios)
- `.opencode/skills/vitest-playwright-patterns/SKILL.md` — vitest test patterns, mocking context

### Context
T2-T3 renamed source code. Now update all frontend tests to use new field names. After this task, all frontend tests pass.

### Files
- `frontend/admin/__tests__/ClientsTable.test.tsx` (modify)
- `frontend/admin/__tests__/ClientsPage.test.tsx` (modify)
- `frontend/admin/__tests__/ClientsIntegration.test.tsx` (modify)
- `frontend/admin/__tests__/ClientInfoTab.test.tsx` (modify)
- `frontend/admin/__tests__/ClientCardModal.test.tsx` (modify)
- `frontend/admin/__tests__/ClientsFilters.test.tsx` (modify)
- `frontend/admin/e2e/clients.spec.ts` (modify)

### Steps

#### 4a. ClientsTable.test.tsx (16 refs)

- [ ] Rename all references in mock data:
  - `visits_count` → `records_count`
  - `last_visit` → `last_record`
  - `missed_visits` → `missed_records`
- [ ] Rename column header assertions:
  - `'Кол-во визитов'` → `'Всего записей'`
  - `'Последний визит'` → `'Последняя запись'`
- [ ] Rename sort key references:
  - `sortBy: 'visits_count'` → `sortBy: 'records_count'`
  - `sortBy: 'last_visit'` → `sortBy: 'last_record'`
- [ ] Rename `visibleKeys` arrays in localStorage-seed tests:
  - `'visits_count'` → `'records_count'`
  - `'last_visit'` → `'last_record'`
- [ ] Rename `client.visits_count` reads → `client.records_count`
- [ ] Rename `client.last_visit` reads → `client.last_record`

#### 4b. ClientsPage.test.tsx (3 refs)

- [ ] Rename mock data fields: `visits_count` → `records_count`, `last_visit` → `last_record`, `missed_visits` → `missed_records`

#### 4c. ClientsIntegration.test.tsx (5 refs)

- [ ] Rename mock data + assertion fields

#### 4d. ClientInfoTab.test.tsx (2 refs)

- [ ] Rename `lastVisit` → `lastRecord` in mockStats objects (these are camelCase props for `ClientStatistics`)

#### 4e. ClientCardModal.test.tsx (3 refs)

- [ ] Rename mock data fields

#### 4f. ClientsFilters.test.tsx (8 refs)

- [ ] Rename `min_visits` → `min_records`, `max_visits` → `max_records` in mock context + test bindings
- [ ] Rename label assertions: `'Визиты'` → `'Записи'`
- [ ] `missed_from`/`missed_to` — no change

#### 4g. clients.spec.ts (E2E, 2 refs)

- [ ] Update column header assertions (lines 74-75):
  - `'Кол-во визитов'` → `'Всего записей'`
  - `'Последний визит'` → `'Последняя запись'`

- [ ] Run vitest: `cd frontend && npx vitest run --reporter=verbose` → all pass
- [ ] Run E2E clients: `cd frontend && npx playwright test e2e/clients.spec.ts` → pass (or skip if #124 blocks)
- [ ] Commit: `git add -A && git commit -m "test(#131): update frontend unit + E2E tests for records-based field names"`

### Definition of Done
- [ ] All 5 unit test files renamed: `ClientsTable`, `ClientsPage`, `ClientsIntegration`, `ClientInfoTab`, `ClientCardModal`
- [ ] `ClientsFilters.test.tsx` updated with `min_records`/`max_records` + label "Записи"
- [ ] `clients.spec.ts` E2E asserts on "Всего записей" / "Последняя запись"
- [ ] `vitest run` → 0 failures (excluding baseline #123 CalendarPopover flake)
- [ ] `playwright test e2e/clients.spec.ts` → pass or skip (#124)

---

## Task 5: Documentation — Update domain-rules/clients.md

### Classification: trivial
### Required Docs
- `docs/specs/2026-07-16-client-stats-records-131-design.md` — §6 (domain rules doc updates)

### Context
All code changes done (T1-T4). Now update the domain-rules doc to reflect new field names.

### Files
- `docs/domain-rules/clients.md` (modify)

### Steps

- [ ] Read `docs/domain-rules/clients.md` to find exact lines to update
- [ ] Update line ~20: `visits_count, total_paid, etc.` → `records_count, total_paid, etc.`
- [ ] Update line ~26: `visits_count, last_visit, total_paid, missed_visits` → `records_count, last_record, total_paid, missed_records`
- [ ] Update line ~27: `last_visit = MAX(Activity.start) over all Visit rows where Visit.status = 'visited' AND Record.is_active = True` → `last_record = MAX(Activity.start) over all active Records of this client (no status filter — includes cancelled/missed/waiting)`
- [ ] Update line ~30: `Sort columns: name, visits_count, last_visit, total_paid, missed_visits, created_at, updated_at` → `Sort columns: name, records_count, last_record, total_paid, missed_records, created_at, updated_at`
- [ ] Add note after line ~27: `missed_records = COUNT(Record.id) WHERE Record.status='missed' AND Record.is_active=True (relies on persisted Record.status — see compute_record_status in domain-rules/records.md)`
- [ ] Add note about API params: `Filter params: min_records, max_records (by records_count), missed_from, missed_to (by missed_records), min_paid, max_paid`
- [ ] Commit: `git add -A && git commit -m "docs(#131): update domain-rules/clients.md for records-based stats"`

### Definition of Done
- [ ] `docs/domain-rules/clients.md` uses `records_count`/`last_record`/`missed_records`
- [ ] `last_record` definition updated (no status filter)
- [ ] `missed_records` definition added (via `Record.status`)
- [ ] Sort columns list updated
- [ ] Filter params documented

---

## Post-Implementation Verification

After all 5 tasks:

- [ ] Backend: `cd backend && uv run pytest -q` → all pass
- [ ] Frontend: `cd frontend && npx tsc --noEmit` → 0 errors
- [ ] Frontend: `cd frontend && npx vitest run` → all pass (except baseline #123)
- [ ] E2E: `cd frontend && npx playwright test e2e/clients.spec.ts` → pass
- [ ] No remaining references to `visits_count`/`last_visit`/`missed_visits`/`min_visits`/`max_visits` anywhere in `backend/src/`, `frontend/`, `packages/`
- [ ] Step 4.5 Visual Compliance Gate: manually verify `/clients` page shows "Всего записей" / "Последняя запись" column headers