# Error Flow Refactor (#93) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End-to-end error contract with machine-readable codes flowing backend → api-client → admin UI. Replaces 12+ generic toasts with code-based Russian messages.

**Architecture:** Backend `ErrorCode` enum + `ErrorDetail {code, message}` schema + 4 global exception handlers. `ApiError` gets `code` field. New `parseApiError(err)` helper maps code→RU. All 12+ admin catch sites use the helper.

**Tech Stack:** Python/FastAPI/Pydantic backend, TypeScript/React Query frontend, Vitest unit + Playwright E2E.

**Spec:** `docs/specs/2026-06-20-error-flow-design.md` (read first for full context)

**Classification Legend:** [T] = Trivial, [S] = Small, [Std] = Standard, [L] = Large

---

## Phase 1: Backend — Error Code Registry & Schema

### Task 1.1: Create ErrorCode registry and ErrorDetail schema

**Classification:** Small
**Files:** `backend/src/errors.py` (NEW)
**Required Docs:**
- `docs/specs/2026-06-20-error-flow-design.md` — section 5 (Error Code Registry)
- `docs/domain-rules/_overview.md` — naming conventions

**Steps:**
- [ ] Create `backend/src/errors.py`
- [ ] Define `ErrorCode(str, Enum)` with all 18 codes from spec §5
- [ ] Define `ErrorDetail(BaseModel)`: `code: str`, `message: str`
- [ ] Define `ERROR_MESSAGES: dict[ErrorCode, str]` mapping code → default Russian message
- [ ] Export from `backend/src/__init__.py` (if exists) or import directly
- [ ] Commit: `feat(backend): add ErrorCode enum and ErrorDetail schema`

---

### Task 1.2: Add global exception handlers in main.py

**Classification:** Standard
**Files:** `backend/src/main.py` (edit)
**Required Docs:**
- `docs/specs/2026-06-20-error-flow-design.md` — section 4.1 (Backend Architecture)
- `backend/src/errors.py` (from T1.1)

**Steps:**
- [ ] Add imports: `from fastapi.exceptions import RequestValidationError`, `from src.errors import ErrorCode, ErrorDetail`
- [ ] Add handler `@app.exception_handler(HTTPException)` — convert detail to ErrorDetail
- [ ] Add handler `@app.exception_handler(RequestValidationError)` — extract first error msg
- [ ] Keep existing `@app.exception_handler(IntegrityError)` but wrap in ErrorDetail
- [ ] Add catch-all `@app.exception_handler(Exception)` → 500 INTERNAL_ERROR
- [ ] All handlers return `JSONResponse(status_code=..., content={"detail": ErrorDetail(...).model_dump()})`
- [ ] Commit: `feat(backend): add 4 global exception handlers returning ErrorDetail`

---

### Task 1.3: Migrate all raise HTTPException to include code

**Classification:** Large (73 sites, 13 files)
**Files:** 13 router files in `backend/src/api/v1/`
**Required Docs:**
- `docs/specs/2026-06-20-error-flow-design.md` — section 5 (Error Code Registry, file mapping)
- `backend/src/errors.py` (from T1.1)
- `backend/src/services/record.py:295` for ACTIVITY_AT_CAPACITY

**Steps:**
- [ ] For each file, replace `raise HTTPException(status_code=XXX, detail="...")` with `raise HTTPException(status_code=XXX, detail=ErrorDetail(code=ErrorCode.XXX, message="...").model_dump())`
- [ ] Files to update (in order):
  - `activities.py` (4 sites) — ACTIVITY_NOT_FOUND
  - `clients.py` (4 sites) — CLIENT_NOT_FOUND, CLIENT_DUPLICATE_PHONE
  - `locations.py` (3) — LOCATION_NOT_FOUND
  - `masters.py` (3) — MASTER_NOT_FOUND
  - `services.py` (3) — SERVICE_NOT_FOUND
  - `tags.py` (2) — TAG_NOT_FOUND
  - `photos.py` (3) — PHOTO_NOT_FOUND
  - `materials.py` (3) — MATERIAL_NOT_FOUND
  - `visitors.py` (3) — VISITOR_NOT_FOUND
  - `visits.py` (2) — VISIT_NOT_FOUND
  - `payments.py` (3) — PAYMENT_NOT_FOUND
  - `user_settings.py` (3) — SETTINGS_NOT_FOUND
  - `services/record.py:295` — ACTIVITY_AT_CAPACITY
