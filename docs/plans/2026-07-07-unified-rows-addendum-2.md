# Unified Rows Addendum-2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 bugs from live-test round 2: (C) no-F5-needed cache sync after add/delete, (D) tariff dropdown empty in modal, (E) hard-delete Payment+Visit + Undo toast.

**Architecture:** Backend switches Payment/Visit from soft-delete to hard-delete via a model hierarchy split (`AbstractModel` → `AbstractModelSoftDelete`) and a repository split (`BaseRepository`/`SoftDeleteRepository`). Frontend adds optimistic `setQueryData` for cache sync, exposes `servicesRaw` from ScheduleContext for tariff lookup, and implements a deferred-delete Undo toast pattern using the existing `useUI.showToast` undo support.

**Tech Stack:** FastAPI + SQLAlchemy (async), Pydantic, Alembic, React + Next.js, TanStack React Query, Zod, Vitest, Playwright.

**Spec:** `docs/specs/2026-06-25-inline-editable-table-unified-rows-design.md` → `## Addendum 2`

---

## Behavioral Delta

How this feature behaves for the user, mapped to spec acceptance criteria:

- **No F5 after add (scenario 15)** → After adding a visitor or payment, switching to another tab in the modal and back shows the new row immediately — no page reload needed.
- **No F5 after delete (scenario 16)** → After deleting a visitor or payment, switching tabs and back shows the row still gone — it does not reappear.
- **Tariff dropdown populated (scenario 17)** → Opening a record's modal → visitors → "+ Добавить" shows the service's actual tariffs in the dropdown; selecting one fills the price.
- **Hard delete removes from stats (scenario 18)** → Deleting a payment makes the client's `total_paid` decrease immediately; the payment is physically gone (GET by id → 404).
- **Undo delete (scenario 19)** → Clicking × on a saved payment/visit removes the row and shows "Удалено. Отменить" toast for ~5s; clicking "Отменить" restores the row with no server call; letting the toast expire sends the hard DELETE.

---

## File Structure

### Backend — files to modify:
- `backend/src/models/abstract.py` — split into `AbstractModel` + `AbstractModelSoftDelete`
- `backend/src/models/visit.py` — change parent to `AbstractModel`
- `backend/src/models/payment.py` — change parent to `AbstractModel`
- `backend/src/repositories/generic.py` — split into `BaseRepository` + `SoftDeleteRepository`
- `backend/src/services/generic.py` — adapt (no change needed — uses repo interface)
- `backend/src/services/visit.py` — hard delete in `delete()`, drop `is_active` filter in `list()`
- `backend/src/services/payment.py` — use `BaseRepository`, override `delete()` for hard delete
- `backend/src/services/record.py` — cascade hard-delete in `delete()`, `update()`, `patch()`
- `backend/src/services/client.py` — no query change needed (hard-delete fixes stats by design)
- `backend/src/domain/record_visits.py` — drop `Visit.is_active` filter in both recompute functions
- `backend/src/schemas/visit.py` — remove `is_active` from `VisitResponse`
- `backend/src/schemas/payment.py` — remove `is_active` from `PaymentResponse`
- `backend/src/api/v1/records.py` — remove `is_active` from `_map_record`
- `backend/alembic/versions/<new>_hard_delete_visit_payment.py` — migration: DROP COLUMN is_active
- `backend/tests/` — update all tests referencing visit/payment `is_active`

### Frontend — files to modify:
- `packages/api-client/src/schemas.ts` — remove `is_active` from `VisitResponseSchema` + `PaymentResponseSchema`
- `frontend/admin/hooks/useRecordMutations.ts` — optimistic `setQueryData` (Bug C) + deferred delete with undo (Bug E)
- `frontend/admin/contexts/ScheduleContext.tsx` — expose `servicesRaw` in context type + value (Bug D)
- `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx` — use `servicesRaw` for tariff lookup (Bug D)
- `frontend/admin/contexts/UIContext.tsx` — extend toast undo timeout to 5000ms (Bug E)
- `frontend/admin/__tests__/useRecordMutations.test.ts` — update mock data + add tests
- `frontend/admin/e2e/unified-rows.spec.ts` — scenarios 15-19, remove `v.is_active` from raw SQL
- `frontend/admin/e2e/activity-details-modal.spec.ts` — remove `is_active` from visit/payment raw SQL

---

## Task 1: Backend — Model hierarchy + Repo split + Hard delete + Migration + Schema + Test updates

### Classification: large

### Required Docs
- `docs/specs/2026-06-25-inline-editable-table-unified-rows-design.md` → `## Addendum 2` sections C, E — full spec of hard-delete decision, model hierarchy, repo split
- `docs/domain-rules/visits.md` — entity fields, status semantics
- `docs/domain-rules/payments.md` — entity fields, create/update rules

### Context
This is the largest task in Addendum-2. Payment and Visit are leaf tables (no FK references) — soft-delete is unnecessary and caused deleted payments to still count in client stats. The user decided: HARD delete these two; ALL other entities keep soft-delete. The implementation requires a coordinated change across models → repositories → services → schemas → migration → tests, all landing in one commit (tests pass only when all pieces are in place).

### Model hierarchy (user decision):
```python
# abstract.py
class AbstractModel(Base):
    __abstract__ = True
    id: Mapped[str]              # UUID PK
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]

class AbstractModelSoftDelete(AbstractModel):
    __abstract__ = True
    is_active: Mapped[bool]      # soft-delete flag
```
- Payment, Visit → inherit `AbstractModel` (NO `is_active` column)
- All 13 soft-delete entities → inherit `AbstractModelSoftDelete`
- Name stays `AbstractModel` (not renamed)

### Repository split (user decision):
```python
# repositories/generic.py
class BaseRepository:
    async def list(...):            # NO is_active filter
    async def get(...):             # by id, any state
    async def create(...):
    async def update(...):
    async def patch(...):
    async def delete(...):          # HARD delete via session.delete(instance)
    async def reorder(...):         # sort_order, no is_active check

class SoftDeleteRepository(BaseRepository):
    async def list(..., include_inactive=False):  # filter is_active=True unless include_inactive
    async def delete(...):           # soft-delete: is_active=False
    async def reorder(...):          # check is_active before update
```
- `get_base_repository()` → `BaseRepository` singleton
- `get_soft_delete_repository()` → `SoftDeleteRepository` singleton
- Keep `get_generic_repository()` as alias to `get_soft_delete_repository()` (backward-compat for any missed references)
- Payment/Visit services → `get_base_repository()`
- ALL other services → `get_soft_delete_repository()` (13 entities)

