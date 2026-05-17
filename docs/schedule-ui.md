---
type: skill
scope: project
sections: [grid, card, dnd, stamp, private, conflict, copy-week, delete-mode]
updated: 2026-05-13
source: sketches/colour-mountains-v4.html, docs/memo-full-spec.md
---

# Schedule UI — Admin Schedule Builder Patterns

Паттерны для P1 (Admin Schedule `/`). Самая сложная страница проекта.

## 1. Schedule Grid (WeekView + DayColumn)

### Структура

```
┌──────┬──────────┬──────────┬──────────┬─────┬──────────┐
│ Время│    ПН    │    ВТ    │    СР    │ ... │    ВС    │
│      │   12     │   13     │   14     │     │   18     │
├──────┼──────────┼──────────┼──────────┼─────┼──────────┤
│ 9:00 │          │          │          │     │          │
│      │ [карт]   │          │ [карт]   │     │          │
│ 9:30 │  (пункт) │          │          │     │          │
│10:00 │          │ [карт]   │          │     │          │
│  ... │          │          │          │     │          │
│21:00 │          │          │          │     │          │
└──────┴──────────┴──────────┴──────────┴─────┴──────────┘
```

### Grid Variables

```typescript
const HOURS_START = 9;    // 9:00
const HOURS_END = 21;     // 21:00
const CELL_HEIGHT = 60;   // px per hour
const SLOT_COUNT = (HOURS_END - HOURS_START) * 2;  // 24 half-hour slots
const TIME_COL_WIDTH = 64; // px
```

### Day Headers

```tsx
// Sticky at top, z-index 50, bg white, border-bottom
<div className="day-headers" style={{
  display: 'grid',
  gridTemplateColumns: `${TIME_COL_WIDTH}px repeat(7, 1fr)`,
  position: 'sticky', top: 0, zIndex: 50,
}}>
  {/* Empty cell for time column */}
  {/* 7 day cells with dayName + dateNumber */}
  {/* Today: brand color for name, filled circle for number */}
</div>
```

### Time Column

```tsx
// Sticky left, z-index 20, bg white, border-right
// 24 rows, alternating solid (hour) / dashed (half-hour) border-top
// Time label positioned at top:-8px, right aligned
// Half-hour labels are hidden
```

### Day Columns

```tsx
// 7 columns (or 1 in day mode), relative positioning
// Each: 24 hour-line divs (solid+half alternating)
// Drop zone: onDragOver adds drag-over class (changes bg)
// Absolute layer for cards on top
// Drop ghost (dashed rect) shown during drag
```

### Now Line

```typescript
// Only on today's column
if (currentHour >= 9 && currentHour <= 21) {
  const top = (currentHour - 9) * 120 + (currentMinutes / 30) * 60;
  // 2px line, brand color, with 8px circle at left
}
```

### Day Mode vs Week Mode

```typescript
// Week mode: 7 columns, gridTemplateColumns = timeCol + repeat(7, 1fr)
// Day mode: 1 column, gridTemplateColumns = timeCol + 1fr
// Both reuse same buildDayCol() with colCount param
```

## 2. Activity Card

### Card Formula

```typescript
function cardStyle(event: Activity, artist: Artist) {
  const pct = event.occupied / event.capacity;  // 0..1
  const fillOpacity = (0.12 + pct * 0.28).toFixed(2);  // 0.12 to 0.40
  const rgb = hexToRgb(artist.color);
  const top = (parseTime(event.startTime) - 9) * 120;   // half-hour slots × 60px
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

### Card Layout

```tsx
<div className="event-card" style={cardStyle}>
  <div className="ev-inner">
    {/* Time pill: oval with artist color fill */}
    <div className="ev-time-pill">{startTime} — {endTime}</div>

    {/* Service name: 2 lines max, 600 weight, 13px */}
    <div className="ev-title">{serviceName}</div>

    {/* Age: icon + text (5+, 6+, 8+, 10+, 12+, 6-12) */}
    <div className="ev-age">👤 {minAge}</div>

    {/* Master: full name */}
    <div className="ev-master">{artistName}</div>

    {/* Location */}
    <div className="ev-loc">📍 {locationName}</div>

    {/* Private star (only for private events) */}
    {isPrivate && <StarIcon />}
  </div>

  {/* Footer */}
  <div className="ev-footer">
    <span>👥 {occupied}/{capacity}</span>
    <button>{isPrivate ? '···' : '+'}</button>
  </div>