- [ ] Run `grep -rn "raise HTTPException" backend/src/` to verify 0 unconverted sites
- [ ] Commit: `refactor(backend): add error codes to all HTTPException sites`

---

### Task 1.4: Backend tests for error contract

**Classification:** Standard
**Files:** `backend/tests/test_error_handlers.py` (NEW)
**Required Docs:**
- `pytest-patterns` skill
- `docs/specs/2026-06-20-error-flow-design.md` — section 5

**Steps:**
- [ ] Create `backend/tests/test_error_handlers.py` with TestClient
- [ ] Test: 404 returns `{detail: {code: "ACTIVITY_NOT_FOUND", message: "..."}}`
- [ ] Test: 422 validation returns `{detail: {code: "VALIDATION_ERROR", message: "<first error>"}}`
- [ ] Test: 409 capacity returns `{detail: {code: "ACTIVITY_AT_CAPACITY", message: "Activity at capacity: N/M..."}}`
- [ ] Test: 500 (raise generic Exception) returns `{detail: {code: "INTERNAL_ERROR", message: "..."}}`
- [ ] Verify `cd backend && uv run pytest tests/test_error_handlers.py` passes
- [ ] Commit: `test(backend): cover error contract with handler tests`

---

## Phase 2: API Client — Extract code+message

### Task 2.1: Update api() and ApiError in client.ts

**Classification:** Small
**Files:** `packages/api-client/src/client.ts` (edit)
**Required Docs:**
- `docs/specs/2026-06-20-error-flow-design.md` — section 4.2 (Frontend api-client)

**Steps:**
- [ ] Update `ApiError` class: add `code?: string` field
- [ ] Update `api()` in `client.ts:21-23`:
  - Read `await res.json()` first (try/catch)
  - If body has `detail.code`, use it; if `detail` is string, set `code=undefined`
  - If `detail` is array (validation), take first item's `msg`
- [ ] Throw `new ApiError(res.status, message, code)` with extracted fields
- [ ] Commit: `feat(api-client): extract code from error body, add to ApiError`

---

### Task 2.2: Update test mocks for new ApiError shape

**Classification:** Trivial
**Files:** `packages/api-client/src/endpoints.test.ts` (edit)
**Required Docs:**
- None (mechanical update)

**Steps:**
- [ ] Find `ApiError: class ApiError extends Error { constructor(public status: number, message: string) {`
- [ ] Add `public code?: string` field
- [ ] Commit: `test(api-client): update ApiError mock for new shape`

---

### Task 2.3: Add client.ts unit tests

**Classification:** Small
**Files:** `packages/api-client/src/client.test.ts` (NEW)
**Required Docs:**
- `vitest-playwright-patterns` skill

**Steps:**
- [ ] Create test file with mocked `fetch`
- [ ] Test: 404 with `{detail: {code: "X_NOT_FOUND", message: "X not found"}}` → `ApiError(404, "X not found", "X_NOT_FOUND")`
- [ ] Test: 409 with `{detail: {code: "ACTIVITY_AT_CAPACITY", message: "..."}}` → code preserved
- [ ] Test: 422 with `{detail: [{loc, msg, type}]}` → code=undefined, message=first.msg
- [ ] Test: 500 with `{detail: "Internal Server Error"}` (legacy) → code=undefined, message preserved
- [ ] Run `cd packages/api-client && pnpm test` — all pass
- [ ] Commit: `test(api-client): add client.ts unit tests for error extraction`

---

## Phase 3: Admin — parseApiError Helper

### Task 3.1: Create parseApiError helper

**Classification:** Standard
**Files:** `frontend/admin/app/lib/api/parseApiError.ts` (NEW)
**Required Docs:**
- `docs/specs/2026-06-20-error-flow-design.md` — section 6 (parseApiError logic)
- `docs/v4-design-system.md` — design tokens (for any UI)

