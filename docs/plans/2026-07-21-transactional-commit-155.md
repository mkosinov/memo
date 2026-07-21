# Transactional Commit Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the read-after-write race (#155) by moving the transaction commit from `get_db_session` (after HTTP response) to service write methods (before HTTP response), using a `@transactional` decorator.

**Architecture:** A new `@transactional` decorator commits the session after a service write method returns successfully. This is the Unit of Work pattern (Fowler, PoEAA) — equivalent to Spring's `@Transactional`. The repository layer keeps `flush()` only; the service layer owns the transaction boundary. `get_db_session` retains its commit-after-yield as a defense-in-depth fallback (double-commit is a SQLAlchemy no-op).

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0 async, aiosqlite, pytest, Playwright

---

## Behavioral Delta

How this feature behaves for the user, mapped to spec acceptance criteria:

- **POST /payments → GET /payments/{id} returns 200** → After creating a payment, reading it back immediately succeeds (no 404, no retry). Scenario 18 passes deterministically on CI.
- **All write endpoints commit before response** → Any POST/PUT/PATCH/DELETE followed by a GET on the same resource sees the updated data immediately. No race window.
- **E2E factories no longer poll** → `createTestClient`, `createTestActivity`, `createTestRecord` return immediately after POST (no 5s polling loop). Tests run faster.
- **Existing tests pass unchanged** → The decorator is transparent to existing backend tests (sync TestClient commits synchronously; double-commit is a no-op).

---

## Spec Note: Method Count Correction

The spec listed 20 write methods. Investigation found **22** — two were missed:
- `visit.update_status` (visit.py:124) — does `flush()`, is a write method
- `user_settings.update_by_user_id` (user_settings.py:72) — does `flush()`, is a write method

Both are included in this plan. The spec's acceptance criterion "20 write methods" is updated to "all write methods (22)".

Additionally, `photo.update` (photo.py:102) already has an inline `await db_session.commit()` — the only method with an existing commit. The plan removes this inline commit (replaced by the decorator).

---

## Complete Method Inventory (22 methods, 7 files)

| # | File | Method | Param name | Notes |
|---|------|--------|------------|-------|
| 1 | `services/generic.py` | `create` | `db_session` | Base class |
| 2 | `services/generic.py` | `update` | `db_session` | Base class |
| 3 | `services/generic.py` | `patch` | `db_session` | Base class |
| 4 | `services/generic.py` | `delete` | `db_session` | Base class |
| 5 | `services/generic.py` | `reorder` | `db_session` | Base class |
| 6 | `services/payment.py` | `create` | `db_session` | Calls super().create() |
| 7 | `services/record.py` | `create` | `db_session` | Multi-step (record + visits) |
| 8 | `services/record.py` | `update` | `db_session` | Multi-step |
| 9 | `services/record.py` | `patch` | `db_session` | Multi-step |
| 10 | `services/record.py` | `delete` | `db_session` | Cascade (visits + payments) |
| 11 | `services/service.py` | `create` | `db_session` | Service + tariffs + tags |
| 12 | `services/service.py` | `update` | `db_session` | Service + tariffs + tags |
| 13 | `services/photo.py` | `create` | `db_session` | Photo + tags |
| 14 | `services/photo.py` | `update` | `db_session` | **Remove inline commit at line 102** |
| 15 | `services/visit.py` | `create` | `db_session` | Visit + cascade |
| 16 | `services/visit.py` | `update` | `db_session` | Param is `visit_id` not `id` |
| 17 | `services/visit.py` | `patch` | `db_session` | Param is `visit_id` |
| 18 | `services/visit.py` | `delete` | `db_session` | Param is `visit_id` |
| 19 | `services/visit.py` | `update_status` | `db_session` | Param is `visit_id` |
| 20 | `services/user_settings.py` | `create` | `session` | **Different param name** |
| 21 | `services/user_settings.py` | `update_by_user_id` | `session` | **Different param name** |
| 22 | `services/user_settings.py` | `delete` | `session` | Delegates to repo |