</div>
```

### Collapsing (small cards)

```typescript
const isSmall = height < 90;  // hide age + master + location
const isTiny = height < 56;   // hide everything except time pill
```

### Private Events (cut corner)

```css
.event-card.private .ev-inner {
  clip-path: polygon(
    0 0,
    calc(100% - 18px) 0,
    100% 18px,
    100% 100%,
    0 100%
  );
}
```

## 3. Drag & Drop

### HTML5 Native (prototype) / @dnd-kit (Next.js)

```typescript
// State
let dragId: string | null = null;
let dragCopy: boolean = false;

// Start
function onDragStart(event, id: string) {
  dragId = id;
  dragCopy = event.altKey;
  card.classList.add('dragging');  // opacity: .5, scale: .99
}

// Over
function onDragOver(event, columnIndex: number) {
  event.preventDefault();
  // Show ghost (dashed rect) at snapped position
  const snap = Math.floor((mouseY - columnTop) / CELL_HEIGHT) * CELL_HEIGHT;
  ghost.style.display = 'block';
  ghost.style.top = `${snap}px`;
  ghost.style.height = `${srcHeight}px`;
  ghost.className = dragCopy ? 'drop-ghost copy' : 'drop-ghost';
}

// Drop
function onDrop(event, columnIndex: number, dayIndex: number) {
  // Calculate new start time from snap position
  const newStart = HOURS_START + snap / CELL_HEIGHT * 0.5;

  // Move: just reposition + change parent
  // Copy (altKey): clone node, set new id, append to column

  showToast(
    (isCopy ? 'Скопировано: ' : 'Перемещено: ') + title + ' → ' + dayName + ' ' + time,
    true  // with Undo button
  );
}
```

### Ghost Styles

```css
.drop-ghost {
  position: absolute; left: 6px; right: 6px;
  border: 2px dashed var(--brand);
  border-radius: 12px;
  background: rgba(0,77,86,.06);
  pointer-events: none;
  z-index: 30;
}
.drop-ghost.copy {
  border-color: #6B8E6E;
  background: rgba(107,142,110,.07);
}
```

## 4. Stamp (Format Painter)

### Состояние

```typescript
interface StampState {
  masterId: string;       // selected master
  serviceId: string;      // selected service
  locations: Set<string>; // multiple locations (checkbox)
  ready: boolean;         // true when master + service + at least 1 location
}
```

### Поведение

- Штамп настраивается в правой панели
- Когда готов — зелёная мигающая точка + краткое описание
- Клик по пустому слоту в расписании → создаёт событие с параметрами штампа
- Если штамп не настроен — клик по слоту ничего не делает (или заглушка)

## 5. Delete Mode

```typescript
let deleteMode: boolean = false;

function toggleDelete() {
  deleteMode = !deleteMode;
  document.body.classList.toggle('delete-mode', deleteMode);
  if (deleteMode) showToast('Режим удаления — кликните на событие');
}

// Click on card in delete mode
function onCardClick(event, id: string) {
  if (!deleteMode) return;
  const card = document.getElementById(id);
  card.style.transition = 'opacity .15s, transform .15s';
  card.style.opacity = '0';
  card.style.transform = 'scale(.95)';
  setTimeout(() => card.remove(), 150);
  showToast('Удалено: ' + title, true);
}
```

```css
body.delete-mode .event-card {
  cursor: not-allowed;
}
body.delete-mode .event-card:hover {
  box-shadow: 0 0 0 2px rgba(200,80,60,.5) !important;
}
```

## 6. Conflict Warning

- Проверяется при каждой отрисовке: есть ли у одного мастера два события в одно время в разных локациях
- Отображается как красная полоса/бар в колонке конфликта
- Данных для расчёта: `events.filter(e => e.artistId === X)` для каждого мастера

## 7. Copy Last Week

- Копирует Public события (isPublic: true) с предыдущей недели на текущую
- Private события и Records НЕ копируются
- После копирования — toast с "Отменить"

## 8. Toast System

```typescript
// Create toast
function showToast(msg: string, undo: boolean = false) {
  const id = 'toast_' + Date.now();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <span>${msg}</span>
    ${undo ? '<button class="toast-undo">Отменить</button>' : ''}
    <button class="toast-x">×</button>
  `;
  toastWrap.appendChild(toast);
  autoRemove(id, 4500);
}

// Auto-remove after 4.5s
// Undo: calls renderSchedule() to reset state
// Transition: opacity 0 → 1, translateY(8px) → 0
```
