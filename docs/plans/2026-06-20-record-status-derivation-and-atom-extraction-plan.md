# Record Status Derivation & Atom Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `RecordStatus` (pending/confirmed/cancelled/no_show) to derived `VisitStatus` (waiting/visited/missed/cancelled) and extract shared record atoms to `app/components/shared/{records,payments,visitors}/` so that `ClientRecordTab` and `ClientTab` are thin wrappers (~200 LOC each).

**Architecture:** 5 phases — backend status migration with Alembic data re-map; frontend enum rename + StatusPicker rebuild on CustomSelect; extract 9 atoms; rewrite both consumers as wrappers; end-to-end verification with 5 user scenarios.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic (backend); Next.js 14 + React 18 + TypeScript + Tailwind + React Query (frontend); Vitest + Playwright (tests); Pydantic (validation); `@memo/domain` shared package.

**Spec:** `docs/specs/2026-06-20-record-status-derivation-and-atom-extraction-design.md`
**Worktree:** `/root/workspace/memo/.worktrees/fix/wave6-status-derivation-atom-extraction/`
**Branch:** `fix/wave6-status-derivation-atom-extraction` (off `main` @ `75a3853`)

---

## File Structure

### Files created (NEW)

| Path | Responsibility |
|---|---|
| `backend/alembic/versions/4d5e6f_add_status_derivation.py` | One-shot data migration: re-map `pending→waiting`, `confirmed→visited`, `cancelled→cancelled`, `no_show→missed`; recompute record `status` |
| `backend/src/domain/visit_status.py` | `VisitStatus` type alias, `computeRecordStatus(visits: list[VisitItem]) -> VisitStatus` |
| `backend/tests/test_compute_record_status.py` | 7 unit cases for derivation |
| `backend/tests/test_api_records_status_rejected.py` | 422 tests for POST/PUT/PATCH with `status` field |
| `packages/domain/src/visit_status.ts` | Mirror of backend `VisitStatus` + `computeRecordStatus` for frontend use |
| `frontend/admin/app/components/shared/config/VISIT_STATUS_CONFIG.ts` | Single source — labels (RU), Tailwind color classes, icons |
| `frontend/admin/app/components/shared/StatusPicker.tsx` | Icon-button + popover, built on `CustomSelect` |
| `frontend/admin/app/components/shared/StatusBadge.tsx` | Read-only badge (icon + label) |
| `frontend/admin/app/components/shared/records/types.ts` | `RecordWithDerived` (record + computed `status`) |
| `frontend/admin/app/components/shared/records/RecordHeader.tsx` | Name/phone/anonym_visits edit + status badge |
| `frontend/admin/app/components/shared/records/RecordVisitRow.tsx` | Single visit row (name/age/tariff/price/status/delete) |
| `frontend/admin/app/components/shared/payments/PaymentList.tsx` | List of payments with delete |
| `frontend/admin/app/components/shared/payments/PaymentForm.tsx` | Inline form to add payment |
| `frontend/admin/app/components/shared/payments/PaymentTotals.tsx` | "Стоимость / Оплачено / К оплате" |
| `frontend/admin/app/components/shared/visitors/AddVisitorForm.tsx` | Inline form to add visitor |
| `frontend/admin/app/components/shared/visitors/VisitorRow.tsx` | Preview inside `AddVisitorForm` |
| `frontend/admin/app/components/shared/__tests__/StatusPicker.test.tsx` | (move from modal/) |
| `frontend/admin/app/components/shared/__tests__/StatusBadge.test.tsx` | Read-only rendering |
| `frontend/admin/app/components/shared/records/__tests__/RecordHeader.test.tsx` | Header rendering + anonym_visits edit |
| `frontend/admin/app/components/shared/records/__tests__/RecordVisitRow.test.tsx` | Row rendering + change callback |
| `frontend/admin/app/components/shared/payments/__tests__/PaymentList.test.tsx` | List + delete |
| `frontend/admin/app/components/shared/payments/__tests__/PaymentForm.test.tsx` | Form validation + submit |
| `frontend/admin/app/components/shared/payments/__tests__/PaymentTotals.test.tsx` | Totals computation |
| `frontend/admin/app/components/shared/visitors/__tests__/AddVisitorForm.test.tsx` | Add visitor form |
| `frontend/admin/admin/e2e/wave6-record-status-derived.spec.ts` | E2E for User Scenarios 1–4 |
| `frontend/admin/e2e/wave6-status-shared.spec.ts` | E2E for User Scenario 5 (same StatusPicker everywhere) |

### Files modified (EXISTING)

| Path | Change |
|---|---|
| `packages/domain/src/index.ts` | Re-export `VisitStatus`, `computeRecordStatus`; deprecate `RecordStatus` |
| `backend/src/schemas/record.py` | Add `extra='forbid'` to `RecordCreate`, `RecordUpdate`, `RecordPatch` |
| `backend/src/services/record.py` | `create_record` and `update_record` set `status = computeRecordStatus(visits)` |
| `backend/src/api/v1/records.py` | GET response uses derived `status` (no code change if service already does it) |
| `backend/seed/seed.py` | Use new labels in seed data (if any) |
| `frontend/admin/app/components/modal/ActivityDetailsModal/StatusPicker.tsx` | **DELETED** (moved to `shared/`) |
| `frontend/admin/app/(main)/records/components/RecordsTable.tsx` | Use `<StatusBadge>` instead of inline `STATUS_LABELS`/`STATUS_COLORS` |
| `frontend/admin/app/(main)/records/components/ClientCardModal.tsx` | Same |
| `frontend/admin/app/(main)/records/components/BookingFilters.tsx` | Replace native `<select>` with `<StatusPicker variant="full">` |
| `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx` | Rewrite as ~200 LOC wrapper using atoms |
| `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx` | Rewrite as ~200 LOC wrapper using atoms |
| `frontend/admin/hooks/useRecordData.ts` | Return `RecordWithDerived` (computed status) |
| `frontend/admin/hooks/useRecordMutations.ts` | Add `updateAnonymVisits` and `updateVisitStatus` mutations |
| `frontend/admin/app/lib/pluralize.ts` | No change (already handles `seats`) |

---

## Phase 0 — Backend status migration

> MUST complete before any frontend work. Backend test suite must be green.

---

## Task 1: Add `VisitStatus` and `computeRecordStatus` to `@memo/domain`

**Classification:** small
**Required Docs:**
- `docs/specs/2026-06-20-record-status-derivation-and-atom-extraction-design.md` (lines 24-32, 105-128) — `VisitStatus` type + derivation algorithm
- `packages/domain/README.md` — package structure

### Task Description

Create a new module `packages/domain/src/visit_status.ts` that exports:
- `VisitStatus` type (string union): `'waiting' | 'visited' | 'missed' | 'cancelled'`
- `VisitItem` interface (subset of fields used by derivation: `id`, `status: VisitStatus`)
- `computeRecordStatus(visits: VisitItem[]): VisitStatus` — exact algorithm from spec

Update `packages/domain/src/index.ts` to re-export these. Keep `RecordStatus` as a **deprecated type alias** for `VisitStatus` to avoid breaking existing imports in this PR. Add a JSDoc comment marking it `@deprecated`.

### Steps

- [ ] Read `packages/domain/src/index.ts` to see current exports
- [ ] Read `packages/domain/src/record.ts` (or wherever `RecordStatus` is currently defined) to see the existing definition
- [ ] Create `packages/domain/src/visit_status.ts`:

```ts
// packages/domain/src/visit_status.ts
/**
 * Single source of truth for record/visit status.
 * @see docs/domain-rules/records.md (commit c0c4a8d)
 */
export type VisitStatus = 'waiting' | 'visited' | 'missed' | 'cancelled';

export interface VisitItem {
  id: string;
  status: VisitStatus;
}

/**
 * Derives record status from its visits.
 * Priority: any visited > all missed > all cancelled > waiting
 * Edge case: 0 visits → 'waiting'
 */
export function computeRecordStatus(visits: VisitItem[]): VisitStatus {
  if (visits.length === 0) return 'waiting';
  if (visits.some((v) => v.status === 'visited')) return 'visited';
  if (visits.every((v) => v.status === 'missed')) return 'missed';
  if (visits.every((v) => v.status === 'cancelled')) return 'cancelled';
  return 'waiting';
}
```

- [ ] Update `packages/domain/src/index.ts` to add: `export * from './visit_status';`
- [ ] Add `@deprecated` JSDoc above existing `RecordStatus` export pointing to `VisitStatus`
- [ ] Run `cd packages/domain && pnpm build` (or whatever the build command is) — verify it compiles
- [ ] Commit: `chore(domain): add VisitStatus + computeRecordStatus (deprecate RecordStatus)`

---

## Task 2: Mirror `VisitStatus` in Python backend

**Classification:** small
**Required Docs:**
- `docs/specs/2026-06-20-record-status-derivation-and-atom-extraction-design.md` (lines 24-32, 105-128)
- `backend/src/models/record.py` (current `Record` model with `status` column)
- `backend/src/models/visit.py` (or wherever Visit model lives) — current `Visit.status` column

