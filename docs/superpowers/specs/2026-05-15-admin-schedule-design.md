# P1: Admin Schedule — Design Document

> Date: 2026-05-15
> Feature: Admin Schedule Builder (`/`)
> Approach: Hybrid (Next.js init → Design System → Layout → Grid/Cards → DnD → Stamp/Modal)

---

## 1. Overview

Admin Schedule — главная страница приложения Memo. Представляет собой недельную сетку расписания мастер-классов с drag-and-drop управлением, штампом для быстрого создания событий, и системой уведомлений.

**Success Criteria:**
- Администратор видит расписание на неделю (7 дней, 9:00–21:00)
- Может перетаскивать события между днями и временными слотами
- Может создавать события через штамп (Format Painter)
- Может удалять события в режиме удаления
- Видит конфликты (двойная занятость мастера)
- Может копировать public-события с прошлой недели

---

## 2. Architecture

### Tech Stack
- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS 3 + CSS Variables (v4 Design System)
- **State:** React Context (ScheduleContext, UIContext)
- **DnD:** @dnd-kit/core, @dnd-kit/sortable
- **Testing:** Vitest + React Testing Library

### Component Hierarchy

```
app/
├── layout.tsx              # Root layout: ThemeProvider, ToastProvider
├── page.tsx                # Admin Schedule page
├── globals.css             # CSS variables, base styles
│
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx         # Navigation, mini-calendar, legend
│   │   ├── Toolbar.tsx         # Week nav, day/week toggle, filters
│   │   └── RightPanel.tsx      # Stamp config, week info
│   ├── schedule/
│   │   ├── WeekView.tsx        # Grid container (7 days)
│   │   ├── DayColumn.tsx       # Single day column (drop zone)
│   │   ├── TimeColumn.tsx      # Sticky time labels (9:00–21:00)
│   │   ├── ActivityCard.tsx    # Event card with fill opacity
│   │   ├── NowLine.tsx         # Current time indicator
│   │   └── ConflictBar.tsx     # Red conflict indicator
│   ├── stamp/
│   │   └── StampPanel.tsx      # Stamp configuration UI
│   ├── modal/
│   │   └── ActivityModal.tsx   # Create/edit event modal
│   └── toast/
│       └── ToastContainer.tsx  # Toast notifications
│
├── contexts/
│   ├── ScheduleContext.tsx     # Activities, artists, services data
│   └── UIContext.tsx          # Theme, delete mode, toast state
│
├── lib/
│   ├── types.ts               # TypeScript interfaces
│   ├── mock-data.ts           # Mock artists, services, activities
│   └── utils.ts               # Date/time helpers, card style calc
│
└── hooks/
    ├── useSchedule.ts         # ScheduleContext consumer
    └── useDnD.ts             # DnD state management
```

---

## 3. Design System (v4)

### CSS Variables

```css
:root {
  /* Brand */
  --brand: #004D56;
  --brand-light: #E6F0F1;
  --brand-dark: #003840;
  
  /* Sidebar */
  --sidebar-bg: #1E2D2F;
  --sidebar-text: #B8C5C7;
  --sidebar-active: #004D56;
  
  /* Cards */
  --card-bg: rgba(255, 255, 255, 0.85);
  --card-border: rgba(0, 77, 86, 0.12);
  --card-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  
  /* Grid */
  --grid-line: #E8EDEE;
  --grid-line-half: #F0F3F4;
  --grid-bg: #FAFBFC;
  
  /* Text */
  --text-primary: #1A2E30;
  --text-secondary: #5A6E72;
  --text-muted: #8A9A9C;
  
  /* Status */
  --success: #6B8E6E;
  --warning: #C8A050;
  --danger: #C8503C;
  
  /* Misc */
  --radius: 12px;
  --radius-sm: 8px;
  --transition: 0.2s ease;
}
```

### Typography
- **Primary:** Inter, system-ui, sans-serif
- **Mono:** JetBrains Mono (for time labels)
- **Scale:** 12px (labels), 13px (card text), 14px (body), 16px (headers), 20px (page title)

---

## 4. Layout

### Sidebar (Left, 240px, collapsible to 64px)
- Logo (Colour Mountains)
- MiniCalendar (month grid, week highlight, today marker)
- Navigation links (Schedule, Bookings, Clients, Artists, Chat)
- Legend (artist colors)
- Theme toggle (☀/☾)
- User avatar + version

### Toolbar (Top, sticky)
- Week navigation (← →, "Today")
- Date range display ("13–19 мая 2026")
- Day/Week toggle
- Filter buttons (artist, location)
- Delete mode toggle
- Copy last week button

### RightPanel (Right, 280px, collapsible)
- Stamp configuration (master, service, locations)
- Week summary (event count, occupancy)
- Collapsible sections

