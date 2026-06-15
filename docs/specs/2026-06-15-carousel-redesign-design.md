# Carousel Redesign — Activity Overlap

**Date:** 2026-06-15
**Status:** Draft

## Problem

Current carousel has two conflicting positioning systems:
1. `buildOverlapMap` — fixed positions based on temporal overlap (never changes)
2. `visibleIndices` — cycling through cards (adds offset ON TOP of fixed positions)

Result: cards never truly swap positions, some never come to front, some never shift.

## Solution

### 1. New Offset Formula

Replace fixed `buildOverlapMap` offset with dynamic formula:

```
offset = (12 - z) * z    where z = virtualZIndex (0, 1, 2, ...)
```

| z | Offset px | Notes |
|---|-----------|-------|
| 0 | 0 | Front card |
| 1 | 11 | First layer |
| 2 | 20 | Second layer |
| 3 | 27 | Third layer |
| 4 | 32 | Fourth layer |
| 5 | 35 | Fifth layer |
| 6 | 36 | Maximum |

**virtualZIndex** = distance from the currently visible card.

**Z-axis:** Higher z = further back. At z=12 offset returns to 0 (unlikely in practice).

### 2. Carousel Cycling

When user scrolls (wheel event) on overlapping cards:
- `visibleIndices[groupKey]` increments/decrements
- All cards recalculate their `virtualZIndex` relative to new visible card
- Front card: z = 0, offset = 0, opacity = 1, scale = 1
- Behind cards: z = 1, 2, 3..., offset from formula, opacity/scale decrease

### 3. "N Cards" Popover

Replace static "N cards" badge with clickable popover:

**Trigger:** Click on "N cards" badge
**Position:** Appear near the badge (dropdown-style, below or above depending on space)
**Content:** Mini-schedule with vertical timeline + columns for non-overlapping cards

```
┌─────────────────────────────────────────┐
│  ┌─────┬─────┬─────┐                    │
│  │ 10  │     │     │                    │
│  │     │ 10  │     │   ← vertical       │
│  │ 11  │     │ 10  │     timeline       │
│  │     │ 11  │     │                    │
│  │ 12  │     │ 11  │                    │
│  │     │ 12  │     │                    │
│  │     │     │ 12  │                    │
│  └─────┴─────┴─────┘                    │
│  Col1  Col2  Col3                       │
└─────────────────────────────────────────┘
```

**Layout rules:**
- Columns = minimal number to avoid time intersections
- Vertical timeline on left (matches main schedule grid)
- Each card shows: time range, service name
- Cards colored by master color (same as main view)
- Click on card → close popover, open ActivityDetails modal for that card
- Click outside → close popover
- Max height: 300px, scrollable if needed

### 4. Timeline Alignment

**Critical:** Timeline in popover must align with main schedule:
- Same hour markers (9:00, 10:00, 11:00...)
- Same cell height ratio
- Same time format (HH:MM)
- User sees familiar time grid, no re-orientation needed

### 5. Files to Change

| File | Change |
|------|--------|
| `DayColumn.tsx` | Remove `buildOverlapMap`, add new offset formula, add Popover component |
| `DayColumn.test.tsx` | Update tests for new carousel behavior |
| `ActivityDetailsModal` | Already exists, will be opened from popover click |

### 6. Visual Compliance Checks

- [ ] Overlapping cards show stack effect with formula-based offset
- [ ] Scrolling cycles through cards smoothly
- [ ] "N cards" badge is clickable
- [ ] Popover shows vertical timeline matching main schedule
- [ ] Popover shows minimal columns for non-overlapping display
- [ ] Clicking card in popover closes popover and opens ActivityDetails
- [ ] Popover closes on outside click