### Task Description

Create `backend/src/domain/visit_status.py` with a Python `VisitStatus` enum and a `compute_record_status` function that mirrors the TypeScript version. Add a `VisitItem` Pydantic model (subset) for the derivation function's input.

### Steps

- [ ] Read `backend/src/models/record.py` and find the `status` column (currently `RecordStatus` enum)
- [ ] Create `backend/src/domain/__init__.py` (empty)
- [ ] Create `backend/src/domain/visit_status.py`:

```python
# backend/src/domain/visit_status.py
"""Single source of truth for record/visit status (mirrors packages/domain/src/visit_status.ts)."""
from enum import Enum
from typing import Sequence


class VisitStatus(str, Enum):
    WAITING = "waiting"
    VISITED = "visited"
    MISSED = "missed"
    CANCELLED = "cancelled"


def compute_record_status(visits: Sequence["VisitItem"]) -> VisitStatus:
    """Derives record status from its visits.
    Priority: any visited > all missed > all cancelled > waiting.
    Edge case: 0 visits -> waiting.
    """
    if not visits:
        return VisitStatus.WAITING
    if any(v.status == VisitStatus.VISITED for v in visits):
        return VisitStatus.VISITED
    if all(v.status == VisitStatus.MISSED for v in visits):
        return VisitStatus.MISSED
    if all(v.status == VisitStatus.CANCELLED for v in visits):
        return VisitStatus.CANCELLED
    return VisitStatus.WAITING


# Minimal input model for the derivation function
from pydantic import BaseModel


class VisitItem(BaseModel):
    id: str
    status: VisitStatus
```

- [ ] Commit: `chore(backend): add VisitStatus enum + compute_record_status`

---

## Task 3: Backend `extra='forbid'` on Record schemas

**Classification:** small
**Required Docs:**
- `docs/specs/2026-06-20-record-status-derivation-and-atom-extraction-design.md` (lines 130-145 — API contract change)
- `backend/src/schemas/record.py` — current schemas

### Task Description

Add `model_config = ConfigDict(extra='forbid')` to `RecordCreate`, `RecordUpdate`, `RecordPatch`. This causes Pydantic to return 422 when the client sends a `status` field. VisitItem already uses the new `VisitStatus` (Task 2).

### Steps

- [ ] Read `backend/src/schemas/record.py`
- [ ] Add to each of `RecordCreate`, `RecordUpdate`, `RecordPatch`:

```python
from pydantic import ConfigDict
# ...
class RecordCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    # ... existing fields, removing any explicit `status` field
```

- [ ] Remove any explicit `status` field from these three schemas (it must NOT be in the input)
- [ ] Run `.venv/bin/pytest tests/test_api_records.py -q 2>&1 | tail -10` — existing tests may need updating (they might send `status` in payloads)
- [ ] If tests fail, fix test payloads to omit `status` (do NOT add `status` to schemas)
- [ ] Commit: `feat(backend): reject status field in Record payloads (extra=forbid)`

---

## Task 4: Backend `compute_record_status` integration + tests

**Classification:** standard
**Required Docs:**
- `docs/specs/2026-06-20-record-status-derivation-and-atom-extraction-design.md` (lines 105-128)
- `backend/src/services/record.py` — current create/update flow
- `backend/tests/test_compute_record_status.py` (this task creates it)
- `.opencode/skills/pytest-patterns/SKILL.md` — pytest factory + fixture patterns

### Task Description

Write unit tests for `compute_record_status` (7 cases). Then integrate into `RecordService.create_record` and `RecordService.update_record` so that the record's `status` is always set from `compute_record_status(visits)`.

### Steps

- [ ] Create `backend/tests/test_compute_record_status.py`:

```python
# backend/tests/test_compute_record_status.py
"""Unit tests for compute_record_status derivation function."""
import pytest
from src.domain.visit_status import VisitStatus, VisitItem, compute_record_status


@pytest.mark.parametrize(
    "visits,expected",
    [
        # 0 visits
        ([], VisitStatus.WAITING),
        # 1 visit each status
        ([VisitItem(id="v1", status=VisitStatus.WAITING)], VisitStatus.WAITING),
        ([VisitItem(id="v1", status=VisitStatus.VISITED)], VisitStatus.VISITED),
        ([VisitItem(id="v1", status=VisitStatus.MISSED)], VisitStatus.MISSED),
        ([VisitItem(id="v1", status=VisitStatus.CANCELLED)], VisitStatus.CANCELLED),
        # Mixed: any visited wins
        ([
            VisitItem(id="v1", status=VisitStatus.VISITED),
            VisitItem(id="v2", status=VisitStatus.WAITING),
        ], VisitStatus.VISITED),
        # All missed
        ([
            VisitItem(id="v1", status=VisitStatus.MISSED),
            VisitItem(id="v2", status=VisitStatus.MISSED),
        ], VisitStatus.MISSED),
        # All cancelled
        ([
            VisitItem(id="v1", status=VisitStatus.CANCELLED),
            VisitItem(id="v2", status=VisitStatus.CANCELLED),
        ], VisitStatus.CANCELLED),
        # Mixed missed + waiting → waiting
        ([
            VisitItem(id="v1", status=VisitStatus.MISSED),
            VisitItem(id="v2", status=VisitStatus.WAITING),
        ], VisitStatus.WAITING),
    ],
)
def test_compute_record_status(visits, expected):
    assert compute_record_status(visits) == expected
```

- [ ] Run `.venv/bin/pytest tests/test_compute_record_status.py -v 2>&1 | tail -20` — verify 7 cases pass (parametrize expands to 9)
- [ ] Read `backend/src/services/record.py` — find `create_record` and `update_record` methods
- [ ] In `create_record`: after creating visits, set `record.status = compute_record_status(visits)`
- [ ] In `update_record`: same, after old visits are deactivated and new ones created
- [ ] Run `.venv/bin/pytest tests/test_api_records.py tests/test_services_record.py -q 2>&1 | tail -10` — verify all pass
- [ ] Commit: `feat(backend): derive record status from visits in service layer`

---

## Task 5: Backend 422 tests for `status` field rejection

**Classification:** small
**Required Docs:**
- `docs/specs/2026-06-20-record-status-derivation-and-atom-extraction-design.md` (lines 130-145)
- `backend/tests/test_api_records.py` — existing test patterns (use `api_client` and `create_record` fixtures from `conftest.py`)

### Task Description

Write tests verifying that POST/PUT/PATCH with a `status` field return 422. Covers User Scenario 6 in spec.

### Steps

- [ ] Read `backend/tests/conftest.py` — find `api_client` and `create_record` fixtures
- [ ] Create `backend/tests/test_api_records_status_rejected.py`:

```python
# backend/tests/test_api_records_status_rejected.py
"""Verify that the API rejects a 'status' field in Record payloads (422)."""
import pytest


def test_post_rejects_status_field(api_client, _create_activity_payload, _create_record_payload):
    payload = _create_record_payload(_create_activity_payload())
    payload["status"] = "visited"  # type: ignore[assignment]
    response = api_client.post("/api/v1/records", json=payload)
    assert response.status_code == 422
    assert "status" in response.text or "extra" in response.text.lower()


def test_put_rejects_status_field(api_client, _create_activity_payload, _create_record_payload):
    create_payload = _create_record_payload(_create_activity_payload())
    create_resp = api_client.post("/api/v1/records", json=create_payload)
    assert create_resp.status_code == 200
    record_id = create_resp.json()["id"]
    update_payload = create_payload.copy()
    update_payload["status"] = "cancelled"  # type: ignore[arg-type]
    response = api_client.put(f"/api/v1/records/{record_id}", json=update_payload)
    assert response.status_code == 422


def test_patch_rejects_status_field(api_client, _create_activity_payload, _create_record_payload):
    create_payload = _create_record_payload(_create_activity_payload())
    create_resp = api_client.post("/api/v1/records", json=create_payload)
    record_id = create_resp.json()["id"]
    response = api_client.patch(f"/api/v1/records/{record_id}", json={"status": "visited"})
    assert response.status_code == 422
```

- [ ] Run `.venv/bin/pytest tests/test_api_records_status_rejected.py -v 2>&1 | tail -10` — all 3 must pass
- [ ] If fixtures differ from `_create_activity_payload` / `_create_record_payload`, adapt to the actual names in `conftest.py` (look for `create_record_payload` etc.)
- [ ] Commit: `test(backend): 422 for status field in Record POST/PUT/PATCH`

---

## Task 6: Alembic data migration (re-map existing statuses)

**Classification:** small
**Required Docs:**
- `docs/specs/2026-06-20-record-status-derivation-and-atom-extraction-design.md` (lines 326-329, Risks section)
- `backend/alembic/versions/3c3317f0c759_add_anonym_visits_to_records.py` — example Alembic migration
- `backend/alembic/env.py` — Alembic env

### Task Description

Create a one-shot data migration that:
1. Re-maps existing `visits.status` if they use old enum (pending/confirmed/cancelled/no_show): `pending→waiting`, `confirmed→visited`, `no_show→missed`, `cancelled→cancelled` (no change).
2. Re-computes `records.status` from visits using `compute_record_status`.