Read-only methods (list, get, get_by_user_id) are NOT decorated — no write to commit.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/src/services/decorators.py` | CREATE | `@transactional` decorator |
| `backend/src/services/generic.py` | MODIFY | Add `@transactional` to 5 base methods |
| `backend/src/services/payment.py` | MODIFY | Add `@transactional` to `create` |
| `backend/src/services/record.py` | MODIFY | Add `@transactional` to 4 methods |
| `backend/src/services/service.py` | MODIFY | Add `@transactional` to 2 methods |
| `backend/src/services/photo.py` | MODIFY | Add `@transactional` to 2 methods, remove inline commit |
| `backend/src/services/visit.py` | MODIFY | Add `@transactional` to 5 methods |
| `backend/src/services/user_settings.py` | MODIFY | Add `@transactional` to 3 methods |
| `backend/tests/test_transactional.py` | CREATE | Unit tests for decorator |
| `frontend/admin/e2e/fixtures/factories.ts` | MODIFY | Remove polling from 3 functions |
| `frontend/admin/e2e/unified-rows.spec.ts` | MODIFY | Un-skip scenario 18 |

---

## Task 1: Create `@transactional` decorator + unit tests

### Classification: standard

### Required Docs
- `docs/specs/2026-07-21-transactional-commit-155-design.md` — design spec, decorator implementation, root cause analysis
- `backend/src/db/database.py` — understand `get_db_session` yield-dependency (the bug being fixed)

### Task Description

Create the `@transactional` decorator in a new file `backend/src/services/decorators.py`, with full TDD unit tests in `backend/tests/test_transactional.py`.

#### Step 1: Write RED tests

Create `backend/tests/test_transactional.py`:

```python
"""Unit tests for the @transactional service decorator.

Tests verify: commit on success, no-commit on exception, double-commit
is safe, works with both `db_session` and `session` parameter names,
works with positional and keyword session args.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from src.services.decorators import transactional


class _MockSession:
    """Minimal async session mock with tracked commit()."""
    def __init__(self):
        self.commit_calls = 0
        self.commit = AsyncMock(side_effect=self._track_commit)

    async def _track_commit(self):
        self.commit_calls += 1


class TestTransactional:
    """Tests for the @transactional decorator."""

    @pytest.mark.asyncio
    async def test_commits_after_success(self):
        """Decorator commits the session after the method returns."""
        session = _MockSession()

        class FakeService:
            @transactional
            async def create(self, db_session, data):
                return {"id": 1, **data}

        svc = FakeService()
        result = await svc.create(db_session=session, data={"name": "test"})

        assert result == {"id": 1, "name": "test"}
        assert session.commit_calls == 1

    @pytest.mark.asyncio
    async def test_does_not_commit_on_exception(self):
        """Decorator does NOT commit when the method raises."""
        session = _MockSession()

        class FakeService:
            @transactional
            async def create(self, db_session, data):
                raise ValueError("boom")

        svc = FakeService()
        with pytest.raises(ValueError, match="boom"):
            await svc.create(db_session=session, data={"name": "test"})

        assert session.commit_calls == 0

    @pytest.mark.asyncio
    async def test_double_commit_is_safe(self):
        """If the method already committed, decorator's commit is a no-op (no error)."""
        session = _MockSession()

        class FakeService:
            @transactional
            async def create(self, db_session, data):
                await db_session.commit()  # method commits internally
                return {"id": 1}

        svc = FakeService()
        result = await svc.create(db_session=session, data={})

        assert result == {"id": 1}
        assert session.commit_calls == 2  # one from method, one from decorator

    @pytest.mark.asyncio
    async def test_works_with_session_param_name(self):
        """Decorator finds session when param is named 'session' (not 'db_session')."""
        session = _MockSession()

        class FakeService:
            @transactional
            async def create(self, session, data):
                return {"id": 1}

        svc = FakeService()
        result = await svc.create(session=session, data={})

        assert result == {"id": 1}
        assert session.commit_calls == 1

    @pytest.mark.asyncio
    async def test_works_with_positional_session(self):
        """Decorator finds session when passed as positional arg."""
        session = _MockSession()

        class FakeService:
            @transactional
            async def create(self, db_session, data):
                return {"id": 1}

        svc = FakeService()
        result = await svc.create(session, {"name": "test"})

        assert result == {"id": 1, "name": "test"}
        assert session.commit_calls == 1

    @pytest.mark.asyncio
    async def test_returns_original_result(self):
        """Decorator preserves the method's return value (ORM, Pydantic, bool, etc.)."""
        session = _MockSession()

        class FakeService:
            @transactional
            async def delete(self, db_session, id):
                return True

        svc = FakeService()
        result = await svc.delete(db_session=session, id="abc")

        assert result is True
        assert session.commit_calls == 1