### Schema change (migration):
- Alembic head: `4d5e6f7a8b9c`
- New migration: `DROP COLUMN is_active FROM payments` + `DROP COLUMN is_active FROM visits`
- SQLite: use `batch_alter_table` (Alembic requirement for SQLite ALTER)
- `down_revision = '4d5e6f7a8b9c'`

### Steps

- [ ] **1a. Write the migration file**
  Create `backend/alembic/versions/a1b2c3d4e5f6_hard_delete_visit_payment.py`:
  ```python
  """Hard delete: drop is_active from visits and payments.

  Revision ID: a1b2c3d4e5f6
  Revises: 4d5e6f7a8b9c
  """
  from alembic import op
  import sqlalchemy as sa

  revision = 'a1b2c3d4e5f6'
  down_revision = '4d5e6f7a8b9c'

  def upgrade():
      with op.batch_alter_table('visits', schema=None) as batch_op:
          batch_op.drop_column('is_active')
      with op.batch_alter_table('payments', schema=None) as batch_op:
          batch_op.drop_column('is_active')

  def downgrade():
      with op.batch_alter_table('visits', schema=None) as batch_op:
          batch_op.add_column(sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')))
      with op.batch_alter_table('payments', schema=None) as batch_op:
          batch_op.add_column(sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')))
  ```

- [ ] **1b. Split AbstractModel in `backend/src/models/abstract.py`**
  ```python
  import uuid
  from datetime import datetime
  from sqlalchemy import DateTime, String
  from sqlalchemy.orm import Mapped, mapped_column
  from src.db.base import Base

  class AbstractModel(Base):
      __abstract__ = True
      id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
      created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
      updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

  class AbstractModelSoftDelete(AbstractModel):
      __abstract__ = True
      from sqlalchemy import Boolean
      is_active: Mapped[bool] = mapped_column(Boolean, default=True)
  ```
  Note: import `Boolean` at module top, not inside the class.

- [ ] **1c. Update Visit model — `backend/src/models/visit.py`**
  Change: `from src.models.abstract import AbstractModel` (already imports AbstractModel). Already inherits `AbstractModel`. No change needed — Visit already inherits `AbstractModel` directly. It will now NOT have `is_active` (since `is_active` moved to `AbstractModelSoftDelete`). ✅

- [ ] **1d. Update Payment model — `backend/src/models/payment.py`**
  Already inherits `AbstractModel` directly. Same as Visit — no change needed. ✅

- [ ] **1e. Update ALL soft-delete models to inherit `AbstractModelSoftDelete`**
  Search for all models that currently inherit `AbstractModel` and change to `AbstractModelSoftDelete`:
  - `client.py`: `class Client(AbstractModelSoftDelete)`
  - `service.py`: `class Service(AbstractModelSoftDelete)`
  - `master.py`: `class Master(AbstractModelSoftDelete)`
  - `location.py`: `class Location(AbstractModelSoftDelete)`
  - `activity.py`: `class Activity(AbstractModelSoftDelete)`
  - `record.py`: `class Record(AbstractModelSoftDelete)`
  - `visitor.py`: `class Visitor(AbstractModelSoftDelete)`
  - `material.py`: `class Material(AbstractModelSoftDelete)`
  - `tag.py`: `class Tag(AbstractModelSoftDelete)`
  - `photo.py`: `class Photo(AbstractModelSoftDelete)`
  - `user.py`: `class User(AbstractModelSoftDelete)`
  - `tariff.py`: `class Tariff(AbstractModelSoftDelete)`
  - `user_settings.py`: `class UserSettings(AbstractModelSoftDelete)`
  Update the import in each file: `from src.models.abstract import AbstractModelSoftDelete`
  **Do NOT touch** `visit.py` and `payment.py` — they keep `AbstractModel`.

- [ ] **1f. Split repository — `backend/src/repositories/generic.py`**
  ```python
  from __future__ import annotations
  from functools import lru_cache
  from typing import TypeVar
  from pydantic import BaseModel
  from sqlalchemy import select
  from sqlalchemy.ext.asyncio import AsyncSession
  from src.db.base import Base

  ModelType = TypeVar("ModelType", bound=Base)

class BaseRepository:
      \"\"\"Stateless repository for ANY model — no soft-delete logic.\"\"\"

      async def list(self, session, table, order_by=None, **filters):
          stmt = select(table)
          for key, value in filters.items():
              if value is not None:
                  stmt = stmt.where(getattr(table, key) == value)
          if order_by is not None:
              stmt = stmt.order_by(*order_by)
          result = await session.execute(stmt)
          return list(result.scalars().all())

      # get(), create(), update(), patch() — COPY VERBATIM from current
      # GenericRepository (lines 41-84 of generic.py). Do NOT change them.
      async def get(self, session, table, id):
          result = await session.execute(select(table).where(table.id == id))
          return result.scalar_one_or_none()
      async def create(self, session, obj, table):
          instance = table(**obj.model_dump())
          session.add(instance)
          await session.flush()
          await session.refresh(instance)
          return instance
      async def update(self, session, table, id, obj):
          instance = await self.get(session, table, id)
          if not instance:
              return None
          for key, value in obj.model_dump().items():
              setattr(instance, key, value)
          await session.flush()
          await session.refresh(instance)
          return instance
      async def patch(self, session, table, id, data):
          instance = await self.get(session, table, id)
          if not instance:
              return None
          for key, value in data.items():
              setattr(instance, key, value)
          await session.flush()
          await session.refresh(instance)
          return instance

      async def delete(self, session, table, id) -> bool:
          """Hard delete — physically remove the row. Returns False if not found."""
          instance = await self.get(session, table, id)
          if not instance:
              return False
          await session.delete(instance)
          await session.flush()
          return True

      async def reorder(self, session, table, ids):
          # no is_active check — any matching id gets sort_order updated
          updated = []
          for idx, record_id in enumerate(ids):
              instance = await self.get(session, table, record_id)
              if instance:
                  instance.sort_order = idx
                  await session.flush()
                  await session.refresh(instance)
                  updated.append(instance)
          return updated

  class SoftDeleteRepository(BaseRepository):
      """Repository for soft-deletable models — adds is_active filtering."""

      async def list(self, session, table, order_by=None, include_inactive=False, **filters):
          stmt = select(table)
          if not include_inactive and hasattr(table, 'is_active'):
              stmt = stmt.where(table.is_active)
          for key, value in filters.items():
              if value is not None:
                  stmt = stmt.where(getattr(table, key) == value)
          if order_by is not None:
              stmt = stmt.order_by(*order_by)
          result = await session.execute(stmt)
          return list(result.scalars().all())

      async def delete(self, session, table, id) -> bool:
          instance = await self.get(session, table, id)
          if not instance or not instance.is_active:
              return False
          instance.is_active = False
          await session.flush()
          return True

      async def reorder(self, session, table, ids):
          updated = []
          for idx, record_id in enumerate(ids):
              instance = await self.get(session, table, record_id)
              if instance and instance.is_active:
                  instance.sort_order = idx
                  await session.flush()
                  await session.refresh(instance)
                  updated.append(instance)
          return updated

  @lru_cache
  def get_base_repository() -> BaseRepository:
      return BaseRepository()

  @lru_cache
  def get_soft_delete_repository() -> SoftDeleteRepository:
      return SoftDeleteRepository()

  @lru_cache
  def get_generic_repository() -> SoftDeleteRepository:
      """Backward-compat alias. Prefer get_soft_delete_repository()."""
      return get_soft_delete_repository()
  ```
  Note: the `hasattr(table, 'is_active')` guard in `SoftDeleteRepository.list` is defense against accidental assignment of a non-soft-delete model. It should never fire (soft-delete repos are only assigned to soft-delete entities) but prevents a hard crash if someone makes that mistake.