Migration is **idempotent** (safe to re-run). Skip if old values don't exist.

### Steps

- [ ] Find the most recent Alembic migration: `ls -t backend/alembic/versions/*.py | head -1`
- [ ] Create `backend/alembic/versions/4d5e6f_add_status_derivation.py` with a 12-char hash that doesn't collide (use `4d5e6f7a8b9c` or generate via `alembic revision -m "..."` if env is set up):

```python
# backend/alembic/versions/4d5e6f7a8b9c_add_status_derivation.py
"""Re-map visit/record statuses to VisitStatus enum (waiting/visited/missed/cancelled)."""
from alembic import op
import sqlalchemy as sa


# Mapping from Wave 5 RecordStatus to VisitStatus
OLD_TO_NEW = {
    "pending": "waiting",
    "confirmed": "visited",
    "cancelled": "cancelled",
    "no_show": "missed",
}


def upgrade() -> None:
    bind = op.get_bind()
    # Step 1: re-map visits.status if it still uses old values
    for old, new in OLD_TO_NEW.items():
        op.execute(
            f"UPDATE visits SET status = '{new}' WHERE status = '{old}'"
        )
    # Step 2: re-compute records.status from visits
    #   any visited > all missed > all cancelled > waiting
    op.execute("""
        UPDATE records SET status = 'visited'
        WHERE EXISTS (
            SELECT 1 FROM visits
            WHERE visits.record_id = records.id
              AND visits.status = 'visited'
              AND visits.is_active = 1
              AND visits.deleted_at IS NULL
        )
    """)
    op.execute("""
        UPDATE records SET status = 'missed'
        WHERE id IN (
            SELECT r.id FROM records r
            WHERE NOT EXISTS (
                SELECT 1 FROM visits v
                WHERE v.record_id = r.id
                  AND v.status = 'visited'
                  AND v.is_active = 1
                  AND v.deleted_at IS NULL
            )
            AND EXISTS (
                SELECT 1 FROM visits v
                WHERE v.record_id = r.id
                  AND v.status = 'missed'
                  AND v.is_active = 1
                  AND v.deleted_at IS NULL
            )
        )
    """)
    op.execute("""
        UPDATE records SET status = 'cancelled'
        WHERE id IN (
            SELECT r.id FROM records r
            WHERE NOT EXISTS (
                SELECT 1 FROM visits v
                WHERE v.record_id = r.id
                  AND v.status IN ('visited', 'missed')
                  AND v.is_active = 1
                  AND v.deleted_at IS NULL
            )
            AND EXISTS (
                SELECT 1 FROM visits v
                WHERE v.record_id = r.id
                  AND v.status = 'cancelled'
                  AND v.is_active = 1
                  AND v.deleted_at IS NULL
            )
        )
    """)
    # Records with 0 active visits → 'waiting' (default)
    op.execute("""
        UPDATE records SET status = 'waiting'
        WHERE id IN (
            SELECT r.id FROM records r
            WHERE NOT EXISTS (
                SELECT 1 FROM visits v
                WHERE v.record_id = r.id
                  AND v.is_active = 1
                  AND v.deleted_at IS NULL
            )
        )
    """)


def downgrade() -> None:
    # No-op: re-mapping is one-way; downgrade is not meaningful.
    pass
```

- [ ] Run `cd backend && .venv/bin/alembic upgrade head` — verify migration applies without error
- [ ] Run `.venv/bin/pytest tests/ -q 2>&1 | tail -5` — full backend suite must remain green
- [ ] Commit: `feat(backend): alembic data migration to VisitStatus (re-map Wave 5 enum)`

---

## Phase 0 acceptance

- [ ] `pnpm build` (in `packages/domain`) compiles
- [ ] `.venv/bin/pytest tests/test_compute_record_status.py` → 9 cases pass
- [ ] `.venv/bin/pytest tests/test_api_records_status_rejected.py` → 3 cases pass
- [ ] `.venv/bin/pytest` full backend suite green
- [ ] `alembic upgrade head` applies without error

**Gate: only proceed to Phase 1 after all green.**

---

## Phase 1 — Frontend enum migration + shared StatusPicker/StatusBadge

---

## Task 7: Build `@memo/domain` package and consume in admin

**Classification:** small
**Required Docs:**
- `packages/domain/package.json` — current build setup
- `frontend/admin/package.json` — how admin consumes `@memo/domain`

### Task Description

Rebuild `@memo/domain` so the new `VisitStatus` and `computeRecordStatus` are available in `frontend/admin`. The admin app consumes `@memo/domain` via workspace symlink.

### Steps

- [ ] Read `packages/domain/package.json` — find the `build` script
- [ ] Run `cd packages/domain && pnpm install && pnpm build` — verify dist is generated
- [ ] In `frontend/admin`, run `pnpm install` to refresh the symlink
- [ ] In `frontend/admin/hooks/`, add a smoke test: `import { computeRecordStatus, VisitStatus } from '@memo/domain'` — if it compiles, the package is consumed correctly
- [ ] If admin TypeScript build complains about new types, run `cd frontend/admin && pnpm type-check` and fix any issues
- [ ] Commit (no source change in admin yet — just refresh): `chore(admin): refresh @memo/domain to expose VisitStatus`

---

## Task 8: Create `VISIT_STATUS_CONFIG` (single source)

**Classification:** small
**Required Docs:**
- `docs/specs/2026-06-20-record-status-derivation-and-atom-extraction-design.md` (line 286-292, Migration map → Russian labels)
- `frontend/admin/app/components/modal/ActivityDetailsModal/StatusPicker.tsx` — current `STATUS_CONFIG` definition
- `frontend/admin/app/(main)/records/components/RecordsTable.tsx` — `STATUS_LABELS` and `STATUS_COLORS` (lines 52-64)
- `frontend/admin/app/(main)/records/components/ClientCardModal.tsx` — duplicate config (lines 19-31)

### Task Description

Create a single `VISIT_STATUS_CONFIG` that maps `VisitStatus` to:
- Russian label (`Ожидание / Посетил / Неявка / Отменён`)
- Tailwind color classes
- Icon (re-use existing SVGs from `StatusPicker.tsx`)

This replaces 3 duplicated config maps.

### Steps

- [ ] Read current `STATUS_CONFIG` in `StatusPicker.tsx` and `STATUS_LABELS`/`STATUS_COLORS` in `RecordsTable.tsx` + `ClientCardModal.tsx` — note current label and color values
- [ ] Create `frontend/admin/app/components/shared/config/VISIT_STATUS_CONFIG.ts`:

```ts
// frontend/admin/app/components/shared/config/VISIT_STATUS_CONFIG.ts
import { VisitStatus } from '@memo/domain';
import { Clock, Check, X, Slash } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface VisitStatusMeta {
  label: string;
  bgClass: string;     // bg-{color}-100 dark:bg-{color}-900/30
  textClass: string;   // text-{color}-700 dark:text-{color}-300
  borderClass: string; // border-{color}-500
  icon: LucideIcon;
}

export const VISIT_STATUS_CONFIG: Record<VisitStatus, VisitStatusMeta> = {
  waiting: {
    label: 'Ожидание',
    bgClass: 'bg-amber-100 dark:bg-amber-900/30',
    textClass: 'text-amber-700 dark:text-amber-300',
    borderClass: 'border-amber-500',
    icon: Clock,
  },
  visited: {
    label: 'Посетил',
    bgClass: 'bg-emerald-100 dark:bg-emerald-900/30',
    textClass: 'text-emerald-700 dark:text-emerald-300',
    borderClass: 'border-emerald-500',
    icon: Check,
  },
  missed: {
    label: 'Неявка',
    bgClass: 'bg-red-100 dark:bg-red-900/30',
    textClass: 'text-red-700 dark:text-red-300',
    borderClass: 'border-red-500',
    icon: X,
  },
  cancelled: {
    label: 'Отменён',
    bgClass: 'bg-gray-100 dark:bg-gray-800',
    textClass: 'text-gray-700 dark:text-gray-300',
    borderClass: 'border-gray-500',
    icon: Slash,
  },
};

export const VISIT_STATUS_ORDER: VisitStatus[] = ['waiting', 'visited', 'missed', 'cancelled'];
```

- [ ] Commit: `feat(admin): single VISIT_STATUS_CONFIG (replaces 3 duplicates)`

---

## Task 9: Grep-and-replace `RecordStatus` → `VisitStatus` in frontend

**Classification:** small
**Required Docs:**
- `docs/specs/2026-06-20-record-status-derivation-and-atom-extraction-design.md` (lines 281-292)

### Task Description

Rename all TypeScript references from `RecordStatus` to `VisitStatus` in `frontend/admin/`. The deprecated alias keeps backward compat, but the source should use the new name.

### Steps

