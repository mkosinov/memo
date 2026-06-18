# Robustness Bundle: RecordsContext audit, React Query errors, e2e test fixes

**Date:** 2026-06-18
**Issues:** #53 (chore: review RecordsContext), #64 (Silent API errors: add error handling for React Query hooks), #65 (fix(e2e): fix 5 pre-existing failing tests + audit e2e quality)
**Status:** Design — awaiting G1b approval
**Branch:** `fix/robustness-bundle`
**PR title:** `fix: robustness bundle (#53, #64, #65)`

## Context

Three open issues, all about application robustness, batched into one PR:

- **#53** — Review if `RecordsContext` is still needed after /records page implementation. The concern: it duplicates `ScheduleContext` and could be merged or removed.
- **#64** — React Query errors are silently swallowed. When zod validation fails or the API returns malformed data, components see `data = []` (default) and show "Нет занятий" with no indication something broke. No `console.error`, no toast, no retry option.
- **#65** — 5 e2e tests have been failing since before PR #63. Root causes are a mix of (a) flaky test data setup, (b) brittle timing assertions, (c) possibly a real column-mode-switching bug. Audit needed to confirm what each test is actually validating.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ app/providers.tsx (QueryClient)                             │
│   queryCache.onError(err, query) {                          │
│     console.error('[Query]', query.queryKey, err)           │
│     showToast('Ошибка загрузки данных', 'error')             │
│   }                                                         │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ app/(main)/layout.tsx                                       │
│   <ErrorBoundary>                                           │
│     <ScheduleProvider> <RecordsProvider> ...                │
│   </ErrorBoundary>                                          │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼ (per page component)
┌─────────────────────────────────────────────────────────────┐
│ const { data, error, refetch, isLoading } = useQuery(...)   │
│                                                             │
│ if (error) return <ErrorState error={error} onRetry={...} />│
│ if (isLoading) return <Skeleton />                          │
│ return <Table rows={data} />                                │
└─────────────────────────────────────────────────────────────┘
```

**Principles:**
- **Single source of truth** for global error reporting: `QueryCache.onError` in `providers.tsx`. No per-query `onError` boilerplate.
- **Inline `<ErrorState>`** for primary data consumers — when a list fails, the user sees "Не удалось загрузить" with a Retry button, NOT an empty table.
- **`<ErrorBoundary>`** catches render-throws (bugs in component code, not fetch failures).
- **No `ErrorsContext` / no Sentry / no debug panel** in this PR. YAGNI — those are separate concerns for a future iteration.

## Components

### ErrorBoundary

Use the lightweight `react-error-boundary` library (idiomatic, well-maintained, ~3kb) instead of writing a class component. This avoids bundle bloat and edge cases.

```tsx
// frontend/admin/app/components/error/ErrorBoundary.tsx
import { ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary';

// Wrap <FullPageError /> as the fallback. Used in app/(main)/layout.tsx
// as outermost wrapper around the providers' children.
```

Catches render-time errors only. Async/fetch errors are handled by `useQuery.error` and rendered as `<ErrorState>`.

### ErrorState (inline, для пустых списков)

```tsx
// frontend/admin/app/components/error/ErrorState.tsx
interface ErrorStateProps {
  error: Error | null;
  onRetry?: () => void;
  title?: string;                    // default: "Не удалось загрузить данные"
  variant?: 'table' | 'card' | 'inline';  // default: 'table' (renders inside <tr>)
}

// Внутри: <div role="alert"> с иконкой + title + error.message + Retry button
// variant 'table'  → возвращает <tr><td colSpan={N}>...</td></tr>
// variant 'card'   → возвращает <div className="card">...</div>
// variant 'inline' → возвращает <div role="alert">...</div>
```

### QueryCache.onError (в providers.tsx)

```ts
const [queryClient] = useState(() => new QueryClient({
  queryCache: new QueryCache({
    onError: (err, query) => {
      console.error('[Query]', query.queryKey, err);
      if (typeof window !== 'undefined') {
        showToast('Не удалось загрузить данные', 'error');
      }
    },
  }),
  defaultOptions: { queries: { throwOnError: false } },
}));
```

`throwOnError: false` — prevents errors from propagating to React error boundary by default. Per-query `throwOnError: true` can opt in if needed.

### UIContext extension

```ts
interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error';   // ← new
  message: string;
  undo?: () => void;
}