- [ ] **1g. Update service factory functions**
  Throughout `backend/src/services/*.py`, update factory functions:
  - `activity.py:96` → `get_soft_delete_repository()`
  - `client.py:29` → `get_soft_delete_repository()`
  - `location.py:13` → `get_soft_delete_repository()`
  - `master.py:13` → `get_soft_delete_repository()`
  - `material.py:13` → `get_soft_delete_repository()`
  - `photo.py:110` → `get_soft_delete_repository()`
  - `record.py:284` → `get_soft_delete_repository()`
  - `service.py:119` → `get_soft_delete_repository()`
  - `tag.py:13` → `get_soft_delete_repository()`
  - `user_settings.py:117` → `get_soft_delete_repository()`
  - `visitor.py:38` → `get_soft_delete_repository()`
  - `payment.py:43` → `get_base_repository()`
  - `visit.py` → uses custom queries (no factory change, but update delete + list)
  Import: `from src.repositories.generic import get_soft_delete_repository, get_base_repository`

- [ ] **1h. Update `backend/src/services/visit.py`**
  - `list()` line 34: remove `Visit.is_active.is_(True)` filter. Now: `select(Visit).where(Visit.record_id == record_id)` (or just `select(Visit)` if record_id is None).
  - `delete()` line 110-125: replace soft-delete with hard delete:
    ```python
    async def delete(self, db_session, visit_id) -> bool:
        visit = await self.get(db_session, visit_id)
        if not visit:
            return False
        await db_session.delete(visit)
        await db_session.flush()
        await recompute_record_status(db_session, visit.record_id)
        await recompute_record_seats(db_session, visit.record_id)
        await db_session.flush()
        return True
    ```
    Remove `visit.is_active = False` and `visit.updated_at = ...`.

- [ ] **1i. Update `backend/src/services/payment.py`**
  PaymentService extends `GenericService`. Since it now uses `BaseRepository`, `self._repository.delete()` will hard-delete. BUT `GenericService.delete()` delegates to `self._repository.delete()` — that already works with `BaseRepository`.
  HOWEVER: `GenericService.patch()` calls `self._repository.patch()` which calls `setattr` — fine for Payment (no is_active).
  The `create()` override stays (explicit `created_at` default).
  One issue: `PaymentResponse` schema still has `is_active` → `model_validate` will fail (ORM no longer has `is_active`).
  Fix: remove `is_active` from `PaymentResponse` (step 1l below) — this is a coordinated change.

- [ ] **1j. Update `backend/src/services/record.py`**
  - `delete()` lines 68-79: cascade hard-delete visits and payments:
    ```python
    await db_session.execute(
        delete(Visit).where(Visit.record_id == id)
    )
    await db_session.execute(
        delete(Payment).where(Payment.record_id == id)
    )
    ```
    Import: `from sqlalchemy import delete` (add to existing `from sqlalchemy import select, update`).
    Remove `Visit.is_active.is_(True)` and `Payment.is_active.is_(True)` filters — all visits/payments for this record are deleted.
    Keep `record.is_active = False` (Record stays soft-delete).
  - `update()` lines 212-213: replace `existing_visit.is_active = False` with hard delete:
    ```python
    for existing_visit in list(record.visits):
        await db_session.delete(existing_visit)
    ```
    Use `list(record.visits)` to avoid modifying the collection while iterating.
  - `patch()` lines 257-258: same pattern — hard delete existing visits:
    ```python
    for existing_visit in list(record.visits):
        await db_session.delete(existing_visit)
    ```

- [ ] **1k. Update `backend/src/domain/record_visits.py`**
  - `recompute_record_seats()` line 38: remove `Visit.is_active.is_(True)` filter. Now:
    ```python
    select(func.count()).select_from(Visit).where(Visit.record_id == record_id)
    ```
  - `recompute_record_status()` line 63: remove `Visit.is_active.is_(True)` filter. Now:
    ```python
    select(Visit).where(Visit.record_id == record_id)
    ```

- [ ] **1l. Remove `is_active` from schemas**
  - `backend/src/schemas/visit.py` line 64: remove `is_active: bool` from `VisitResponse`.
  - `backend/src/schemas/payment.py` line 53: remove `is_active: bool` from `PaymentResponse`.

- [ ] **1m. Remove `is_active` from `api/v1/records.py` `_map_record`**
  - Line 51: remove `is_active=v.is_active,`
  - Line 54: remove `if v.is_active` filter (all visits loaded are now live — no soft-deleted ones in the relationship).