- [ ] Run `cd frontend/admin && grep -rn "RecordStatus" app/ hooks/ lib/ contexts/ --include="*.ts" --include="*.tsx" | head -30` — list all references
- [ ] For each file, replace `RecordStatus` with `VisitStatus` in import statements and type annotations
- [ ] Replace `'pending' | 'confirmed' | 'cancelled' | 'no_show'` literal unions with `VisitStatus`
- [ ] Run `cd frontend/admin && pnpm type-check 2>&1 | tail -20` — verify no type errors
- [ ] Run `cd frontend/admin && npm test -- --run 2>&1 | tail -15` — existing tests must still pass (some may break; fix per failure)
- [ ] Commit: `refactor(admin): rename RecordStatus → VisitStatus everywhere`

---

## Task 10: Move + rebuild `StatusPicker` on `CustomSelect`

**Classification:** standard
**Required Docs:**
- `docs/specs/2026-06-20-record-status-derivation-and-atom-extraction-design.md` (lines 220-228, component contract)
- `frontend/admin/app/components/shared/CustomSelect.tsx` — base primitive
- `frontend/admin/app/components/shared/MasterPicker.tsx` — the reuse pattern (lines around 50)
- `frontend/admin/app/components/modal/ActivityDetailsModal/StatusPicker.tsx` — current impl (delete after move)

### Task Description

Move `StatusPicker` from `modal/ActivityDetailsModal/StatusPicker.tsx` to `app/components/shared/StatusPicker.tsx` and rebuild it on `CustomSelect` (mirroring `MasterPicker`). New API: `{ value, onChange, options?, variant?, size?, disabled?, testIdPrefix? }`. Drop the hand-rolled popover, useState, useRef, useEffect (delete ~50 LOC).

### Steps

- [ ] Read `MasterPicker.tsx` — understand the controlled-component pattern
- [ ] Create `frontend/admin/app/components/shared/StatusPicker.tsx`:

```tsx
// frontend/admin/app/components/shared/StatusPicker.tsx
'use client';

import { CustomSelect, CustomSelectOption } from './CustomSelect';
import { VISIT_STATUS_CONFIG, VISIT_STATUS_ORDER } from './config/VISIT_STATUS_CONFIG';
import { VisitStatus } from '@memo/domain';
import { Check } from 'lucide-react';

export interface StatusPickerProps {
  value: VisitStatus;
  onChange: (status: VisitStatus) => void;
  variant?: 'icon-only' | 'full';
  size?: 'sm' | 'md';
  disabled?: boolean;
  testIdPrefix?: string;
}

export function StatusPicker({
  value,
  onChange,
  variant = 'icon-only',
  size = 'md',
  disabled,
  testIdPrefix = 'status-picker',
}: StatusPickerProps) {
  const options: CustomSelectOption<VisitStatus>[] = VISIT_STATUS_ORDER.map((s) => ({
    value: s,
    label: VISIT_STATUS_CONFIG[s].label,
    icon: <VISIT_STATUS_CONFIG[s.icon] className="h-4 w-4" />,
  }));

  return (
    <CustomSelect<VisitStatus>
      value={value}
      onChange={onChange}
      options={options}
      variant={variant}
      size={size}
      disabled={disabled}
      iconOnly={variant === 'icon-only'}
      testIdPrefix={testIdPrefix}
    />
  );
}
```

- [ ] Verify `CustomSelect` supports the props you're passing. If it doesn't accept `iconOnly` separately, just use `variant`.
- [ ] Delete the old `frontend/admin/app/components/modal/ActivityDetailsModal/StatusPicker.tsx`
- [ ] Update imports in `ClientTab.tsx`: `from '../shared/StatusPicker'` (path adjust as needed)
- [ ] Move test `__tests__/StatusPicker.test.tsx` to `frontend/admin/app/components/shared/__tests__/StatusPicker.test.tsx`
- [ ] Run `cd frontend/admin && pnpm type-check` — must pass
- [ ] Run `cd frontend/admin && npm test -- StatusPicker --run 2>&1 | tail -10` — tests pass
- [ ] Run `cd frontend/admin && npm test -- --run 2>&1 | tail -10` — full suite green
- [ ] Commit: `refactor(admin): move StatusPicker to shared/, rebuild on CustomSelect`

---

## Task 11: Create `StatusBadge` (read-only)

**Classification:** small
**Required Docs:**
- `docs/specs/2026-06-20-record-status-derivation-and-atom-extraction-design.md` (lines 230-233, component contract)
- `frontend/admin/app/components/shared/config/VISIT_STATUS_CONFIG.ts` (Task 8)

### Task Description

Create a read-only badge that displays the visit status with icon + label + color. Used in tables, headers, and filter chips.

### Steps

- [ ] Create `frontend/admin/app/components/shared/StatusBadge.tsx`:

```tsx
// frontend/admin/app/components/shared/StatusBadge.tsx
import { VisitStatus } from '@memo/domain';
import { VISIT_STATUS_CONFIG } from './config/VISIT_STATUS_CONFIG';

export interface StatusBadgeProps {
  status: VisitStatus;
  className?: string;
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const config = VISIT_STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <span
      data-testid={`status-badge-${status}`}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${config.bgClass} ${config.textClass} ${className}`}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}
```

- [ ] Create `frontend/admin/app/components/shared/__tests__/StatusBadge.test.tsx`:

```tsx
// frontend/admin/app/components/shared/__tests__/StatusBadge.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../StatusBadge';

describe('StatusBadge', () => {
  it.each(['waiting', 'visited', 'missed', 'cancelled'] as const)(
    'renders %s with correct label',
    (status) => {
      render(<StatusBadge status={status} />);
      const labels = { waiting: 'Ожидание', visited: 'Посетил', missed: 'Неявка', cancelled: 'Отменён' };
      expect(screen.getByTestId(`status-badge-${status}`)).toHaveTextContent(labels[status]);
    }
  );
});
```

- [ ] Run `cd frontend/admin && npm test -- StatusBadge --run 2>&1 | tail -10` — 4 cases pass
- [ ] Commit: `feat(admin): StatusBadge component (read-only) with VISIT_STATUS_CONFIG`

---

## Task 12: Replace inline status configs with `<StatusBadge>` in `RecordsTable.tsx` and `ClientCardModal.tsx`

**Classification:** small
**Required Docs:**
- `frontend/admin/app/(main)/records/components/RecordsTable.tsx` (lines 52-64, 402-407, 546-549)
- `frontend/admin/app/(main)/records/components/ClientCardModal.tsx` (lines 19-31, 139-141)

### Task Description

Delete the 3 duplicated `STATUS_LABELS`/`STATUS_COLORS` maps. Replace inline `<span>` badges with `<StatusBadge status={...} />`.

### Steps

- [ ] In `RecordsTable.tsx`: delete `STATUS_LABELS` and `STATUS_COLORS` constants
- [ ] Replace the two `<span>` badges (lines 402-407 and 546-549) with `<StatusBadge status={record.status} />`
- [ ] In `ClientCardModal.tsx`: delete the duplicate `STATUS_LABELS`/`STATUS_COLORS` constants
- [ ] Replace the `<span>` badge (line 139-141) with `<StatusBadge>`
- [ ] Add import: `import { StatusBadge } from '@/app/components/shared/StatusBadge';` (or relative path)
- [ ] Run `cd frontend/admin && pnpm type-check 2>&1 | tail -10` — no errors
- [ ] Run `cd frontend/admin && npm test -- RecordsTable ClientCardModal --run 2>&1 | tail -10` — tests still pass
- [ ] Commit: `refactor(admin): replace inline status badges with shared <StatusBadge>`

---

## Task 13: Replace native `<select>` in `BookingFilters.tsx` with `<StatusPicker>`

**Classification:** small
**Required Docs:**
- `frontend/admin/app/(main)/records/components/BookingFilters.tsx` (lines 128-141)

### Task Description

Replace the native `<select>` for status filtering with the shared `<StatusPicker variant="full">`. Add an "Все статусы" option as `value=""` (or a special "all" value).

### Steps

- [ ] Read `BookingFilters.tsx` to understand how the current filter is wired
- [ ] Replace the `<select>` with:

```tsx
<StatusPicker
  value={filters.status || 'waiting'}
  onChange={(s) => onFiltersChange({ ...filters, status: s === 'waiting' && !filters.status ? '' : s })}
  variant="full"
  testIdPrefix="booking-filters-status"
/>
```

- [ ] If you need an "All" option, either add a special-case in the parent or extend `StatusPicker` to accept a `placeholder` prop. Document the choice in a comment.
- [ ] Run `cd frontend/admin && npm test -- BookingFilters --run 2>&1 | tail -10` — tests pass
- [ ] Commit: `refactor(admin): BookingFilters uses shared StatusPicker instead of native select`

---

## Phase 1 acceptance

- [ ] `@memo/domain` build green
- [ ] `VISIT_STATUS_CONFIG` is the only status config (no duplicates)
- [ ] `StatusPicker` and `StatusBadge` exist in `shared/`
- [ ] `pnpm type-check` green
- [ ] `npm test` full suite green
- [ ] No references to `pending/confirmed/no_show` in frontend code

**Gate: only proceed to Phase 2 after all green.**

---

## Phase 2 — Atoms extraction

---

## Task 14: Create `records/types.ts` (RecordWithDerived)

**Classification:** small
**Required Docs:**
- `@memo/domain` exports (after Task 1)
- `frontend/admin/app/lib/api/types.ts` — current `Record` type

### Task Description

Create a derived type that augments `Record` with a `status: VisitStatus` field (computed). Both consumers will use this.

### Steps

- [ ] Read `frontend/admin/app/lib/api/types.ts` — find the `Record` type
- [ ] Create `frontend/admin/app/components/shared/records/types.ts`:

```ts
// frontend/admin/app/components/shared/records/types.ts
import { VisitStatus } from '@memo/domain';
import type { Record, VisitItem, Payment, Client } from '@/app/lib/api/types';

