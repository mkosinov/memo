# Carousel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace broken carousel positioning with formula-based offset and add popover for viewing all overlapping cards.

**Architecture:** Remove `buildOverlapMap` (fixed positions), use only `getDirectOverlapGroup` + `visibleIndices` with new offset formula `(12 - z) * z`. Add Popover component for "N cards" badge.

**Tech Stack:** React, TypeScript, Tailwind CSS

---

## Task 1: Remove buildOverlapMap and update offset formula
### Classification: small
### Required Docs
- `docs/specs/2026-06-15-carousel-redesign-design.md` — offset formula spec

### Task Description
Replace the old carousel positioning system with the new formula-based approach.

### Files
- Modify: `frontend/admin/app/components/schedule/DayColumn.tsx`

### Steps

1. **Remove `OVERLAP_OFFSET` constant** (line 11):
   ```typescript
   // DELETE: const OVERLAP_OFFSET = 12;
   ```

2. **Remove `buildOverlapMap` function** (lines 15-40):
   ```typescript
   // DELETE entire function
   ```

3. **Remove `overlapMap` memo** (line 235):
   ```typescript
   // DELETE: const overlapMap = useMemo(() => buildOverlapMap(activities), [activities]);
   ```

4. **Update wheel handler** — remove overlapMap reference (lines 254-255):
   ```typescript
   // REMOVE these lines:
   const overlapInfo = overlapMap.get(act.id);
   const oy = overlapInfo ? overlapInfo.index * OVERLAP_OFFSET : 0;
   
   // REPLACE with:
   const oy = 0; // No base offset — carousel handles positioning
   ```

5. **Update card rendering** — replace old offset logic (lines 368-371):
   ```typescript
   // REMOVE:
   const overlapInfo = overlapMap.get(activity.id);
   const ox = overlapInfo ? overlapInfo.index * OVERLAP_OFFSET : 0;
   const oy = overlapInfo ? overlapInfo.index * OVERLAP_OFFSET : 0;
   
   // REPLACE with new formula:
   const z = totalInSlot > 1 ? (indexInGroup - visibleIndex + totalInSlot) % totalInSlot : 0;
   const ox = (12 - z) * z;
   const oy = (12 - z) * z;
   ```

6. **Update carousel offset variables** (lines 343-365):
   ```typescript
   // REMOVE carouselOffsetX, carouselOffsetY calculations
   // The new formula replaces them entirely
   
   let cardOpacity = 1;
   let cardScale = 1;
   let cardZIndex = 20;
   let isClickable = true;
   
   if (totalInSlot > 1) {
     const z = (indexInGroup - visibleIndex + totalInSlot) % totalInSlot;
     isClickable = z === 0;
     cardOpacity = z === 0 ? 1 : Math.max(0, 1 - (z * 0.15));
     cardScale = z === 0 ? 1 : Math.max(0.8, 1 - (z * 0.04));
     cardZIndex = 25 - z;
   }
   ```

7. **Update transform style** (line 388):
   ```typescript
   // REMOVE: transform: `translate(${ox + carouselOffsetX}px, ${oy + carouselOffsetY}px) scale(${cardScale})`,
   // ADD:
   transform: `translate(${ox}px, ${oy}px) scale(${cardScale})`,
   ```

8. **Remove unused state variables** (lines 220, 223):
   ```typescript
   // REMOVE: const [prevIndices, setPrevIndices] = useState<Record<string, number>>({});
   // REMOVE: const [animatingKeys, setAnimatingKeys] = useState<Set<string>>(new Set());
   ```

9. **Run tests to verify**:
   ```bash
   cd frontend/admin && npx vitest run __tests__/DayColumn.test.tsx
   ```

10. **Commit**:
    ```bash
    git add frontend/admin/app/components/schedule/DayColumn.tsx
    git commit -m "feat: replace buildOverlapMap with formula-based carousel offset"
    ```

### Expected Result
- Cards stack with formula-based offset
- Carousel cycling works with new positioning
- No visual regression for non-overlapping cards