```

Run the tests — they should FAIL because `src.services.decorators` doesn't exist yet:

```bash
cd backend && uv run pytest tests/test_transactional.py -v
```

Expected: `ImportError: No module named 'src.services.decorators'`

#### Step 2: Implement the decorator (GREEN)

Create `backend/src/services/decorators.py`:

```python
"""Service-layer transaction decorator — Unit of Work pattern.

Commits the session after a service write method returns successfully,
ensuring data is visible BEFORE the HTTP response is sent to the client.

This fixes the read-after-write race caused by get_db_session's
yield-dependency pattern (commit-after-response).

Repository layer does flush() only; service layer owns the transaction
boundary, matching the Unit of Work pattern (Fowler, PoEAA) and
Spring's @Transactional annotation.

Usage:
    from src.services.decorators import transactional

    class MyService:
        @transactional
        async def create(self, db_session, data):
            ...
            return result

Convention: the session must be the first parameter after ``self``
(named ``db_session`` or ``session`` — the decorator inspects the
signature to find it).

On exception: does NOT commit (let get_db_session rollback).
Double-commit is safe: SQLAlchemy treats commit() on an already-committed
session as a no-op (documented behavior).
"""

from __future__ import annotations

import inspect
from functools import wraps


def transactional(func):
    """Decorate an async service method to commit its session after success.

    The decorated method MUST accept its session as the first positional
    argument after ``self`` (regardless of parameter name — ``db_session``,
    ``session``, etc.). The decorator inspects the function signature to
    find the session parameter, commits it after the method returns, then
    returns the result.

    On exception: does NOT commit (let the caller / get_db_session rollback).
    Double-commit is safe: SQLAlchemy treats commit() on an already-committed
    session as a no-op (documented behavior).
    """

    @wraps(func)
    async def wrapper(self, *args, **kwargs):
        result = await func(self, *args, **kwargs)
        # Find the session parameter: first positional after self, or
        # a keyword arg matching the parameter name from the signature.
        sig = inspect.signature(func)
        param_names = list(sig.parameters.keys())
        session_name = param_names[1]  # [0]='self', [1]=session

        if session_name in kwargs:
            session = kwargs[session_name]
        elif args:
            session = args[0]
        else:
            raise TypeError(
                f"@transactional: session parameter '{session_name}' "
                f"not found in call to {func.__name__}"
            )
        await session.commit()
        return result

    return wrapper
```

Run the tests — they should PASS:

```bash
cd backend && uv run pytest tests/test_transactional.py -v
```

Expected: `6 passed`

#### Step 3: Verify no import breakage

```bash
cd backend && uv run python -c "from src.services.decorators import transactional; print('import ok')"
```

Expected: `import ok`

#### Step 4: Commit

```bash
git add backend/src/services/decorators.py backend/tests/test_transactional.py
git commit -m "feat(#155): add @transactional decorator + unit tests

Unit of Work pattern — commits session after service write method
returns, fixing read-after-write race (GET 404 after POST).

Tests: commit-on-success, no-commit-on-exception, double-commit-safe,
session-param-name, positional-arg, return-value-preserved."
```

### DoD
- [ ] `backend/src/services/decorators.py` created with `transactional` decorator
- [ ] `backend/tests/test_transactional.py` created with 6 unit tests
- [ ] All 6 tests pass (`uv run pytest tests/test_transactional.py -v`)
- [ ] Import works: `from src.services.decorators import transactional`

---

## Task 2: Apply `@transactional` to all 22 write methods

### Classification: standard

### Required Docs
- `docs/specs/2026-07-21-transactional-commit-155-design.md` — design spec, method inventory table
- `backend/src/services/decorators.py` — the decorator (from Task 1)
- `backend/src/services/generic.py` — base class (5 methods to decorate)
- `backend/src/services/payment.py` — override (1 method)
- `backend/src/services/record.py` — override (4 methods, multi-step)
- `backend/src/services/service.py` — override (2 methods)
- `backend/src/services/photo.py` — override (2 methods, REMOVE inline commit)
- `backend/src/services/visit.py` — override (5 methods, including update_status)
- `backend/src/services/user_settings.py` — override (3 methods, uses `session` not `db_session`)

### Task Description

Apply the `@transactional` decorator to all 22 write methods across 7 service files. This is a mechanical change: add the import, add the decorator above each write method. Also remove the existing inline `await db_session.commit()` from `photo.update` (replaced by the decorator).

**IMPORTANT:** Read-only methods (list, get, get_by_user_id) do NOT get `@transactional`.

#### Step 1: Apply to `services/generic.py` (5 methods)

Add import at the top:
```python
from src.services.decorators import transactional
```

Decorate 5 methods: `create`, `update`, `patch`, `delete`, `reorder`.

Example (create):
```python
    @transactional
    async def create(
        self, db_session: AsyncSession, data: CreateSchemaT
    ) -> ResponseSchemaT:
        """Create a new record from a validated create schema."""
        orm = await self._repository.create(db_session, data, self._model)
        return self._response_schema.model_validate(orm)