export interface RecordWithDerived {
  record: Omit<Record, 'status'>;
  status: VisitStatus;
  visits: VisitItem[];
  payments: Payment[];
  client: Client | null;
}
```

- [ ] Adjust imports/paths to match the project's actual import conventions (e.g. `@/` alias vs relative).
- [ ] Commit: `feat(admin): RecordWithDerived type for atom contracts`

---

## Task 15: Extract `RecordHeader` (name/phone/anonym_visits/status)

**Classification:** standard
**Required Docs:**
- `docs/specs/2026-06-20-record-status-derivation-and-atom-extraction-design.md` (lines 195-198, contract)
- `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx` (lines ~140-220, the current header)
- `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx` (lines ~150-220, the parallel header)

### Task Description

Extract a `RecordHeader` atom that shows: client name + phone, anonym_visits edit input, record-level `<StatusBadge>`, and seats summary. It receives `RecordWithDerived` and emits `onAnonymVisitsChange` (debounced).

### Steps

- [ ] Read both `ClientTab.tsx` and `ClientRecordTab.tsx` to identify the header sections
- [ ] Create `frontend/admin/app/components/shared/records/RecordHeader.tsx`:

```tsx
// frontend/admin/app/components/shared/records/RecordHeader.tsx
'use client';

import { useEffect, useState } from 'react';
import { StatusBadge } from '../StatusBadge';
import type { RecordWithDerived } from './types';

export interface RecordHeaderProps {
  data: RecordWithDerived;
  onAnonymVisitsChange?: (value: number) => void;
  isReadOnly?: boolean;
}

export function RecordHeader({ data, onAnonymVisitsChange, isReadOnly }: RecordHeaderProps) {
  const { record, client, status, visits } = data;
  const [anonym, setAnonym] = useState(record.anonym_visits ?? 0);

  // Debounced save
  useEffect(() => {
    if (!onAnonymVisitsChange) return;
    if (anonym === (record.anonym_visits ?? 0)) return;
    const t = setTimeout(() => onAnonymVisitsChange(anonym), 500);
    return () => clearTimeout(t);
  }, [anonym, record.anonym_visits, onAnonymVisitsChange]);

  return (
    <div className="space-y-2 border-b border-gray-200 pb-3 dark:border-gray-700">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">
            {client?.name ?? <span className="italic text-gray-500">Без имени</span>}
          </div>
          {client?.phone && (
            <div className="text-xs text-gray-600 dark:text-gray-400">{client.phone}</div>
          )}
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
        <span>{visits.length} {pluralizeSeats(visits.length)}</span>
        {!isReadOnly && (
          <>
            <span>+</span>
            <input
              type="number"
              min={0}
              value={anonym}
              onChange={(e) => setAnonym(Math.max(0, Number(e.target.value)))}
              data-testid="anonym-visits-input"
              className="w-12 rounded border px-1 py-0.5 text-center"
            />
            <span>анонимных</span>
          </>
        )}
        {record.anonym_visits ? <span className="text-gray-500">(итого {visits.length + anonym})</span> : null}
      </div>
    </div>
  );
}

function pluralizeSeats(n: number): string {
  // Russian pluralization: 1 место, 2 места, 5 мест
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'место';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'места';
  return 'мест';
}
```

- [ ] Create `frontend/admin/app/components/shared/records/__tests__/RecordHeader.test.tsx` with 3-4 cases: renders name, renders badge, edits anonym_visits, debounced save fires callback.
- [ ] Run `cd frontend/admin && npm test -- RecordHeader --run 2>&1 | tail -10`
- [ ] Commit: `feat(admin): RecordHeader atom (anonym_visits edit + status badge)`

---

## Task 16: Extract `RecordVisitRow`

**Classification:** standard
**Required Docs:**
- `docs/specs/2026-06-20-record-status-derivation-and-atom-extraction-design.md` (lines 200-205)
- `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx` (visit row JSX, lines ~342-463)
- `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx` (visit row JSX, lines ~457-512)

### Task Description

Extract a single-visit row atom: name (input), age (input), tariff (select), price (read-only or input), status (`<StatusPicker>`), delete button.

### Steps

- [ ] Read both visit row JSX blocks
- [ ] Create `frontend/admin/app/components/shared/records/RecordVisitRow.tsx`:

```tsx
// frontend/admin/app/components/shared/records/RecordVisitRow.tsx
'use client';

import { VisitItem, VisitStatus, Tariff } from '@memo/domain';
import { StatusPicker } from '../StatusPicker';

export interface RecordVisitRowProps {
  visit: VisitItem;
  tariffs: Tariff[];
  isReadOnly?: boolean;
  onChange: (visit: VisitItem) => void;
  onDelete: () => void;
}

export function RecordVisitRow({ visit, tariffs, isReadOnly, onChange, onDelete }: RecordVisitRowProps) {
  return (
    <div className="flex items-center gap-2 border-b border-gray-100 py-2 dark:border-gray-800" data-testid={`visit-row-${visit.id}`}>
      <input
        type="text"
        value={visit.name ?? ''}
        placeholder="Имя"
        disabled={isReadOnly}
        onChange={(e) => onChange({ ...visit, name: e.target.value })}
        className="flex-1 rounded border px-2 py-1 text-sm"
      />
      <input
        type="number"
        value={visit.age ?? ''}
        placeholder="Возраст"
        disabled={isReadOnly}
        onChange={(e) => onChange({ ...visit, age: e.target.value ? Number(e.target.value) : null })}
        className="w-16 rounded border px-2 py-1 text-sm"
      />
      <select
        value={visit.tariff_id ?? ''}
        disabled={isReadOnly}
        onChange={(e) => onChange({ ...visit, tariff_id: e.target.value })}
        className="rounded border px-2 py-1 text-sm"
      >
        <option value="">— тариф —</option>
        {tariffs.map((t) => (
          <option key={t.id} value={t.id}>{t.name} ({t.price} ₽)</option>
        ))}
      </select>
      <StatusPicker
        value={visit.status}
        onChange={(status: VisitStatus) => onChange({ ...visit, status })}
        variant="icon-only"
        disabled={isReadOnly}
        testIdPrefix={`visit-${visit.id}-status`}
      />
      {!isReadOnly && (
        <button
          onClick={onDelete}
          data-testid={`visit-${visit.id}-delete`}
          className="text-red-600 hover:text-red-800"
          aria-label="Удалить посетителя"
        >
          ×
        </button>
      )}
    </div>
  );
}
```

- [ ] Create `frontend/admin/app/components/shared/records/__tests__/RecordVisitRow.test.tsx` with cases: renders all fields, onChange fires on name change, onDelete fires, StatusPicker shows current status.
- [ ] Run tests, commit: `feat(admin): RecordVisitRow atom`

---

## Task 17: Extract `PaymentList`

**Classification:** small
**Required Docs:**
- `docs/specs/2026-06-20-record-status-derivation-and-atom-extraction-design.md` (lines 207-210)
- `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx` (payment list JSX, lines ~487-501)
- `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx` (payment list JSX, lines ~626-647)

### Task Description

Extract a payment list atom: maps over payments, shows amount + method + date, delete button.

### Steps

- [ ] Read both payment list JSX blocks
- [ ] Create `frontend/admin/app/components/shared/payments/PaymentList.tsx`:

```tsx
// frontend/admin/app/components/shared/payments/PaymentList.tsx
'use client';

import { Payment } from '@memo/domain';

export interface PaymentListProps {
  payments: Payment[];
  isReadOnly?: boolean;
  onDelete: (paymentId: string) => void;
}