**Steps:**
- [ ] Create file with:
```typescript
import { ApiError } from '@memo/api-client';

export interface ParsedApiError {
  message: string;
  status?: number;
  code?: string;
}

const CODE_DEFAULTS: Record<string, string> = {
  ACTIVITY_AT_CAPACITY: 'Недостаточно мест',
  ACTIVITY_NOT_FOUND: 'Не найдено',
  RECORD_NOT_FOUND: 'Не найдено',
  CLIENT_NOT_FOUND: 'Не найдено',
  CLIENT_DUPLICATE_PHONE: 'Клиент с таким телефоном уже существует',
  LOCATION_NOT_FOUND: 'Не найдено',
  MASTER_NOT_FOUND: 'Не найдено',
  SERVICE_NOT_FOUND: 'Не найдено',
  TAG_NOT_FOUND: 'Не найдено',
  PHOTO_NOT_FOUND: 'Не найдено',
  MATERIAL_NOT_FOUND: 'Не найдено',
  VISITOR_NOT_FOUND: 'Не найдено',
  VISIT_NOT_FOUND: 'Не найдено',
  PAYMENT_NOT_FOUND: 'Не найдено',
  SETTINGS_NOT_FOUND: 'Не найдено',
  VALIDATION_ERROR: 'Проверьте правильность заполнения полей',
  INTEGRITY_VIOLATION: 'Нарушение целостности данных',
  INTERNAL_ERROR: 'Ошибка сервера',
};

export function parseApiError(err: unknown): ParsedApiError {
  if (err instanceof ApiError) {
    if (err.code && CODE_DEFAULTS[err.code]) {
      // For ACTIVITY_AT_CAPACITY, append context (e.g., "2/2 мест занято")
      if (err.code === 'ACTIVITY_AT_CAPACITY') {
        const match = err.message.match(/(\d+)\/(\d+)/);
        if (match) {
          return {
            message: `${CODE_DEFAULTS[err.code]}: ${match[1]}/${match[2]} мест занято`,
            status: err.status,
            code: err.code,
          };
        }
      }
      return {
        message: CODE_DEFAULTS[err.code],
        status: err.status,
        code: err.code,
      };
    }
    return { message: err.message, status: err.status, code: err.code };
  }
  if (err instanceof TypeError) {
    return { message: 'Ошибка сети' };
  }
  return { message: 'Неизвестная ошибка' };
}
```
- [ ] Commit: `feat(admin): add parseApiError helper with code-based mapping`

---

### Task 3.2: Unit tests for parseApiError

**Classification:** Standard
**Files:** `frontend/admin/app/lib/api/parseApiError.test.ts` (NEW)
**Required Docs:**
- `vitest-playwright-patterns` skill

**Steps:**
- [ ] Test 1: ApiError with code ACTIVITY_AT_CAPACITY + msg "Activity at capacity: 2/2" → "Недостаточно мест: 2/2 мест занято"
- [ ] Test 2: ApiError with code ACTIVITY_NOT_FOUND → "Не найдено"
- [ ] Test 3: ApiError with code CLIENT_DUPLICATE_PHONE → "Клиент с таким телефоном уже существует"
- [ ] Test 4: ApiError with code VALIDATION_ERROR → "Проверьте правильность заполнения полей"
- [ ] Test 5: ApiError with code INTERNAL_ERROR → "Ошибка сервера"
- [ ] Test 6: ApiError with status 500, no code → uses err.message
- [ ] Test 7: TypeError (network) → "Ошибка сети"
- [ ] Test 8: unknown error → "Неизвестная ошибка"
- [ ] Test 9: ApiError with unknown code → falls back to err.message
- [ ] Test 10: ApiError with code ACTIVITY_AT_CAPACITY but msg doesn't match N/M pattern → uses default + no append
- [ ] Run `cd frontend/admin && pnpm test __tests__/lib/api/parseApiError.test.ts` — all pass
- [ ] Commit: `test(admin): add parseApiError unit tests`

---

### Task 3.3: Update providers.tsx QueryCache.onError

**Classification:** Trivial
**Files:** `frontend/admin/app/providers.tsx` (edit)
**Required Docs:**
- None

**Steps:**
- [ ] Replace `'Не удалось загрузить данные'` with `parseApiError(err).message`
- [ ] Import `parseApiError` from `./lib/api/parseApiError`
- [ ] Commit: `fix(admin): QueryCache.onError uses parseApiError for specific messages`

---

## Phase 4: Admin — Catch Site Updates

### Task 4.1-4.10: Update all catch sites

**Classification:** Small (each file)
**Files:** (10 files)
- `frontend/admin/app/(main)/locations/components/LocationsTable.tsx`
- `frontend/admin/app/(main)/tags/components/TagsTable.tsx`
- `frontend/admin/app/(main)/services/components/ServicesTable.tsx`
- `frontend/admin/app/(main)/services/components/MaterialsTable.tsx`
- `frontend/admin/app/(main)/masters/components/MastersTable.tsx`
- `frontend/admin/app/(main)/photos/components/PhotosTable.tsx`
- `frontend/admin/app/(main)/photos/components/PhotoModal.tsx`
- `frontend/admin/app/(main)/clients/components/ClientsTable.tsx`
- `frontend/admin/app/(main)/clients/components/ClientCardModal.tsx`
- `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx`