```

Apply the same `@transactional` decorator to `update`, `patch`, `delete`, `reorder`.

**Do NOT decorate** `list` or `get` (read-only).

#### Step 2: Apply to `services/payment.py` (1 method)

Add import:
```python
from src.services.decorators import transactional
```

Decorate `create`:
```python
    @transactional
    async def create(
        self, db_session: AsyncSession, data: PaymentCreate
    ) -> PaymentResponse:
        if data.created_at is None:
            data = data.model_copy(update={"created_at": datetime.utcnow()})
        return await super().create(db_session, data)
```

Note: `super().create()` is also decorated (from generic.py). The super's decorator commits first, then this override's decorator commits again (no-op). This is safe and documented.

#### Step 3: Apply to `services/record.py` (4 methods)

Add import:
```python
from src.services.decorators import transactional
```

Decorate `create`, `update`, `patch`, `delete`.

**Do NOT decorate** `list`, `get`, `_resolve_client_by_phone`, `_resolve_visitor_by_name` (read-only / private helpers).

Example (delete):
```python
    @transactional
    async def delete(self, db_session: AsyncSession, id: str) -> bool:
        """Soft-delete a record and hard-delete its visits and payments."""
        record = await self._repository.get(db_session, Record, id)
        if not record or not record.is_active:
            return False
        await db_session.execute(delete(Visit).where(Visit.record_id == id))
        await db_session.execute(delete(Payment).where(Payment.record_id == id))
        record.is_active = False
        await db_session.flush()
        return True
```

#### Step 4: Apply to `services/service.py` (2 methods)

Add import:
```python
from src.services.decorators import transactional
```

Decorate `create` and `update`.

**Do NOT decorate** `list`, `get` (read-only).

#### Step 5: Apply to `services/photo.py` (2 methods + remove inline commit)

Add import:
```python
from src.services.decorators import transactional
```

Decorate `create` and `update`.

**CRITICAL:** In `update` method (around line 102), REMOVE the existing inline commit:
```python
# REMOVE THIS LINE:
await db_session.commit()
```

The decorator now handles the commit. Keeping the inline commit would be a double-commit (safe but confusing for future developers).

**Do NOT decorate** `list`, `get` (read-only).

#### Step 6: Apply to `services/visit.py` (5 methods)

Add import:
```python
from src.services.decorators import transactional
```

Decorate `create`, `update`, `patch`, `delete`, `update_status`.

**Do NOT decorate** `list`, `get` (read-only).

Example (update_status):
```python
    @transactional
    async def update_status(
        self, db_session: AsyncSession, visit_id: str, status: str,
    ) -> Visit | None:
        visit = await self.get(db_session, visit_id)
        if not visit:
            return None
        visit.status = status
        visit.updated_at = datetime.now(UTC)
        await recompute_record_status(db_session, visit.record_id)
        await db_session.flush()
        await db_session.refresh(visit)
        return visit
```

#### Step 7: Apply to `services/user_settings.py` (3 methods)

Add import:
```python
from src.services.decorators import transactional
```

Decorate `create`, `update_by_user_id`, `delete`.

**Do NOT decorate** `get_by_user_id` (read-only).

Note: These methods use `session` as the parameter name (not `db_session`). The decorator inspects the signature to find it — this is tested in Task 1 (`test_works_with_session_param_name`).

Example (create):
```python
    @transactional
    async def create(
        self, session: AsyncSession, data: UserSettingsCreate
    ) -> UserSettingsResponse:
        orm = UserSettings(
            user_id=data.user_id,
            theme=data.theme,
            language=data.language,
            column_order_masters=json.dumps(data.column_order_masters),
            column_order_locations=json.dumps(data.column_order_locations),
        )
        session.add(orm)
        await session.flush()
        await session.refresh(orm)
        return _to_response(orm)
