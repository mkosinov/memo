# Adaptive ActivityCard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `ActivityCard` into a 3-tier adaptive layout (Tiny / Compact / Standard) so all useful information is readable for any duration ≥ 30 min, and add `shortTitle` field to `Location` for compact display.

**Architecture:**
- Single component, three structural modes selected by `durMinutes`
- One `showMaster` rule covers both Compact and Standard (hide master when 2-line title + master doesn't fit)
- `line-clamp-2` (Tailwind) on title — overflow visually signalled, not silently clipped
- Backend: add `short_title` column to `Location` (nullable, length 50) with full API surface
- Frontend rename: `Studio` → `Location` (4 parent components + ActivityCard)

**Tech Stack:** Next.js 14 (App Router) + TypeScript + Tailwind CSS 3, FastAPI + SQLAlchemy + Alembic + SQLite, vitest + Playwright, pytest.

**Worktree:** `/root/workspace/memo/.worktrees/feat-photo-searchable-select/` (already exists, HEAD `dcaaa04`)

**Spec:** `docs/specs/2026-06-16-activity-card-adaptive-design.md`

---

## File Structure

### Backend
- `backend/src/models/location.py` — **MODIFY**: add `short_title` column
- `backend/src/schemas/location.py` — **MODIFY**: add to Base/Create/Update/Response
- `backend/src/migrations/versions/<hash>_location_short_title.py` — **CREATE**: Alembic migration
- `backend/tests/test_location_schema.py` — **CREATE**: Pydantic schema tests (or add to existing)
- `backend/tests/test_location_api.py` — **CREATE**: API tests (or add to existing)

### Shared
- `packages/domain/src/index.ts` — **MODIFY**: add `shortTitle` to `LocationSchema`

### Frontend
- `frontend/admin/app/components/schedule/ActivityCard.tsx` — **MODIFY**: 3-tier layout
- `frontend/admin/app/components/schedule/DayView.tsx` — **MODIFY**: `studios` → `locations` prop
- `frontend/admin/app/components/schedule/DayColumn.tsx` — **MODIFY**: same
- `frontend/admin/app/components/schedule/WeekView.tsx` — **MODIFY**: same
- `frontend/admin/app/components/schedule/OverlapPopover.tsx` — **MODIFY**: same
- `frontend/admin/__tests__/ActivityCard.test.tsx` — **MODIFY**: add new tests
- `frontend/admin/e2e/activity-card-adaptive.spec.ts` — **CREATE**: visual tests

---

## Task Classification Legend

| Tier | Criteria | Review Pipeline |
|------|----------|-----------------|
| **Trivial** | ≤5 lines, style/text only | Architect spot-check |
| **Small** | 1-2 files, <50 lines, simple change | Spec-review only |
| **Standard** | Multi-file, logic, API + validation | Spec + code-quality review |
| **Large** | Architecture change, >200 lines, multi-file refactor | Spec + code-quality + final review |

---

## Task 1: Backend — Add `short_title` to Location model, schemas, and migration

**Classification:** small
**Required Docs:**
- `docs/specs/2026-06-16-activity-card-adaptive-design.md` — Backend Changes section
- `backend/src/models/location.py` — existing model to extend
- `backend/src/schemas/location.py` — existing schemas to extend
- `docs/domain-rules/_overview.md` — Naming Conventions (snake_case in Python, camelCase in TS)

### Task Description

Add `short_title` field to `Location` ORM model, all 4 Pydantic schemas, and create an Alembic migration to add the column to SQLite.

### Files
- **Modify:** `backend/src/models/location.py`
- **Modify:** `backend/src/schemas/location.py`
- **Create:** `backend/src/migrations/versions/<hash>_location_short_title.py`

### Steps

- [ ] **Step 1.1:** Read current state of `backend/src/models/location.py` and `backend/src/schemas/location.py` (already done by architect — use as reference)

- [ ] **Step 1.2:** Edit `backend/src/models/location.py` — add import for `String` is already present; add new field after `name`:
  ```python
  short_title: Mapped[str | None] = mapped_column(String(50), nullable=True)
  ```

- [ ] **Step 1.3:** Edit `backend/src/schemas/location.py` — add `short_title: str | None = None` to `LocationBase` (line 11 area, after `name: str`):
  ```python
  class LocationBase(BaseModel):
      """Shared fields for location creation and updates."""

      name: str
      short_title: str | None = None  # new
      address: str | None = None
      # ... rest unchanged
  ```
  `LocationCreate`, `LocationUpdate`, `LocationResponse` inherit from `LocationBase` — no further changes needed.

- [ ] **Step 1.4:** Generate Alembic migration. From `backend/`:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select/backend
  alembic revision --autogenerate -m "add short_title to locations"
  ```
  Verify the generated file in `src/migrations/versions/` contains:
  ```python
  def upgrade() -> None:
      op.add_column("locations", sa.Column("short_title", sa.String(length=50), nullable=True))

  def downgrade() -> None:
      op.drop_column("locations", "short_title")
  ```

- [ ] **Step 1.5:** Apply migration:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select/backend
  alembic upgrade head
  ```
  Expected: `Running upgrade <prev_hash> -> <new_hash>, add short_title to locations`

- [ ] **Step 1.6:** Verify schema in SQLite:
  ```bash
  sqlite3 /root/workspace/memo/.worktrees/feat-photo-searchable-select/backend/memo.db ".schema locations"
  ```
  Expected: column list includes `short_title varchar(50)`.

- [ ] **Step 1.7:** Run existing tests to confirm no regression:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select/backend
  pytest tests/ -x -q
  ```
  Expected: all pass.

- [ ] **Step 1.8:** Commit:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select
  git add backend/src/models/location.py backend/src/schemas/location.py backend/src/migrations/versions/
  git commit -m "feat(backend): add short_title to Location"
  ```

### Self-Review Checklist
- [ ] `short_title` is nullable (existing rows won't break)
- [ ] Length is 50 (matches spec)
- [ ] Field is in all 4 schemas (Base, Create, Update, Response) — Create/Update/Response inherit from Base
- [ ] Migration has both upgrade and downgrade
- [ ] No new test failures

---

## Task 2: Backend — Tests for `Location.short_title`

**Classification:** small
**Required Docs:**
- `docs/specs/2026-06-16-activity-card-adaptive-design.md` — Testing section
- `backend/tests/conftest.py` — existing fixtures
- `.opencode/skills/pytest-patterns/SKILL.md` — pytest factory pattern, TestClient

### Task Description

Add tests covering the new `short_title` field: schema validation, API create/read/update, length limit.

### Files
- **Modify or create:** `backend/tests/test_location_schema.py` (or extend existing test file for locations)
- **Modify or create:** `backend/tests/test_location_api.py` (or extend existing)

### Steps

- [ ] **Step 2.1:** Check existing location tests:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select/backend
  ls tests/ | rg -i location
  ```
  If files exist, append; if not, create new ones using the patterns below.

- [ ] **Step 2.2:** Write RED test for schema — append to `tests/test_location_schema.py` (or create):
  ```python
  """Tests for Location Pydantic schemas."""
  from src.schemas.location import LocationCreate, LocationResponse


  def test_short_title_optional_in_create() -> None:
      """short_title should be optional in LocationCreate."""
      loc = LocationCreate(name="Test Loc", capacity=10)
      assert loc.short_title is None


  def test_short_title_accepted_in_create() -> None:
      """short_title should be settable in LocationCreate."""
      loc = LocationCreate(name="Test Loc", capacity=10, short_title="Test")
      assert loc.short_title == "Test"


  def test_short_title_max_length() -> None:
      """short_title should accept up to 50 chars and reject 51+."""
      loc_ok = LocationCreate(name="Test", capacity=10, short_title="x" * 50)
      assert len(loc_ok.short_title) == 50
      # Pydantic v2 raises ValidationError on length 51+; if model doesn't enforce,
      # the DB column will reject it (length 50). Either is acceptable.
  ```

- [ ] **Step 2.3:** Write RED test for API — append to `tests/test_location_api.py` (or create):
  ```python
  """Tests for Location API endpoints."""
  from fastapi.testclient import TestClient
  from src.main import app

  client = TestClient(app)


  def test_create_location_with_short_title() -> None:
      """POST /api/locations/ should accept short_title."""
      payload = {"name": "Гранд Отель Поляна", "capacity": 10, "short_title": "Гранд"}
      resp = client.post("/api/locations/", json=payload)
      assert resp.status_code == 200
      data = resp.json()
      assert data["short_title"] == "Гранд"
      # cleanup
      client.delete(f"/api/locations/{data['id']}")


  def test_create_location_without_short_title() -> None:
      """POST without short_title should default to null."""
      payload = {"name": "Test Loc No Short", "capacity": 5}
      resp = client.post("/api/locations/", json=payload)
      assert resp.status_code == 200
      data = resp.json()
      assert data["short_title"] is None
      client.delete(f"/api/locations/{data['id']}")


  def test_update_location_short_title() -> None:
      """PATCH/PUT should update short_title."""
      payload = {"name": "Test Update", "capacity": 5, "short_title": "Old"}
      resp = client.post("/api/locations/", json=payload)
      loc_id = resp.json()["id"]
      # update
      resp = client.put(f"/api/locations/{loc_id}", json={**payload, "short_title": "New"})
      assert resp.status_code == 200
      assert resp.json()["short_title"] == "New"
      client.delete(f"/api/locations/{loc_id}")
  ```

- [ ] **Step 2.4:** Run the new tests:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select/backend
  pytest tests/test_location_schema.py tests/test_location_api.py -v
  ```
  Expected: all pass (implementation is already in place from Task 1).

- [ ] **Step 2.5:** Run full backend test suite to confirm no regression:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select/backend
  pytest -x -q
  ```
  Expected: all pass.

- [ ] **Step 2.6:** Commit:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select
  git add backend/tests/
  git commit -m "test(backend): cover Location.short_title schema and API"
  ```

### Self-Review Checklist
- [ ] Schema tests verify optional + accepted + max length behaviour
- [ ] API tests cover create with/without, update
- [ ] Tests use existing test client / fixtures (don't reinvent the wheel)
- [ ] Test cleanup deletes created locations (no DB pollution)

---

## Task 3: Domain — Add `shortTitle` to `LocationSchema`

**Classification:** trivial
**Required Docs:**
- `docs/specs/2026-06-16-activity-card-adaptive-design.md` — Domain section
- `packages/domain/src/index.ts` — current schema

### Task Description

Extend the `LocationSchema` (zod) in the shared domain package to include the new optional `shortTitle` field. Rebuild the package so the new schema is consumed by frontend.

### Files
- **Modify:** `packages/domain/src/index.ts`

### Steps

- [ ] **Step 3.1:** Edit `packages/domain/src/index.ts` — find `LocationSchema` and add `shortTitle`:
  ```ts
  export const LocationSchema = z.object({
    id: z.string(),
    name: z.string(),
    shortTitle: z.string().optional(),  // new — fallback to name if missing
    address: z.string().optional(),
    emoji: z.string().optional(),
    defaultCapacity: z.number().optional(),
    sortOrder: z.number().optional(),
  });
  ```

- [ ] **Step 3.2:** Rebuild the domain package (it's a workspace package):
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select
  pnpm --filter @memo/domain build || npm run build --workspace=packages/domain
  ```
  If no build script, just run `tsc`:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select/packages/domain
  npx tsc --noEmit
  ```
  Expected: no TS errors.

- [ ] **Step 3.3:** Verify the new field is exported — check `packages/domain/dist/index.d.ts` (or wherever types are emitted) contains `shortTitle?: string` inside the `Location` type.

- [ ] **Step 3.4:** Commit:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select
  git add packages/domain/src/index.ts
  git commit -m "feat(domain): add shortTitle to LocationSchema"
  ```

### Self-Review Checklist
- [ ] Field is `optional()` (matches backend nullable)
- [ ] TypeScript type reflects optional (`shortTitle?: string`)
- [ ] No other schemas affected

---

## Task 4: ActivityCard — 3-tier layout refactor

**Classification:** large
**Required Docs:**
- `docs/specs/2026-06-16-activity-card-adaptive-design.md` — Architecture, Layout & Sizing, Element Structure, Concrete changes sections
- `frontend/admin/app/components/schedule/ActivityCard.tsx` — current component
- `frontend/admin/__tests__/ActivityCard.test.tsx` — existing tests (must keep passing)
- `frontend/admin/app/components/schedule/DayView.tsx`, `DayColumn.tsx`, `WeekView.tsx`, `OverlapPopover.tsx` — parent components (will rename in Task 5)
- `packages/domain/src/index.ts` — `Location` type

### Task Description

Refactor `ActivityCard.tsx` to use 3-tier adaptive layout. Update formula, add `isTiny/isCompact/isStandard` mode selection, add `showMaster` rule, wrap master/footer in conditions, move age icon inline with title, switch title to `line-clamp-2`, add capacity to location row in Compact.

### Files
- **Modify:** `frontend/admin/app/components/schedule/ActivityCard.tsx`

### Steps

- [ ] **Step 4.1:** Update imports — replace `Studio` with `Location`:
  ```ts
  import type { Activity, Master, Location } from '@memo/domain';
  ```
  Rename prop type and name:
  ```ts
  interface ActivityCardProps {
    activity: Activity;
    master: Master;
    locations?: Location[];   // was: studios?: Studio[]
    style?: React.CSSProperties;
    onEdit?: (activity: Activity) => void;
    onQuickAdd?: (activity: Activity) => void;
    isDragging?: boolean;
    isDragCopy?: boolean;
    gridStart?: number;
  }

  export function ActivityCard({ activity, master, locations = [], ... }) {
  ```

- [ ] **Step 4.2:** Update position + height formula. Replace the existing `topPx` and `heightPx` lines, and **delete** the old `showExtra`/`showOnlyPill` derivations (they are replaced by the new tier logic):
  ```ts
  const topPx = (activity.startTime - gridStart) * cellHeight * 2 + 4;          // +4 top margin
  const durMinutes = activity.durationMinutes ?? activity.duration * 60;
  const heightPx = Math.max((durMinutes / 60) * cellHeight * 2 - 8, 60);        // -8 bottom, min 60
  const fillPct = activity.capacity > 0 ? Math.min(activity.occupied / activity.capacity, 1) : 0;

  // Tier selection (replaces old showExtra/showOnlyPill)
  const isTiny = durMinutes < 60;
  const isCompact = !isTiny && durMinutes < 90;
  const isStandard = !isTiny && !isCompact;
  const hasFooter = isStandard;

  // Master visibility rule
  const want2LineTitle        = heightPx >= (hasFooter ? 134 : 90);
  const canFit2LineWithMaster = heightPx >= (hasFooter ? 152 : 108);
  const canFit1LineWithMaster = heightPx >= (hasFooter ? 132 : 88);
  const titleLines = want2LineTitle ? 2 : 1;
  const showMaster = titleLines === 2 ? canFit2LineWithMaster : canFit1LineWithMaster;
  ```

- [ ] **Step 4.3:** Rename the location lookup. Replace:
  ```ts
  const locationName = studios.find(s => s.id === activity.locationId)?.name || '';
  ```
  with:
  ```ts
  const foundLocation = locations.find(l => l.id === activity.locationId);
  const locationShortName = foundLocation?.shortTitle || foundLocation?.name || '';
  ```

- [ ] **Step 4.4:** Update the JSX root — add `line-clamp-2` support and conditional wrapping. The whole conditional block (currently `{!showOnlyPill && (...)}`) becomes `{!isTiny && (...)}`. The structure inside changes.

  Replace the existing title + age blocks (currently lines 115-130 in the old code) with a single combined title row:
  ```tsx
  {/* 2. TITLE + AGE (inline icon) */}
  <div className="px-2 overflow-hidden">
    <div className="text-sm font-semibold leading-tight text-black flex items-start gap-1">
      {/* Age icon inline */}
      <svg
        className="w-3 h-3 flex-shrink-0 mt-0.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
      </svg>
      <span
        className={titleLines === 2 ? 'line-clamp-2' : 'truncate'}
        title={activity.serviceName}
      >
        {activity.serviceName}
      </span>
    </div>
  </div>
  ```
  Note: `line-clamp-2` is a Tailwind utility (v3.3+). If not enabled, add it to `tailwind.config.ts` plugins (`require('@tailwindcss/line-clamp')`).

- [ ] **Step 4.5:** Wrap master in `{showMaster && (...)}` (replaces the old `{showExtra && (...)}`). Also wrap the spacer:
  ```tsx
  {showMaster && (
    <div className="px-2 text-[13px] text-black truncate" title={master.name}>
      {master.name}
    </div>
  )}

  {showMaster && <div className="flex-1" />}
  ```

- [ ] **Step 4.6:** Update location row — show in all non-Tiny modes, add capacity to the right in Compact. Replace existing `{showExtra && locationName && (...)}` block with:
  ```tsx
  {!isTiny && locationShortName && (
    <div className="flex items-center gap-1 px-2 pb-1 text-[13px] text-black">
      <svg
        className="w-3 h-3 flex-shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
      <span className="truncate flex-1" title={locationShortName}>
        {locationShortName}
      </span>
      {!isStandard && (
        <span className="flex-shrink-0" data-testid="compact-capacity">
          {activity.occupied}/{activity.capacity}
        </span>
      )}
    </div>
  )}
  ```

- [ ] **Step 4.7:** Wrap the footer in `{isStandard && (...)}`:
  ```tsx
  {isStandard && (
    <div className="mx-0 mb-0 rounded-xl overflow-hidden relative" style={{ border: '1px solid rgba(0,0,0,0.15)' }}>
      {/* ... entire existing footer block unchanged ... */}
    </div>
  )}
  ```

- [ ] **Step 4.8:** Update the outer guard. Replace `{!showOnlyPill && (...)}` with `{!isTiny && (...)}` (the wrapper around title/master/location/footer). Note: location in Compact needs `!isTiny`, not `showExtra`.

- [ ] **Step 4.9:** Run the existing test suite — they must still pass (some are about time-pill, occupancy, capacity=0, isPrivate diamond):
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select/frontend
  npx vitest run __tests__/ActivityCard.test.tsx
  ```
  Expected: existing tests pass. The "hides content when card is very small" test (`duration: 0.25` = 15 min) should now check that **only the header** is visible (Tiny mode) — update that test assertion if needed (covered in Task 6).

- [ ] **Step 4.10:** Run the full frontend test suite to check no other regressions:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select/frontend
  npx vitest run
  ```
  Expected: any failures are in parent components that still pass `studios` (Task 5 will fix).

- [ ] **Step 4.11:** Commit:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select
  git add frontend/admin/app/components/schedule/ActivityCard.tsx
  git commit -m "feat(frontend): adaptive ActivityCard 3-tier layout (Tiny/Compact/Standard)"
  ```

### Self-Review Checklist
- [ ] `line-clamp-2` is enabled in Tailwind (check config or add plugin)
- [ ] All formulas match spec: `+4` top, `-8` bottom, `min 60`
- [ ] Master rule constants match spec: `(hasFooter ? 134/152/132 : 90/108/88)`
- [ ] Age icon is inline in title row, not a separate block
- [ ] Compact shows capacity in location row, not footer
- [ ] Tiny shows only header + title
- [ ] Existing tests still pass (may need to update "hides content" test — see Task 6)

---

## Task 5: Rename `studios` → `locations` in parent components

**Classification:** small
**Required Docs:**
- `frontend/admin/app/components/schedule/ActivityCard.tsx` — interface to match
- `docs/specs/2026-06-16-activity-card-adaptive-design.md` — Files Touched section

### Task Description

Rename the `studios` prop to `locations` in 4 parent components so TypeScript is happy with the refactored ActivityCard.

### Files
- **Modify:** `frontend/admin/app/components/schedule/DayView.tsx`
- **Modify:** `frontend/admin/app/components/schedule/DayColumn.tsx`
- **Modify:** `frontend/admin/app/components/schedule/WeekView.tsx`
- **Modify:** `frontend/admin/app/components/schedule/OverlapPopover.tsx`

### Steps

- [ ] **Step 5.1:** Find all call sites of `<ActivityCard` and any places that read `studios` to pass it down:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select/frontend
  rg -n "studios" admin/app/components/schedule/
  ```

- [ ] **Step 5.2:** For each parent component:
  - Change `import type { Activity, Master, Studio, ... }` → `Location`
  - Change prop `studios?: Studio[]` → `locations?: Location[]`
  - In the `useSchedule()` destructure (WeekView), `locations: studios` → use `locations` directly
  - In all `<ActivityCard` usages, change `studios={studios}` → `locations={locations}` (or similar mapping if the local variable is still named `studios`)

  Specifically for `WeekView.tsx` line ~18: change
  ```ts
  const { ..., locations: studios, ... } = useSchedule();
  ```
  to
  ```ts
  const { ..., locations, ... } = useSchedule();
  ```
  Then update downstream usages accordingly (any `studios.find(...)`, `studios.map(...)`, etc.).

- [ ] **Step 5.3:** Run TypeScript check:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select/frontend
  npx tsc --noEmit
  ```
  Expected: no errors related to `studios`/`Studio` in `admin/app/components/schedule/`.

- [ ] **Step 5.4:** Run full frontend tests:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select/frontend
  npx vitest run
  ```
  Expected: all pass.

- [ ] **Step 5.5:** Commit:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select
  git add frontend/admin/app/components/schedule/
  git commit -m "refactor(frontend): rename studios prop to locations in schedule components"
  ```

### Self-Review Checklist
- [ ] No `Studio` import remains in `frontend/admin/app/components/schedule/`
- [ ] No `studios` prop name remains
- [ ] `tsc --noEmit` is clean
- [ ] All existing tests pass

---

## Task 6: Frontend unit tests for ActivityCard (master visibility + tier selection)

**Classification:** small
**Required Docs:**
- `docs/specs/2026-06-16-activity-card-adaptive-design.md` — Testing section, Visual Compliance Checks
- `frontend/admin/__tests__/ActivityCard.test.tsx` — existing tests
- `.opencode/skills/vitest-playwright-patterns/SKILL.md` — vitest patterns

### Task Description

Add unit tests covering: (1) tier selection for `[30, 59, 60, 89, 90, 120]` min; (2) master visibility matrix for `[30, 60, 75, 90, 105, 120, 150, 180]` min × `[1-line title, 2-line title]`; (3) Compact capacity in location row, not footer; (4) Tiny mode hides everything except header; (5) Standard mode has footer. Update the existing "hides content when very small" test to match the new Tiny behaviour.

### Files
- **Modify:** `frontend/admin/__tests__/ActivityCard.test.tsx`

### Steps

- [ ] **Step 6.1:** Read current test file (`__tests__/ActivityCard.test.tsx`) to understand helper patterns and imports.

- [ ] **Step 6.2:** Add helpers at top of file (after imports):
  ```ts
  import type { Location } from '@memo/domain';

  const mockLocation: Location = {
    id: 'loc_1',
    name: 'Гранд Отель Поляна',
    shortTitle: 'Гранд',
  };

  // For long-title test variant
  const longTitleActivity: Activity = {
    ...mockActivity,
    serviceName: 'Мини-картина акрилом',  // wraps to 2 lines
  };
  ```

- [ ] **Step 6.3:** Update existing "hides content when card is very small" test to match new Tiny behaviour. Replace the test body:
  ```ts
  it('hides content when card is tiny (duration < 60 min)', () => {
    const shortActivity = { ...mockActivity, duration: 0.25 }; // 15 min
    render(
      <ActivityCard
        activity={shortActivity}
        master={mockMaster}
        locations={[mockLocation]}
      />
    );
    // Time pill should still show
    expect(screen.getByText(/10:00/)).toBeInTheDocument();
    // Title visible (truncate)
    expect(screen.getByText('Картина маслом')).toBeInTheDocument();
    // Master, location, footer hidden
    expect(screen.queryByText('Ольга Петрова')).not.toBeInTheDocument();
    expect(screen.queryByText('Гранд')).not.toBeInTheDocument();
    expect(screen.queryByTestId('btn-quick-add')).not.toBeInTheDocument();
  });
  ```

- [ ] **Step 6.4:** Add tier selection tests — new `describe('tier selection')` block:
  ```ts
  describe('tier selection', () => {
    it.each([
      [30, 'tiny'],     // 30 min
      [59, 'tiny'],     // 59 min
      [60, 'compact'],  // exactly 1:00
      [89, 'compact'],  // 89 min
      [90, 'standard'], // exactly 1:30
      [120, 'standard'],// 2:00
    ])('duration %i min → %s tier', (minutes, expectedTier) => {
      const activity = { ...mockActivity, duration: minutes / 60 };
      const { container } = render(
        <ActivityCard
          activity={activity}
          master={mockMaster}
          locations={[mockLocation]}
        />
      );
      const card = container.querySelector('[data-testid^="activity-"]') as HTMLElement;
      const styleHeight = parseInt(card.style.height);
      if (expectedTier === 'tiny') {
        // Tiny: 60px min, no footer, no master
        expect(styleHeight).toBe(60);
        expect(screen.queryByTestId('btn-quick-add')).not.toBeInTheDocument();
        expect(screen.queryByText('Ольга Петрова')).not.toBeInTheDocument();
      } else if (expectedTier === 'compact') {
        // Compact: has compact-capacity, no footer
        expect(screen.getByTestId('compact-capacity')).toBeInTheDocument();
        expect(screen.queryByTestId('btn-quick-add')).not.toBeInTheDocument();
      } else {
        // Standard: has footer
        expect(screen.getByTestId('btn-quick-add')).toBeInTheDocument();
      }
    });
  });
  ```

- [ ] **Step 6.5:** Add master visibility matrix — new `describe('master visibility')` block:
  ```ts
  describe('master visibility', () => {
    // For each duration and title type, expected master visibility
    // (Can't easily mock "1-line" vs "2-line" because that's determined by CSS line-clamp at runtime;
    //  we approximate by testing short titles (1-line visually) and long titles (2-line visually))
    const cases: Array<[number, 'short' | 'long', boolean]> = [
      // [durationMinutes, titleType, expectedShowMaster]
      [30, 'short', false],   // tiny: no master
      [30, 'long', false],
      [60, 'short', true],    // compact 1:00, 1-line: master fits (88 ≤ 92)
      [60, 'long', false],    // compact 1:00, 2-line: no master (108 > 92)
      [75, 'short', true],
      [75, 'long', true],     // compact 1:15, 2-line: master fits (108 ≤ 117)
      [90, 'short', true],    // standard 1:30, 1-line: master fits (132 ≤ 142)
      [90, 'long', false],    // standard 1:30, 2-line: no master (152 > 142)
      [120, 'long', true],    // standard 2:00, 2-line: master fits (152 ≤ 192)
      [180, 'long', true],
    ];

    it.each(cases)(
      'duration %i min, %s title → showMaster=%s',
      (minutes, titleType, expectedShowMaster) => {
        const activity = {
          ...mockActivity,
          duration: minutes / 60,
          serviceName: titleType === 'long' ? 'Мини-картина акрилом' : 'МК',
        };
        render(
          <ActivityCard
            activity={activity}
            master={mockMaster}
            locations={[mockLocation]}
          />
        );
        if (expectedShowMaster) {
          expect(screen.getByText('Ольга Петрова')).toBeInTheDocument();
        } else {
          expect(screen.queryByText('Ольга Петрова')).not.toBeInTheDocument();
        }
      }
    );
  });
  ```
  Note: the titleType→expectedShowMaster mapping is derived from the spec math. jsdom doesn't render `line-clamp-2` as a visual 2-line cap, so the test relies on height-derived logic. If jsdom's rendering doesn't reflect the real layout, the matrix may need adjustment — verify by running the visual test (Task 7) and cross-checking.

- [ ] **Step 6.6:** Add Compact capacity placement test:
  ```ts
  describe('compact capacity', () => {
    it('renders capacity in location row, not in footer', () => {
      const activity = { ...mockActivity, duration: 1 }; // 1:00 → compact
      render(
        <ActivityCard
          activity={activity}
          master={mockMaster}
          locations={[mockLocation]}
        />
      );
      // Capacity present in compact-capacity slot
      const compactCap = screen.getByTestId('compact-capacity');
      expect(compactCap).toHaveTextContent('3/8');
      // Footer absent in compact
      expect(screen.queryByTestId('btn-quick-add')).not.toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 6.7:** Run all ActivityCard tests:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select/frontend
  npx vitest run __tests__/ActivityCard.test.tsx
  ```
  Expected: all pass (existing + new). If `line-clamp-2` causes text not to be found by `getByText`, check that the inner `<span>` actually contains the text (it does — `line-clamp-2` doesn't remove text, just visually clips).

- [ ] **Step 6.8:** Commit:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select
  git add frontend/admin/__tests__/ActivityCard.test.tsx
  git commit -m "test(frontend): add ActivityCard tier and master visibility tests"
  ```

### Self-Review Checklist
- [ ] Existing test for "hides content when very small" updated to match Tiny mode
- [ ] Tier selection test covers boundary values (59, 60, 89, 90)
- [ ] Master visibility matrix uses values from spec math
- [ ] Compact capacity test confirms placement
- [ ] All tests pass

---

## Task 7: Frontend visual (playwright) tests

**Classification:** small
**Required Docs:**
- `docs/specs/2026-06-16-activity-card-adaptive-design.md` — Visual Compliance Checks section
- `.opencode/skills/vitest-playwright-patterns/SKILL.md` — Playwright Full Cycle pattern
- `.opencode/skills/pair-visual-debugging/SKILL.md` — visual debugging patterns

### Task Description

Add Playwright E2E tests that capture screenshots of cards in each tier (Tiny 30, Compact 60/75/90, Standard 90/120/180) and verify no content is silently clipped by inspecting computed dimensions.

### Files
- **Create:** `frontend/admin/e2e/activity-card-adaptive.spec.ts`

### Steps

- [ ] **Step 7.1:** Find an existing Playwright spec to use as reference:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select/frontend
  ls admin/e2e/ 2>/dev/null
  ```

- [ ] **Step 7.2:** Read `.opencode/skills/pair-visual-debugging/SKILL.md` for the right Playwright patterns (dev server URL, screenshot save paths).

- [ ] **Step 7.3:** Create the new spec file:
  ```ts
  import { test, expect } from '@playwright/test';
  import * as path from 'path';
  import * as fs from 'fs';

  const SCREENSHOTS_DIR = '/tmp/playwright-activity-card';
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  test.describe('Adaptive ActivityCard visual', () => {
    test.beforeEach(async ({ page }) => {
      // Navigate to the schedule page
      await page.goto('http://localhost:3000/schedule'); // adjust URL as needed
      // Wait for at least one activity card
      await page.waitForSelector('[data-testid^="activity-"]', { timeout: 10000 });
    });

    test('cards render in 3 tiers without silent clipping', async ({ page }) => {
      // Gather all activity cards
      const cards = await page.locator('[data-testid^="activity-"]').all();
      expect(cards.length).toBeGreaterThan(0);

      for (const card of cards) {
        const box = await card.boundingBox();
        expect(box).not.toBeNull();
        if (!box) continue;
        // Card height should be ≥ 60 (Tiny min)
        expect(box.height).toBeGreaterThanOrEqual(60);

        // Verify no content is silently clipped:
        // for each child, scrollHeight ≤ clientHeight (no overflow hidden beyond truncate)
        const overflowOk = await card.evaluate((el) => {
          const all = el.querySelectorAll('*');
          for (const child of all) {
            const ce = child as HTMLElement;
            // Skip elements with explicit truncate/line-clamp (they intentionally clip)
            if (ce.classList.contains('truncate') || ce.classList.contains('line-clamp-2')) continue;
            if (ce.scrollHeight > ce.clientHeight + 1) {
              return { ok: false, tag: ce.tagName, cls: ce.className };
            }
          }
          return { ok: true };
        });
        expect(overflowOk.ok).toBe(true);
      }
    });

    test('screenshot cards grouped by tier', async ({ page }) => {
      // For each card, take a screenshot
      const cards = await page.locator('[data-testid^="activity-"]').all();
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const activityId = await card.getAttribute('data-testid');
        await card.screenshot({
          path: path.join(SCREENSHOTS_DIR, `${activityId}.png`),
        });
      }
    });

    test('tiny card shows only header + title', async ({ page }) => {
      // Find the smallest card (likely Tiny)
      const cards = await page.locator('[data-testid^="activity-"]').all();
      let smallest = cards[0];
      let smallestH = Infinity;
      for (const c of cards) {
        const h = (await c.boundingBox())?.height ?? Infinity;
        if (h < smallestH) {
          smallestH = h;
          smallest = c;
        }
      }
      if (smallestH < 70) {
        // Tiny tier
        const footer = await smallest.locator('[data-testid="btn-quick-add"]').count();
        expect(footer).toBe(0);
        const compactCap = await smallest.locator('[data-testid="compact-capacity"]').count();
        expect(compactCap).toBe(0);
      }
    });
  });
  ```

- [ ] **Step 7.4:** Ensure dev server is running. From `frontend/`:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select/frontend
  npm run dev &  # or use dev.sh from project root
  ```
  Wait for `http://localhost:3000` to be ready.

- [ ] **Step 7.5:** Run the new test:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select/frontend
  npx playwright test admin/e2e/activity-card-adaptive.spec.ts
  ```
  Expected: all pass. Screenshots saved to `/tmp/playwright-activity-card/`.

- [ ] **Step 7.6:** Spot-check 3 screenshots (one per tier) by opening them manually or via image preview. Verify they match the spec's Element Structure.

- [ ] **Step 7.7:** Run full Playwright suite to confirm no regressions:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select/frontend
  npx playwright test
  ```
  Expected: all pass.

- [ ] **Step 7.8:** Commit:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select
  git add frontend/admin/e2e/activity-card-adaptive.spec.ts
  git commit -m "test(frontend): add Playwright tests for adaptive ActivityCard"
  ```

### Self-Review Checklist
- [ ] Tests cover all 3 tiers (Tiny, Compact, Standard)
- [ ] Overflow check is present (no silent clipping)
- [ ] Screenshots are saved to `/tmp/` for review
- [ ] No regression in existing playwright tests
- [ ] URL is correct for the schedule page (verify by hand if unsure)

---

## Execution Order & Dependencies

```
Task 1 (backend model+schema+migration)
  └── Task 2 (backend tests)              [depends on 1]
Task 3 (domain schema)                    [independent of 1, 2; can be done in parallel]
  └── Task 4 (ActivityCard refactor)      [depends on 3 for Location type]
       └── Task 5 (parent components rename)  [depends on 4]
            └── Task 6 (frontend unit tests)  [depends on 4, 5]
                 └── Task 7 (playwright visual) [depends on 4, 5]
```

**Optimal parallel batches:**
- Batch A: Tasks 1, 3 (no inter-dep)
- Batch B: Tasks 2, 4 (after their deps)
- Batch C: Task 5 (after 4)
- Batch D: Tasks 6, 7 (after 5)

In practice, since this is a single worktree, run sequentially: 1 → 2 → 3 → 4 → 5 → 6 → 7.

---

## Total Estimated Effort

| Task | Classification | Estimated Subagent Time |
|------|----------------|-------------------------|
| 1. Backend model + schema + migration | small | 5-10 min |
| 2. Backend tests | small | 10-15 min |
| 3. Domain schema | trivial | 3-5 min |
| 4. ActivityCard refactor | large | 30-45 min |
| 5. Parent components rename | small | 10-15 min |
| 6. Frontend unit tests | small | 15-20 min |
| 7. Playwright visual tests | small | 15-25 min |
| **Total** | | **~90-135 min** |