---

## Task 2: Create Popover component for overlapping cards
### Classification: standard
### Required Docs
- `docs/specs/2026-06-15-carousel-redesign-design.md` — popover layout spec

### Task Description
Create a popover component that shows all overlapping cards in a timeline view with columns.

### Files
- Create: `frontend/admin/app/components/schedule/OverlapPopover.tsx`
- Modify: `frontend/admin/app/components/schedule/DayColumn.tsx` (add popover trigger)

### Steps

1. **Create `OverlapPopover.tsx`** with the following structure:

```typescript
'use client';

import React, { useEffect, useRef } from 'react';
import type { Activity, Master } from '@memo/domain';
import { formatTime } from '@/lib/utils';

interface OverlapPopoverProps {
  activities: Activity[];
  masterMap: Map<string, Master>;
  onClose: () => void;
  onSelectActivity: (activity: Activity) => void;
  /** Position near the badge */
  anchorRect: DOMRect;
}

/**
 * Assigns activities to minimal columns without time intersections.
 * Uses greedy algorithm: each activity goes to first available column.
 */
function assignColumns(activities: Activity[]): Activity[][] {
  const sorted = [...activities].sort((a, b) => a.startTime - b.startTime);
  const columns: Activity[][] = [];
  
  for (const act of sorted) {
    let placed = false;
    for (const col of columns) {
      const lastInCol = col[col.length - 1];
      if (act.startTime >= lastInCol.startTime + lastInCol.duration) {
        col.push(act);
        placed = true;
        break;
      }
    }
    if (!placed) {
      columns.push([act]);
    }
  }
  
  return columns;
}

export function OverlapPopover({ activities, masterMap, onClose, onSelectActivity, anchorRect }: OverlapPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const columns = assignColumns(activities);
  
  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);
  
  // Calculate timeline bounds
  const allStarts = activities.map(a => a.startTime);
  const allEnds = activities.map(a => a.startTime + a.duration);
  const timelineStart = Math.floor(Math.min(...allStarts));
  const timelineEnd = Math.ceil(Math.max(...allEnds));
  const hours = Array.from({ length: timelineEnd - timelineStart + 1 }, (_, i) => timelineStart + i);
  
  // Position below anchor
  const style: React.CSSProperties = {
    position: 'fixed',
    top: anchorRect.bottom + 4,
    left: anchorRect.left,
    zIndex: 100,
  };
  
  return (
    <div ref={popoverRef} style={style} className="bg-white rounded-lg shadow-xl border p-3 max-h-[300px] overflow-auto">
      <div className="flex gap-2">
        {/* Timeline column */}
        <div className="w-10 flex-shrink-0">
          {hours.map(h => (
            <div key={h} className="h-8 text-[10px] text-gray-500 flex items-center">
              {formatTime(h)}
            </div>
          ))}
        </div>
        
        {/* Activity columns */}
        {columns.map((col, colIdx) => (
          <div key={colIdx} className="relative" style={{ minWidth: '80px' }}>
            {col.map(act => {
              const top = (act.startTime - timelineStart) * 32; // 32px per hour
              const height = act.duration * 32;
              const master = masterMap.get(act.masterId);
              return (
                <button
                  key={act.id}
                  onClick={() => onSelectActivity(act)}
                  className="absolute inset-x-0.5 rounded p-1 text-left text-[10px] text-white font-medium overflow-hidden hover:opacity-90 transition-opacity"
                  style={{
                    top: `${top}px`,
                    height: `${height}px`,
                    backgroundColor: master?.color || '#666',
                  }}
                >
                  <div className="font-semibold">{formatTime(act.startTime)}</div>
                  <div className="truncate">{act.serviceName}</div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
```

2. **Update DayColumn.tsx** — add popover state and trigger:

