# GH #231 — Clients deep-link `/clients?clientId=X`: exactly one narrowed list request per mount

- **Date**: 2026-09-21
- **Branch**: `231-clients-deeplink-single-request`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `d8e07f60` (main) — 3 commits (`69920a24..93426dff`), 5 files, +240 / −34
- **Issue**: #231 — `/clients?clientId=X` fires two list requests per mount (wasted default + narrowed)
- **Spec**: `docs/specs/2026-09-19-clients-deeplink-single-request-design.md` (rev3, on main, unchanged by IMPL)
- **Plan**: `docs/plans/2026-09-20-clients-deeplink-single-request-plan.md` (4 tasks, on main, unchanged by IMPL)
- **Canon**: `docs/domain-rules/clients.md` — «Deep-link `?clientId=`» rewritten to seed-at-mount by the spec commit `774dc57d` (on main, unchanged by this branch)

## Goal

A deep-link mount of `/clients?clientId=X` now fires **exactly one** list request — the
narrowed `GET /api/v1/clients?q=<uuid>&status=all` — instead of the previous default +
narrowed pair, and the client card opens on the first response. The page reads the param
during render (above `ClientsProvider`, under the top `Suspense` boundary) and passes it to
the list context as one-time initial filters; the factory seed is a lazy `useState`
initializer, not a live sync — a param arriving **after** mount is not picked up.
Plain `/clients`, search, sort, «Сбросить фильтры», the dead-link strip and the modal-close
param removal are unchanged.

## Summary of Changes (per task)

- **T1 — factory `initialFilters` mount-time seed (small, `69920a24`):**
  `frontend/admin/contexts/createPagedListContext.tsx` — the with-filters overload gains an
  optional `initialFilters?: Partial<F>` provider prop; the `filters` state moves to the lazy
  initializer `() => initialFilters ? { ...filtersDefaults, ...initialFilters } : filtersDefaults`
  (runs once per mount, merge semantics identical to `setFilters`; later prop changes are
  deliberately ignored). The classic (no-filters) overload stays `{ children }` — the prop is
  not exposed there. `setFilters`/`resetFilters`, the query key, the ≥2-char clamp and
  `keepPreviousData` untouched; the factory never reads the URL. Unit coverage in
  `ClientsContext.factory.test.tsx` (seed merged over defaults; no prop → config defaults; prop
  change after mount does not change state; `resetFilters` returns config defaults, not the seed).
- **T2 — clients page boundary rebuild (standard, `27ef744d`):**
  `frontend/admin/app/(main)/clients/page.tsx` — `Suspense` moves to the very top; the new
  `ClientsPageInner` reads `useSearchParams()` during render and, when `clientId` is present,
  builds `{ search: clientId, status: 'all' }` (value carried verbatim, no validation) and mounts
  `ClientsProvider initialFilters={...}`; `GridSettingsProvider` stays inside, preserving the
  #138 order. **Only the `setFilters` effect is deleted** — #216's other four effects (latch
  reset, find-and-open modal, dead-link cleanup, param strip on close) are kept line-for-line.
  The two effect-era unit tests in `ClientsPage.test.tsx` are rewritten to assert the
  `initialFilters` prop (present with param / absent without).
- **T3 — e2e «exactly one request» counter (small, `93426dff`):**
  `frontend/admin/e2e/clients.spec.ts`, describe «Deep-link ?clientId=» — `page.on('request')`
  registered **before** `goto` counts **all** `/api/v1/clients*` requests (no `q=` pre-filter,
  which would hide the killed default request); window closes on the narrowed response + 500 ms;
  asserts `length === 1` and the URL contains `q=<uuid>&status=all`. Test 19 is untouched.
- **T4 — green verification (trivial, no code):** full DoD run by @tester (see Test Results).

## Test Results

- **admin vitest (full run):** **2303 passed / 0 failed** (143 files).
- **e2e `clients.spec.ts`:** **22/22 × 3 consecutive runs, 0 flaky**, on an isolated shard-2 stack
  (includes the new counter test and the untouched test 19 tail).
- **Type check:** `tsc --noEmit` — 0 errors.
- **ESLint (admin):** 0 errors / 36 pre-existing warnings (none in the changed files).

## Acceptance Criteria (spec §3 scenarios)

| Scenario | Status |
|---|---|
| S1 — deep-link mount sends exactly one narrowed list GET (`q=<uuid>&status=all`), card opens by the first response | ✅ (new e2e counter in `clients.spec.ts`) |
| S2 — plain `/clients` (no params) unchanged: one default GET, no seed | ✅ (existing clients tests green unedited) |
| S3 — closing the deep-link modal keeps the narrowed table and strips `?clientId=` | ✅ (existing test 19 tail green, unedited) |
| S4 — search debounce 300 ms / ≥2-char threshold unaffected by the seed | ✅ (existing search tests green) |

Behavioral Delta (spec §4) fully delivered: the duplicate request is eliminated; a param that
appears/changes after mount is no longer picked up (seed-at-mount, per canon
`docs/domain-rules/clients.md`).

## Review Trail

- T1: compliance ✅.
- T2: compliance ✅ + quality ✅.
- T3: compliance ✅ — tripwire genuineness verified (pre-#231 double-fetch: both requests matched
  by the counter, so `toHaveLength(1)` would have failed).
- T4: verification only.

## Key Files Changed

- `frontend/admin/contexts/createPagedListContext.tsx` (prop + lazy mount-time seed)
- `frontend/admin/app/(main)/clients/page.tsx` (`Suspense` to top, `ClientsPageInner`, seed,
  `setFilters` effect removed)
- `frontend/admin/__tests__/ClientsContext.factory.test.tsx` (factory seed units)
- `frontend/admin/__tests__/ClientsPage.test.tsx` (2 effect-era tests rewritten)
- `frontend/admin/e2e/clients.spec.ts` (S1 request counter)
- Backend, migrations, `packages/api-client`, DB — untouched; zero visual delta (behavioral only).

## Out of Scope / Follow-ups

- Live URL synchronization of clients filters (rule of three) — #349.
- `?id=` + server-side page resolution — #232.

## Docs Impact

- Spec, plan and canon `docs/domain-rules/clients.md` live on main and were not touched by this
  branch (canon updated by the spec commit `774dc57d`).
- `CHANGELOG.md` — new `### Fixed` bullet under `[Unreleased] — 2026-09-21` (this docs commit).
- `PLAN.md` — completion blockquote added.
- `docs/memo-full-spec.md`, `docs/design-system.md`, `docs/mock-data.md` — untouched (no contract,
  design or data-model change).

## References

- **GitHub Issue**: #231
- **Design Spec**: `docs/specs/2026-09-19-clients-deeplink-single-request-design.md` (rev3, on main)
- **Plan**: `docs/plans/2026-09-20-clients-deeplink-single-request-plan.md` (on main)
- **Canon**: `docs/domain-rules/clients.md` (deep-link section)
- **PR**: _(to be added after PR creation)_
