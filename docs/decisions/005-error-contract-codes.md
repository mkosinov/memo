# ADR 005: End-to-End Error Contract with Machine-Readable Codes

## Status

Accepted

**Date:** 2026-06-20

## Context

Backend returns structured error responses (HTTP status + JSON `detail`), but admin frontend was throwing away the detail and showing a single generic Russian toast for every failure. Users could not understand what went wrong (e.g., activity at capacity vs server error vs network failure).

**Current state (pre-2026-06-20):**
- Backend: 73 `raise HTTPException(status_code=XXX, detail="string")` sites — no error code system
- api-client (`packages/api-client/src/client.ts`): throws `new ApiError(res.status, 'API error: ${status} ${statusText}')` — ignores response body
- Admin UI: 30+ `catch { showToast('Ошибка ...') }` blocks — generic Russian text, loses error context
- Some UI components had **empty try/catch** (`catch {}`) that silently swallowed errors — user saw nothing

**Implicit error response shapes** (no formal contract):
- HTTPException: `{"detail": "string"}`
- IntegrityError: `{"detail": "string"}` (custom handler)
- Pydantic validation: `{"detail": [{loc, msg, type}]}` (FastAPI default — array)
- Uncaught: `{"detail": "Internal Server Error"}`

## Decision

Adopt a **machine-readable error code system** flowing end-to-end:

1. **Backend** defines `ErrorCode(str, Enum)` with 18 stable codes (`ACTIVITY_AT_CAPACITY`, `TAG_NOT_FOUND`, `VALIDATION_ERROR`, `INTERNAL_ERROR`, etc.) and `ErrorDetail(BaseModel) { code, message }` Pydantic schema.

2. **Backend** adds 4 global exception handlers that wrap all responses in `{"detail": {code, message}}` shape. Migration: 41 `raise HTTPException` sites updated to pass `ErrorDetail(...)` as detail.

3. **API client** (`packages/api-client`) extracts `{code, message}` from response body and attaches to `ApiError.code?: string` field. Legacy `{"detail": "string"}` and validation arrays still work (code=undefined for legacy).

4. **Admin frontend** defines `parseApiError(err: unknown): { message, status?, code? }` helper that maps `code` → user-friendly Russian message (e.g., `ACTIVITY_AT_CAPACITY` → "Недостаточно мест: 2/2 мест занято"). 26 mutation handlers in 9 admin files updated to use it.

5. **No new public error schema** for validation errors — frontend maps HTTP 422 to "Проверьте правильность заполнения полей" regardless of validation array content.

## Consequences

### Positive
- Users see specific error messages (e.g., "Недостаточно мест: 2/2 мест занято" instead of "Ошибка создания записи")
- Silent error swallowing eliminated — every mutation failure shows feedback
- Stable error codes enable analytics, error reporting, A/B testing
- Frontend can implement retry logic, error categorization, i18n without backend changes
- New errors can be added via `ErrorCode` enum + handler updates

### Negative
- API client `ApiError` shape change (added optional `code` field) — backward compatible (existing callers using `status`/`message` continue to work)
- 18 codes require maintenance — adding a new error type needs enum + frontend mapping
- Russian messages duplicated in backend (`ERROR_MESSAGES`) and frontend (`CODE_DEFAULTS`) — single source of truth would require runtime fetch (overkill for now)

### Risks
- Future FastAPI/Pydantic updates might change validation error shape → mitigated by explicit handler
- Adding more error codes requires frontend mapping update → documented in spec §5
- If backend returns malformed body (not JSON), handler falls back to generic message → acceptable degradation

## References

- Issue: #93 — UI: specific error messages instead of generic toast
- Spec: `docs/specs/2026-06-20-error-flow-design.md`
- Plan: `docs/plans/2026-06-20-error-flow-plan.md`
- Implementation: PR `fix/error-flow-93` (17 commits)
- Related: ADR-001 (SQLite), ADR-002 (React Query), ADR-004 (SuperAgents workflow)