```typescript
// Add state for popover
const [popoverData, setPopoverData] = useState<{
  activities: Activity[];
  anchorRect: DOMRect;
} | null>(null);

// Replace "N cards" button onClick:
onClick={(e) => {
  e.stopPropagation();
  setPopoverData({ activities: group, anchorRect: e.currentTarget.getBoundingClientRect() });
}}

// Add popover render at end of DayColumn:
{popoverData && (
  <OverlapPopover
    activities={popoverData.activities}
    masterMap={masterMap}
    anchorRect={popoverData.anchorRect}
    onClose={() => setPopoverData(null)}
    onSelectActivity={(act) => {
      setPopoverData(null);
      onOpenEditModal?.(act);
    }}
  />
)}
```

3. **Run tests**:
   ```bash
   cd frontend/admin && npx vitest run __tests__/DayColumn.test.tsx
   ```

4. **Commit**:
   ```bash
   git add frontend/admin/app/components/schedule/OverlapPopover.tsx frontend/admin/app/components/schedule/DayColumn.tsx
   git commit -m "feat: add OverlapPopover for viewing all overlapping cards"
   ```

### Expected Result
- Clicking "N cards" badge opens popover
- Popover shows timeline with columns
- Clicking card opens ActivityDetails
- Popover closes on outside click

---

## Task 3: Update tests for new carousel behavior
### Classification: small
### Required Docs
- `frontend/admin/__tests__/DayColumn.test.tsx` — existing test patterns

### Task Description
Update existing tests and add new tests for the formula-based carousel.

### Files
- Modify: `frontend/admin/__tests__/DayColumn.test.tsx`

### Steps

1. **Update existing overlap tests** — remove references to `buildOverlapMap` behavior

2. **Add test for formula-based offset**:
```typescript
it('applies formula-based offset to overlapping cards', () => {
  render(
    <DayColumn
      dayIndex={0}
      date={new Date()}
      activities={partialOverlapActivities}
      masters={MOCK_MASTERS}
    />,
  );
  
  const cardA = screen.getByTestId('activity-a1');
  const cardB = screen.getByTestId('activity-a2');
  
  // Card A (index 0) should be at front
  expect(cardA).toHaveStyle({ zIndex: 25 });
  
  // Card B (index 1) should be offset
  expect(cardB).toHaveStyle({ transform: 'translate(11px, 11px) scale(0.96)' });
});
```

3. **Add test for popover**:
```typescript
it('opens popover when clicking "N cards" badge', async () => {
  render(
    <DayColumn
      dayIndex={0}
      date={new Date()}
      activities={partialOverlapActivities}
      masters={MOCK_MASTERS}
    />,
  );
  
  const badge = screen.getByRole('button', { name: /2 cards/i });
  fireEvent.click(badge);
  
  // Popover should appear
  expect(screen.getByText('10:00')).toBeInTheDocument();
});
```

4. **Run all tests**:
   ```bash
   cd frontend/admin && npx vitest run __tests__/DayColumn.test.tsx
   ```

5. **Commit**:
   ```bash
   git add frontend/admin/__tests__/DayColumn.test.tsx
   git commit -m "test: update carousel tests for new formula-based offset"
   ```

### Expected Result
- All existing tests pass
- New tests verify formula offset
- New tests verify popover behavior

---

## Task 4: Visual verification with BrowserMCP
### Classification: trivial
### Required Docs
- `docs/specs/2026-06-15-carousel-redesign-design.md` — visual compliance checks

### Task Description
Verify the carousel works correctly in the browser using BrowserMCP.

### Steps

1. **Start dev server**:
   ```bash
   cd frontend/admin && npm run dev
   ```

2. **Navigate to schedule view** in browser

3. **Test carousel**:
   - Create 2-3 overlapping activities
   - Verify stack effect with correct offsets
   - Scroll to cycle through cards
   - Verify smooth animation

4. **Test popover**:
   - Click "N cards" badge
   - Verify popover appears near badge
   - Verify timeline matches main schedule
   - Click card in popover
   - Verify ActivityDetails opens

5. **Document results** and commit if all checks pass

### Expected Result
- Visual compliance checks pass
- No regressions in existing functionality
