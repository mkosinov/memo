# Fix TS Errors Blocking Pre-Push Hook (Wave 4.5)

**Date:** 2026-06-19
**Branch:** `fix/ts-errors-blocking-hook`
**Issue:** [#88](https://github.com/mkosinov/memo/issues/88)
**Owner:** @architect (delegated to @backend-coder for type changes, @frontend-coder for the rest)
**Related:** PR #87 (Testing Strategy v2) merged, pre-push hook active and strict

---

## Problem Statement

The pre-push hook (introduced in PR #87) runs `pnpm test:all`, which includes a `tsc --noEmit` type-check. On `frontend/admin/`, this check currently reports **~55 TypeScript errors** (issue #88 said 49, but the count grew as the codebase evolved). Result: every push is blocked, breaking the developer workflow.

The errors are not deep architectural issues — they are symptoms of three concurrent type models in the codebase:

1. **Old draft type system** in `lib/mock-data.ts` + `lib/schedule-context.tsx` — uses status values (`waiting`/`visited`/`missed`) that no longer exist in the domain, and `Record<>` syntax that conflicts with the imported `Record` type alias.
2. **New canonical types** in `@memo/domain` (camelCase, Zod-based, `status: 'pending'|'confirmed'|'cancelled'|'no_show'`, `Visit.visited: boolean`).
3. **API types** in `@memo/api-client` (snake_case from FastAPI, with `seats: number`, `RecordResponse`, etc.).

Test mocks and the dead draft both refer to the old shape; production contexts (`RecordsContext`, `ClientsContext`) refer to API types.

### Why it matters

- Pre-push hook is **strict by design** (PR #87 added it to prevent bug regressions). It currently blocks all pushes that touch `frontend/admin/`.
- A pre-push hook that fires only on real failures builds trust; one that fires on stale type drift erodes trust and devs start bypassing it.
- `pnpm type-check` in CI is a smoke check, not a gate. The strict gate is local.

---

## Goals

1. `cd frontend/admin && pnpm type-check` reports **0 errors**.
2. Pre-push hook passes on a clean `main` branch.
3. All existing 986+ vitest tests still pass (no regression).
4. No new lint warnings, no `// @ts-ignore`, no `as any` suppressions.

## Non-Goals

- Restoring any data from the deleted `lib/mock-data.ts` (it was a stale draft, not a fixture for production).
- Rewriting context types (the API types are correct, the mocks are wrong).
- Refactoring unrelated TS strictness in other packages (`web/`, `api-client/`).
- Fixing the 14 P1/P3 UX bugs (#73–#86). Those will be Wave 5.

---

## Root Cause Analysis

### Finding 1: Dead code (~37 of 55 errors)

`lib/schedule-context.tsx` and `lib/mock-data.ts` reference **only each other**. Verified by grep:

```
$ grep -rn "from '@/lib/schedule-context\|from '@/lib/mock-data" --include="*.ts" --include="*.tsx"
lib/schedule-context.tsx:4:import { MASTERS, LOCATIONS, SERVICES, INITIAL_ACTIVITIES, addDays, addMinutes, getMonday } from './mock-data';
```

- All 20+ test files import `from '@/contexts/ScheduleContext'` (new), not the old one.
- `lib/schedule-context.tsx` is an unfinished draft that was never wired up. The new context in `contexts/ScheduleContext.tsx` was built from scratch and supersedes it.
- `lib/mock-data.ts` exports types that the new context never imports; the data shape is incompatible with both `@memo/domain` and `@memo/api-client` types.

**Decision:** Delete both files. -37 errors instantly. The type system of `@memo/domain` and `@memo/api-client` is the canonical source.

### Finding 2: Test mocks drifted from context types (~6 errors)

`contexts/UIContext.tsx` defines `Toast { id, kind: ToastKind, message, undo? }` (with required `kind: 'info' | 'success' | 'error'`).
`contexts/RecordsContext.tsx` and `contexts/ClientsContext.tsx` both have `refetch: () => void` (required).

Test mocks in `__tests__/helpers/mockContexts.ts` define toasts without `kind`, and clients/records contexts without `refetch`. Type drift between mocks and contracts.

**Decision:** Update mocks to match the contracts (add `kind: 'info'`, add `refetch: vi.fn()`). This makes the mocks stricter, catching real bugs in tests.

### Finding 3: Activity type missing `maxAge` (~3 errors)

`Activity` in `@memo/domain` has `minAge: string.optional()` but no `maxAge`. However, `Service` has `maxAge: string.optional()`, `ScheduleAdminDTO` (in `packages/domain/src/schedule.ts`) has `maxAge?: string`, and `lib/buildSchedule.ts:95` already reads `activity.maxAge ?? service?.maxAge`. So `Activity.maxAge` was always intended to exist.

`ActivityCard.tsx:138` and `lib/buildSchedule.ts:95` both use it. The TS errors say "Property 'maxAge' does not exist on type 'Activity'".

**Decision (per user input):** Add `maxAge?: string` to `Activity` in `@memo/domain`. `activity.maxAge` overrides `service.maxAge`; if absent, fall back to service. This matches existing intent in `buildSchedule.ts`.

### Finding 4: `TagsFieldConfig` missing `required` (~4 errors in PhotoModal)

`PhotoFieldConfig` is a discriminated union of `TextFieldConfig | SearchableFieldConfig | TagsFieldConfig`. The first two have `required?: boolean`; `TagsFieldConfig` doesn't. `PhotoModal.tsx:211` accesses `field.required` without discriminating, so TS errors out on the union member that lacks it.

**Decision:** Add `required?: boolean` to `TagsFieldConfig`. Tags can be required (e.g. "at least one tag"). The UI doesn't currently enforce it, but the field is a logical member of the union's API surface.

### Finding 5: ErrorBoundary `unknown` → `Error` (1 error)

`react-error-boundary`'s `FallbackProps.error` is typed as `unknown` (since v4). `FullPageError` expects `Error`. The `<FullPageError error={error} ... />` line fails.

**Decision:** Add type guard: `error instanceof Error ? error : new Error(String(error))`. Graceful fallback for non-Error throws.

### Finding 6: E2E for-of on `NodeList` (1 error)

`e2e/activity-card-adaptive.spec.ts:73` iterates `el.querySelectorAll('*')` (a `NodeList`) with `for...of`. This requires ES2015+ target. Current `tsconfig.json` is at ES5 or similar.

**Decision:** Use `Array.from(el.querySelectorAll('*'))`. Doesn't change tsconfig; matches style elsewhere in the spec.

### Finding 7: `Location` test mock missing fields (1 error)

`__tests__/useLocationsMutations.test.ts:28` creates a location literal without `short_title` and `tag_ids`. The `Location` schema (in `@memo/domain`) marks both as optional, so this is likely a real type error. Either the test's mock shape is wrong, or the `Location` schema is missing `tag_ids`.

**Decision:** Investigate when implementing. If `tag_ids` is genuinely required by `Location`, add it. Otherwise, update the mock to provide all required fields. Default fix: provide all schema fields with `undefined` or empty defaults.

### Finding 8: `mockUseQuery` typed as `unknown` (1 error)

`__tests__/helpers/clientRecordTabSetup.ts:115` calls `mockUseQuery(...)` where `mockUseQuery: Mock<...>` is typed as `Mock<[], unknown>`. Should be `Mock<typeof useQuery, ReturnType<typeof useQuery>>` or use a proper `vi.fn()` with a typed signature.

**Decision:** Re-type with the proper return type, OR cast at call site. Preference: re-type once in the helper, not at every call site.

---

## Design Decisions Summary

| # | Decision | Rationale | Alternative considered |
|---|----------|-----------|------------------------|
| 1 | Delete `lib/schedule-context.tsx` + `lib/mock-data.ts` | Dead code, -37 errors, zero references | Keep and fix (waste, no value) |
| 2 | Update mocks to match context contracts | Mocks are wrong, contexts are right | Weaken context types (reduces safety) |
| 3 | Add `maxAge?: string` to `Activity` in `@memo/domain` | Already used by `buildSchedule.ts`, `ActivityCard.tsx` | Lookup maxAge at component level (couples UI to service) |
| 4 | Add `required?: boolean` to `TagsFieldConfig` | Symmetric with other union members | Type guard in PhotoModal (more code, root cause stays) |
| 5 | Type-guard in `ErrorBoundary` | Graceful for non-Error throws | `error as Error` (lies about type) |
| 6 | `Array.from(...)` in E2E | No tsconfig change | Set `target: ES2020` in tsconfig (broader impact) |
| 7 | Match `Location` mock to schema (or schema to mock) | Either side may be wrong | Suppress error (loses safety) |
| 8 | Re-type `mockUseQuery` properly | One fix, all call sites benefit | Cast at each call site (repetitive) |

---

## Implementation Strategy (3 phases)

### Phase 1: Delete dead code + add type fields

**Goal:** Remove 40 of 55 errors with minimal risk.

| Task | File(s) | Effect |
|------|---------|--------|
| 1.1 Delete | `lib/schedule-context.tsx` | -9 errors |
| 1.2 Delete | `lib/mock-data.ts` | -28 errors |
| 1.3 Add `maxAge?: string` to `Activity` | `packages/domain/src/index.ts` | Fixes 3 errors in `buildSchedule.ts` and `ActivityCard.tsx` |
| 1.4 Add `required?: boolean` to `TagsFieldConfig` | `app/(main)/photos/components/photoFields.tsx` | Fixes 4 errors in `PhotoModal.tsx` |
| 1.5 Verify | Run `pnpm type-check` | Should report ≤11 errors (down from 55) |

### Phase 2: Update test mocks

**Goal:** Bring mocks in sync with current context types.

| Task | File(s) | Effect |
|------|---------|--------|
| 2.1 Add `kind: 'info'` to toasts in `createMockUIContext` | `__tests__/helpers/mockContexts.ts` | Fixes 2 errors (ActivityCard, ActivityDetailsModal tests) |
| 2.2 Add `refetch: vi.fn()` to `createMockRecordsContext` | `__tests__/helpers/mockContexts.ts` | Fixes 2 errors (RecordsTable tests) |
| 2.3 Add `refetch: vi.fn()` to `createMockClientsContext` | `__tests__/helpers/mockContexts.ts` | Fixes 3 errors (ClientsTable tests + helper) |
| 2.4 Re-type `mockUseQuery` in `clientRecordTabSetup.ts` | `__tests__/helpers/clientRecordTabSetup.ts` | Fixes 1 error |
| 2.5 Update Location mock in `useLocationsMutations.test.ts` | `__tests__/useLocationsMutations.test.ts` | Fixes 1 error |
| 2.6 Verify | Run `pnpm type-check` + `pnpm test` | Should report 0 type errors; all 986+ tests pass |

### Phase 3: Isolated production fixes + e2e

**Goal:** Fix last 2 production errors and 1 e2e error.

| Task | File(s) | Effect |
|------|---------|--------|
| 3.1 Type-guard in `ErrorBoundary.defaultFallback` | `app/components/error/ErrorBoundary.tsx` | Fixes 1 error |
| 3.2 `Array.from(...)` in e2e | `e2e/activity-card-adaptive.spec.ts` | Fixes 1 error |
| 3.3 Final verify | `pnpm type-check` + `pnpm test:all` | 0 errors, all tests pass |

---

## User Scenarios

Per the testing-strategy-v2 spec, every change must have user scenarios. Wave 4.5 is a refactor (no new features), so scenarios describe what a developer can now do that they couldn't before.

| ID | Scenario | Acceptance Criteria | E2E mapping |
|----|----------|---------------------|-------------|
| **US-T01** | Developer runs `cd frontend/admin && pnpm type-check` and sees a clean report | Exit code 0, "0 errors" in output, no error annotations in editor | Manual: `pnpm type-check` |
| **US-T02** | Developer pushes a branch — pre-push hook runs `pnpm test:all` and passes the TS step | Pre-push hook exits 0 on a clean `main`; blocks only on real failures | Manual: `git push` |
| **US-T03** | Developer runs full vitest suite after the refactor — all tests pass | 986+ tests pass, 0 fail, 0 skip beyond known skips | `pnpm test` |
| **US-T04** | Developer writes a new test using `createMockRecordsContext({ records: [...] })` | TypeScript accepts the call, runtime works, `refetch` is wired | New unit test (manual or scenario) |
| **US-T05** | ActivityCard renders an activity with explicit `maxAge: '12'` | Card shows "6–12", not "6–undefined" or "6–" | Manual + visual check on /schedule |

US-T05 is the only one that touches UI rendering. The Visual Compliance Gate will run on Phase 3 and verify the schedule page still renders correctly.

---

## Visual Compliance Checks

Per the workflow's Step 4.5, this section feeds the automated visual compliance script. Only Phase 3 touches UI, so this check runs once after all 3 phases complete.

- [ ] `/schedule` page loads without runtime errors in console
- [ ] ActivityCard renders normally (text "6+", "6–12", etc. depending on data)
- [ ] No "undefined" appears in any ActivityCard's age badge
- [ ] ErrorBoundary still catches errors and shows FullPageError fallback (manual test: throw a test error)
- [ ] E2E `activity-card-adaptive.spec.ts` passes (regression check on existing UI test)

---

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Deleting `lib/mock-data.ts` breaks some import we missed | Low | Verified zero non-self references; if something breaks, restore from git |
| `maxAge` field addition conflicts with runtime data shape | Low | `maxAge` is optional, so existing data without it still compiles |
| `TagsFieldConfig.required` addition requires UI change | Low | Field is optional, no current usage, doesn't break existing fields |
| Pre-existing tests rely on `UIContextMock` without `kind` (other than the 2 we found) | Low | Will run full vitest after each phase; if new failures appear, fix the mock |
| `Location` schema change in domain package affects `api-client` or `web/` | Medium | If `tag_ids` is added, check both consumers; if not, leave schema alone and update mock |

---

## Acceptance Criteria (for closing issue #88)

- [ ] `cd frontend/admin && pnpm type-check` reports 0 errors
- [ ] `cd /root/workspace/memo && pnpm test:all` passes all 6 steps (or 5, if E2E is excluded locally)
- [ ] Pre-push hook does not block on a clean push to `fix/ts-errors-blocking-hook`
- [ ] No `// @ts-ignore`, no `as any`, no `// @ts-expect-error` added
- [ ] No new lint warnings
- [ ] All 986+ vitest tests pass
- [ ] Visual compliance gate: `/schedule` renders cleanly (manual + visual)

---

## Out of Scope (Future Work)

- **Wave 5:** Fix 14 P1/P3 bugs (#73–#86) in a single batch PR. The new E2E from Wave 4 (T15–T24) should turn GREEN after Wave 5.
- **Wave 6+:** Full type-strict pass on `web/` and `api-client/`.
- **Migrate mock data to fixtures:** Replace `lib/mock-data.ts` (already deleted) with proper test fixtures in `__tests__/fixtures/` matching API types.
- **Domain ↔ API mappers:** Add explicit mapping layer between `@memo/domain` DTOs and `@memo/api-client` response types to prevent future drift.

---

## References

- Issue #88: <https://github.com/mkosinov/memo/issues/88>
- PR #87: Testing Strategy v2 (merged) — established pre-push hook
- `docs/specs/2026-06-19-testing-strategy-v2.md` — the testing framework that surfaced this issue
- `packages/domain/src/index.ts` — canonical types
- `packages/domain/src/schedule.ts` — `ScheduleAdminDTO` (already has `maxAge`)
- `frontend/admin/lib/buildSchedule.ts:95` — existing fallback to `service?.maxAge`
- `frontend/admin/contexts/ScheduleContext.tsx` — new context, supersedes the deleted one
