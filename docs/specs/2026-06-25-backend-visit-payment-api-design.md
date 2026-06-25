# Backend: Visit/Payment API Completion & `tariff_id` Fix — Design

**Date:** 2026-06-25
**Status:** Draft (awaiting written-spec approval — G1b)
**Scope:** Backend-only. Expands GH-104 to cover (a) `tariff_id` model/schema drift and (b) missing CRUD endpoints for visit and payment entities.
**Supersedes:** None. Frontend refactor of `RecordVisitsTable`/`RecordPaymentsTable` lives in `2026-06-25-inline-editable-table-unified-rows-design.md` (commit `4c031a5`) and is **deferred** until this spec ships.

---

## Problem

GH-104 originally reads: "UI shows '— тариф —' placeholder everywhere". Investigation revealed **two compounding backend problems** that the UI cannot fix on its own:

### A. Triple-layer `tariff_id` drift (GH-104 root cause)

The DB column `visits.tariff_id` was added in migration `448bdcc2a6a7` (2026-06-20), but the change was **never propagated** to the model, schema, or response mapper:

| Layer | Has `tariff_id`? | Evidence |
|-------|------------------|----------|
| **DB column** (migration `448bdcc2a6a7`) | ✅ Yes | `String(36)`, nullable, FK → `tariffs.id` |
| **SQLAlchemy `Visit` model** (`backend/src/models/visit.py`) | ❌ No | 18-line file, no `tariff_id` attribute, no `tariff` relationship |
| **Pydantic `VisitResponse`** (`backend/src/schemas/visit.py:14-27`) | ❌ No | Fields: `id, record_id, visitor_id, price, custom_price, status, created_at, updated_at, is_active` |
| **`_map_visit` mapper** (`backend/src/api/v1/visits.py:34-44`) | ❌ No | Hard-coded field list, doesn't pull `tariff_id` from ORM |
| **Nested visit in `RecordResponse`** (`backend/src/schemas/record.py:26-39`) | ❌ No | Separate `VisitResponse` definition, also missing `tariff_id` |
| **Frontend Zod schema** (`packages/api-client/src/schemas.ts:198-209`) | ✅ Yes (expected) | Treats `tariff_id` as first-class field |
| **Frontend request** (via `patchRecord` in `endpoints.ts:297`) | ✅ Yes (sends) | Includes `tariff_id` in each visit |
| **Frontend UI** (`RecordVisitsTable.tsx:226`, `ClientRecordTab.tsx:138`) | ✅ Yes (reads) | `<select value={visit.tariff_id ?? ''}>` — always empty because backend never returns it |

