# Adaptive ActivityCard Design Spec

**Date:** 2026-06-16
**Feature:** Adaptive ActivityCard — 3-tier layout (Tiny / Compact / Standard)
**Status:** Draft
**Worktree:** `feat/photo-searchable-select`

## Overview

Current `ActivityCard` uses two thresholds (`showExtra`, `showOnlyPill`) based on raw `heightPx`. When `durMinutes` is small (≤ 90 min) and the title wraps to 2 lines, the card content is physically clipped (`overflow:hidden` + `flex-shrink: 1` shrinks children, and `truncate`/`overflow:hidden` on title/master/footer crops the text silently — no `…` indicator).

**Goal:** Make all useful information readable for any duration ≥ 30 min by introducing a 3-tier adaptive layout that:
1. Chooses a structural mode from `durMinutes` (Tiny / Compact / Standard)
2. Within each mode, decides whether `master` fits based on available height
3. Always uses `line-clamp-2` on title (and `truncate` on location) so overflow is visually signalled, not silently lost
4. Symmetrises card margins (4px top/left/right, 8px bottom)

**Out of scope:** Calendar/overlap popover changes, modal redesign, schedule grid changes.

## Problem Statement

### Current behaviour (verified by visual check on 2026-06-16)

| Duration | h card | Title | Master | Footer | Verdict |
|---|---|---|---|---|---|
| 1:00 (60 min) | 90 | clipped top | **invisible** | **invisible** | broken |
| 1:30 long title | 140 | bottom clipped | compressed | compressed | broken |
| 1:30 short title | 112 | compressed | compressed | compressed | broken |
| 2:00+ | ≥175 | ok | ok | ok | fine |

Root cause: `heightPx = max((durMinutes/60) * cellHeight * 2 - 10, 52)`. Natural content height ≈ 152-172px. Below ~1:42h the card is shorter than its content → silent clipping.

## Architecture

```
ActivityCard
├── isTiny       (durMinutes < 60)          → header + title 1-line
├── isCompact    (60 ≤ durMinutes < 90)     → header + title (line-clamp-2) + master? + location+capacity
└── isStandard   (durMinutes ≥ 90)          → header + title (line-clamp-2) + master? + location + footer
```

**Tier selection** (precomputed from `durMinutes`):
```ts
const isTiny = durMinutes < 60;
const isCompact = !isTiny && durMinutes < 90;
const isStandard = !isTiny && !isCompact;
const hasFooter = isStandard;
```

**Master visibility** (one rule for both Compact and Standard):
```ts
const want2LineTitle       = heightPx >= (hasFooter ? 134 : 90);
const canFit2LineWithMaster = heightPx >= (hasFooter ? 152 : 108);
const canFit1LineWithMaster = heightPx >= (hasFooter ? 132 : 88);

const titleLines = want2LineTitle ? 2 : 1;
const showMaster = titleLines === 2 ? canFit2LineWithMaster : canFit1LineWithMaster;
```

**Rule:** if the card can fit 2 title lines + master, show both. If it can fit 2 title lines but not master, hide master (keep 2 title lines). If it can fit only 1 title line, show master if it fits, else hide it.

## Layout & Sizing

### Card position and height
```ts
const topPx    = (activity.startTime - gridStart) * cellHeight * 2 + 4;     // +1 unit top margin
const heightPx = Math.max((durMinutes / 60) * cellHeight * 2 - 8, 60);      // -2 unit bottom, min 60
```

### Margins
| Edge    | Value | Source                                   |
|---------|-------|------------------------------------------|
| Top     | 4 px  | `+4` in `topPx` (new)                    |
| Bottom  | 8 px  | `-8` in `heightPx` (new; was `-10`)      |
| Left    | 4 px  | existing `left-1` (no change)            |
| Right   | 4 px  | existing `right-1` (no change)           |

### Element heights (at cellHeight = 50, default)
| Element             | Height  |
|---------------------|---------|
| Header (time-pill)  | 26 px   |
| Title + age (1 line) | 20 px  |
| Title + age (2 lines)| 40 px  |
| Master              | 18 px   |
| Location row        | 24 px   |
| Footer              | 44 px   |

## Element Structure

