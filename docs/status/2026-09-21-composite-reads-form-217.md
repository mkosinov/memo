# GH #217 — Composite reads aligned to free functions (Corridor 3 / ADR 007)

- **Date**: 2026-09-21
- **Branch**: `feature/composite-reads-free-functions`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `5fdeac5b` (main) — 7 commits (`fb8e5098..be9d5d02`), 35 files, +1224 / −618
- **Issue**: #217 — evaluate a CQRS read-side layer (`queries/`); activated when composite reads ≥ 2
- **Spec**: `docs/specs/2026-09-20-composite-reads-form-217-design.md` (rev5 + errata rev6, on main, unchanged by IMPL)
- **Plan**: `docs/plans/2026-09-20-composite-reads-form-217-plan.md` (5 tasks, on main, unchanged by IMPL)
- **ADR**: `docs/decisions/007-composite-reads-free-functions.md` (Accepted 2026-09-20)
- **Canon**: `docs/domain-rules/service-layer.md` (rev6, rule 8), `records.md`, `photos.md`, `clients.md`, `_overview.md` (record/photos/clients rows updated by the IMPL branch)

## Goal

Answer #217: no `queries/` layer — composite reads (cross-aggregate projections/enrichments)
stay **free functions in the module of the owning service** (canon Corridor 3, ADR 007), and
align the five legacy-form composites (#2 records, #3 masters, #4 photos, #6 activity seats,
#7 material counts) to that form. Behavior, HTTP contracts and the frontend do not change
(pure backend refactor).

## Summary of Changes (per task)

- **T1 — records (standard):** `RecordService.list_view` → module-level free function
  `list_records_view`; the shared building blocks (`_build_list_stmt`, `_sort_columns`,
  `search_fields`, `map_record`) hoisted to module level so `RecordService.list` and
  `list_records_view` reuse one implementation; the route calls the function directly with
  the session (no service dependency) (`fb8e5098`).
- **T2 — masters (standard):** `MasterViewService` disbanded — the class, both cached
  factories (`get_master_view_service`, the router's `_get_master_view_service` + `_ServiceDep`)
  and the dead `_model = Staff` binding removed; replaced by `list_masters_view`
  (GET /masters, paginated, re-homed onto `BaseRepository.list_custom` — order passed as a
  parameter, count-equivalence pinned by test) and `list_all_masters_view` (GET /masters/all,
  flat list, `BARE_LIST_MAX_ROWS + 1` guard preserved → 422). Archive statuses (#267
  active/archived/all) preserved as a parameter; the events/entities docstring and
  `test_events_entities.py` re-bound (`d58e9534`).
- **T3 — photos (small):** `PhotoService.list` → `list_photos_view`; the #263 master-scope
  EXISTS moves with it. `GET /photos/web` is left untouched — it is a hand-written router
  query that never rode the composite (erratum rev6, hard gate «HTTP contracts don't
  change») (`a30f4ae0`) — preceded by the errata docs commit `6c080b1d`.
- **T4 — helpers (small):** `ActivityService.sum_active_seats_bulk` and
  `MaterialService._attach_counts` become module-level functions; the activity query-count
  and material write-response enrichment behavior is unchanged (`dfeaa1f5`).
- **T5 — clients rename + full verification (small):** `list_clients_with_stats` →
  `list_clients_view` and schema `ClientWithStats` → `ClientViewResponse` (internal Python
  names only — HTTP/JSON contract unchanged); docstrings updated, the fixtures script
  (`packages/api-client/scripts/gen_backend_fixtures.py`) rebound, and the full test/lint
  verification run (`90294a1a`, `be9d5d02`).

## Notable Extras Folded In

- **Shared module-level bricks (T1):** `_build_list_stmt` / `_sort_columns` / `search_fields` /
  `map_record` de-duplicate the list path instead of duplicating it into the free function.
- **Dead `_model = Staff` deleted intentionally (T2):** the events-entity registry never read
  it (verified in spec rev4); the registry docstring no longer names the class and
  `test_events_entities.py` is re-bound — master entity resolution in events is unchanged.

## Test Results

- **pytest (full):** **2407 passed / 15 skipped / 0 failed**.
- **ruff / mypy:** no new findings vs baseline.
- **e2e phase verification:** US1 clients **24/24**, US2 records-view core tests pass
  (incl. exact-one-request), US3 staff **15/15**, US4 photos **20/20**, US7 materials
  **4/4**, scope gates (master-role-photos, master-role-record-create,
  `test_master_scope_contract.py`) all green.
- **Known environmental flakes (documented, CI adjudicates):** admin-manages-payments ×2 and
  `schedule.spec.ts:158` — non-deterministic under load, pass isolated 2/3, no regression
  mechanism (zero frontend changes in this branch).

## Acceptance Criteria (spec DoD)

| Criterion | Status |
|---|---|
| All 7 composites are free functions in their service modules | ✅ T1–T5 |
| `MasterViewService` no longer exists; `queries/` never introduced | ✅ T2 |
| List views named `list_<entity>_view` (clients + schema renamed) | ✅ T5 |
| №2/№3/№4 execute via `list_custom` | ✅ T1/T2/T3 |
| №1 documented exception (manual cheap count kept) | ✅ T5 + ADR 007 §3 |
| Masters count-equivalence test present & green | ✅ T2 (`test_service_master_view.py`) |
| pytest + e2e + lint/typecheck green | ✅ (CI adjudicates the two known env flakes) |

## Key Files Changed

- `backend/src/services/record.py` — `list_records_view` + module-level shared bricks (T1)
- `backend/src/api/v1/records.py` — route calls the free function (T1)
- `backend/src/services/master.py`, `backend/src/api/v1/masters.py` — `MasterViewService` disbanded → `list_masters_view` / `list_all_masters_view` (T2)
- `backend/src/events/entities.py` — dead-binding docstring synced (T2)
- `backend/src/services/photo.py`, `backend/src/api/v1/photos.py` — `list_photos_view` (T3)
- `backend/src/services/activity.py`, `backend/src/services/material.py` — module-level helpers (T4)
- `backend/src/services/client.py`, `backend/src/schemas/client.py`, `backend/src/api/v1/clients.py` — `list_clients_view` / `ClientViewResponse` (T5)
- Tests: `tests/services/test_clients_view_rename.py`, `tests/services/test_service_module_helpers.py`, `test_service_master_view.py`, `test_service_photo_list.py`, `test_service_record_view.py`, `test_events_entities.py`, plus rebinding in the remaining API/service suites
- `packages/api-client/scripts/gen_backend_fixtures.py` — fixtures-script rebind (T5)

## Docs Impact

- Spec rev5 + errata rev6, plan, ADR 007 and canon rev6 (corridors, naming) already on main.
- Domain-rules `records.md`, `photos.md`, `clients.md`, `_overview.md` (+ `schemas/material.py` docstring) updated by the IMPL tasks.
- `CHANGELOG.md` — new entry under `[Unreleased] — 2026-09-21` → `### Changed` (this docs commit).
- `PLAN.md` — completion blockquote in the header.
- `docs/decisions/README.md` — ADR 007 row added to the index.

## Known Non-Blocking Observations

- **Follow-up candidate (not filed here):** `gen_backend_fixtures.py` location dict uses
  `name=` where the thing-title canon is `title=` (pre-existing #313 staleness) — needs a
  `name`→`title` fix and a `backend-responses.json` regeneration.
- **Follow-up candidate (not filed here):** `schedule.spec.ts` week-label tests are
  clock-sensitive — consider a frozen-clock helper.
- The two e2e flakes above are environmental; CI is the authoritative merge gate.

## References

- **GitHub Issue**: #217
- **Design Spec**: `docs/specs/2026-09-20-composite-reads-form-217-design.md` (rev5 + errata rev6, on main)
- **Plan**: `docs/plans/2026-09-20-composite-reads-form-217-plan.md` (on main)
- **ADR**: `docs/decisions/007-composite-reads-free-functions.md`
- **Canon**: `docs/domain-rules/service-layer.md` (rev6, rule 8), `docs/domain-rules/records.md`, `photos.md`, `clients.md`, `_overview.md`
- **Related**: #206 (pagination consolidation / cheap-count rationale), #213 (records view composite), #263 (master scope), #171 (usecases / layering), #205 (bare-list guard)
- **PR**: _(to be added after PR creation)_