### Main Area
- Schedule grid (flex: 1, scrollable)

---

## 5. Schedule Grid

### Grid Variables
```typescript
const HOURS_START = 9;
const HOURS_END = 21;
const CELL_HEIGHT = 60;      // px per hour
const SLOT_COUNT = (HOURS_END - HOURS_START) * 2;  // 24 half-hour slots
const TIME_COL_WIDTH = 64;     // px
```

### Structure
- **Header row:** Sticky top, z-index 50. Time column + 7 day columns (day name + date). Today highlighted with brand color.
- **Time column:** Sticky left, z-index 20. Hour labels (9:00, 10:00...). Half-hour slots have dashed border.
- **Day columns:** 7 columns (or 1 in day mode). Relative positioning. 24 slot divs with alternating borders.
- **Now line:** 2px brand-colored line with circle, only on today's column. Updates every minute.

### Day Mode vs Week Mode
- Week mode: `gridTemplateColumns = ${TIME_COL_WIDTH}px repeat(7, 1fr)`
- Day mode: `gridTemplateColumns = ${TIME_COL_WIDTH}px 1fr`
- Same `DayColumn` component, `colCount` parameter

---

## 6. Activity Card

### Card Formula
```typescript
function cardStyle(event: Activity, artist: Artist) {
  const pct = event.occupied / event.capacity;
  const fillOpacity = (0.12 + pct * 0.28).toFixed(2);
  const rgb = hexToRgb(artist.color);
  const top = (parseTime(event.startTime) - 9) * 120;  // half-hour slots × 60px
  const height = Math.max(event.duration * 120 - 10, 52);

  return {
    position: 'absolute',
    top: `${top}px`,
    height: `${height}px`,
    backgroundColor: `rgba(${rgb}, ${fillOpacity})`,
    borderLeft: `3px solid ${artist.color}`,
    '--ev-color': artist.color,
  };
}
```

### Card Layout (inner)
- Time pill: oval with artist color fill
- Service name: 2 lines max, font-weight 600, 13px
- Age: icon + text (5+, 6+, 8+, 10+, 12+, 6-12)
- Master: full name
- Location: icon + name
- Private star (only for private events)

### Footer
- Occupancy: "👥 {occupied}/{capacity}"
- Action button: "+" (public) or "···" (private)

### Collapsing
- `height < 90px`: hide age + master + location
- `height < 56px`: hide everything except time pill

### Private Events
- Cut corner via `clip-path: polygon(...)`
- Red action button "···"

### Hover/Drag States
- Hover: subtle shadow increase
- Dragging: opacity 0.5, scale 0.99

---

## 7. Drag & Drop (@dnd-kit)

### State
```typescript
interface DnDState {
  dragId: string | null;
  dragCopy: boolean;        // altKey pressed
  ghostPosition: { x: number; y: number } | null;
}
```

### Behavior
1. **DragStart:** Store activity ID, check altKey (copy mode). Add `.dragging` class to card.
2. **DragOver:** Calculate snap position (nearest half-hour). Show ghost (dashed rectangle) at snapped position. Ghost style differs for copy vs move.
3. **Drop:** Calculate new start time from snap position. If copy: clone activity with new ID. If move: update activity day/start. Show toast with "Отменить".
4. **DragEnd:** Clean up state, remove `.dragging` class.

### Ghost Styles
```css
.drop-ghost {
  position: absolute; left: 6px; right: 6px;
  border: 2px dashed var(--brand);
  border-radius: 12px;
  background: rgba(0, 77, 86, 0.06);
  pointer-events: none;
  z-index: 30;
}
.drop-ghost.copy {
  border-color: #6B8E6E;
  background: rgba(107, 142, 110, 0.07);
}
```

### Snap Logic
- Snap to nearest half-hour: `Math.round(mouseY / (CELL_HEIGHT / 2)) * (CELL_HEIGHT / 2)`
- Constrain within day column bounds (9:00–21:00)

---

## 8. Stamp (Format Painter)

### State
```typescript
interface StampState {
  masterId: string | null;
  serviceId: string | null;
  locations: Set<string>;
  ready: boolean;  // true when all required fields set
}
```

### Behavior
- Configured in RightPanel
- When ready: green blinking dot + summary text ("Ольга — Картина маслом — Альпика, Гранд Отель")
- Click on empty grid slot → creates new activity with stamp parameters
- If stamp not ready → click does nothing (or shows hint)
- Stamp persists across navigation (week changes)

### Validation
- Master: required
- Service: required
- Locations: at least 1 required
- Default values: capacity from service, occupied = 0, private = false

---

## 9. Delete Mode

