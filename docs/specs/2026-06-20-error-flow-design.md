# End-to-End Error Flow Refactor (#93)

> Date: 2026-06-20
> Issue: #93 — UI: specific error messages instead of generic toast
> Status: Draft (pending G1b approval)
> Scope: ~50 files, single PR
> Deadline risk: May 20, 2026 MVP

## 1. Problem Statement

Backend returns structured error responses (HTTP status + JSON `detail`), but admin frontend throws away the detail and shows a single generic Russian toast for every failure ("Ошибка создания записи", "Ошибка удаления", etc.).

**Concrete example (from issue #93):**
- Backend: `HTTP 409 {"detail": "Activity at capacity: 2/2 seats occupied"}`
- Frontend: `showToast('Ошибка создания записи')` — user has no idea what went wrong

**Root cause chain:**
1. `packages/api-client/src/client.ts:22` — throws `new ApiError(res.status, 'API error: ${status} ${statusText}')`, **ignores response body**
2. `hooks/useRecordMutations.ts:100` — `await createRecord(...)` — propagates error
3. `ActivityDetailsModal.tsx:123-125` — `catch { showToast('Ошибка создания записи') }` — **bare catch, no error read**

Same anti-pattern in 12+ admin components.

## 2. Current Backend Error Contract (implicit)

No formal contract. Backend relies on FastAPI defaults + 1 custom handler:

| Pattern | Source | Response body | Status |
|---|---|---|---|
| A. `HTTPException(detail="...")` | All routers (73 sites) | `{"detail": "string"}` | 4xx/5xx |
| B. `IntegrityError` handler | `main.py:50-57` | `{"detail": "string"}` | 422 |
| C. Pydantic validation | FastAPI default | `{"detail": [{"loc": [...], "msg": "...", "type": "..."}]}` ⚠️ array | 422 |
| D. Uncaught exception | FastAPI default | `{"detail": "Internal Server Error"}` | 500 |

**Gap:** no error code system, no schema, no docs. The contract is implicit and inconsistent (C is array, others are string).

## 3. Goal

End-to-end error contract with **machine-readable codes** flowing backend → api-client → admin UI:

```
Backend:  raise HTTPException(409, "Activity at capacity: 2/2 seats occupied",
                                code="ACTIVITY_AT_CAPACITY")
                ↓
Response:  {"detail": {"code": "ACTIVITY_AT_CAPACITY",
                       "message": "Activity at capacity: 2/2 seats occupied"}}
                ↓
api-client: ApiError { status: 409, code: "ACTIVITY_AT_CAPACITY",
                       message: "Activity at capacity: 2/2 seats occupied" }
                ↓
parseApiError: { message: "Недостаточно мест: 2/2 мест занято", status: 409 }
                ↓
Admin UI:  showToast("Недостаточно мест: 2/2 мест занято", 'error')
```

## 4. Architecture

### 4.1 Backend (`src/`)

```
┌────────────────────────────────────────────┐
│ errors.py (NEW)                             │
│  - ErrorCode enum (all codes)              │
│  - ErrorDetail Pydantic model              │
│    { code: str, message: str }             │
│  - ERROR_MESSAGES dict (code → RU text)    │
└────────────────────────────────────────────┘
                ↓
┌────────────────────────────────────────────┐
│ main.py — global exception handlers        │
│  - HTTPException → ErrorResponse (409 etc) │
│  - RequestValidationError → ErrorResponse  │
│  - IntegrityError → ErrorResponse          │
│  - Exception (catch-all) → ErrorResponse   │
└────────────────────────────────────────────┘
                ↓
┌────────────────────────────────────────────┐
│ All routers (12 files) — add code= to      │
│ raise HTTPException(...) calls             │
└────────────────────────────────────────────┘
```

### 4.2 Frontend api-client (`packages/api-client/`)

```
┌────────────────────────────────────────────┐
│ client.ts                                   │
│  - api() reads error body, extracts        │
│    { code, message }                       │
│  - throws new ApiError(status, code, msg)  │
└────────────────────────────────────────────┘
```

### 4.3 Admin UI (`frontend/admin/`)

```
┌────────────────────────────────────────────┐
│ app/lib/api/parseApiError.ts (NEW)          │
│  - Pure function:                          │
│    parseApiError(err: unknown)             │
│      → { message: string, status?: number, │
│           code?: string }                  │
│  - Maps code → default RU message          │
│  - Uses err.message for context (e.g.      │
│    "2/2 seats occupied")                   │
└────────────────────────────────────────────┘
                ↓
┌────────────────────────────────────────────┐
│ All catch sites (12+ files)                │
│  catch (err) {                             │
│    const { message } = parseApiError(err); │
│    showToast(message, 'error');            │
│  }                                         │
└────────────────────────────────────────────┘
```

## 5. Error Code Registry

Stable machine-readable codes, mapped to user-friendly Russian messages in `parseApiError`:

| Code | HTTP | Backend message (English) | Frontend default RU | Used in |
|---|---|---|---|---|
| `ACTIVITY_AT_CAPACITY` | 409 | "Activity at capacity: N/M seats occupied" | "Недостаточно мест" (appends N/M) | records.py:295 |
| `ACTIVITY_NOT_FOUND` | 404 | "Activity not found" | "Не найдено" | activities.py |
| `RECORD_NOT_FOUND` | 404 | "Record not found" | "Не найдено" | records.py |
| `CLIENT_NOT_FOUND` | 404 | "Client not found" | "Не найдено" | clients.py |
| `CLIENT_DUPLICATE_PHONE` | 409 | "Client with this phone already exists" | "Клиент с таким телефоном уже существует" | clients.py |
| `LOCATION_NOT_FOUND` | 404 | "Location not found" | "Не найдено" | locations.py |
| `MASTER_NOT_FOUND` | 404 | "Master not found" | "Не найдено" | masters.py |
| `SERVICE_NOT_FOUND` | 404 | "Service not found" | "Не найдено" | services.py |
| `TAG_NOT_FOUND` | 404 | "Tag not found" | "Не найдено" | tags.py |
| `PHOTO_NOT_FOUND` | 404 | "Photo not found" | "Не найдено" | photos.py |
| `MATERIAL_NOT_FOUND` | 404 | "Material not found" | "Не найдено" | materials.py |
| `VISITOR_NOT_FOUND` | 404 | "Visitor not found" | "Не найдено" | visitors.py |
| `VISIT_NOT_FOUND` | 404 | "Visit not found" | "Не найдено" | visits.py |
| `PAYMENT_NOT_FOUND` | 404 | "Payment not found" | "Не найдено" | payments.py |
| `SETTINGS_NOT_FOUND` | 404 | "Settings not found" | "Не найдено" | user_settings.py |
| `VALIDATION_ERROR` | 422 | first validation error msg | "Проверьте правильность заполнения полей" | RequestValidationError |
| `INTEGRITY_VIOLATION` | 422 | "Database integrity constraint violated" | "Нарушение целостности данных" | IntegrityError |
| `INTERNAL_ERROR` | 500 | "Internal Server Error" | "Ошибка сервера" | uncaught |

**Total: 18 codes.** All in `backend/src/errors.py:ErrorCode` enum.

## 6. parseApiError — Mapping Logic

```typescript
function parseApiError(err: unknown): {
  message: string;
  status?: number;
  code?: string;
} {
  if (err instanceof ApiError) {
    // Use backend message as primary source (often more specific)
    // Override with code-based default only for generic cases
    if (err.code && CODE_DEFAULTS[err.code]) {
      return {
        message: appendContext(CODE_DEFAULTS[err.code], err.message),
        status: err.status,
        code: err.code,
      };
    }
    return { message: err.message, status: err.status, code: err.code };
  }
  if (err instanceof TypeError) {
    // fetch() throws TypeError on network failure
    return { message: 'Ошибка сети' };
  }
  return { message: 'Неизвестная ошибка' };
}
```

**appendContext** combines default RU with informative bits from backend message (e.g., `2/2 seats occupied`).

## 7. File Scope

### Backend (5 new, ~13 edited)

| File | Action |
|---|---|
| `backend/src/errors.py` | **NEW** — ErrorCode enum + ErrorDetail schema + registry |
| `backend/src/main.py` | edit — add 3 global exception handlers |
| `backend/src/api/v1/activities.py` | edit — add `code=` to 4 HTTPException |
| `backend/src/api/v1/records.py` | edit — add `code=` to 4 HTTPException + 1 in service |
| `backend/src/api/v1/clients.py` | edit — add `code=` to 4 HTTPException + DUPLICATE_PHONE |
| `backend/src/api/v1/locations.py` | edit — add `code=` to 3 HTTPException |
| `backend/src/api/v1/masters.py` | edit — add `code=` to 3 HTTPException |
| `backend/src/api/v1/services.py` | edit — add `code=` to 3 HTTPException |
| `backend/src/api/v1/tags.py` | edit — add `code=` to 2 HTTPException |
| `backend/src/api/v1/photos.py` | edit — add `code=` to 3 HTTPException |
| `backend/src/api/v1/materials.py` | edit — add `code=` to 3 HTTPException |
| `backend/src/api/v1/visitors.py` | edit — add `code=` to 3 HTTPException |
| `backend/src/api/v1/visits.py` | edit — add `code=` to 2 HTTPException |
| `backend/src/api/v1/payments.py` | edit — add `code=` to 3 HTTPException |
| `backend/src/api/v1/user_settings.py` | edit — add `code=` to 3 HTTPException |
| `backend/src/services/record.py` | edit — add `code="ACTIVITY_AT_CAPACITY"` |
| `backend/src/errors.test.py` | **NEW** — unit tests for handlers |
| `backend/tests/test_error_handlers.py` | **NEW** — integration tests |

### API client (1 edited + 1 new test)

| File | Action |
|---|---|
| `packages/api-client/src/client.ts` | edit — extract `{code, message}` from body, update ApiError |
| `packages/api-client/src/client.test.ts` | **NEW** — test ApiError has code+message fields |

### Admin (1 new helper, 1 new test, 12+ edited call sites)

| File | Action |
|---|---|
| `frontend/admin/app/lib/api/parseApiError.ts` | **NEW** — helper |
| `frontend/admin/app/lib/api/parseApiError.test.ts` | **NEW** — ~15 unit tests |
| `frontend/admin/app/providers.tsx` | edit — QueryCache.onError uses parseApiError |
| `frontend/admin/app/(main)/locations/components/LocationsTable.tsx` | edit — 4 catches |
| `frontend/admin/app/(main)/tags/components/TagsTable.tsx` | edit — 3 catches |
| `frontend/admin/app/(main)/services/components/ServicesTable.tsx` | edit — 4 catches |
| `frontend/admin/app/(main)/services/components/MaterialsTable.tsx` | edit — 4 catches |
| `frontend/admin/app/(main)/masters/components/MastersTable.tsx` | edit — 4 catches |
| `frontend/admin/app/(main)/photos/components/PhotosTable.tsx` | edit — 1-2 catches |
| `frontend/admin/app/(main)/photos/components/PhotoModal.tsx` | edit — 1 catch |
| `frontend/admin/app/(main)/clients/components/ClientsTable.tsx` | edit — catches |
| `frontend/admin/app/(main)/clients/components/ClientCardModal.tsx` | edit — catches |
| `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx` | edit — 4+ catches |

**Total: ~50 files changed.**

## 8. Migration Plan

Single PR, sequential commits for review:

1. **Commit 1:** Backend — `errors.py` (codes + schema + tests)
2. **Commit 2:** Backend — `main.py` handlers + tests
3. **Commit 3:** Backend — migrate all `raise HTTPException` to include `code=`
4. **Commit 4:** API client — update `client.ts` + ApiError + tests
5. **Commit 5:** Admin — `parseApiError.ts` helper + tests
6. **Commit 6:** Admin — update `providers.tsx` QueryCache.onError
7. **Commits 7-15:** Admin — update catch sites per directory (locations, tags, services, masters, photos, clients, activity-details-modal)
8. **Commit 16:** E2E tests for 6 user scenarios
9. **Commit 17:** Docs (this spec + contract ADR)

**Risk mitigation:** each commit independently testable. If a commit fails, can be reverted without blocking later work.

## 9. User Scenarios (E2E coverage)

1. **Admin creates record on full activity** → sees "Недостаточно мест: 2/2 мест занято" (from 409 ACTIVITY_AT_CAPACITY with detail), not generic.
2. **Admin deletes non-existent tag** → sees "Тег не найден" (404 TAG_NOT_FOUND), not generic.
3. **Admin updates location with empty name** → sees "Проверьте правильность заполнения полей" (422 VALIDATION_ERROR), not generic.
4. **Backend returns 500** → sees "Ошибка сервера" (500 INTERNAL_ERROR), not generic.
5. **Network offline during mutation** → sees "Ошибка сети" (TypeError from fetch), not generic.
6. **Admin creates client with duplicate phone** → sees "Клиент с таким телефоном уже существует" (409 CLIENT_DUPLICATE_PHONE), not generic.

Each scenario → 1 Playwright E2E in `e2e/error-messages.spec.ts`.

## 10. Visual Compliance Checks

For Visual Compliance Gate (Step 4.5):

- [ ] Toast for ACTIVITY_AT_CAPACITY shows capacity numbers (e.g., "2/2 мест занято")
- [ ] Toast for *_NOT_FOUND shows "Не найдено" (not generic "Ошибка удаления")
- [ ] Toast for 500 shows "Ошибка сервера" with red kind
- [ ] Toast for VALIDATION_ERROR shows "Проверьте правильность заполнения полей"
- [ ] No "Ошибка создания записи" or "Ошибка удаления" generic toasts in flows
- [ ] Toast appears with kind='error' (red border per existing ToastContainer design)

## 11. Out of Scope

- **i18n** — all messages stay Russian (consistent with current state)
- **Retry logic** — error display only, retry is separate concern
- **Error reporting** (Sentry etc.) — separate concern
- **Web app (client-facing)** — only admin in this PR
- **Backend structured logging** — separate concern
- **Optimistic update rollback UI** — already handled by useRecordMutations

## 12. Acceptance Criteria

- [ ] All 18 error codes registered in `backend/src/errors.py:ErrorCode`
- [ ] All 4 backend exception handlers return `ErrorDetail` shape
- [ ] All 73 `raise HTTPException` sites include `code=` parameter
- [ ] `api-client` `ApiError` has `code: string | undefined` field
- [ ] `parseApiError` exists with full unit test coverage
- [ ] All 12+ admin catch sites use `parseApiError`
- [ ] 6 E2E tests pass
- [ ] 0 regressions in existing 555 pytest + 1012 vitest
- [ ] Visual compliance 6/6 PASS
- [ ] TypeScript 0 errors
- [ ] Ruff 0 new errors