showToast: (message: string, kind?: Toast['kind'], undo?: () => void) => void;
```

Backward compat: `showToast(msg, undo)` continues to work (`kind` defaults to 'info').

`ToastContainer` adds visual distinction for `kind: 'error'` (red accent / left border) while keeping the same component shape.

## E2E test strategy (issue #65)

### Classification of 5 failing tests

| # | File:line | Root cause | Fix |
|---|-----------|-----------|-----|
| 1 | `clients.spec.ts:434` | `setupRecordTab` doesn't await `#record-time` — modal not yet rendered | Add `await page.waitForSelector('[data-testid="client-record-tab"]', { state: 'visible' })` after clicking the tab |
| 2 | `records.spec.ts:307` | `waitForRecordsReady` waits for rows, but seed didn't create records for sort test | Seed `>= 3` records with different clients, use deterministic sort assertion |
| 3 | `records.spec.ts:575` | `rowCount === 0` → payment indicator not found. No seed for records with payments | Seed `>= 1` record with `payment_status: 'Оплачено'`; keep `if rowCount > 0` fallback |
| 4 | `schedule-column-visibility:281` | 30s timeout on "add master to filter" — column mode switching is slow | Replace `waitForTimeout(300)` with `waitForResponse` on filter API; replace `body`-click with `Escape` |
| 5 | `schedule-column-visibility:406` | 30s timeout on column mode switch | Replace `waitForTimeout(500)` with `waitForResponse('/api/v1/activities')` |

### Audit (deliverable)

**File:** `docs/audits/2026-06-18-e2e-audit.md`

**Format:**

| Test | Quality | Action |
|------|---------|--------|
| `clients.spec.ts:434` | ok / demote / replace | keep / move to vitest / remove |
| ... | ... | ... |

**Audit checklist per test:**
- [ ] Test asserts **behavior** (sort works, filter applies), not **DOM internals** (specific selector)
- [ ] Seed data is **deterministic** (explicit API create, not relying on existing data)
- [ ] Cleanup is **guaranteed** (try/finally + cleanup helper)
- [ ] No **overlap** with vitest unit tests
- [ ] No **brittle** assertions (exact strings, fragile timeouts)

If audit recommends `demote`: rewrite as vitest + RTL test, remove from e2e spec.

## RecordsContext (#53) — wontfix

### Investigation

`RecordsContext` was created to isolate `/records` page data from `/schedule`, but is now used by both:

- `app/(main)/records/page.tsx` — wraps with `RecordsProvider`
- `app/(main)/schedule/page.tsx` — **also** wraps with `RecordsProvider` (for `ActivityDetailsModal`)
- `app/(main)/records/components/RecordsTable.tsx` — `useRecords()`
- `app/(main)/records/components/BookingFilters.tsx` — `useRecords()`
- `app/(main)/records/components/ClientCardModal.tsx` — `useRecords()`
- `app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx` — `useRecords()`

### Verdict: do not remove, do not merge

Reasons:
1. **Real shared dependency.** `ActivityDetailsModal` renders above both schedule and records — needs `useRecords` to look up client/visitor.
2. **Removing it** would force `ActivityDetailsModal` to either duplicate fetches or trigger a 2nd context. No clean win.
3. **Merging with `ScheduleContext`** would inflate the already 550-LOC `ScheduleContext` by 5 more `useQuery` calls — over 800 lines with no architectural benefit.

### Action

Close issue #53 as `wontfix` with comment:

> RecordsContext is used by both /records and /schedule pages (specifically ActivityDetailsModal which is shared). Merging with ScheduleContext would inflate it to 800+ LOC without architectural benefit. The context exists to share data between pages — which is its intended purpose. If ScheduleContext later refactors to a "domain slice" pattern, this assessment should be revisited.

## File manifest

### New files

| File | Purpose |
|------|---------|
| `frontend/admin/app/components/error/ErrorBoundary.tsx` | Class component, catches render errors |
| `frontend/admin/app/components/error/ErrorState.tsx` | Inline UI for failed queries (3 variants) |
| `frontend/admin/app/components/error/FullPageError.tsx` | Fallback for `ErrorBoundary` |
| `frontend/admin/app/components/error/index.ts` | Barrel export |
| `frontend/admin/__tests__/error/ErrorBoundary.test.tsx` | 2 unit tests |
| `frontend/admin/__tests__/error/ErrorState.test.tsx` | 3 unit tests (one per variant) |
| `docs/audits/2026-06-18-e2e-audit.md` | Audit table for 5 failing tests |