### Behavior
- Toggle button in Toolbar
- When active: body gets `.delete-mode` class
- Click on any card → card fades out (opacity 0, scale 0.95, 150ms transition) then removed
- Toast with "Отменить"
- Clicking toggle again exits delete mode

### Visual
- Cards show `cursor: not-allowed`
- Hover: red shadow `0 0 0 2px rgba(200, 80, 60, 0.5)`

---

## 10. Conflict Warning

### Logic
- On every render: check for each artist if they have 2+ events at overlapping times in different locations
- Overlap: `(startA < endB) && (endA > startB)`
- Different locations: `locA !== locB`

### Visual
- Red bar/indicator in affected day column(s)
- Tooltip on hover: "Ольга Середа: пересечение в 10:00 (Альпика vs Гранд Отель)"

---

## 11. Copy Last Week

### Behavior
- Button in Toolbar
- Copies only `isPublic: true` events from previous week to current week
- Private events and Records are NOT copied
- After copy: toast with "Отменить"
- New IDs generated for copied events

---

## 12. Toast System

### API
```typescript
function showToast(message: string, undo?: boolean): void;
function hideToast(id: string): void;
```

### Behavior
- Toasts stack at bottom-right
- Auto-remove after 4.5s
- "Отменить" button calls undo callback (reverts last action)
- Transition: opacity 0→1, translateY(8px)→0
- Max 5 toasts visible

---

## 13. Data Flow

```
Mock Data (lib/mock-data.ts)
    ↓
ScheduleContext (React Context)
    ↓
WeekView → DayColumn → ActivityCard
    ↓
DnD / Stamp / Delete → update ScheduleContext → re-render
```

### State Management
- **ScheduleContext:** activities, artists, services, studios, currentWeek, filters
- **UIContext:** theme, deleteMode, toastQueue, sidebarCollapsed, rightPanelCollapsed

### No Backend (MVP)
- All data in memory via mock-data.ts
- No API calls
- No persistence

---

## 14. Testing Strategy

### Unit Tests (Vitest)
- `cardStyle()` — correct top/height/opacity calculations
- `getFillOpacity()` — boundary values (0, 0.5, 1)
- `formatTime()` — correct formatting (10 → "10:00", 10.5 → "10:30")
- `getMonday()` — correct Monday calculation
- Conflict detection — overlap logic

### Component Tests (React Testing Library)
- WeekView renders 7 day columns
- ActivityCard displays correct info
- DnD drag start sets correct state
- Stamp creates activity on click
- Delete mode removes card

### Integration Tests
- Copy last week duplicates public events
- Undo restores deleted event

---

## 15. File Structure (Target)

```
frontend/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── globals.css
│   └── components/
│       ├── layout/
│       │   ├── Sidebar.tsx
│       │   ├── Toolbar.tsx
│       │   └── RightPanel.tsx
│       ├── schedule/
│       │   ├── WeekView.tsx
│       │   ├── DayColumn.tsx
│       │   ├── TimeColumn.tsx
│       │   ├── ActivityCard.tsx
│       │   ├── NowLine.tsx
│       │   └── ConflictBar.tsx
│       ├── stamp/
│       │   └── StampPanel.tsx
│       ├── modal/
│       │   └── ActivityModal.tsx
│       └── toast/
│           └── ToastContainer.tsx
├── contexts/
│   ├── ScheduleContext.tsx
│   └── UIContext.tsx
├── lib/
│   ├── types.ts
│   ├── mock-data.ts
│   └── utils.ts
├── hooks/
│   ├── useSchedule.ts
│   └── useDnD.ts
├── __tests__/
│   ├── utils.test.ts
│   ├── ActivityCard.test.tsx
│   └── WeekView.test.tsx
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── vitest.config.ts
```

---

## 16. Implementation Order (Plan Preview)

1. **Task 1:** Next.js init + Tailwind + deps (@dnd-kit)
2. **Task 2:** Design system (globals.css, types.ts, mock-data.ts)
3. **Task 3:** Layout components (Sidebar, Toolbar, RightPanel)
4. **Task 4:** Schedule grid (WeekView, DayColumn, TimeColumn, NowLine)
5. **Task 5:** ActivityCard component
6. **Task 6:** DnD integration (@dnd-kit)
7. **Task 7:** Stamp panel + create activity
8. **Task 8:** Delete mode + Conflict warning
9. **Task 9:** Copy last week + Toast system
10. **Task 10:** ActivityModal (create/edit)
11. **Task 11:** Tests + Polish

---

## 17. Open Questions

None. All requirements clarified.

---

*Self-review: No TBD/TODO placeholders. No contradictions. Scope is P1 only. All requirements from schedule-ui.md, mock-data.md, and v4-design-system.md are covered.*