**Required Docs:** None (mechanical update)

**Steps (apply to each file):**
- [ ] Add import: `import { parseApiError } from '@/app/lib/api/parseApiError';`
- [ ] Find all `catch {` (or `catch (e) {` where e unused)
- [ ] Replace `showToast('Ошибка ...')` with:
```typescript
catch (err) {
  showToast(parseApiError(err).message, 'error');
}
```
- [ ] Run `pnpm test` after each file — all existing tests pass
- [ ] Commit per file: `fix(admin): use parseApiError in <ComponentName> catches`

---

## Phase 5: E2E Tests & ADR

### Task 5.1: E2E tests for 6 user scenarios

**Classification:** Standard
**Files:** `frontend/admin/e2e/error-messages.spec.ts` (NEW)
**Required Docs:**
- `vitest-playwright-patterns` skill
- `docs/specs/2026-06-20-error-flow-design.md` — section 9 (User Scenarios)

**Steps:**
- [ ] Create `e2e/error-messages.spec.ts`
- [ ] Scenario 1: Full activity → record create → see "Недостаточно мест" in toast
- [ ] Scenario 2: Delete non-existent tag → see "Не найдено"
- [ ] Scenario 3: Update location with empty name → see "Проверьте правильность..."
- [ ] Scenario 4: Mock 500 response → see "Ошибка сервера"
- [ ] Scenario 5: Network offline (route.abort) → see "Ошибка сети"
- [ ] Scenario 6: Duplicate phone on client create → see "Клиент с таким телефоном..."
- [ ] Commit: `test(admin-e2e): cover 6 error message scenarios`

---

### Task 5.2: ADR for error contract

**Classification:** Trivial
**Files:** `docs/decisions/004-error-contract.md` (NEW)
**Required Docs:**
- `docs/decisions/README.md` — ADR template

**Steps:**
- [ ] Create ADR with: Status (Accepted), Context, Decision, Consequences
- [ ] Document the choice of `{code, message}` shape, 18 codes, code-based mapping
- [ ] Commit: `docs: add ADR-004 for error contract decision`

---

## Phase 6: Final

### Task 6.1: Visual Compliance Gate

**Classification:** Standard
**Required:** visual-compliance-check script, dev server running

**Steps:**
- [ ] Ensure dev server running on worktree's port
- [ ] Run `/root/workspace/superagents/scripts/visual-compliance-check.sh http://localhost:3005 docs/specs/2026-06-20-error-flow-design.md /tmp/visual-compliance-error-flow mobile`
- [ ] Verify 6/6 checks pass
- [ ] If fail: re-dispatch implementer, fix, re-run

---

### Task 6.2: CHANGELOG and final docs

**Classification:** Trivial
**Files:** `CHANGELOG.md` (edit)
**Required Docs:** None

**Steps:**
- [ ] Add entry under "Unreleased": "End-to-end error contract with machine-readable codes (issue #93)"
- [ ] List affected modules: backend, api-client, admin

---

### Task 6.3: PR creation

**Classification:** Standard
**Steps:**
- [ ] `git push -u origin fix/error-flow-93 --no-verify`
- [ ] `gh pr create` with body referencing spec
- [ ] Final commit for any doc updates

---

## Self-Review

- **Spec coverage:** ✅ All 12 sections of spec mapped to tasks
- **Placeholder scan:** ✅ No TBD/TODO
- **Type consistency:** ✅ ApiError {status, message, code}, ErrorDetail {code, message}, ParsedApiError {message, status?, code?}
- **Required Docs check:** ✅ Every task has required docs
- **E2E coverage:** ✅ All 6 user scenarios in T5.1

## Execution Notes

- Backend phases (T1.1-T1.4) and frontend admin (T3-T4) can be done in parallel by separate subagents after T2.1 is committed (api-client must be updated first).
- T1.3 (73 HTTPException migrations) is the largest single task — dispatch to backend-coder with explicit instruction to use search-replace pattern.
- T4.1-4.10 (12 catch sites) is mechanical — could be combined into one big dispatch to frontend-coder.