### Modified files

| File | Change |
|------|--------|
| `frontend/admin/app/providers.tsx` | Add `QueryCache.onError` |
| `frontend/admin/app/(main)/layout.tsx` | Wrap in `<ErrorBoundary>` |
| `frontend/admin/contexts/UIContext.tsx` | Add `kind: 'info' \| 'error'` to Toast, extend `showToast` signature |
| `frontend/admin/app/components/toast/ToastContainer.tsx` | Color accent by `kind` (error = red left border) |
| `frontend/admin/app/(main)/records/components/RecordsTable.tsx` | Inline `<ErrorState variant='table'>` |
| `frontend/admin/app/(main)/clients/components/ClientsTable.tsx` (or equivalent) | Inline `<ErrorState variant='table'>` |
| `frontend/admin/app/(main)/services/components/ServicesTable.tsx` | Inline `<ErrorState variant='table'>` |
| `frontend/admin/app/(main)/locations/components/LocationsTable.tsx` | Inline `<ErrorState variant='table'>` |
| `frontend/admin/app/(main)/masters/components/MastersTable.tsx` | Inline `<ErrorState variant='table'>` |
| `frontend/admin/app/(main)/tags/components/TagsTable.tsx` | Inline `<ErrorState variant='table'>` |
| `frontend/admin/app/(main)/photos/components/PhotosTable.tsx` | Inline `<ErrorState variant='table'>` |
| `frontend/admin/e2e/clients.spec.ts` | Fix #434 |
| `frontend/admin/e2e/records.spec.ts` | Fix #307, #575 |
| `frontend/admin/e2e/schedule-column-visibility.spec.ts` | Fix #281, #406 + 3 similar timeouts |

## Acceptance criteria

### #64 — React Query error handling
- [ ] `QueryCache.onError` shows error-toast on any failed query
- [ ] `console.error` logs `queryKey + error` in dev mode
- [ ] `ErrorBoundary` catches render-throw → renders `<FullPageError>` with reset button
- [ ] 7 list components render `<ErrorState>` on `error` with Retry button
- [ ] `toast.kind='error'` is visually distinct (red left border)
- [ ] Unit tests pass: 5/5 (2 ErrorBoundary + 3 ErrorState)
- [ ] All existing 155 e2e tests still pass (no regressions)

### #65 — E2E fix + audit
- [ ] 5 failing e2e tests pass (all shards)
- [ ] `docs/audits/2026-06-18-e2e-audit.md` exists with quality/action table
- [ ] If audit recommends demote, corresponding vitest tests are added
- [ ] E2E in CI: 0 failing (across all shards, excluding visual)

### #53 — RecordsContext
- [ ] Issue #53 closed with `wontfix` rationale

## Visual Compliance Checks (для Step 4.5)

- [ ] When `/api/v1/records` returns 500 → `/records` page shows `<ErrorState>` with Retry (NOT an empty table)
- [ ] When `/api/v1/clients` returns 500 → `/clients` page shows `<ErrorState>` with Retry
- [ ] When a component throws during render → user sees `<FullPageError>` instead of a blank screen
- [ ] Error-toast has visually distinct red accent (different from info/success toasts)
- [ ] Retry button on `<ErrorState>` triggers refetch and clears error state on success

## Out of scope (YAGNI)

- **ErrorsContext** / debug panel — separate concern, future iteration
- **Sentry / production monitoring** — separate concern
- **Per-query `meta.errorMessage` customization** — global message is sufficient for MVP
- **Optimistic rollback toasts** — already handled in `useActivities` mutation

## Risks

| Risk | Mitigation |
|------|------------|
| Touch 7+ table components — regression risk | Run e2e in parallel with changes; rollback individual files if regression |
| `QueryCache.onError` fires for **all** queries including those with their own `error` UI — duplicate toasts? | Use a flag `meta.silent: true` for queries that handle their own errors; default fires toast |
| Class component (`ErrorBoundary`) adds bundle size vs functional `react-error-boundary` lib | Use `react-error-boundary` (lightweight, idiomatic) instead of writing our own — **DECIDED**: use the library |

## Open questions
None — all answered during brainstorming.