```
┌─────────────────────────────────────┐
│ HEADER: 10:00–11:30        [💎]     │  26px — always
├─────────────────────────────────────┤
│ 🧒 Mini-картина                    │  20–40px — line-clamp-2
│    акрилом                          │     age icon inline
├─────────────────────────────────────┤
│ [master]                            │  18px — if showMaster
│ ↕ flex-1 spacer                    │
├─────────────────────────────────────┤
│ 📍 Гранд                  1/6  ←   │  24px — location + capacity
│                                    │     capacity right (Compact)
├─────────────────────────────────────┤
│ FOOTER: 👥 1/6              [+]    │  44px — Standard only
└─────────────────────────────────────┘
```

### Concrete changes inside `ActivityCard.tsx`

1. **Title row** (replaces separate title + age rows):
   - `line-clamp-2` Tailwind utility on the text container
   - `flex items-start gap-1` so the age icon sits inline to the left of the text
   - Age icon: keep the current `w-3 h-3` SVG; `flex-shrink-0`

2. **Age row**: **removed** (icon now inline with title).

3. **Master row**: wrapped in `{showMaster && (...)}`. Spacer (`<div className="flex-1" />`) only renders when `showMaster` is true.

4. **Location row**:
   - Replaces `locationName` lookup with `locationShortName = locations.find(l => l.id === activity.locationId)?.shortTitle || locations.find(l => l.id === activity.locationId)?.name || ''`
   - Adds `flex-1` on the `<span>` so `truncate` works
   - In Compact: append a `<span className="flex-shrink-0">{occupied}/{capacity}</span>` to the right
   - In Standard: capacity is shown only in the footer (unchanged)

5. **Footer**: wrapped in `{isStandard && (...)}`.

6. **Imports**: `import type { Activity, Master, Location } from '@memo/domain'` (replace `Studio` with `Location`); prop `studios?: Location[]` (rename to `locations?` and pass from parent).

## Backend Changes — `Location.shortTitle`

### Model
`backend/src/models/location.py` — add:
```python
short_title: Mapped[str | None] = mapped_column(String(50), nullable=True)
```

### Schemas
`backend/src/schemas/location.py` — add `short_title: str | None = None` to `LocationBase`, `LocationCreate`, `LocationUpdate`, `LocationResponse`.

### Migration
Alembic: add column `short_title VARCHAR(50) NULL` to `locations`.

### API
Naming convention (consistent with existing fields):
- Python: `short_title`
- API JSON: `short_title`
- TypeScript domain: `shortTitle`

### Domain
`packages/domain/src/index.ts` — extend `LocationSchema`:
```ts
export const LocationSchema = z.object({
  id: z.string(),
  name: z.string(),
  shortTitle: z.string().optional(),  // new
  address: z.string().optional(),
  emoji: z.string().optional(),
  defaultCapacity: z.number().optional(),
  sortOrder: z.number().optional(),
});
```

### Frontend wiring
- `ActivityCard` reads `location.shortTitle ?? location.name`
- Parent components (`DayView`, `DayColumn`, `WeekView`, `OverlapPopover`) — rename `studios` prop to `locations`, type `Location[]`

### Fallback
If `shortTitle` is empty/missing → use `name`; `truncate` itself crops if still too long.

## Edge Cases

| Case                                    | Behaviour |
|-----------------------------------------|-----------|
| `durMinutes` exactly 60 (1:00)           | isCompact = true. 1-line title + master fits (88 ≤ 92). 2-line title hides master (90 ≤ 92 ≤ 108). |
| `durMinutes` exactly 90 (1:30)          | isStandard = true. 1-line title + master fits (132 ≤ 142). 2-line title hides master (134 ≤ 142 ≤ 152). |
| `durMinutes` < 30 (theoretical)         | heightPx = 60 (min). Tiny shows header + title with truncate. |
| `capacity = 0`                          | capacity is shown as `0/0`. `fillPct = 0` (no crash). |
| `isPrivate = true`                      | Header shows diamond. Compact capacity row shows `0/0` (admin sees fill info). Footer `+` button replaced with `···` (unchanged). |
| `master` is undefined                   | isPrivate path or test fixture — showMaster check is independent of master presence; row renders `''` (truncate empty). |
| Activity in overlap group (`scale < 1`) | Card dimensions unchanged in DOM; visual scaling is by parent transform. Text is harder to read at scale 0.8, but layout invariants hold. |