- [ ] **1n. Update backend tests**
  Remove/disable all `is_active` assertions on Visit and Payment in:
  - `backend/tests/test_api_visits.py:90` — remove `assert data["is_active"] is True` (field gone from response).
  - `backend/tests/test_api_visits.py:278-283` — change "After DELETE, is_active=False at DB level" to "After DELETE, row is absent from DB":
    ```python
    rows = query_db(f"SELECT * FROM visits WHERE id='{visit_id}'")
    assert len(rows) == 0
    ```
  - `backend/tests/test_api_payments.py:105` — remove `assert body["is_active"] is True`.
  - `backend/tests/test_api_payments.py:166` — change from asserting `is_active is False` to asserting 404 on GET after delete (hard delete means row is gone):
    ```python
    response = await client.get(f"/api/v1/payments/{payment_id}")
    assert response.status_code == 404
    ```
  - `backend/tests/services/test_visit_service.py:97-105` — change test from "is_active=False" to "row absent":
    ```python
    assert sample_visit not in db_session  # or: query DB, assert no row
    ```
  - `backend/tests/test_record_visits.py:11,23` — remove `v.is_active` filters:
    ```python
    assert record.seats == len(sample_record.visits) + sample_record.anonym_visits
    ```
  - `backend/tests/test_integration_flows.py:129,155,192,206,215,234,240` — remove `is_active=1` from raw SQL queries for visits/payments. Replace `WHERE ... AND is_active=1` with just `WHERE record_id=...`.

- [ ] **1o. Run backend tests**
  ```bash
  cd backend && python -m pytest -x -q 2>&1 | tail -30
  ```
  All visit/payment tests must pass. Soft-delete tests for other entities must pass (they still have is_active via AbstractModelSoftDelete).

- [ ] **1p. Commit**
  ```bash
  git add -A && git commit -m "feat(backend): hard-delete Payment+Visit, repo split, model hierarchy, migration

  - Split AbstractModel → AbstractModel + AbstractModelSoftDelete
  - Payment/Visit inherit AbstractModel (no is_active column)
  - 13 soft-delete entities inherit AbstractModelSoftDelete
  - Split GenericRepository → BaseRepository + SoftDeleteRepository
  - Payment uses BaseRepository (hard delete), others use SoftDeleteRepository
  - VisitService.delete: hard delete via session.delete()
  - RecordService.delete/update/patch: cascade hard-delete visits+payments
  - record_visits.py: drop is_active filter from recompute functions
  - Schemas: remove is_active from VisitResponse + PaymentResponse
  - Migration: DROP COLUMN is_active from visits + payments
  - Tests: update all visit/payment is_active assertions"
  ```

### DoD
- [ ] Backend tests pass: `cd backend && python -m pytest -q`
- [ ] Migration runs: `alembic upgrade head` succeeds (tested via conftest)
- [ ] No `is_active` references remain on Visit/Payment in backend code (grep clean)
- [ ] Soft-delete still works for all 13 other entities (test_api_clients, test_api_visitors, etc. pass)

---

## Task 2: Frontend — Remove is_active from Zod schemas + test fixtures

### Classification: small

### Required Docs
- `docs/specs/2026-06-25-inline-editable-table-unified-rows-design.md` → `## Addendum 2` section E
- `.opencode/skills/vitest-playwright-patterns/SKILL.md` — frontend test patterns

### Context
Backend no longer returns `is_active` on Visit/Payment responses. The Zod schemas must drop the field, and test mock data must be updated. This is a mechanical change — remove one field from two schemas + update mock objects in test files.

### Steps