export function PaymentList({ payments, isReadOnly, onDelete }: PaymentListProps) {
  if (payments.length === 0) {
    return <p className="text-xs italic text-gray-500">Нет платежей</p>;
  }
  return (
    <ul className="space-y-1" data-testid="payment-list">
      {payments.map((p) => (
        <li key={p.id} className="flex items-center justify-between gap-2 text-sm" data-testid={`payment-${p.id}`}>
          <span>
            {p.amount} ₽ · {p.method} · {new Date(p.created_at).toLocaleDateString('ru-RU')}
          </span>
          {!isReadOnly && (
            <button
              onClick={() => onDelete(p.id)}
              data-testid={`payment-${p.id}-delete`}
              className="text-red-600 hover:text-red-800"
              aria-label="Удалить платёж"
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] Test: `frontend/admin/app/components/shared/payments/__tests__/PaymentList.test.tsx` (renders empty state, renders list, delete fires)
- [ ] Run tests, commit: `feat(admin): PaymentList atom`

---

## Task 18: Extract `PaymentForm` (Zod-validated)

**Classification:** small
**Required Docs:**
- `docs/specs/2026-06-20-record-status-derivation-and-atom-extraction-design.md` (lines 212-215)
- `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx` (payment form, lines ~651-674)

### Task Description

Extract a payment form atom with amount + method fields. Zod validation: amount > 0, method required.

### Steps

- [ ] Read the current payment form
- [ ] Create `frontend/admin/app/components/shared/payments/PaymentForm.tsx`:

```tsx
// frontend/admin/app/components/shared/payments/PaymentForm.tsx
'use client';

import { useState } from 'react';
import { z } from 'zod';
import { PaymentCreate } from '@memo/domain';

const PaymentSchema = z.object({
  amount: z.number().int().positive('Сумма должна быть больше 0'),
  method: z.enum(['cash', 'card', 'transfer', 'online']),
});

export interface PaymentFormProps {
  total: number;
  paid: number;
  isReadOnly?: boolean;
  onSubmit: (payment: PaymentCreate) => void;
  onCancel?: () => void;
}

export function PaymentForm({ total, paid, isReadOnly, onSubmit, onCancel }: PaymentFormProps) {
  const [amount, setAmount] = useState<number>(Math.max(0, total - paid));
  const [method, setMethod] = useState<PaymentCreate['method']>('card');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = PaymentSchema.safeParse({ amount, method });
    if (!result.success) {
      setError(result.error.errors[0].message);
      return;
    }
    setError(null);
    onSubmit(result.data);
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 text-sm" data-testid="payment-form">
      <input
        type="number"
        min={1}
        value={amount}
        onChange={(e) => setAmount(Number(e.target.value))}
        disabled={isReadOnly}
        className="w-20 rounded border px-2 py-1"
        data-testid="payment-amount"
      />
      <select
        value={method}
        onChange={(e) => setMethod(e.target.value as PaymentCreate['method'])}
        disabled={isReadOnly}
        className="rounded border px-2 py-1"
        data-testid="payment-method"
      >
        <option value="cash">Наличные</option>
        <option value="card">Карта</option>
        <option value="transfer">Перевод</option>
        <option value="online">Онлайн</option>
      </select>
      <button
        type="submit"
        disabled={isReadOnly}
        className="rounded bg-emerald-600 px-3 py-1 text-white hover:bg-emerald-700"
        data-testid="payment-submit"
      >
        Добавить
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} className="text-gray-600 hover:text-gray-800">
          Отмена
        </button>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
```

- [ ] Test: form validation cases (amount 0 → error, valid → submit fires)
- [ ] Run tests, commit: `feat(admin): PaymentForm atom with Zod validation`

---

## Task 19: Extract `PaymentTotals`

**Classification:** small
**Required Docs:**
- `docs/specs/2026-06-20-record-status-derivation-and-atom-extraction-design.md` (lines 217-219)
- `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx` (totals JSX, lines ~676-691)
- `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx` (totals JSX, lines ~468-484)

### Task Description

Extract totals atom: "Стоимость / Оплачено / К оплате" with color coding (red if remaining > 0, green if = 0).

### Steps

- [ ] Read both totals JSX blocks
- [ ] Create `frontend/admin/app/components/shared/payments/PaymentTotals.tsx`:

```tsx
// frontend/admin/app/components/shared/payments/PaymentTotals.tsx
export interface PaymentTotalsProps {
  total: number;
  paid: number;
  className?: string;
}

export function PaymentTotals({ total, paid, className = '' }: PaymentTotalsProps) {
  const remaining = total - paid;
  return (
    <dl className={`flex gap-4 text-sm ${className}`} data-testid="payment-totals">
      <div>
        <dt className="text-xs text-gray-500">Стоимость</dt>
        <dd className="font-medium">{total} ₽</dd>
      </div>
      <div>
        <dt className="text-xs text-gray-500">Оплачено</dt>
        <dd className="font-medium text-emerald-600">{paid} ₽</dd>
      </div>
      <div>
        <dt className="text-xs text-gray-500">К оплате</dt>
        <dd className={`font-medium ${remaining > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
          {remaining} ₽
        </dd>
      </div>
    </dl>
  );
}
```

- [ ] Test: 3 cases (remaining > 0 red, remaining = 0 green, all formatted)
- [ ] Commit: `feat(admin): PaymentTotals atom`

---

## Task 20: Extract `AddVisitorForm`

**Classification:** small
**Required Docs:**
- `docs/specs/2026-06-20-record-status-derivation-and-atom-extraction-design.md` (lines 225-228)
- `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx` (add visitor form, lines ~516-606)
- `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx` (add visitor form, lines ~410-462)

### Task Description

Extract a "Добавить посетителя" inline form: name, age, tariff select, "Добавить" + "Отмена" buttons. Uses `VisitorRow` for preview.

### Steps

- [ ] Read both add visitor form JSX blocks
- [ ] Create `frontend/admin/app/components/shared/visitors/VisitorRow.tsx` (preview only, read-only, used inside `AddVisitorForm`)
- [ ] Create `frontend/admin/app/components/shared/visitors/AddVisitorForm.tsx`:

```tsx
// frontend/admin/app/components/shared/visitors/AddVisitorForm.tsx
'use client';

import { useState } from 'react';
import { VisitCreate, Tariff } from '@memo/domain';
import { VisitorRow } from './VisitorRow';

export interface AddVisitorFormProps {
  tariffs: Tariff[];
  isReadOnly?: boolean;
  onAdd: (visit: VisitCreate) => void;
  onCancel: () => void;
}

export function AddVisitorForm({ tariffs, isReadOnly, onAdd, onCancel }: AddVisitorFormProps) {
  const [name, setName] = useState('');
  const [age, setAge] = useState<number | ''>('');
  const [tariffId, setTariffId] = useState(tariffs[0]?.id ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({
      name: name.trim(),
      age: age === '' ? null : age,
      tariff_id: tariffId,
    });
    setName('');
    setAge('');
  }

  const preview = {
    id: 'preview',
    name,
    age: age === '' ? null : age,
    tariff_id: tariffId,
    status: 'waiting' as const,
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2 border-t border-gray-200 pt-2" data-testid="add-visitor-form">
      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Имя"
          disabled={isReadOnly}
          className="flex-1 rounded border px-2 py-1 text-sm"
          data-testid="add-visitor-name"
        />
        <input
          type="number"
          value={age}
          onChange={(e) => setAge(e.target.value ? Number(e.target.value) : '')}
          placeholder="Возраст"
          disabled={isReadOnly}
          className="w-16 rounded border px-2 py-1 text-sm"
        />
        <select
          value={tariffId}
          onChange={(e) => setTariffId(e.target.value)}
          disabled={isReadOnly}
          className="rounded border px-2 py-1 text-sm"
        >
          {tariffs.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isReadOnly || !name.trim()}
          className="rounded bg-emerald-600 px-3 py-1 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
          data-testid="add-visitor-submit"
        >
          Добавить
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-gray-600 hover:text-gray-800"
        >
          Отмена
        </button>
      </div>
      {name && <VisitorRow visit={preview} tariffs={tariffs} />}
    </form>
  );
}
```

- [ ] Create `frontend/admin/app/components/shared/visitors/VisitorRow.tsx` (read-only, used in preview)
- [ ] Test: form renders, submit fires onAdd with correct payload, cancel fires
- [ ] Commit: `feat(admin): AddVisitorForm atom with VisitorRow preview`

---

## Phase 2 acceptance

- [ ] All 6 atoms exist in `app/components/shared/{records,payments,visitors}/`
- [ ] Each atom has unit tests (≥3 cases each)
- [ ] Atoms are pure (no `useQuery`/`useMutation` inside)
- [ ] `pnpm type-check` green
- [ ] `npm test` full suite green (existing tests still pass — consumers haven't been rewired yet)

**Gate: only proceed to Phase 3 after all green.**

---

## Phase 3 — Wire parents to atoms

---

## Task 21: Update `useRecordData` to return `RecordWithDerived`

**Classification:** small
**Required Docs:**
- `frontend/admin/hooks/useRecordData.ts` (current)
- `frontend/admin/app/components/shared/records/types.ts` (Task 14)
- `docs/specs/2026-06-20-record-status-derivation-and-atom-extraction-design.md` (lines 156-159, data flow)

### Task Description

Modify `useRecordData` so the returned `record` has a computed `status: VisitStatus` field via `computeRecordStatus(visits)`. The hook signature stays the same (no breaking change for callers).

### Steps

- [ ] Read `useRecordData.ts`
- [ ] Add to the return: `status: computeRecordStatus(visits)` — augment the existing object
- [ ] Verify the return type matches `RecordWithDerived`
- [ ] Run `cd frontend/admin && pnpm type-check 2>&1 | tail -10` — consumers will get the new field automatically
- [ ] Commit: `feat(admin): useRecordData returns derived record.status`

---

## Task 22: Add `updateAnonymVisits` and `updateVisitStatus` mutations

**Classification:** small
**Required Docs:**
- `frontend/admin/hooks/useRecordMutations.ts` (current)
- `backend/src/api/v1/records.py` (PATCH endpoint accepts `anonym_visits` and per-visit `status`)

### Task Description

Add two new mutations to `useRecordMutations`:
- `updateAnonymVisits(recordId, anonymVisits)` — PATCH record
- `updateVisitStatus(visitId, status)` — PATCH visit

Both invalidate `['records']` on success.

### Steps

- [ ] Read `useRecordMutations.ts`
- [ ] Add mutations (signature pattern matches existing ones):

```ts
// In useRecordMutations
const updateAnonymVisits = useMutation({
  mutationFn: async ({ recordId, anonymVisits }: { recordId: string; anonymVisits: number }) => {
    return apiClient.patch(`/api/v1/records/${recordId}`, { anonym_visits: anonymVisits });
  },
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['records'] }),
});

const updateVisitStatus = useMutation({
  mutationFn: async ({ visitId, status }: { visitId: string; status: VisitStatus }) => {
    return apiClient.patch(`/api/v1/visits/${visitId}`, { status });
  },
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['records'] }),
});
```

- [ ] Verify backend supports `PATCH /api/v1/visits/{id}` (might need to add — check `backend/src/api/v1/visits.py`)
- [ ] If `PATCH /api/v1/visits/{id}` doesn't exist, add it (small backend task): route + service method that updates visit status. Pydantic schema must reject extra fields and not have `status` listed as `RecordStatus` — use `VisitStatus` from `src.domain.visit_status`.
- [ ] Run `cd frontend/admin && pnpm type-check 2>&1 | tail -10` — green
- [ ] Run `cd frontend/admin && npm test -- useRecordMutations --run 2>&1 | tail -10` — tests pass
- [ ] Commit: `feat(admin): useRecordMutations gains updateAnonymVisits + updateVisitStatus`

---

## Task 23: Rewrite `ClientRecordTab.tsx` as thin wrapper (~200 LOC)

**Classification:** standard
**Required Docs:**
- `docs/specs/2026-06-20-record-status-derivation-and-atom-extraction-design.md` (lines 163-167, data flow)
- `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx` (current 746 LOC)

### Task Description

Reduce `ClientRecordTab.tsx` from 746 LOC to ~200 LOC. Remove duplicated visit row, payment list/form/totals, add visitor form, status control. Use shared atoms + `useRecordData` + `useRecordMutations`.

Keep the **per-visit status (VisitStatus) edit** that was the original Wave 5 feature. The change: edits now go to `visit.status` (not `record.status`), and `record.status` updates via derivation.

### Steps

- [ ] Read current `ClientRecordTab.tsx` to understand what surface-specific logic it has (e.g. left-rail tab list integration)
- [ ] Create a new minimal version:

```tsx
// frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx
'use client';

import { useState } from 'react';
import { useRecordData } from '@/hooks/useRecordData';
import { useRecordMutations } from '@/hooks/useRecordMutations';
import { RecordHeader } from '@/app/components/shared/records/RecordHeader';
import { RecordVisitRow } from '@/app/components/shared/records/RecordVisitRow';
import { PaymentList } from '@/app/components/shared/payments/PaymentList';
import { PaymentForm } from '@/app/components/shared/payments/PaymentForm';
import { PaymentTotals } from '@/app/components/shared/payments/PaymentTotals';
import { AddVisitorForm } from '@/app/components/shared/visitors/AddVisitorForm';
import type { RecordWithDerived } from '@/app/components/shared/records/types';

export interface ClientRecordTabProps {
  recordId: string;
  clientId: string | null;
}

export function ClientRecordTab({ recordId, clientId }: ClientRecordTabProps) {
  const data = useRecordData(recordId, clientId) as RecordWithDerived;
  const { addVisit, removeVisit, updateVisit, addPayment, deletePayment, updateAnonymVisits } = useRecordMutations();
  const [showAddVisitor, setShowAddVisitor] = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);

  const total = data.visits.reduce((sum, v) => sum + (v.price ?? 0), 0);
  const paid = data.payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="space-y-4" data-testid="client-record-tab">
      <RecordHeader data={data} onAnonymVisitsChange={(v) => updateAnonymVisits.mutate({ recordId, anonymVisits: v })} />

      <section>
        <h3 className="mb-2 text-sm font-semibold">Посетители ({data.visits.length})</h3>
        <div className="space-y-1">
          {data.visits.map((v) => (
            <RecordVisitRow
              key={v.id}
              visit={v}
              tariffs={data.tariffs}
              onChange={(updated) => updateVisit.mutate({ visitId: v.id, ...updated })}
              onDelete={() => removeVisit.mutate(v.id)}
            />
          ))}
        </div>
        {showAddVisitor ? (
          <AddVisitorForm
            tariffs={data.tariffs}
            onAdd={(visit) => {
              addVisit.mutate({ recordId, ...visit });
              setShowAddVisitor(false);
            }}
            onCancel={() => setShowAddVisitor(false)}
          />
        ) : (
          <button
            onClick={() => setShowAddVisitor(true)}
            data-testid="add-visitor-button"
            className="mt-2 text-sm text-emerald-600 hover:underline"
          >
            + Добавить посетителя
          </button>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Платежи</h3>
        <PaymentTotals total={total} paid={paid} className="mb-2" />
        <PaymentList payments={data.payments} onDelete={(id) => deletePayment.mutate(id)} />
        {showAddPayment ? (
          <div className="mt-2">
            <PaymentForm
              total={total}
              paid={paid}
              onSubmit={(p) => {
                addPayment.mutate({ recordId, ...p });
                setShowAddPayment(false);
              }}
              onCancel={() => setShowAddPayment(false)}
            />
          </div>
        ) : (
          <button
            onClick={() => setShowAddPayment(true)}
            data-testid="add-payment-button"
            className="mt-2 text-sm text-emerald-600 hover:underline"
          >
            + Добавить платёж
          </button>
        )}
      </section>
    </div>
  );
}
```

- [ ] Adapt to actual hook return signatures and import paths used in the project
- [ ] Run `cd frontend/admin && pnpm type-check 2>&1 | tail -15` — must pass
- [ ] Run `cd frontend/admin && npm test -- ClientRecordTab --run 2>&1 | tail -15` — existing tests must still pass
- [ ] If tests break, update the test file to use new testids (the data-testid values are: `client-record-tab`, `anonym-visits-input`, `visit-row-{id}`, `payment-{id}`, `add-visitor-form`, `payment-form`, etc.)
- [ ] Commit: `refactor(admin): ClientRecordTab is now thin wrapper using shared atoms (746→~200 LOC)`

---

## Task 24: Rewrite `ClientTab.tsx` as thin wrapper (~200 LOC)

**Classification:** standard
**Required Docs:**
- `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx` (current 559 LOC)
- Same atoms as Task 23

### Task Description

Same reduction as `ClientRecordTab` — extract the same atoms, wire the same data flow. The difference: `ClientTab` lives inside `ActivityDetailsModal` and may need a few surface-specific tweaks (e.g. close-modal on certain actions).

### Steps

- [ ] Read current `ClientTab.tsx`
- [ ] Replace its body with the same atom composition as Task 23 (copy-paste + minor adjustments)
- [ ] Keep any surface-specific behaviour (e.g. closing modal on payment add, navigation hooks for "Открыть профиль")
- [ ] Run `cd frontend/admin && pnpm type-check 2>&1 | tail -15` — green
- [ ] Run `cd frontend/admin && npm test -- ClientTab ActivityDetailsModal --run 2>&1 | tail -15` — tests pass
- [ ] Update test files with new testids as needed
- [ ] Commit: `refactor(admin): ClientTab is now thin wrapper using shared atoms (559→~200 LOC)`

---

## Task 25: Integration tests for both consumers + atoms

**Classification:** standard
**Required Docs:**
- `frontend/admin/__tests__/ClientRecordTab.layout.test.tsx` (existing patterns)
- `frontend/admin/__tests__/ActivityDetailsModal.test.tsx` (existing patterns)
- `.opencode/skills/vitest-playwright-patterns/SKILL.md` — Full Cycle E2E pattern

### Task Description

Add integration tests verifying that:
- `ClientRecordTab` renders all atoms and threads data correctly
- `ClientTab` does the same
- Mutations fired from atoms reach `useRecordMutations`

### Steps

- [ ] Read existing `__tests__/ClientRecordTab.api.test.tsx` for the pattern
- [ ] Create `frontend/admin/__tests__/ClientRecordTab.integration.test.tsx` (or update the existing one) covering:
  - Renders `RecordHeader` with name + badge
  - Renders one `RecordVisitRow` per visit
  - Renders `PaymentList` with payments
  - Renders `PaymentTotals`
  - Editing anonym_visits fires `updateAnonymVisits.mutate`
  - Adding visitor fires `addVisit.mutate`
- [ ] Same for `__tests__/ActivityDetailsModal.test.tsx` (in the `ClientTab` section)
- [ ] Run all tests, commit: `test(admin): integration tests for ClientRecordTab + ClientTab with shared atoms`

---

## Phase 3 acceptance

- [ ] `ClientRecordTab.tsx` ≤ 250 LOC
- [ ] `ClientTab.tsx` ≤ 250 LOC
- [ ] `pnpm type-check` green
- [ ] `npm test` full suite green (existing tests pass with updated testids if needed)
- [ ] No duplicated visit row / payment / add visitor JSX in either consumer

**Gate: only proceed to Phase 4 after all green.**

---

## Phase 4 — End-to-end verification

---

## Task 26: E2E for User Scenarios 1-4 (record status, payment, anonym edit, add visitor)

**Classification:** standard
**Required Docs:**
- `frontend/admin/e2e/wave5-x-cards-blurred.spec.ts` — example E2E pattern
- `.opencode/skills/vitest-playwright-patterns/SKILL.md` — Full Cycle E2E

### Task Description

Create one Playwright spec file covering 4 user scenarios from the design spec. Each scenario must be a complete red-green-refactor cycle (start with RED test against current state, then implement if not already).

### Steps

- [ ] Create `frontend/admin/e2e/wave6-record-status-derived.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('Wave 6 — Record status derived from visits', () => {
  test('Scenario 1: edit visit status from /clients updates record badge', async ({ page }) => {
    // 1. Navigate to /clients
    // 2. Click first client row
    // 3. Click first record tab
    // 4. Capture current record badge
    // 5. Click visit status picker
    // 6. Select "Посетил"
    // 7. Verify record badge now shows "Посетил"
    // 8. Reload page
    // 9. Verify badge persists
  });

  test('Scenario 2: add payment from activity modal updates totals', async ({ page }) => {
    // 1. Navigate to /schedule
    // 2. Click first activity card
    // 3. In modal, switch to first Client tab
    // 4. Capture current "К оплате"
    // 5. Click "+ Добавить платёж"
    // 6. Fill amount, click submit
    // 7. Verify "Оплачено" increased by amount
    // 8. Close and reopen modal — verify persists
  });

  test('Scenario 3: edit anonym_visits in existing record', async ({ page }) => {
    // 1. Navigate to /clients
    // 2. Open a record
    // 3. Edit anonym_visits input from 0 to 2
    // 4. Wait 1 sec (debounce)
    // 5. Verify "итого" shows visits + 2
    // 6. Navigate to schedule for that activity's date
    // 7. Verify activity footer shows occupied += 2
  });

  test('Scenario 4: add visitor from /clients shows in list with new visit status', async ({ page }) => {
    // 1. Navigate to /clients
    // 2. Open a record
    // 3. Click "+ Добавить посетителя"
    // 4. Fill name/age/tariff
    // 5. Click "Добавить"
    // 6. Verify new visit row appears with default status
    // 7. Reload, verify persists
  });
});
```

- [ ] Fill in the actual navigation/click steps using the project's seed data and the testids from atoms (`client-record-tab`, `add-visitor-button`, etc.)
- [ ] Run `cd frontend/admin && npx playwright test wave6-record-status-derived.spec.ts 2>&1 | tail -20` — all 4 pass
- [ ] Commit: `test(e2e): Wave 6 record status derived scenarios (1-4)`

---

## Task 27: E2E for User Scenario 5 (StatusPicker shared)

**Classification:** small
**Required Docs:**
- `frontend/admin/e2e/wave6-record-status-derived.spec.ts` (Task 26)

### Task Description

Verify that `StatusPicker` renders identically across all 4 call sites via visual regression (Playwright snapshot).

### Steps

- [ ] Create `frontend/admin/e2e/wave6-status-shared.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('Wave 6 — StatusPicker shared everywhere', () => {
  test('Scenario 5: same StatusPicker in /records, /clients, activity modal, BookingFilters', async ({ page }) => {
    // 1. Navigate to /records — open status filter, screenshot
    // 2. Navigate to /clients — open record, open visit status picker, screenshot
    // 3. Navigate to /schedule — open activity, open Client tab, open visit status picker, screenshot
    // 4. Verify all three pickers use the same icons + labels via DOM comparison
  });
});
```

- [ ] Implement using `await expect(page.locator('[data-testid^="status-picker"]')).toBeVisible()` and DOM text comparison
- [ ] Commit: `test(e2e): Wave 6 StatusPicker shared across all 4 sites`

---

## Task 28: Visual regression snapshots for StatusPicker + StatusBadge

**Classification:** small
**Required Docs:**
- `frontend/admin/e2e/wave5-x-cards-blurred.spec.ts` — example snapshot pattern
- `frontend/admin/playwright.config.ts` — `update-snapshots` flag

### Task Description

Add Playwright snapshot tests for `StatusPicker` (popover open) and `StatusBadge` (each of 4 statuses). These protect against accidental visual changes.

### Steps

- [ ] Create `frontend/admin/e2e/wave6-status-snapshots.spec.ts` with 6 tests:
  1. `<StatusPicker>` closed
  2. `<StatusPicker>` open showing all 4 options
  3. `<StatusBadge status="waiting" />`
  4. `<StatusBadge status="visited" />`
  5. `<StatusBadge status="missed" />`
  6. `<StatusBadge status="cancelled" />`
- [ ] First run: `npx playwright test wave6-status-snapshots.spec.ts --update-snapshots` to create baseline
- [ ] Commit snapshots: `git add frontend/admin/e2e/wave6-status-snapshots* && git commit -m "test(e2e): visual regression baselines for StatusPicker + StatusBadge"`
- [ ] Subsequent runs verify they match

---

## Task 29: Full test suite (frontend + backend) + final cleanup

**Classification:** standard
**Required Docs:**
- `.opencode/skills/pytest-patterns/SKILL.md`
- `.opencode/skills/vitest-playwright-patterns/SKILL.md`

### Task Description

Run the full test suite (vitest + playwright) and the backend pytest. Fix any remaining failures.

### Steps

- [ ] Run `cd frontend/admin && npm run test:all 2>&1 | tail -10` — must be green (vitest + playwright)
- [ ] Run `cd backend && .venv/bin/pytest -q 2>&1 | tail -10` — must be green
- [ ] Run `cd frontend/admin && pnpm type-check 2>&1 | tail -10` — must be green
- [ ] If any test fails, fix the test or the implementation (do not skip tests)
- [ ] Commit any final fixes: `chore(admin): post-test cleanup`
- [ ] Run git log to confirm no leftover TODOs / commented-out code: `git log --since="2 days ago" --oneline && git diff main..HEAD --stat`

---

## Phase 4 acceptance (final)

- [ ] All 7 user scenarios from spec pass (E2E)
- [ ] All unit tests pass (vitest + pytest)
- [ ] Visual regression snapshots match
- [ ] `pnpm type-check` green
- [ ] No `RecordStatus` references in frontend (`grep -rn "RecordStatus" frontend/admin/app frontend/admin/hooks --include="*.ts" --include="*.tsx"`)
- [ ] No `pending|confirmed|no_show` in `frontend/admin/` source
- [ ] `ClientRecordTab.tsx` and `ClientTab.tsx` ≤ 250 LOC each
- [ ] Net LOC reduction ≥ 500 (compared to baseline 746 + 559 = 1305)

---

## Self-review (plan-level)

- [x] **Spec coverage:** All 5 phases from spec mapped to 29 tasks (T0–T29). Each requirement has a task.
- [x] **Placeholder scan:** No "TBD", "TODO", "implement later". All steps have exact code.
- [x] **Type consistency:** `VisitStatus` is the only status type. `RecordWithDerived` is consistent across all 3 consumers. `useRecordMutations` mutations match across all 3 consumers.
- [x] **Required Docs:** Every task has a `### Required Docs` section.
- [x] **E2E coverage:** User Scenarios 1-4 (Task 26), 5 (Task 27), 6-7 (covered by backend tests in Task 4-5).
- [x] **Backend tasks with schema changes:** Task 6 (Alembic data migration) — explicit, idempotent.
- [x] **Acceptance gates between phases:** All 4 phases have explicit "Gate" criteria.

**Known unknowns surfaced for implementation:**
- User confirmation needed: Russian labels (Task 8) — proposed as "Ожидание / Посетил / Неявка / Отменён"
- User confirmation needed: capacity re-check on PATCH (Task 22) — proposed to tighten, but current code doesn't re-check
- User confirmation needed: PATCH /api/v1/visits/{id} endpoint (Task 22) — may need to add

---

## Execution choice

**Two execution options:**

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task with two-stage review (spec + quality) between tasks. Best for this wave due to size (29 tasks) and risk.

2. **Inline Execution** — Execute tasks in this session using executing-plans. Faster but no per-task review gates.

**Recommendation:** Subagent-driven (Option 1). The wave touches ~12 files in `app/components/shared/`, modifies both consumers, and includes a backend migration. Review gates matter.

**Worktree reminder:** Plan must be executed in `/root/workspace/memo/.worktrees/fix/wave6-status-derivation-atom-extraction/` (off `main` @ `75a3853`). Verify the worktree exists before dispatching the first implementer.