**Result:** every visit renders with the "— тариф —" placeholder because the frontend receives `undefined` (Pydantic drops the field entirely; SQLAlchemy doesn't even load it). The user-selected tariff is silently lost on save and never displayed.

### B. Visit entity has no direct CRUD

The `visits` API surface exposes only **two** endpoints:

| Method | Path | What it does |
|--------|------|--------------|
| `GET /api/v1/visits/{id}` | Read one visit |
| `PUT /api/v1/visits/{id}/status` | Update status only |

`POST`, `PATCH`, `DELETE`, and `GET /visits` (list) are **all missing**. The `VisitService` (`backend/src/services/visit.py`) has only `get()` and `update_status()`.

All visit mutations today go through `PATCH /api/v1/records/{id}` with a full `visits` array replacement. This causes:
- The "showForm blink" in the UI (close form → refetch record → render new row)
- Stale-cache bugs in `useRecordMutations.addVisitorToRecord` (reads current visits from React Query cache and appends; if cache is stale, visits are lost)
- Inability to do per-visit edits (e.g., changing only one visit's tariff requires sending the entire visits array)

### C. Payment PATCH is missing

`PaymentService` uses `GenericService`, which already has a `patch()` method — but `PATCH /api/v1/payments/{id}` is not exposed in the router. Only full-replace `PUT` exists. Any partial update (e.g., "change payment method only") requires sending the full payment.

---

## Goals

1. **Fix GH-104 root cause:** `tariff_id` round-trips correctly through Visit model → `_map_visit` → `VisitResponse` → frontend. UI shows the chosen tariff name (or `—` when null) instead of the misleading placeholder.
2. **Complete Visit CRUD:** add `POST /api/v1/visits`, `PATCH /api/v1/visits/{id}`, `DELETE /api/v1/visits/{id}`, and `GET /api/v1/visits` (list, with optional `record_id` filter). Match the pattern used by `payments.py`.
3. **Add Payment PATCH:** expose `PATCH /api/v1/payments/{id}` (the `GenericService.patch()` method is already implemented — just wire it up).
4. **Service-layer cascade:** any visit mutation (create, update including partial, delete) must re-derive the parent record's `status` (call `_derive_record_status` from `VisitService`) and refresh `updated_at`. This is the same pattern `update_status` already uses.
5. **Test coverage:** full unit + API tests for all new endpoints and the `tariff_id` round-trip. Follow the existing test pattern under `backend/tests/`.

---

## Non-Goals

- **Frontend changes.** This spec is backend-only. The `RecordVisitsTable`/`RecordPaymentsTable` refactor is a separate spec (`4c031a5`).
- **Migration.** No alembic migration is needed — the `visits.tariff_id` column already exists from `448bdcc2a6a7`. We only update the SQLAlchemy model.
- **Hard-deleting visits.** All deletes are soft (`is_active = False`), consistent with existing `delete_payment` and the `AbstractModel` pattern.
- **Changing the visit endpoint URL structure.** We do NOT move to `/api/v1/records/{record_id}/visits` (nested REST) — `POST /api/v1/visits` with `record_id` in body is the chosen shape (flat, matches `payments.py`).
- **Replacing the existing `patchRecord({visits: [...]})` flow.** It stays for now; the frontend migration to the new endpoints is part of the deferred frontend refactor.
- **New test infrastructure.** Use the existing `pytest` setup under `backend/tests/`. No new fixtures or framework changes.
- **Domain-rules docs.** The `docs/domain-rules/visits.md` file (if it exists) should be updated to reflect the new CRUD surface and the `tariff_id` semantics, but this is a docs follow-up, not a blocker for the code change.

---

## Architecture

### Files modified (Phase 0 — GH-104 minimum)

| File | Change | Approx lines |
|------|--------|-------------|
| `backend/src/models/visit.py` | Add `tariff_id: Mapped[str \| None] = mapped_column(String(36), ForeignKey("tariffs.id"), nullable=True)` + `tariff: Mapped["Tariff"] = relationship(...)` | +5 |
| `backend/src/schemas/visit.py` | Add `tariff_id: str \| None = None` to `VisitResponse` (line 14-27) | +1 |
| `backend/src/api/v1/visits.py` | Add `tariff_id=visit.tariff_id` to `_map_visit` (line 34-44) | +1 |
| `backend/src/schemas/record.py` | Add `tariff_id: str \| None = None` to nested `VisitResponse` (line 26-39) | +1 |
| `backend/tests/api/test_visits.py` (or new file) | Test: `GET /api/v1/visits/{id}` response includes `tariff_id` | +20 |
| `backend/tests/models/test_visit.py` (or new file) | Test: Visit model has `tariff_id` column attribute | +10 |
| **Phase 0 total** | | **~40 lines** |

### Files modified (Phase 1 — Visit CRUD)

| File | Change | Approx lines |
|------|--------|-------------|
| `backend/src/schemas/visit.py` | Add `VisitBase`, `VisitCreate`, `VisitUpdate`, `VisitPatch` (mirroring `visitor.py` pattern) | +30 |
| `backend/src/services/visit.py` | Add `list`, `create`, `update`, `patch`, `delete` methods to `VisitService` (use `GenericService` or hand-roll; see Design Decisions) | +80 |
| `backend/src/api/v1/visits.py` | Add `GET /`, `POST /`, `PATCH /{id}`, `DELETE /{id}` handlers | +50 |
| `backend/tests/api/test_visits.py` | Full CRUD tests (create, list, get, patch, delete, error cases) | +200 |
| **Phase 1 total** | | **~360 lines** |

### Files modified (Phase 2 — Payment PATCH)

| File | Change | Approx lines |
|------|--------|-------------|
| `backend/src/schemas/payment.py` | Add `PaymentPatch` (all fields `\| None = None`) | +10 |
| `backend/src/api/v1/payments.py` | Add `PATCH /{payment_id}` handler (delegates to `service.patch`) | +10 |
| `backend/tests/api/test_payments.py` | PATCH tests (partial update, NOT_NULL strip, 404) | +30 |
| **Phase 2 total** | | **~50 lines** |

### Files not modified

- `backend/alembic/versions/` — no new migration (DB column already exists).
- `backend/src/services/payment.py` — `GenericService.patch` is already implemented; we just expose it in the router.
- `backend/src/models/payment.py` — model is complete.
- `backend/src/repositories/generic.py` — `GenericRepository.patch` is already implemented.
- Any frontend file — out of scope.

---

## Data model (after Phase 0)

### `Visit` ORM (`backend/src/models/visit.py`)

```python
from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.abstract import AbstractModel


class Visit(AbstractModel):
    __tablename__ = "visits"

    record_id: Mapped[str] = mapped_column(String(36), ForeignKey("records.id"))
    visitor_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("visitors.id"), nullable=True)
    tariff_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tariffs.id"), nullable=True)  # NEW
    price: Mapped[int] = mapped_column(Integer)
    custom_price: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20))

    record: Mapped["Record"] = relationship("Record", back_populates="visits")
    tariff: Mapped["Tariff | None"] = relationship("Tariff")  # NEW (optional, for eager loading)
```

### `VisitResponse` Pydantic (`backend/src/schemas/visit.py`)

```python
class VisitResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    record_id: str
    visitor_id: str | None = None
    tariff_id: str | None = None  # NEW
    price: int
    custom_price: int | None = None
    status: str
    created_at: str
    updated_at: str
    is_active: bool
```

### Nested `VisitResponse` in `RecordResponse` (`backend/src/schemas/record.py:26-39`)

Same field as above — add `tariff_id: str | None = None` to the nested class too. (There is a pre-existing duplication between the two `VisitResponse` classes; this spec does NOT deduplicate them, just adds the field to both. Deduplication is tracked as a follow-up — see "Known debt" in Risks.)

---

## Schema design (Phase 1 — Visit CRUD)

Mirroring the **`visitor.py` pattern** (the cleanest existing example in the codebase):

```python
# backend/src/schemas/visit.py

from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field

from src.models.enums import VisitStatus


class VisitBase(BaseModel):
    """Shared fields for visit create and update."""

    record_id: str
    visitor_id: str | None = None
    tariff_id: str | None = None
    price: int = Field(ge=0)  # allow 0 (will be flagged by UI as "—")
    custom_price: int | None = None
    status: VisitStatus = VisitStatus.WAITING  # default for new visits


class VisitCreate(VisitBase):
    """Request schema for creating a new visit (POST /api/v1/visits)."""

    pass


class VisitUpdate(VisitBase):
    """Request schema for full-replace update (PUT /api/v1/visits/{id})."""

    pass


class VisitPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/visits/{id}).

    All fields optional. None means 'don't change'.
    """

    visitor_id: str | None = None
    tariff_id: str | None = None
    price: int | None = Field(default=None, ge=0)
    custom_price: int | None = None
    status: VisitStatus | None = None


class VisitStatusUpdate(BaseModel):
    """Existing — request schema for status-only PUT."""

    status: VisitStatus


class VisitResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    record_id: str
    visitor_id: str | None = None
    tariff_id: str | None = None
    price: int
    custom_price: int | None = None
    status: str
    created_at: str
    updated_at: str
    is_active: bool
```

**`PaymentPatch` (Phase 2):**

```python
# backend/src/schemas/payment.py (add to existing file)

class PaymentPatch(BaseModel):
    """Request schema for partial update (PATCH /api/v1/payments/{id}).

    All fields optional. None means 'don't change'.
    """

    amount: int | None = Field(default=None, gt=0)
    method: PaymentMethod | None = None
```

---

## API surface (after Phase 1 + 2)

### Visit endpoints

| Method | Path | Handler | Request | Response | Status | New? |
|--------|------|---------|---------|----------|--------|------|
| `GET` | `/api/v1/visits` | `list_visits` | — (query: `record_id?`) | `list[VisitResponse]` | 200 | ✅ NEW |
| `GET` | `/api/v1/visits/{visit_id}` | `get_visit` | — | `VisitResponse` | 200 | existing |
| `POST` | `/api/v1/visits` | `create_visit` | `VisitCreate` | `VisitResponse` | 201 | ✅ NEW |
| `PUT` | `/api/v1/visits/{visit_id}` | `update_visit` | `VisitUpdate` | `VisitResponse` | 200 | ✅ NEW (full replace) |
| `PATCH` | `/api/v1/visits/{visit_id}` | `patch_visit` | `VisitPatch` | `VisitResponse` | 200 | ✅ NEW (partial) |
| `DELETE` | `/api/v1/visits/{visit_id}` | `delete_visit` | — | — | 204 | ✅ NEW (soft) |
| `PUT` | `/api/v1/visits/{visit_id}/status` | `update_visit_status` | `VisitStatusUpdate` | `VisitResponse` | 200 | existing (unchanged) |

### Payment endpoints (additions)

| Method | Path | Handler | Request | Response | Status | New? |
|--------|------|---------|---------|----------|--------|------|
| `PATCH` | `/api/v1/payments/{payment_id}` | `patch_payment` | `PaymentPatch` | `PaymentResponse` | 200 | ✅ NEW (partial) |

### Error responses

All endpoints follow the project's standard error contract (see `docs/specs/2026-06-20-error-flow-design.md`):

- `404` with `code: VISIT_NOT_FOUND` / `PAYMENT_NOT_FOUND` for missing IDs
- `422` for validation errors (Pydantic)
- `400` for malformed requests (rare — most validation is 422)

---

## Service layer (Phase 1)

### Design decision: hand-roll `VisitService` methods vs use `GenericService`

`VisitService` is currently hand-rolled (only `get` + `update_status`). The new methods need:
- `_derive_record_status` cascade after any mutation (status change affects parent record)
- **`seats` recomputation** after any mutation that changes `len(active_visits)` (create adds, delete removes)
- **Capacity check** on `create` (reusing `RecordService._check_capacity`)
- Custom create logic (after insert, derive parent record's `status` and `seats`)
- Custom delete logic (soft-delete, then derive parent record's `status` and `seats`)

`GenericService` doesn't know about cascades. Two options:

**Option A: Hand-roll all CRUD methods in `VisitService`** — explicit, easy to add cascade, but more code.

**Option B: Inherit from `GenericService` and override `create`/`update`/`patch`/`delete` to add cascade** — reuses `GenericService` boilerplate (`model_validate` etc.), but inheritance gets messy.

**Decision: Option A.** Hand-roll all methods. Total ~80 lines. Clearer separation between "pure CRUD" and "visit-specific cascade logic". **`GenericService` itself is NOT modified** — it stays as a generic, cascade-agnostic CRUD wrapper that other services (like `PaymentService`) can keep using without polluting it with visit-specific logic.

### Cascade helpers: live in `RecordService`, called by `VisitService`

Per user's preference: cascade logic is the parent record's concern, not the visit's. Add **two new public methods** to `RecordService`:

```python
# backend/src/services/record.py — NEW public methods (refactor of inlined logic)

class RecordService:
    # ... existing methods ...

    async def recompute_seats(self, db_session: AsyncSession, record_id: str) -> Record | None:
        """Recompute record.seats from active visits.

        Formula: seats = len(active visits) + anonym_visits.
        Called by VisitService after create/delete (which change len(active_visits)),
        and by RecordService.patch when visits are replaced.

        Replaces the inlined logic at lines 127, 208, 268, 272.
        """
        record = await self.get(db_session, record_id)
        if not record:
            return None
        result = await db_session.execute(
            select(func.count()).select_from(Visit).where(
                Visit.record_id == record_id,
                Visit.is_active.is_(True),
            )
        )
        active_count = result.scalar() or 0
        record.seats = active_count + record.anonym_visits
        record.updated_at = datetime.now(UTC)
        await db_session.flush()
        return record

    async def recompute_status(self, db_session: AsyncSession, record_id: str) -> Record | None:
        """Recompute record.status from active visits.

        Uses the same compute_record_status domain function as the inlined code.
        Called by VisitService after any mutation (status change affects parent record),
        and by RecordService.patch when visits are replaced.

        Replaces the inlined logic at lines 123, 225, 277, 283.
        """
        record = await self.get(db_session, record_id)
        if not record:
            return None
        result = await db_session.execute(
            select(Visit).where(
                Visit.record_id == record_id,
                Visit.is_active.is_(True),
            )
        )
        active_visits = list(result.scalars().all())
        record.status = compute_record_status([
            VisitItem(id=v.id, status=v.status)
            for v in active_visits
        ]).value
        record.updated_at = datetime.now(UTC)
        await db_session.flush()
        return record
```

**Bonus DRY:** refactor existing `RecordService.create`, `update`, `patch` to use these new helpers instead of inlining the logic. Removes ~30 lines of duplication. This is included in Phase 1 scope (not a separate cleanup).

### `VisitService` uses `RecordService` for cascade

```python
# backend/src/services/visit.py — refactored methods

class VisitService:
    def __init__(self, record_service: RecordService | None = None) -> None:
        """VisitService depends on RecordService for cascade recompute."""
        self._record_service = record_service or RecordService()

    async def list(self, db_session, record_id=None) -> list[Visit]:
        """Return active visits, optionally filtered by record_id."""
        stmt = select(Visit).where(Visit.is_active.is_(True))
        if record_id is not None:
            stmt = stmt.where(Visit.record_id == record_id)
        result = await db_session.execute(stmt)
        return list(result.scalars().all())

    async def get(self, db_session, visit_id) -> Visit | None:
        # ... existing implementation ...

    async def create(self, db_session, data: VisitCreate) -> Visit | None:
        """Create a new visit, then cascade: derive record.status + record.seats.

        Returns None if the parent record doesn't exist.
        Raises HTTPException 409 + ErrorCode.ACTIVITY_AT_CAPACITY if activity is at capacity.
        """
        # 1. Verify parent record exists (404 if not)
        record = await self._record_service.get(db_session, data.record_id)
        if not record:
            return None
        # 2. Capacity check (409 + ACTIVITY_AT_CAPACITY if exceeded)
        #    Uses RecordService._check_capacity (existing static method, line 294)
        await RecordService._check_capacity(db_session, record.activity_id, seats=1)
        # 3. Insert visit
        visit = Visit(**data.model_dump())
        db_session.add(visit)
        await db_session.flush()
        # 4. Cascade: derive status + seats on parent record
        await self._record_service.recompute_status(db_session, visit.record_id)
        await self._record_service.recompute_seats(db_session, visit.record_id)
        await db_session.flush()
        await db_session.refresh(visit)
        return visit

    async def update(self, db_session, visit_id, data: VisitUpdate) -> Visit | None:
        """Full-replace update. Cascade only status (seats unchanged — is_active not in VisitUpdate)."""
        visit = await self.get(db_session, visit_id)
        if not visit:
            return None
        for field, value in data.model_dump().items():
            setattr(visit, field, value)
        visit.updated_at = datetime.now(UTC)
        await db_session.flush()
        # Cascade: status only (seats: no change — is_active not exposed in VisitUpdate)
        await self._record_service.recompute_status(db_session, visit.record_id)
        await db_session.flush()
        await db_session.refresh(visit)
        return visit

    async def patch(self, db_session, visit_id, data: VisitPatch) -> Visit | None:
        """Partial update — only fields explicitly set in `data` are applied.

        Cascade only status (seats unchanged — is_active not in VisitPatch).
        """
        visit = await self.get(db_session, visit_id)
        if not visit:
            return None
        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(visit, field, value)
        visit.updated_at = datetime.now(UTC)
        await db_session.flush()
        # Cascade: status only
        await self._record_service.recompute_status(db_session, visit.record_id)
        await db_session.flush()
        await db_session.refresh(visit)
        return visit

    async def delete(self, db_session, visit_id) -> bool:
        """Soft-delete the visit (is_active=False) and cascade: derive record.status + record.seats.

        seats -= 1 because the deleted visit is no longer in len(active_visits).
        """
        visit = await self.get(db_session, visit_id)
        if not visit:
            return False
        visit.is_active = False
        visit.updated_at = datetime.now(UTC)
        await db_session.flush()
        # Cascade: status + seats
        await self._record_service.recompute_status(db_session, visit.record_id)
        await self._record_service.recompute_seats(db_session, visit.record_id)
        await db_session.flush()
        return True

    # ... existing get, update_status (now also uses recompute_status) ...
```

**The existing `VisitService.update_status` (line 24-37) and `_derive_record_status` (line 39-62) are REFACTORED** to use `RecordService.recompute_status` instead of their own implementation. Removes the duplicated logic.

### Phase 2 — Payment PATCH

`PaymentService` already uses `GenericService` — no service change needed. Just expose `patch` in the router:

```python
# backend/src/api/v1/payments.py (add)

@router.patch("/{payment_id}", response_model=PaymentResponse)
async def patch_payment(
    payment_id: str,
    data: PaymentPatch,
    service: _ServiceDep,
    session: SessionDep,
) -> PaymentResponse:
    """Partial-update a payment (PATCH)."""
    payment = await service.patch(db_session=session, id=payment_id, data=data)
    if not payment:
        raise HTTPException(
            status_code=404,
            detail=ErrorDetail(
                code=ErrorCode.PAYMENT_NOT_FOUND,
                message="Payment not found",
            ).model_dump(),
        )
    return payment
```

**Note:** `Payment.amount` and `Payment.method` are NOT NULL columns, but the only NOT NULL one in `amount` matters. `GenericService.NOT_NULL_FIELDS` is empty by default, so `method: null` in PATCH would set `method = None` (which is allowed — `method` is nullable). `amount: null` would also work (it would set `amount = None`, which violates NOT NULL). Two ways to handle:

1. **Add `amount` to `NOT_NULL_FIELDS`** in `PaymentService` — `GenericService.patch` will strip `null` for `amount`, so a `PaymentPatch({method: 'card'})` doesn't accidentally null out `amount`.
2. **Let it fail** with a 422 from the DB constraint.

**Decision: Option 1.** Set `NOT_NULL_FIELDS = {'amount'}` in `PaymentService`. This matches the documented contract of `GenericService.patch` and gives a cleaner error to the client (the Pydantic schema enforces `amount: int | None` but the service strips it before the DB sees it).

---

## User Scenarios

> Each scenario maps to a test (per testing-strategy-v2 / User Scenario workflow). E2E for the UI side is deferred to the frontend refactor; these scenarios are covered by **backend API tests** in `backend/tests/`.

### Phase 0 — `tariff_id` round-trip

1. **`GET /api/v1/visits/{id}` returns `tariff_id`.** Seed a visit with `tariff_id='t7a'` in the DB. Call `GET /api/v1/visits/{id}`. Response body has `"tariff_id": "t7a"`. (Test: `test_visits.py::test_get_visit_includes_tariff_id`.)

2. **`GET /api/v1/records/{id}` includes `tariff_id` in nested visits.** Same setup — call `GET /api/v1/records/{record_id}`. The nested `visits[*].tariff_id` field is `"t7a"` for the seeded visit. (Test: `test_records.py::test_get_record_includes_tariff_id_in_visits`.)

3. **`PATCH /api/v1/records/{id}` accepts `tariff_id` in visits array.** Send `{"visits": [{"id": "v42", "tariff_id": "t7b", ...}]}`. Backend accepts (200), returns the visit with `tariff_id="t7b"`. (Test: `test_records.py::test_patch_record_preserves_tariff_id_in_visits`.)

4. **Visit with no tariff returns `tariff_id: null`.** Seed a visit with `tariff_id=NULL` (or no tariff). API response has `"tariff_id": null`. (Test: `test_visits.py::test_get_visit_tariff_id_null`.)

### Phase 1 — Visit CRUD

5. **`POST /api/v1/visits` creates a visit.** Send `{"record_id": "r1", "price": 3500, "tariff_id": "t7a"}`. Response 201 with full `VisitResponse` (id, created_at, etc.). DB has the new visit. Parent record's `status` was re-derived after the insert. (Test: `test_visits.py::test_create_visit`.)

6. **`POST /api/v1/visits` with missing `record_id` returns 422.** Send `{"price": 3500}` (no `record_id`). 422 with Pydantic validation error. (Test: `test_visits.py::test_create_visit_missing_record_id_422`.)

7. **`POST /api/v1/visits` with invalid `record_id` (FK violation) returns 422.** Send `{"record_id": "nonexistent", ...}`. 422 with `code: INTEGRITY_VIOLATION` (project's standard error contract for FK violations). (Test: `test_visits.py::test_create_visit_invalid_record_id_422`.)

8. **`GET /api/v1/visits` lists all active visits.** Seed 3 visits. Call `GET /api/v1/visits`. Response is a list of 3 visits. (Test: `test_visits.py::test_list_visits`.)

9. **`GET /api/v1/visits?record_id=r1` filters by record.** Seed visits across 2 records. Call with filter. Response only contains visits for `r1`. (Test: `test_visits.py::test_list_visits_filtered_by_record`.)

10. **`PATCH /api/v1/visits/{id}` partial update.** Send `{"tariff_id": "t7b"}`. Visit's `tariff_id` changes, `price` and `status` are unchanged. Parent record's `status` is re-derived (no change if `status` wasn't touched). (Test: `test_visits.py::test_patch_visit_partial`.)

11. **`PATCH /api/v1/visits/{id}` with `status` change cascades to record.** Send `{"status": "visited"}` to a visit in record `r1` that was previously `waiting`. After PATCH, `record.status` is re-derived (e.g., becomes `visited` if all visits are now visited). (Test: `test_visits.py::test_patch_visit_status_cascades_to_record`.)

12. **`DELETE /api/v1/visits/{id}` soft-deletes and cascades.** Send DELETE. 204. Visit's `is_active = False` in DB. Parent record's `status` is re-derived (without this visit). (Test: `test_visits.py::test_delete_visit_cascades_to_record`.)

13. **`GET /api/v1/visits/{nonexistent_id}` returns 404 with `code: VISIT_NOT_FOUND`.** (Test: `test_visits.py::test_get_visit_not_found_404`.)

14. **PUT (full replace) still works.** Send `PUT /api/v1/visits/{id}` with full body. All fields are updated. (Test: `test_visits.py::test_update_visit_full_replace`.)

15. **Existing `PUT /api/v1/visits/{id}/status` still works unchanged.** (Regression test — make sure the new methods don't break the status-only PUT.)

16. **`POST /api/v1/visits` cascades to `record.seats` (+1).** Before create, `record.seats = N`. After create, `record.seats = N + 1`. Confirmed by re-fetching the record via `GET /api/v1/records/{record_id}`. (Test: `test_visits.py::test_create_visit_cascades_to_seats`.)

17. **`DELETE /api/v1/visits/{id}` cascades to `record.seats` (-1).** Before delete, `record.seats = N`. After delete, `record.seats = N - 1` (assuming `anonym_visits` unchanged). Confirmed by re-fetching the record. (Test: `test_visits.py::test_delete_visit_cascades_to_seats`.)

18. **`PATCH /api/v1/visits/{id}` does NOT change `record.seats`.** Since `is_active` is not exposed in `VisitPatch`, patching other fields (e.g., `tariff_id`, `status`, `price`) doesn't change `seats`. Confirmed by re-fetching the record. (Test: `test_visits.py::test_patch_visit_does_not_change_seats`.)

19. **`POST /api/v1/visits` rejects when capacity exceeded.** Setup: an activity with `capacity=3` and a record with 3 active visits. Try to POST a 4th visit. Response 409 with `code: ACTIVITY_AT_CAPACITY` (project's standard error code for capacity violations, per `docs/specs/2026-06-20-error-flow-design.md`). (Test: `test_visits.py::test_create_visit_rejects_when_capacity_exceeded`.)

20. **`POST /api/v1/visits` rejects when `record_id` doesn't exist.** Send `{"record_id": "nonexistent", ...}`. Response 404 with `code: RECORD_NOT_FOUND`. (Test: `test_visits.py::test_create_visit_invalid_record_id_404` — supersedes the 400 test in scenario 7, which was speculative.)

### Phase 2 — Payment PATCH

21. **`PATCH /api/v1/payments/{id}` partial update.** Send `{"method": "card"}`. Payment's `method` changes, `amount` and `record_id` unchanged. (Test: `test_payments.py::test_patch_payment_partial`.)

22. **`PATCH /api/v1/payments/{id}` with `amount: null` is silently stripped.** Send `{"amount": null, "method": "cash"}`. Payment's `amount` is unchanged (NOT_NULL strip), `method` is updated. (Test: `test_payments.py::test_patch_payment_null_amount_stripped`.)

23. **`PATCH /api/v1/payments/{id}` on non-existent ID returns 404.** (Test: `test_payments.py::test_patch_payment_not_found_404`.)

---

## Implementation phases (for writing-plans)

### Phase 0 — GH-104 minimum (small, ~40 lines)

Goal: `tariff_id` round-trips correctly. UI shows the chosen tariff. 4 files changed, 4 tests added.

- T0.1. `backend/src/models/visit.py` — add `tariff_id` column + `tariff` relationship
- T0.2. `backend/src/schemas/visit.py` — add `tariff_id: str | None = None` to `VisitResponse`
- T0.3. `backend/src/schemas/record.py` — add `tariff_id: str | None = None` to nested `VisitResponse`
- T0.4. `backend/src/api/v1/visits.py` — add `tariff_id=visit.tariff_id` to `_map_visit`
- T0.5. `backend/tests/api/test_visits.py` (or extend if exists) — add tests for scenarios 1, 4
- T0.6. `backend/tests/api/test_records.py` (or extend) — add tests for scenarios 2, 3
- T0.7. Run `pytest backend/tests/` — all green, no regressions

**Acceptance gate:** scenarios 1-4 pass. Manual sanity check: open `/admin/.../record/...` in browser, confirm Tariff dropdown shows the actual tariff name (or `—` for null), not `— тариф —` everywhere.

### Phase 1 — Visit CRUD (medium, ~360 lines)

Goal: visit can be created, listed, fully updated, partially updated, soft-deleted via direct endpoints. 4 files changed, ~15 tests added.

- T1.1. `backend/src/schemas/visit.py` — add `VisitBase`, `VisitCreate`, `VisitUpdate`, `VisitPatch` (see Schema design section)
- T1.2. `backend/src/services/visit.py` — add `list`, `create`, `update`, `patch`, `delete` methods to `VisitService` (hand-rolled, with `_derive_record_status` cascade + `seats` recomputation + capacity check on `create`)
- T1.3. `backend/src/api/v1/visits.py` — add `GET /`, `POST /`, `PUT /{id}`, `PATCH /{id}`, `DELETE /{id}` handlers (return `_map_visit` for non-list responses, `list[_map_visit]` for list)
- T1.4. `backend/tests/api/test_visits.py` — add tests for scenarios 5-15 (full CRUD + cascades)
- T1.5. `backend/tests/api/test_visit_status.py` (regression) — confirm scenario 15 (existing `PUT /visits/{id}/status` still works)
- T1.6. Run `pytest backend/tests/` — all green, including new tests

**Acceptance gate:** scenarios 5-15 pass. Manual sanity check (optional): use `curl` or `/docs` (Swagger UI) to create a visit, list visits, patch a tariff, delete — all work as expected.

### Phase 2 — Payment PATCH (small, ~50 lines)

Goal: `PATCH /api/v1/payments/{id}` exposed and tested. 3 files changed, 3 tests added.

- T2.1. `backend/src/schemas/payment.py` — add `PaymentPatch` (all fields `| None = None`)
- T2.2. `backend/src/services/payment.py` — set `NOT_NULL_FIELDS = {'amount'}` on `PaymentService`
- T2.3. `backend/src/api/v1/payments.py` — add `PATCH /{payment_id}` handler (delegates to `service.patch`)
- T2.4. `backend/tests/api/test_payments.py` — add tests for scenarios 16-18
- T2.5. Run `pytest backend/tests/` — all green

**Acceptance gate:** scenarios 16-18 pass. Existing `POST`, `PUT`, `DELETE` for payments still work (regression).

### Cross-cutting

- **Test layout:** `backend/tests/api/test_visits.py` (new or extended), `backend/tests/api/test_payments.py` (new or extended), `backend/tests/api/test_records.py` (extend for nested visit changes in Phase 0). Use existing fixtures/factories per the `pytest-patterns` skill.
- **Type-check:** `cd backend && mypy src/` (or whatever the project uses) — no new errors.
- **Migration check:** `cd backend && alembic check` — should pass with no pending migrations (we're not adding a new migration in this spec).

---

## Acceptance gates (overall)

| Gate | Criteria |
|------|----------|
| **Phase 0 done** | Scenarios 1-4 pass. UI in browser shows correct tariff names. `pytest` all green. |
| **Phase 1 done** | Scenarios 5-15, 19-23 pass. `pytest` all green. Existing `PUT /visits/{id}/status` still works (scenario 15). Cascade to `record.seats` verified (scenarios 19-21). Capacity check enforced (scenario 22). |
| **Phase 2 done** | Scenarios 16-18 pass. `pytest` all green. Existing `POST`/`PUT`/`DELETE` for payments still work. |
| **Overall** | All 23 scenarios pass. No new `mypy` errors. `pytest` 100% green. Frontend can now rely on `tariff_id` in `VisitResponse` and can use direct visit endpoints (re-enables the deferred `RecordVisitsTable` refactor at `4c031a5`). |

---

## Visual Compliance Checks (N/A for backend)

This spec is backend-only; no UI changes. The visual compliance checks for the eventual UI fix live in the deferred frontend spec (`4c031a5`, section `## Visual Compliance Checks`). Backend correctness is verified via API tests in `backend/tests/api/`.

---

## Risks

### Known debt: `VisitResponse` is duplicated

There are two `VisitResponse` Pydantic classes:
- `backend/src/schemas/visit.py:VisitResponse` (used by `GET /visits/{id}`, `PUT /visits/{id}/status`)
- `backend/src/schemas/record.py:VisitResponse` (nested in `RecordResponse`)

This spec adds `tariff_id` to **both**, but does NOT deduplicate them. Drift risk persists. Track as a follow-up issue (de-dedupe `VisitResponse` by importing one from the other). Not a blocker — the field set is small and the spec is explicit about updating both.

### `tariff_id` cascade on visit update is not implemented

When a visit's `tariff_id` changes, the **record's `total_cost` is NOT re-derived** by the backend. The `Record` model has no `total_cost` column (verified at `backend/src/models/record.py` — only `status`, `seats`, `anonym_visits`, `comment`, `custom_price` are stored; no `total_cost` denormalization). The frontend computes total cost from visits on the fly. No cascade needed for `total_cost`. **Resolved: no risk.**

### `seats` cascade IS implemented (added in revision)

When a visit is created, `record.seats` must increment by 1. When soft-deleted, decrement by 1. When patched/updated (no `is_active` change), no change. This is covered by scenarios 19-21 and the new `_derive_record_seats` helper in `VisitService`. **Resolved.**

### Capacity check on visit create is enforced

`POST /api/v1/visits` must check that adding the visit doesn't exceed the activity's `capacity` field. This is covered by scenario 19 and reuses `RecordService._check_capacity` (existing static method at `services/record.py:294`). **Resolved.**

### `RecordResponse` visits round-trip test depends on nested schema

Scenario 2 (`GET /api/v1/records/{id}` returns visits with `tariff_id`) depends on the nested `VisitResponse` in `RecordResponse` being updated. If the implementer forgets T0.3, scenario 2 will fail. The test must explicitly assert the nested field, not just the top-level.

### `GenericService.patch` `NOT_NULL_FIELDS` interaction with `PaymentPatch`

`GenericService.patch` (line 91) iterates over `self.NOT_NULL_FIELDS` and strips `None` values. If `PaymentService.NOT_NULL_FIELDS = {'amount'}` is set, a PATCH with `{"amount": null}` silently drops it. The frontend might receive a 200 response but the `amount` wasn't actually updated. Document this in `PaymentPatch` schema docstring: "Setting `amount: null` is a no-op (stripped by the service)."

### `update_visit_status` (existing endpoint) may need to call `_derive_record_status` from a new method

The existing `update_visit_status` already calls `_derive_record_status` (line 33 of `services/visit.py`). Phase 1's new `update`/`patch` methods also call it. Refactoring `_derive_record_status` into a non-static method (or extracting it to a helper) is recommended for code reuse. Optional refactor — not a blocker.

---

## Out of scope (deferred)

- **Frontend `RecordVisitsTable` / `RecordPaymentsTable` refactor.** Spec at `4c031a5` on main. Awaiting this spec to ship.
- **Replace `patchRecord({visits: [...]})` with new POST/PATCH endpoints in `useRecordMutations`.** Will be done as part of the frontend refactor.
- **Dedupe `VisitResponse` Pydantic class** (one in `visit.py`, one nested in `record.py`). Follow-up issue.
- **Eager loading of `tariff` relationship** (Phase 0 only adds the relationship, not eager loading). Performance follow-up if N+1 queries become a problem.
- **Visit ordering / sort** (which visit is "first" in the list). Not in scope; sort by `created_at` is the current behavior.
- **Visit `tariff_id` immutability** (should you be allowed to change a tariff after the visit is created?). For now, yes (via PATCH). If business rules change, this can be enforced in the service layer.
- **Visit price recalculation on tariff change** (if you change a visit's `tariff_id`, should `price` auto-update to the new tariff's price?). Not in this spec. Could be a frontend-driven UX improvement.
- **Bulk visit operations** (create multiple visits in one request). Not in this spec. The existing `patchRecord({visits: [...]})` covers this use case.

---

## Open questions for user (none blocking)

None — all design decisions are made. The Phase 0/1/2 split is explicit; the user can choose to ship all three as one PR or three separate ones. The hook signature, service-layer patterns, and error contracts all follow the existing codebase conventions.