- [ ] **2a. Remove `is_active` from Zod schemas — `packages/api-client/src/schemas.ts`**
  - Line 208: remove `is_active: z.boolean(),` from `VisitResponseSchema`
  - Line 314: remove `is_active: z.boolean(),` from `PaymentResponseSchema`
  Keep all other `is_active` lines (they're on Service, Client, Record, Activity, etc. — still soft-delete).

- [ ] **2b. Update frontend test mock data**
  - `frontend/admin/__tests__/useRecordMutations.test.ts`:
    - Line 92: remove `is_active: true,` from `mockPaymentResponse`
    - Line 105: remove `is_active: true,` from `mockVisitResponse`
    - Keep line 71 (Record is_active) and line 82 (Visitor is_active) — those entities stay soft-delete.
  - Search ALL `frontend/admin/__tests__/` + `frontend/admin/e2e/fixtures/` for mock Visit/Payment objects with `is_active` and remove the field from those specific mocks. Use:
    ```bash
    grep -rn "is_active" frontend/admin/__tests__/ frontend/admin/e2e/fixtures/ | grep -i "visit\|payment"
    ```
    to find all touchpoints. Only remove `is_active` from mock objects that represent Visit or Payment API responses. Keep it on Service, Client, Record, Activity, Visitor mocks.

- [ ] **2c. Update E2E raw SQL — `frontend/admin/e2e/unified-rows.spec.ts`**
  - Line 105: `WHERE r.id = 'r1' AND v.is_active = 1 AND v.visitor_id IS NOT NULL` → remove `v.is_active = 1 AND` (column gone):
    ```sql
    WHERE r.id = 'r1' AND v.visitor_id IS NOT NULL
    ```
  - Line 213: `WHERE r.id = 'r2' AND v.is_active = 1` → remove `v.is_active = 1 AND`:
    ```sql
    WHERE r.id = 'r2'
    ```

- [ ] **2d. Update E2E raw SQL — `frontend/admin/e2e/activity-details-modal.spec.ts`**
  - Line 89: `SELECT * FROM visits WHERE record_id='...' AND is_active=1` → remove `AND is_active=1`:
    ```sql
    SELECT * FROM visits WHERE record_id='${recordRow!.id}'
    ```
  - Line 165: `SELECT * FROM payments WHERE record_id='...' AND is_active=1` → remove `AND is_active=1`:
    ```sql
    SELECT * FROM payments WHERE record_id='${record.id}'
    ```
  - Line 201: same as line 165.
  - Lines 102, 114, 117, 139, 141 reference `records.is_active` — KEEP these (Record is still soft-delete).

- [ ] **2e. Run frontend unit tests**
  ```bash
  cd frontend/admin && npx vitest run --reporter=verbose 2>&1 | tail -30
  ```
  Focus: no Zod validation errors for Visit/Payment. Pre-existing flakes (CalendarPopover, Menubar — GH #123) are acceptable baseline.

- [ ] **2f. Commit**
  ```bash
  git add -A && git commit -m "fix(frontend): remove is_active from Visit/Payment zod schemas + test mocks

  - Drop is_active from VisitResponseSchema + PaymentResponseSchema
  - Update mock data in useRecordMutations.test.ts
  - Remove is_active filter from E2E raw SQL on visits/payments"
  ```

### DoD
- [ ] `npx vitest run` passes (excluding pre-existing flakes)
- [ ] `npx tsc --noEmit` passes (no type errors from removed field)
- [ ] No `is_active` on Visit/Payment mock objects in frontend tests

---

## Task 3: Frontend — Optimistic cache setQueryData (Bug C: no F5 after add/delete)

### Classification: standard

### Required Docs
- `docs/specs/2026-06-25-inline-editable-table-unified-rows-design.md` → `## Addendum 2` section C
- `.opencode/skills/vitest-playwright-patterns/SKILL.md` — component test patterns

### Context
After adding/deleting a visitor or payment, switching tabs in the modal causes the table to remount and read from a STALE React Query cache (the mutation only called `invalidateRecord()` which triggers a background refetch — the table reads stale data before the refetch completes). Fix: optimistically update the cache with `setQueryData` so any remount reads fresh data immediately. Also restore the `['visitors', clientId]` invalidation in `addVisit` (regression from the refactor).

### Steps

- [ ] **3a. Write RED unit test — `frontend/admin/__tests__/useRecordMutations.test.ts`**
  Add a test that verifies `setQueryData` is called on `['record', recordId]` after `addVisit`:
  ```typescript
  it('addVisit optimistically updates [record, recordId] cache', async () => {
    const { result } = renderHook(() => useRecordMutations('act-1', recordId), {
      wrapper: createWrapperWithClient(),
    });
    // Mock createVisitor + createVisit
    mockCreateVisitor.mockResolvedValue(mockVisitorResponse);
    mockCreateVisit.mockResolvedValue({ ...mockVisitResponse, id: 'visit-1' });

    await act(async () => {
      await result.current.addVisit({
        client_id: 'c1',
        name: 'Test',
        tariff_id: 't1',
        price: 3500,
      });
    });

    // Verify cache was updated optimistically
    expect(queryClientSetQueryData).toHaveBeenCalledWith(
      ['record', recordId],
      expect.any(Function),
    );
  });
  ```
  Similarly for `deleteVisit`, `patchVisit`, `addPayment`, `deletePayment`, `patchPayment`.
  Add a test for `addVisit` invalidating `['visitors', clientId]` (regression fix).
  Run tests → they FAIL (setQueryData not called yet in the current code).

- [ ] **3b. Implement: add optimistic setQueryData to `useRecordMutations.ts`**
  In each of the 6 mutation functions, add `queryClient.setQueryData(['record', recordId], updater)`:

  ```typescript
  // addVisit — after createVisit returns savedVisit:
  const visit = await createVisit({ ... });
  queryClient.setQueryData<RecordResponse>(['record', recordId], (old) => {
    if (!old) return old;
    return { ...old, visits: [...old.visits, visit] };
  });
  queryClient.invalidateQueries({ queryKey: ['visitors', visit.visitor_id?.split('|')[0] ?? ''] }); // or clientId
  invalidateRecord();

  // deleteVisit — before API call (optimistic), then confirm:
  queryClient.setQueryData<RecordResponse>(['record', recordId], (old) => {
    if (!old) return old;
    return { ...old, visits: old.visits.filter(v => v.id !== visitId) };
  });
  await apiDeleteVisit(visitId);
  invalidateRecord();

  // patchVisit — after API returns updated visit:
  const visit = await apiPatchVisit(visitId, data);
  queryClient.setQueryData<RecordResponse>(['record', recordId], (old) => {
    if (!old) return old;
    return { ...old, visits: old.visits.map(v => v.id === visitId ? { ...v, ...visit } : v) };
  });
  invalidateRecord();

  // addPayment — after createPayment returns:
  const payment = await createPayment({ ... });
  queryClient.setQueryData<PaymentResponse[]>(['payments', recordId], (old) => {
    return [...(old ?? []), payment];
  });
  // Also update record cache if payments are stored there
  invalidateAll();

  // deletePayment — optimistic:
  queryClient.setQueryData<PaymentResponse[]>(['payments', recordId], (old) => {
    return (old ?? []).filter(p => p.id !== paymentId);
  });
  await apiDeletePayment(paymentId);
  invalidateAll();

  // patchPayment — after API returns:
  const payment = await apiPatchPayment(paymentId, data);
  queryClient.setQueryData<PaymentResponse[]>(['payments', recordId], (old) => {
    return (old ?? []).map(p => p.id === paymentId ? { ...p, ...payment } : p);
  });
  invalidateRecord();
  ```

  **Important for `addVisit` regression fix:** add `queryClient.invalidateQueries({ queryKey: ['visitors', clientId] })` after creating the visitor. The `clientId` is accessible from the record cache (already fetched via `fetchQuery` in some paths). For `addVisit`, the `client_id` is passed in `data.client_id`:
  ```typescript
  queryClient.invalidateQueries({ queryKey: ['visitors', data.client_id] });
  ```

  Import `RecordResponse` and `PaymentResponse` types at the top (already imported `RecordResponse`).

- [ ] **3c. Run tests → GREEN**
  ```bash
  cd frontend/admin && npx vitest run __tests__/useRecordMutations.test.ts --reporter=verbose
  ```
  All new setQueryData tests pass.

- [ ] **3d. Run full vitest suite**
  ```bash
  cd frontend/admin && npx vitest run --reporter=verbose 2>&1 | tail -30
  ```
  No regressions (excluding pre-existing flakes GH #123).

- [ ] **3e. Commit**
  ```bash
  git add -A && git commit -m "fix(record): optimistic setQueryData cache sync after add/delete/patch

  Bug C: table remount read stale cache before background refetch.
  - addVisit/deleteVisit/patchVisit: setQueryData(['record', recordId], ...) optimistic
  - addPayment/deletePayment/patchPayment: setQueryData(['payments', recordId], ...) optimistic
  - Restore invalidateQueries(['visitors', clientId]) in addVisit (regression fix)
  - InvalidateRecord kept as server-confirmation pass"
  ```

### DoD
- [ ] `useRecordMutations.test.ts` — new tests for setQueryData pass
- [ ] `npx vitest run` — no regressions
- [ ] `npx tsc --noEmit` — no type errors

---

## Task 4: Frontend — Tariff dropdown populated in modal (Bug D)

### Classification: small

### Required Docs
- `docs/specs/2026-06-25-inline-editable-table-unified-rows-design.md` → `## Addendum 2` section D
- `docs/domain-rules/services.md` (if exists — check for tariff entity rules)

### Context
The ActivityDetailsModal fetches services via `useSchedule()` which returns transformed `Service` objects (via `useServices()` → `transformService` — drops `tariffs`). The modal's `getServiceTariffs()` reads `svc.tariffs` → `undefined` → empty dropdown. Fix: expose `servicesRaw` (the un-transformed `ServiceResponse[]` with `tariffs`) from ScheduleContext and use it in the modal for tariff lookup.

### Steps

- [ ] **4a. Expose `servicesRaw` from ScheduleContext**
  In `frontend/admin/contexts/ScheduleContext.tsx`:
  - Add to `ScheduleContextType` interface (after line 91 `services: Service[]`):
    ```typescript
    servicesRaw: ServiceResponse[];
    ```
  - Add import: `import type { ServiceResponse } from '@memo/api-client';`
  - Add to the `contextValue` useMemo (after `services,` on line 492):
    ```typescript
    servicesRaw,
    ```
  - Add `servicesRaw` to the dependency array of the useMemo (after `services`):
    ```typescript
    [filteredItems, scheduleIndex, masters, services, servicesRaw, locations, ...]
    ```
  Note: `servicesRaw` is already fetched on line 277 (`const { data: servicesRaw = [] } = useQuery<ServiceResponse[]>({...})`) — just needs to be exported in the context value.

- [ ] **4b. Update ActivityDetailsModal to use `servicesRaw` for tariffs**
  In `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx`:
  - Line 34: change to also destructure `servicesRaw`:
    ```typescript
    const { services, servicesRaw, updateActivity, deleteActivity } = useSchedule();
    ```
  - Line 51-52: keep `currentService` as-is (for title display) AND add a raw service lookup:
    ```typescript
    const currentService = useMemo(
      () => services.find((s) => s.id === activity.serviceId),
      [services, activity.serviceId],
    );
    const currentRawService = useMemo(
      () => servicesRaw.find((s) => s.id === activity.serviceId),
      [servicesRaw, activity.serviceId],
    );
    const serviceTariffs = useMemo(
      () => currentRawService?.tariffs ?? [],
      [currentRawService],
    );
    ```
  - Remove the old `getServiceTariffs` helper function (lines 26-30) — no longer needed.
  - `serviceTariffs` is now `TariffResponse[]` (from the raw service) instead of the undefined-reading workaround.

- [ ] **4c. Write/update unit test**
  In `frontend/admin/__tests__/ActivityDetailsModal.test.tsx`:
  Add a test that verifies the tariff dropdown shows tariffs from a raw service with tariffs:
  ```typescript
  it('tariff dropdown shows service tariffs', async () => {
    // Mock useSchedule to return servicesRaw with tariffs
    // Render modal → ClientTab → "+ Добавить" → verify tariff <select> has options
  });
  ```
  Or if the modal test is complex (needs full schedule context), add a targeted test in `ClientTab.integration.test.tsx` that passes `serviceTariffs` prop directly and verifies the `<select>` renders options.

- [ ] **4d. Run tests**
  ```bash
  cd frontend/admin && npx vitest run __tests__/ActivityDetailsModal.test.tsx --reporter=verbose
  ```

- [ ] **4e. Commit**
  ```bash
  git add -A && git commit -m "fix(modal): tariff dropdown populated via servicesRaw from ScheduleContext

  Bug D: transformService dropped tariffs field, dropdown was empty.
  - Expose servicesRaw (ServiceResponse[]) from ScheduleContext
  - ActivityDetailsModal looks up raw service by id for tariff list
  - Remove getServiceTariffs workaround"
  ```

### DoD
- [ ] Tariff dropdown in modal shows the service's tariffs
- [ ] `npx vitest run` passes (no regressions)
- [ ] `npx tsc --noEmit` passes

---

## Task 5: Frontend — Undo toast deferred delete (Bug E frontend)

### Classification: standard

### Required Docs
- `docs/specs/2026-06-25-inline-editable-table-unified-rows-design.md` → `## Addendum 2` section E (Undo toast pattern)
- `docs/domain-rules/visits.md` + `docs/domain-rules/payments.md`

### Context
After Bug C (Task 3) added optimistic `setQueryData`, clicking × on a saved row calls `deleteVisit`/`deletePayment` which sends DELETE immediately. The spec requires a deferred-delete pattern: row disappears from UI + toast "Удалено. Отменить" for 5s. If user clicks "Отменить" → restore row, no server call. If 5s expires → send hard DELETE. The existing `useUI.showToast` already supports an undo callback (second arg is a function). The toast auto-dismisses after 4500ms — we need to extend this to 5000ms for undo toasts so the button is visible the full duration.

### Steps

- [ ] **5a. Extend toast undo timeout to 5000ms — `frontend/admin/contexts/UIContext.tsx`**
  In `showToast` (line 50-70):
  ```typescript
  const showToast = useCallback((
    message: string,
    kindOrUndo?: ToastKind | (() => void),
    undo?: () => void,
  ) => {
    let kind: ToastKind = 'info';
    let undoFn: (() => void) | undefined;
    if (typeof kindOrUndo === 'function') {
      undoFn = kindOrUndo;
    } else if (kindOrUndo) {
      kind = kindOrUndo;
      undoFn = undo;
    }
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts(prev => [...prev, { id, kind, message, undo: undoFn }]);
    const duration = undoFn ? 5000 : 4500; // undo toasts stay 5s
    const timerId = setTimeout(() => {
      toastTimers.current.delete(id);
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
    toastTimers.current.set(id, timerId);
  }, []);
  ```

- [ ] **5b. Write RED unit test — `frontend/admin/__tests__/useRecordMutations.test.ts`**
  ```typescript
  describe('deferred delete with undo', () => {
    it('deleteVisitDeferred removes row + shows toast, no DELETE sent', async () => {
      const { result } = renderHook(() => useRecordMutations('act-1', recordId), { wrapper });
      await act(async () => {
        await result.current.deleteVisitDeferred('visit-1');
      });
      // Row removed from cache (setQueryData called)
      expect(queryClientSetQueryData).toHaveBeenCalled();
      // DELETE NOT sent yet
      expect(mockDeleteVisit).not.toHaveBeenCalled();
      // Toast shown
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining('Удалено'),
        expect.any(Function),
      );
    });

    it('deleteVisitDeferred fires DELETE after 5s if not undone', async () => {
      // ... setup ...
      await act(async () => {
        await result.current.deleteVisitDeferred('visit-1');
      });
      // Fast-forward 5s
      act(() => { vi.advanceTimersByTime(5000); });
      expect(mockDeleteVisit).toHaveBeenCalledTimes(1);
    });

    it('undo cancels the deferred DELETE and restores the row', async () => {
      // ... setup ...
      await act(async () => {
        await result.current.deleteVisitDeferred('visit-1');
      });
      // Call the undo function captured from the toast
      const undoFn = mockShowToast.mock.calls[0][1] as () => void;
      await act(async () => { undoFn(); });
      // Fast-forward 5s — DELETE should NOT fire
      act(() => { vi.advanceTimersByTime(5000); });
      expect(mockDeleteVisit).not.toHaveBeenCalled();
      // Row restored in cache
      expect(queryClientSetQueryData).toHaveBeenCalledWith(['record', recordId], expect.any(Function));
    });
  });
  ```
  Add `vi.useFakeTimers()` in beforeEach.
  Run tests → FAIL (no `deleteVisitDeferred` exists).

- [ ] **5c. Implement `deleteVisitDeferred` + `deletePaymentDeferred` in `useRecordMutations.ts`**

  Add a ref to track pending delete timers:
  ```typescript
  const pendingDeleteTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  ```

  Implement `deleteVisitDeferred`:
  ```typescript
  const deleteVisitDeferred = useCallback(
    async (visitId: string, showToastFn: (msg: string, undo: () => void) => void) => {
      // 1. Save the visit from cache for potential restore
      const record = queryClient.getQueryData<RecordResponse>(['record', recordId]);
      const savedVisit = record?.visits.find(v => v.id === visitId);

      // 2. Optimistically remove from cache
      queryClient.setQueryData<RecordResponse>(['record', recordId], (old) => {
        if (!old) return old;
        return { ...old, visits: old.visits.filter(v => v.id !== visitId) };
      });

      // 3. Cancel any existing timer for this id
      const existing = pendingDeleteTimers.current.get(visitId);
      if (existing) clearTimeout(existing);

      // 4. Show toast with undo
      let undone = false;
      showToastFn('Удалено. Отменить', () => {
        undone = true;
        // Restore the row
        if (savedVisit) {
          queryClient.setQueryData<RecordResponse>(['record', recordId], (old) => {
            if (!old) return old;
            return { ...old, visits: [...old.visits, savedVisit] };
          });
        }
        pendingDeleteTimers.current.delete(visitId);
      });

      // 5. Schedule the actual DELETE after 5s
      const timer = setTimeout(async () => {
        if (!undone) {
          await apiDeleteVisit(visitId);
          invalidateRecord();
        }
        pendingDeleteTimers.current.delete(visitId);
      }, 5000);
      pendingDeleteTimers.current.set(visitId, timer);
    },
    [recordId, queryClient, invalidateRecord],
  );
  ```

  Implement `deletePaymentDeferred` similarly — for payments the cache key is `['payments', recordId]` instead of `['record', recordId].visits`.

  Export both from the hook return:
  ```typescript
  return {
    ...,
    deleteVisitDeferred,
    deletePaymentDeferred,
  };
  ```

  Note: the `showToast` function is passed as a parameter because `useRecordMutations` doesn't have access to `useUI` (it's for client record tab context). The `ClientTab` component already has `showToast` from props.

- [ ] **5d. Wire deferred delete in ClientTab — `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx`**
  Line 69: add `deleteVisitDeferred, deletePaymentDeferred` to destructured mutations:
  ```typescript
  const { ..., addVisit, patchVisit, deleteVisit: _deleteVisit, addPayment, patchPayment, deletePayment: _deletePayment, deleteVisitDeferred, deletePaymentDeferred } = useRecordMutations(...);
  ```
  Line 197: change `onDeleteVisit={deleteVisit}` to:
  ```typescript
  onDeleteVisit={(visitId: string) => deleteVisitDeferred(visitId, showToast)}
  ```
  Line 208: change `onDeletePayment={deletePayment}` to:
  ```typescript
  onDeletePayment={(paymentId: string) => deletePaymentDeferred(paymentId, showToast)}
  ```
  Keep the immediate `deleteVisit`/`deletePayment` exported for backward compat (e.g., `ClientRecordTab` on the clients page may use immediate delete). The `_` prefix on the immediate versions avoids lint unused warnings if they're not used in this file.

  Actually: check if `ClientRecordTab` (the clients-page variant) also uses `useRecordMutations`. If yes, it should also use deferred delete. The spec says "Clicking × on a SAVED visit/payment row" — this applies everywhere the inline-edit table is used. For now, wire it in the modal's ClientTab. Adapt ClientRecordTab in a follow-up if needed.

  Pass `showToast` to the wrapper. The `deleteVisitDeferred` signature is `(visitId: string, showToastFn: (msg: string, undo: () => void) => void)`.

- [ ] **5e. Update `InlineEditRow` onDelete flow**
  Currently `InlineEditRow.handleDelete` calls `onDelete(row.id)` for saved rows, `onRemove(row)` for new rows.
  This contract stays the same — the CONSUMER (RecordVisitsTable/RecordPaymentsTable) passes a `handleDeleteRow` that delegates to `onDeleteVisit`/`onDeletePayment`. The deferred logic lives in `useRecordMutations.deleteVisitDeferred` — the table calls it via `onDeleteVisit` prop.
  No change to `InlineEditRow` or `useInlineEditRow` — `onDelete` is now async and returns a deferred Promise (resolves immediately after optimistic cache update, not after the full 5s).

- [ ] **5f. Run tests → GREEN**
  ```bash
  cd frontend/admin && npx vitest run __tests__/useRecordMutations.test.ts --reporter=verbose
  ```
  All deferred-delete tests pass.

- [ ] **5g. Run full vitest suite**
  ```bash
  cd frontend/admin && npx vitest run --reporter=verbose 2>&1 | tail -30
  ```
  No regressions.

- [ ] **5h. Commit**
  ```bash
  git add -A && git commit -m "feat(record): deferred delete with Undo toast (5s) for visits+payments

  Bug E: deleting a saved row now removes it from UI immediately and shows
  'Удалено. Отменить' toast for 5s. Undo restores the row with no server call.
  Toast expiry fires the hard DELETE.

  - UIContext: undo toasts stay 5000ms (was 4500ms fixed)
  - useRecordMutations: deleteVisitDeferred + deletePaymentDeferred (setQueryData
    optimistic remove + toast + setTimeout DELETE)
  - ClientTab: wire onDeleteVisit/onDeletePayment to deferred variants"
  ```

### DoD
- [ ] `deleteVisitDeferred` test: row removed from cache, DELETE not sent immediately
- [ ] `deleteVisitDeferred` test: DELETE fires after 5s if not undone
- [ ] `deleteVisitDeferred` test: undo restores row, DELETE not fired
- [ ] `npx vitest run` — no regressions
- [ ] `npx tsc --noEmit` — no type errors

---

## Task 6: E2E — Scenarios 15-19

### Classification: standard

### Required Docs
- `docs/specs/2026-06-25-inline-editable-table-unified-rows-design.md` → `## Addendum 2` → Scenarios 15-19
- `.opencode/skills/vitest-playwright-patterns/SKILL.md` — Full Cycle E2E pattern

### Context
5 new E2E scenarios that verify the 3 bugs are fixed. These go in `frontend/admin/e2e/unified-rows.spec.ts` alongside scenarios 10-14. The test helper functions (`switchToRecordsTab`, `queryDB`, `openModal`) are in `e2e/fixtures/`.

### Steps

- [ ] **6a. Write RED E2E tests for scenarios 15-19** in `frontend/admin/e2e/unified-rows.spec.ts`:

  ```typescript
  test.describe('addendum-2: cache sync, tariffs, undo', () => {
    test('scenario 15: no F5 after add visitor', async ({ page, request }) => {
      // Setup: create activity + record via API
      // Open modal → ClientTab → add a visitor (blur to save)
      // Switch to "Настройки" tab → switch back to "Клиент" tab
      // Assert: visitor row is still visible (no stale cache)
    });

    test('scenario 15b: no F5 after add payment', async ({ page, request }) => {
      // Same pattern for payments
    });

    test('scenario 16: no F5 after delete visitor', async ({ page, request }) => {
      // Setup: create activity + record with a visitor
      // Open modal → delete visitor (× button)
      // Switch to "Настройки" → back to "Клиент"
      // Assert: visitor is still gone (does not reappear)
    });

    test('scenario 16b: no F5 after delete payment', async ({ page, request }) => {
      // Same for payments
    });

    test('scenario 17: tariff dropdown populated in modal', async ({ page, request }) => {
      // Setup: create activity with a service that has tariffs
      // Open modal → ClientTab → click "+ Добавить"
      // Assert: tariff <select> has <option> elements matching the service's tariffs
      // Select one → assert price auto-fills
    });

    test('scenario 18: hard delete removes from stats', async ({ page, request }) => {
      // Setup: create client + record + payment
      // DELETE the payment via API (hard delete)
      // GET client stats → assert total_paid does not include the deleted payment
      // GET payment by id → assert 404
    });

    test('scenario 19: undo delete', async ({ page, request }) => {
      // Setup: create activity + record + payment
      // Open modal → ClientTab → click × on the payment row
      // Assert: toast "Удалено. Отменить" appears
      // Assert: payment row disappeared from table
      // Assert: NO DELETE request was sent (intercept network — no DELETE /api/v1/payments/...)
      // Click "Отменить" in the toast
      // Assert: payment row reappears in table
      // Assert: still no DELETE request sent
      // Wait 5s (toast expires)
      // Assert: DELETE request was now sent
    });
  });
  ```

  Use `page.route('**/api/v1/payments/**', ...)` to intercept and count DELETE requests for scenario 19.

- [ ] **6b. Run E2E tests (may fail due to GH #124 openModal issue)**
  ```bash
  cd frontend/admin && npx playwright test e2e/unified-rows.spec.ts --grep "scenario 1[5-9]"
  ```
  If scenarios 15-17 and 19 pass → GREEN. Scenario 18 is API-only (no modal needed). If #124 blocks modal opening for 15-17/19 → mark as `.skip` with a comment referencing GH #124, and file a follow-up.

- [ ] **6c. Commit**
  ```bash
  git add -A && git commit -m "test(e2e): scenarios 15-19 (cache sync, tariffs, hard delete stats, undo)

  - 15/16: no F5 needed after add/delete (visits+payments)
  - 17: tariff dropdown populated via servicesRaw
  - 18: hard delete removes payment from stats (API-level)
  - 19: undo toast restores row, no DELETE sent until 5s expiry"
  ```

### DoD
- [ ] E2E scenario 15 passes (visits + payments variants)
- [ ] E2E scenario 16 passes (visits + payments variants)
- [ ] E2E scenario 17 passes
- [ ] E2E scenario 18 passes (API-level, no modal needed)
- [ ] E2E scenario 19 passes (network interception)
- [ ] If GH #124 blocks any → `.skip` with comment + follow-up

---

## Risk / Notes

1. **GH #124** (openModal wrong-activity) may block E2E scenarios 15-17, 19 that require opening the modal. Mitigation: if blocked, write the test body and `.skip` it with a comment. API-only tests (scenario 18) are not affected.
2. **Pre-existing vitest flakes** (GH #123 — CalendarPopover, Menubar) are baseline. Do not fix in this addendum.
3. **ClientRecordTab** (clients page variant of the record tab) also uses `useRecordMutations` for delete. The deferred-delete pattern is only wired in the modal's `ClientTab` for now. If the clients-page also shows the undo toast — that's a follow-up, not in this addendum.
4. **`servicesRaw` in ScheduleContext** — it's already fetched (line 277) but not exported. The export is a 3-line change (interface + contextValue + deps array) — minimal risk.
5. **Migration on SQLite** — `batch_alter_table` is required (SQLite doesn't support `DROP COLUMN` directly until 3.35.0). Alembic handles this via table recreation. The conftest uses alembic to create schema, so the migration runs automatically in tests.
6. **GenericService.list** calls `self._repository.list(...)` — with `BaseRepository`, no `is_active` filter is applied. This is fine for Payment (we want ALL payments). But check: does any code call `PaymentService.list()` expecting filtered results? Unlikely — PaymentService.list should return all payments (they're all "active" in hard-delete world).