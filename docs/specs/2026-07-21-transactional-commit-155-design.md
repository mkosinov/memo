# Design: Transactional Commit Boundary — #155 read-after-write fix

> Date: 2026-07-21
> Issue: #155 (E2E flake: GET /payments/{id} 404 after POST)
> Branch: feat-transactional-commit-155
> Classification: standard (backend architecture change + test cleanup)

## Problem

E2E scenario 18 (`unified-rows.spec.ts:851` — "hard delete removes payment from
stats") flakes ~50% on CI. The test does `POST /payments` then immediately
`GET /payments/{id}` — the GET returns 404 despite the POST returning 201.

This is NOT a test-only flake. It is a **backend read-after-write race** that
affects ALL write endpoints. E2E factories (`createTestClient`,
`createTestActivity`, `createTestRecord`) already work around it with polling
loops + an explicit comment:

> *"The backend's get_db_session commits in the finally block — AFTER the HTTP
> response is sent. Without this, page.goto('/clients') can trigger a GET that
> arrives before the commit is visible, returning stale data."*

Scenario 18 forgot the polling → exposed the bug. Backend unit tests don't see
the race because sync `TestClient` runs the commit synchronously in the same
call stack.

## Root Cause

`backend/src/db/database.py:56-64` — `get_db_session` uses FastAPI yield-dependency:

```python
async def get_db_session(self):
    async with self.async_session() as session:
        try:
            yield session              # handler runs, flushes to DB
            await session.commit()     # runs AFTER HTTP response is sent
        except Exception:
            await session.rollback()
            raise
```

Code after `yield` executes **after** FastAPI sends the HTTP response. Timeline:

```
t0: POST arrives → handler runs → session.add() + session.flush()
t1: handler returns PaymentResponse
t2: FastAPI serializes → sends 201 to client
t3: yield resumes → await session.commit()   ← COMMIT HAPPENS HERE
```

Client receives 201 at t2, sends GET immediately. GET opens a new session
(different pooled connection). If GET reaches the DB before t3 (commit) → 404.

On fast hardware: commit wins. On slow CI: GET wins ~50%. This is a structural
defect of the yield-dependency pattern for read-after-write guarantees.

## Solution: `@transactional` decorator on service write methods

Move the commit boundary from infrastructure (get_db_session) to the business
layer (service), where it belongs per the **Unit of Work** pattern (Martin
Fowler, PoEAA). This is the equivalent of Spring's `@Transactional` annotation.

### Why the service layer (not repository, not session)?

| Layer | Commit here? | Why |
|-------|-------------|-----|
| Repository | ❌ | Breaks multi-step atomicity. `RecordService.create` adds record + visits in one transaction — if repository commits after first flush, a visit failure leaves an orphan record. `flush` in repo is intentional (write to buffer, keep transaction open). |
| get_db_session | ❌ (can't fix) | yield-dependency: code after yield runs after response sent. No way to insert commit between handler return and response send. |
| **Service** | ✅ | Owns the unit-of-work boundary. Knows when all steps are done. Decorator commits after method returns, but before route handler returns to FastAPI → data is visible before HTTP response leaves. |

### Evidence this is standard practice

- **SQLAlchemy docs** ([session_transaction.html](https://docs.sqlalchemy.org/en/20/orm/session_transaction.html)): "Commit-as-you-go" pattern — caller decides when to commit. `flush()` writes to buffer, `commit()` closes transaction. Repository = flush, service = commit.
- **Spring Framework** ([tx-decl-explained.html](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-decl-explained.html)): `@Transactional` on service methods — "automatic commit on success and rollback on exceptions". DAO (repository) does NOT commit.

### Decorator implementation

New file: `backend/src/services/decorators.py`

```python
"""Service-layer transaction decorator — Unit of Work pattern.

Commits the session after the service method returns successfully,
ensuring data is visible BEFORE the HTTP response is sent to the client.

This fixes the read-after-write race caused by get_db_session's
yield-dependency pattern (commit-after-response).

Repository layer does flush() only; service layer owns the transaction
boundary, matching the Unit of Work pattern (Fowler, PoEAA) and
Spring's @Transactional annotation.
"""
from functools import wraps


def transactional(func):
    """Decorate an async service method to commit its session after success.

    The decorated method MUST accept its session as the first positional
    argument after ``self`` (regardless of parameter name — ``db_session``,
    ``session``, etc.). The decorator inspects the signature to find the
    session argument, commits it after the method returns, then returns
    the result.

    On exception: does NOT commit (let the caller / get_db_session rollback).
    Double-commit is safe: SQLAlchemy treats commit() on an already-committed
    session as a no-op (documented behavior).
    """
    import inspect

    @wraps(func)
    async def wrapper(self, *args, **kwargs):
        # Find the session argument: first positional after self, or
        # a keyword arg named db_session/session
        sig = inspect.signature(func)
        params = list(sig.parameters.values())
        session_param_name = params[1].name  # params[0] is self

        if session_param_name in kwargs:
            session = kwargs[session_param_name]
        elif len(args) >= 2:
            session = args[1]  # args[0] is self
        else:
            raise TypeError(
                f"@transactional: cannot find session parameter "
                f"'{session_param_name}' in {func.__name__} call"
            )

        result = await func(self, *args, **kwargs)
        await session.commit()
        return result
    return wrapper
```

### `get_db_session` — keep as fallback

`get_db_session` retains its `await session.commit()` after yield as a
**defense-in-depth fallback**. If a new service method forgets `@transactional`,
the fallback still commits (just late, after response — same as current
behavior). Double-commit is a documented SQLAlchemy no-op:

> *"When there is no transaction in place for the Session... commit() will
> begin and commit an internal-only 'logical' transaction, that does not
> normally affect the database."* — SQLAlchemy 2.0 docs

## Scope

### Backend — apply `@transactional` to 20 write methods across 7 service files

| File | Methods | Count | Notes |
|------|---------|-------|-------|
| `services/generic.py` | create, update, patch, delete, reorder | 5 | Base class — all generic CRUD |
| `services/payment.py` | create | 1 | Override (adds created_at default) |
| `services/record.py` | create, update, patch, delete | 4 | Multi-step (record + visits) — commit after all flushes |
| `services/service.py` | create, update | 2 | Override (adds tariff logic) |
| `services/photo.py` | create, update | 2 | Override |
| `services/visit.py` | create, update, patch, delete | 4 | Override |
| `services/user_settings.py` | create, delete | 2 | Override |
| **Total** | | **20** | |

**Read-only methods** (list, get) do NOT get `@transactional` — no write to commit.

### E2E — remove polling workarounds from 3 factory functions

| File | Function | Change |
|------|----------|--------|
| `e2e/fixtures/factories.ts` | `createTestClient` | Remove `expect.poll` block (lines 44-54) — POST returns client with id, no GET needed |
| `e2e/fixtures/factories.ts` | `createTestActivity` | Remove `expect.poll` block (lines 92-101) |
| `e2e/fixtures/factories.ts` | `createTestRecord` | Remove `expect.poll` block (lines 130-140) |
| `e2e/fixtures/factories.ts` | `createTestRecordWithPayment` | No change (already has no polling) |

After the backend fix, `POST → GET` is guaranteed visible — polling is dead
code. Remove it so future developers don't think there's still a race.

### E2E — un-skip scenario 18

| File | Line | Change |
|------|------|--------|
| `e2e/unified-rows.spec.ts` | ~851 | Remove `test.skip(true, '#155 ...')` annotation → `test(...)` |

Scenario 18 is a pure API test (no browser, no openModal). After the backend
fix, `POST /payments` → `GET /payments/{id}` is visible immediately. The test
passes as-is — no test-code change needed beyond un-skip.

## Testing Strategy

### Backend tests (pytest)

1. **New unit test for `@transactional` decorator** (`backend/tests/test_transactional.py`):
   - Decorated method commits after success
   - Decorated method does NOT commit on exception
   - Double-commit is safe (commit after already-committed session = no-op)
   - Works with both `db_session` and `session` parameter names

2. **Existing backend tests must pass unchanged** (668 pass):
   - Sync `TestClient` commits synchronously — decorator's commit is a no-op (already committed by the time the method returns in sync mode). Verify no breakage.
   - Integration tests that do POST → GET in sequence must pass without polling.

3. **Regression test for #155** — validated by E2E scenario 18 on CI:
   - Scenario 18 (un-skipped) does POST /payments → GET /payments/{id} → assert 200
   - This is the async-path regression test (sync TestClient masks the race)
   - Must pass deterministically across multiple CI runs (no 50% flake)

### Frontend tests (vitest)

- No vitest changes (backend-only fix)
- Verify existing 1194 pass + 0 skip unchanged

### E2E tests (Playwright)

- Un-skip scenario 18 → must pass on CI shard-rest
- All other E2E tests pass unchanged (factories simplified, but behavior identical)
- No new E2E tests needed (scenario 18 is the regression test)

## User Scenarios

This is a backend architecture fix, not a user-facing feature. The user
scenarios are the E2E tests that validate the fix:

1. **Scenario 18 (un-skipped):** POST /payments creates a payment → GET /payments/{id} returns 200 with the payment data immediately (no 404, no retry needed).
2. **Factory createTestClient (simplified):** POST /clients → client.id available for immediate use in subsequent API calls (no polling loop).
3. **Factory createTestActivity (simplified):** POST /activities → activity.id available for immediate use.
4. **Factory createTestRecord (simplified):** POST /records → record.id available for immediate use.
5. **All existing E2E tests:** continue to pass — the fix is transparent, only removes a race window that was previously masked by polling.

## Visual Compliance Checks

N/A — backend-only change. No .tsx, .css, or UI files touched. No screenshots needed.

## Acceptance Criteria

- [ ] `@transactional` decorator created in `backend/src/services/decorators.py`
- [ ] Decorator applied to all 20 write methods across 7 service files
- [ ] `get_db_session` retains commit-after-yield as fallback (no change)
- [ ] Unit tests for decorator pass (commit on success, no-commit on exception, double-commit safe)
- [ ] Existing 668 backend tests pass unchanged
- [ ] New regression test: scenario 18 un-skipped, POST /payments → GET /payments/{id} → 200 on CI (deterministic, no flake)
- [ ] E2E factory polling removed from createTestClient, createTestActivity, createTestRecord
- [ ] Scenario 18 un-skipped → passes on CI shard-rest
- [ ] All other E2E tests pass unchanged (both shards green)
- [ ] CI: 14/14 green (backend 6, frontend 7, E2E 2)
- [ ] #155 closed with summary comment

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Decorator breaks existing sync TestClient tests | Double-commit is SQLAlchemy no-op (documented). Verify with full 668-test run. |
| Multi-step service methods (record.create) commit too early | Decorator commits AFTER method returns (after all internal flushes). Single commit at the end = atomic. |
| New service method forgets @transactional | `get_db_session` fallback still commits (late, but commits). Plus code review. |
| E2E factory removal breaks other tests | Factories return same data (id from POST response). Only polling removed, not the POST itself. CI validates. |
| Decorator parameter name mismatch (`db_session` vs `session`) | Decorator inspects signature, finds session param by name. Unit test covers both variants. |
| AsyncClient test reproduces race unreliably | No AsyncClient test — scenario 18 on CI is the async-path regression test. Must pass across multiple CI runs. |

## Out of Scope

- `get_db_session` commit removal — keep as fallback (defense in depth)
- Refactoring repository layer — no changes (flush stays in repo)
- `#124 item 3` (visitor PATCH 422) — separate backend issue, not related to commit timing
- Other E2E skip/fixme tests — only scenario 18 is in scope