```

#### Step 8: Run full backend test suite

```bash
cd backend && uv run pytest -x -q
```

Expected: `668 passed` (same as baseline, no regressions). The decorator's commit is a no-op for sync TestClient tests (transaction already committed synchronously in the test's call stack).

If any test FAILS — investigate. Most likely cause: a test that relies on the commit happening AFTER the response (unlikely, but possible if a test does a write and then checks uncommitted state within the same session).

#### Step 9: Verify type-check / imports

```bash
cd backend && uv run python -c "
from src.services.generic import GenericService
from src.services.payment import PaymentService
from src.services.record import RecordService
from src.services.service import ServiceService
from src.services.photo import PhotoService
from src.services.visit import VisitService
from src.services.user_settings import UserSettingsService
print('all imports ok')
"
```

Expected: `all imports ok`

#### Step 10: Commit

```bash
git add backend/src/services/generic.py backend/src/services/payment.py backend/src/services/record.py backend/src/services/service.py backend/src/services/photo.py backend/src/services/visit.py backend/src/services/user_settings.py
git commit -m "fix(#155): apply @transactional to all 22 write methods

Moves commit boundary from get_db_session (after HTTP response) to
service layer (before HTTP response). Fixes read-after-write race:
GET /payments/{id} 404 after POST.

7 files, 22 methods decorated. Removed inline commit from
photo.update (now handled by decorator).

Full backend suite: 668 passed, 0 regressions."
```

### DoD
- [ ] All 22 write methods across 7 service files decorated with `@transactional`
- [ ] `photo.update` inline `await db_session.commit()` removed
- [ ] Read-only methods (list, get, get_by_user_id) NOT decorated
- [ ] Full backend test suite passes: `668 passed`
- [ ] All service imports work without errors

---

## Task 3: Remove E2E factory polling workarounds

### Classification: small

### Required Docs
- `docs/specs/2026-07-21-transactional-commit-155-design.md` — E2E factory cleanup section
- `frontend/admin/e2e/fixtures/factories.ts` — the 3 functions with polling to remove

### Task Description

Remove the `expect.poll` retry blocks from 3 factory functions in `frontend/admin/e2e/fixtures/factories.ts`. After the backend fix, POST returns the created entity with its id, and the data is immediately visible to subsequent GETs — no polling needed.

#### Step 1: Remove polling from `createTestClient` (lines ~44-54)

Remove the entire `expect.poll` block:
```typescript
  // REMOVE THIS BLOCK:
  // Verify the new client is queryable before returning.
  // The backend's get_db_session commits in the finally block — AFTER the
  // HTTP response is sent. Without this, page.goto('/clients') can trigger
  // a GET that arrives before the commit is visible, returning stale data.
  await expect
    .poll(
      async () => {
        const listResp = await api.get(`${BACKEND}/api/v1/clients?per_page=100`);
        const list = await listResp.json();
        const items = list.items || list;
        return items.some((c: any) => c.id === client.id);
      },
      { timeout: 5_000, intervals: [50, 100, 200, 500] },
    )
    .toBe(true);
```

After removal, the function is simply:
```typescript
export async function createTestClient(
  api: APIRequestContext,
  overrides?: { name?: string; phone?: string },
) {
  const name = overrides?.name || `Test Client ${uid()}`;
  const phone = overrides?.phone || `+7999${String(Date.now()).slice(-7)}`;
  const resp = await api.post(`${BACKEND}/api/v1/clients`, {
    data: { name, phone, channel: 'telegram' },
  });
  expect(resp.ok()).toBeTruthy();
  return await resp.json();
}
```

#### Step 2: Remove polling from `createTestActivity` (lines ~92-101)

Remove the `expect.poll` block + the comment "Verify the new activity is queryable before returning (commit-race fix)."

After removal, the function ends with:
```typescript
  expect(resp.ok()).toBeTruthy();
  return await resp.json();
```

#### Step 3: Remove polling from `createTestRecord` (lines ~130-140)

Remove the `expect.poll` block + the comment "Verify the new record is queryable before returning (commit-race fix)."

After removal, the function ends with:
```typescript
  expect(resp.ok()).toBeTruthy();
  return await resp.json();