## Visual Compliance Checks (for VCG Step 4.5)

- [ ] Tiny card (30 min) shows only header + title (1 line, truncate if needed)
- [ ] Tiny card has no master, no location, no footer
- [ ] Compact card (1:00, 2-line title) shows header + 2-line title + location+capacity, NO master, NO footer
- [ ] Compact card (1:15+) shows header + 2-line title + master + location+capacity, NO footer
- [ ] Compact capacity (`X/Y`) appears on the right side of the location row
- [ ] Standard card (1:30, 2-line title) shows header + 2-line title + location + footer, NO master
- [ ] Standard card (1:30, 1-line title) shows header + 1-line title + master + location + footer
- [ ] Standard card (2:00+) shows header + 2-line title + master + location + footer
- [ ] Age icon is positioned inline to the left of the title text
- [ ] Title uses `line-clamp-2` (no more than 2 lines visible)
- [ ] Location uses `truncate` (1 line, ellipsis on overflow)
- [ ] All cards have 4px margin on top/left/right, 8px on bottom
- [ ] Existing tests (header pill, occupancy, capacity=0, isPrivate, etc.) still pass

## Testing Strategy

### Unit (vitest) — `frontend/admin/__tests__/ActivityCard.test.tsx`

- **Master visibility table** — parametrized:
  - `[30, 60, 75, 90, 105, 120, 150, 180]` min × `[1-line title, 2-line title]` → expected `showMaster` for each
- **Tier selection** — `[30, 59, 60, 89, 90, 120]` min → expected `isTiny/isCompact/isStandard`
- **Compact capacity rendering** — capacity appears in location row, not in footer (query for `1/6` returns the location one, footer absent)
- **Tiny mode** — query for master/footer → not in document
- **Standard mode** — footer present
- **Existing tests** — all current tests must still pass (Studio→Location rename, header pill, occupancy, capacity=0, isPrivate diamond)

### Visual (playwright) — `frontend/admin/e2e/`

- Screenshots of cards in each tier (Tiny 30, Compact 60/75/90, Standard 90/120/180) with both 1-line and 2-line titles
- Verify no content is silently clipped: every element has computed height > 0 and content height ≤ element height
- Overlap group screenshot — short cards in a 3-card overlap should still be readable

### Backend (pytest) — `backend/tests/`

- `Location` model — column exists, nullable, length 50
- `Location` schemas — `short_title` is optional in Create/Update/Response
- API — create/update/get a Location with `short_title`; missing field → null

## Files Touched

### Frontend
- `frontend/admin/app/components/schedule/ActivityCard.tsx` — refactored layout, Studio→Location, `line-clamp-2`, master/footer conditions
- `frontend/admin/app/components/schedule/DayView.tsx` — `studios` → `locations` prop
- `frontend/admin/app/components/schedule/DayColumn.tsx` — same
- `frontend/admin/app/components/schedule/WeekView.tsx` — same
- `frontend/admin/app/components/schedule/OverlapPopover.tsx` — same
- `frontend/admin/__tests__/ActivityCard.test.tsx` — new tests
- `frontend/admin/e2e/...` — new visual tests

### Shared
- `packages/domain/src/index.ts` — `LocationSchema.shortTitle`

### Backend
- `backend/src/models/location.py` — `short_title` column
- `backend/src/schemas/location.py` — field in Base/Create/Update/Response
- `backend/src/migrations/versions/<new>_location_short_title.py` — Alembic
- `backend/tests/...` — schema + API tests

## Risk & Rollback

- **Risk:** Renaming `Studio` import → `Location` may break other call sites not listed above. Mitigation: `rg -n "Studio" frontend/` after the rename to catch stragglers.
- **Risk:** Changing `heightPx` formula may shift existing tests' snapshot expectations. Mitigation: update test fixtures to use the new heights.
- **Rollback:** Revert the merge commit. No DB destructive changes (column is nullable with default null), so rollback is safe even after migration.