```

#### Step 4: Remove unused import (if applicable)

Check if `expect` is still used in factories.ts after removing the 3 `expect.poll` blocks. The `expect(resp.ok()).toBeTruthy()` calls still use `expect`. If `expect` is no longer needed, remove it from the import. If still needed, keep it.

Current import: `import { type APIRequestContext, expect } from '@playwright/test';`

After removal, `expect` is still used for `expect(resp.ok()).toBeTruthy()`. Keep the import.

#### Step 5: Verify type-check

```bash
cd frontend/admin && npx tsc --noEmit
```

Expected: no errors

#### Step 6: Commit

```bash
git add frontend/admin/e2e/fixtures/factories.ts
git commit -m "refactor(#155): remove E2E factory polling workarounds

Backend @transactional decorator guarantees write visibility before
response. The expect.poll retry blocks in createTestClient,
createTestActivity, createTestRecord are now dead code — removed."
```

### DoD
- [ ] `expect.poll` blocks removed from `createTestClient`, `createTestActivity`, `createTestRecord`
- [ ] Stale comments about commit-race removed
- [ ] `expect` import retained (still used for `expect(resp.ok()).toBeTruthy()`)
- [ ] Type-check passes: `npx tsc --noEmit`

---

## Task 4: Un-skip scenario 18

### Classification: trivial

### Required Docs
- `docs/specs/2026-07-21-transactional-commit-155-design.md` — scenario 18 un-skip section
- `frontend/admin/e2e/unified-rows.spec.ts` — scenario 18 (around line 855)

### Task Description

Un-skip scenario 18 in `frontend/admin/e2e/unified-rows.spec.ts`. This is the regression test for #155 — it does POST /payments → GET /payments/{id} and asserts 200. After the backend fix, this passes deterministically.

#### Step 1: Read the current skip annotation

Find the test around line 855:
```typescript
  test.skip(true, 'pre-existing backend flake (GH #155): GET /payments/{id} non-OK immediately after POST — backend commits in get_db_session AFTER response sent, so GET arrives before commit is visible. Fixed by @transactional decorator on service write methods.');
  test('scenario 18: hard delete removes payment from stats', async ({ request }) => {
```

#### Step 2: Remove the skip line

Delete the `test.skip(true, ...)` line. The test declaration stays as `test(...)`.

#### Step 3: Verify type-check

```bash
cd frontend/admin && npx tsc --noEmit
```

Expected: no errors

#### Step 4: Commit

```bash
git add frontend/admin/e2e/unified-rows.spec.ts
git commit -m "test(#155): un-skip scenario 18 — read-after-write fixed

POST /payments → GET /payments/{id} now returns 200 deterministically.
@transactional decorator commits before HTTP response is sent."
```

### DoD
- [ ] `test.skip(true, '#155 ...')` line removed from scenario 18
- [ ] Test declaration is `test('scenario 18: ...')` (not `test.skip` or `test.fixme`)
- [ ] Type-check passes

---

## Execution Notes

### Test verification commands

| Layer | Command | Expected |
|-------|---------|----------|
| Decorator unit tests | `cd backend && uv run pytest tests/test_transactional.py -v` | 6 passed |
| Full backend suite | `cd backend && uv run pytest -x -q` | 668 passed |
| Frontend type-check | `cd frontend/admin && npx tsc --noEmit` | no errors |
| Frontend vitest | `cd frontend/admin && npx vitest run` | 1194 passed |
| E2E scenario 18 | CI shard-rest | pass (deterministic) |
| CI all checks | PR CI | 14/14 green |

### Risk mitigations

- **Backend tests break**: The decorator's commit is a no-op for sync TestClient (transaction already committed in sync call stack). If any test breaks, it likely relied on uncommitted state — investigate individually.
- **Double-commit in PaymentService.create**: `super().create()` decorator commits, then override's decorator commits again (no-op). Safe per SQLAlchemy docs. If this causes issues, remove `@transactional` from `PaymentService.create` (the super's decorator handles it).
- **E2E factory removal breaks tests**: Factories return the same data (id from POST response). Only polling removed. If an E2E test breaks, it was relying on the polling delay for timing — investigate individually.

### Post-merge

- Close #155 with summary comment
- Update `docs/domain-rules/payments.md` if any business logic changed (none expected — this is infrastructure)
- Update scratchpad with completion status
