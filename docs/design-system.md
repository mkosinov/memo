---
type: design-system
scope: project
sections: [colors, typography, shadows, spacing, components, icons, patterns]
updated: 2026-05-17
source: sketches/colour-mountains-v4.html + feat-admin-schedule worktree (actual implementation)
---

# v4 Design System — ColourMountains Memo

Визуальная дизайн-система для Memo.
**Source of truth:** реализованный код в `.worktrees/feat-admin-schedule/frontend/`.
Все значения выверены из реального кода, расхождения со скетчем помечены ⚠️.

---

## Colors

### Theme Variables (CSS custom properties)

```css
:root {
  /* Light theme */
  --bg:         #EDEDEE;
  --sidebar-bg: #1E2D2F;
  --brand:      #004D56;
  --brand-light:#006670;
  --white:      #ffffff;
  --card-bg:    #ffffff;
  --surface:    #f4f4f5;
  --ink:        #1a1a1a;
  --ink-mid:    #555555;
  --ink-light:  #888888;
  --ink-faint:  #cccccc;
  --line:       #E0E0E1;
  --line-dark:  rgba(255,255,255,.1);
  --gold:       #C49A2E;

  /* Layout */
  --sidebar-w:           230px;
  --sidebar-collapsed-w: 56px;
  --right-w:             260px;
  --cell-h:              60px;      /* height per hour */
  --time-w:              64px;      /* time column width */
  --toolbar-h:           48px;

  /* Grid */
  --grid-line:      #E8EDEE;
  --grid-line-half: #F0F3F4;
  --grid-bg:        #FFFFFF;

  /* Status */
  --success: #6B8E6E;
  --warning: #C8A050;
  --danger:  #C8503C;

  /* Misc */
  --radius:    16px;
  --radius-sm: 8px;
  --transition: 0.2s ease;
}

[data-theme="dark"] {
  --bg:         #1a1a1c;
  --white:      #252528;
  --card-bg:    #2a2a2e;
  --surface:    #303035;
  --ink:        #e8e8ea;
  --ink-mid:    #aaaaae;
  --ink-light:  #777780;
  --ink-faint:  #555560;
  --line:       #3a3a3e;
}
```

### Tailwind Color Tokens

Все CSS-переменные продублированы в `tailwind.config.ts`:

```ts
colors: {
  brand:    { DEFAULT: '#004D56', light: '#006670' },
  sidebar:  { DEFAULT: '#1E2D2F' },
  surface:  { DEFAULT: '#f4f4f5', 2: '#303035' },
  card:     { DEFAULT: '#ffffff', dark: '#252528' },
  ink:      { DEFAULT: '#1a1a1a', mid: '#555555', light: '#888888', faint: '#cccccc' },
  line:     { DEFAULT: '#E0E0E1', dark: 'rgba(255,255,255,.1)' },
  artist:   { olga: '#5B8C7A', yulia: '#6B7E9C', anastasia: '#A07060',
              darya: '#7A6E9C', aleksandra: '#8A7840', irina: '#9A5870' },
  status:   { confirmed: '#10b981', cancelled: '#ef4444', noShow: '#6b7280' },
}
```

### Artist Colors

```typescript
const ARTIST_COLORS: Record<string, string> = {
  'Ольга Середа':      '#5B8C7A',  // зелёный мох
  'Юлия Большакова':   '#6B7E9C',  // стальной синий
  'Анастасия П.':      '#A07060',  // терракота
  'Дарья Тюльпина':    '#7A6E9C',  // лавандовый
  'Александра В.':     '#8A7840',  // оливковый
  'Ирина Горох':       '#9A5870',  // ягодный
};
```

### Status Badge Colors

| Status | Tailwind | Hex |
|--------|----------|-----|
| CONFIRMED | `status.confirmed` | #10b981 (emerald) |
| CANCELLED | `status.cancelled` | #ef4444 (red) |
| NO_SHOW | `status.noShow` | #6b7280 (gray) |

Паттерн badge: `bg-{color}/15 text-{color}` pill с `rounded-full px-2 py-0.5 text-xs font-medium`.

---

## Typography

Font family: `'Inter', sans-serif` (Google Fonts, через `var(--font-inter)`)
Headings: `'Playfair Display', serif` (Google Fonts)

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Time pill | 12px | 600 | white на `rgba(0,0,0,0.25)` |
| Service name | 14px (`text-sm`) | 600 | black (на карточке) |
| Age | 13px | 400 | black (на карточке) |
| Master name | 13px | 400 | black (на карточке) |
| Location | 13px | 400 | black (на карточке) |
| Guests count | 13px | 500 | black (на карточке) |
| Day headings | 10px | 500 uppercase | `var(--ink-light)` |
| Day number | 22px | 300 (light) | `var(--ink-mid)` |
| Period label (Toolbar) | 14px (`text-sm`) | 500 | `var(--ink)` |
| Nav item (Sidebar) | 14px (`text-sm`) | 400 | `rgba(255,255,255,.60)` |
| Nav item active | 14px (`text-sm`) | 500 | white |
| Mini-cal month | 12px (`text-xs`) | 600 | `rgba(255,255,255,.90)` |
| Mini-cal day number | 11px | 400 | `rgba(255,255,255,.50)` / `.90` active |
| User name | `text-xs` | 400 | `rgba(255,255,255,.70)` |
| Version | 10px | 400 | `rgba(255,255,255,.30)` |
| Section label (legend) | 10px uppercase tracking-wider | 600 | `rgba(255,255,255,.40)` |

> ⚠️ **Отличие от скетча:** текст внутри ActivityCard — **чёрный** (`text-black`), не `var(--ink)` / `var(--ink-mid)`. Это намеренно: карточки заливаются цветом мастера (solid), чёрный обеспечивает контраст на любом цвете.

---

## Shadows

```css
/* Cards */
box-shadow: 0 1px 4px rgba(0,0,0,.08);      /* shadow-card */
/* Site cards */
box-shadow: 0 2px 16px rgba(0,0,0,.09);     /* shadow-site-card */
/* Cards hover */
box-shadow: 0 4px 14px rgba(0,0,0,.13);     /* shadow-card-hover */
transform: translateY(-1px);

/* Collapse / toggle buttons */
box-shadow: 0 1px 4px rgba(0,0,0,.12);      /* shadow-collapse */

/* Panel (right panel) */
box-shadow: 0 2px 10px rgba(0,0,0,.1);      /* shadow-panel */

/* Toast */
box-shadow: 0 4px 20px rgba(0,0,0,.2);      /* shadow-toast */

/* Appearance popup */
box-shadow: 0 8px 32px rgba(0,0,0,.14);     /* shadow-popup */
```

Tailwind: `shadow-card`, `shadow-site-card`, `shadow-card-hover`, `shadow-collapse`, `shadow-panel`, `shadow-toast`, `shadow-popup`.

---

## Spacing & Sizing

| Element | Value | CSS var / Tailwind |
|---------|-------|-------------------|
| Sidebar width | 230px | `--sidebar-w` / `w-sidebar` |
| Sidebar collapsed | 56px | `--sidebar-collapsed-w` / `w-sidebar-collapsed` |
| Right panel | 260px | `--right-w` / `w-right-panel` |
| Toolbar height | 48px | `--toolbar-h` / `h-12` |
| Hour height | 60px | `--cell-h` / `h-cell` |
| Half-hour slot | 30px | (60px / 2) |
| Time column | 64px | `--time-w` / `w-time-col` |
| Hours range | 9:00–21:00 | 12h × 2 = 24 слота |
| Card padding | `px-2 py-1` / `px-2 pb-1` | inline |
| Card horizontal gap | `left-1 right-1` (4px each side) | Tailwind |
| Sidebar padding | `px-3` / `px-4` | Tailwind |
| Section gap | `space-y-1.5` / `py-2` | Tailwind |

---

## Border Radius

| Element | Radius | Tailwind |
|---------|--------|----------|
| Event cards | 16px | `rounded-lg` / `--radius` |
| Buttons, inputs, selects | 8px | `rounded-lg` / `--radius-sm` |
| Avatars, day circles | 50% | `rounded-full` |
| Time pill | `rounded-br-lg` | top-left flush, bottom-right rounded |
| Mini-cal week row | 6px | `rounded-md` |
| Badge (status) | full pill | `rounded-full` |

---

## Scrollbar

```css
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--line); border-radius: 2px; }
```

---

## Transitions

| Element | Properties | Duration | Easing |
|---------|------------|----------|--------|
| Sidebar width | `width` | 200ms | `ease` |
| Right panel width | `width` / `max-h` | 200ms | `ease` |
| Card hover | `box-shadow, transform` | 150ms | `ease` |
| Card delete | `opacity, transform (scale-95)` | 150ms | `ease` |
| Toast slide-up | `opacity, translateY(8px→0)` | 200ms | `ease-out` |
| Accordion | `max-height` | 200ms | `ease` |
| Nav item | `color, background` | 150ms | `ease` |
| Theme toggle | `color, background` | 150ms | `ease` |
| Sidebar collapse btn arrow | `transform (rotate-180)` | 200ms | `ease` |

---

## Animations (keyframes)

```css
@keyframes slide-up {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.animate-slide-up { animation: slide-up 200ms ease-out; }
```

> ⚠️ **Отличие от скетча:** `fadeIn .18s` заменён на `slide-up 200ms ease-out`.

---

## Components

### Sidebar

```tsx
<aside
  style={{ width: collapsed ? '56px' : '230px', backgroundColor: 'var(--sidebar-bg)' }}
  className="fixed left-0 top-0 h-full z-30 flex flex-col transition-all duration-200"
>
  {/* Logo Section — emoji + text (не PNG) */}
  <div className="flex items-center px-4 py-4 border-b border-white/10">
    <span>🏔</span>
    {!collapsed && <span className="text-sm font-bold text-white">Colour Mountains</span>}
  </div>

  {/* Scrollable: MiniCalendar + nav divider + Navigation + legend divider + ArtistLegend */}
  <div className="flex-1 overflow-y-auto">
    <MiniCalendar />
    <nav>{/* 5 nav items */}</nav>
    <ArtistLegend />
  </div>

  {/* Bottom: User Avatar + Theme Toggle (slider) + Collapse button + Version */}
  <div className="border-t border-white/10">
    {/* theme slider: Sun/Moon pill */}
    {/* collapse: rounded-lg button, arrow rotates 180° when collapsed */}
  </div>
</aside>
```

**Navigation items (5):**
1. Расписание (`/`) — CalendarIcon
2. Бронирования (`/bookings`) — ClipboardIcon
3. Клиенты (`/clients`) — UsersIcon
4. Мастера — PaletteIcon
5. Чат (`/chat`) — ChatIcon

Active state: `bg-brand text-white font-medium`. Inactive: `text-white/60 hover:bg-white/5`.

> ⚠️ **Отличие от скетча:** 5 пунктов (не 6), кнопка схлопывания в нижней секции (не абсолютная на краю).

---

### Toolbar

```tsx
<div
  className="sticky top-0 z-40 flex h-12 items-center justify-between border-b px-3"
  style={{ backgroundColor: 'var(--white)', borderColor: 'var(--line)' }}
>
  {/* Left: ◀ [date range] ▶ [Сегодня] */}
  {/* Center: [День] [Неделя] pill toggle */}
  {/* Right: [Все мастера ▾] [Все локации ▾] selects */}
</div>
```

Select style: `rounded-lg border px-2 py-1.5 text-xs`, border=`var(--line)`, bg=`var(--white)`, color=`var(--ink-mid)`.

Button "Сегодня": `rounded-lg px-3 py-1.5 text-xs font-medium`, border=`var(--brand)`, color=`var(--brand)`.

View toggle: pill контейнер `bg-surface rounded-lg p-0.5`. Active: `bg-brand text-white shadow-sm`. Inactive: `text-ink-light`.

---

### Right Panel

```tsx
<aside
  className="fixed right-0 top-0 z-20 h-full border-l bg-white transition-all duration-200"
  style={{ width: 'var(--right-w)', borderColor: 'var(--line)' }}
>
  {/* Header: "Инструменты" + ‹ arrow button */}
  {/* AccordionSection "Штамп" → StampPanel */}
  {/* AccordionSection "Неделя" → CopyLastWeek button */}
</aside>
```

Toggle: `StampFab` — плавающая кнопка справа (FAB), открывает/закрывает RightPanel. При открытой панели: кнопка-стрелка `‹` в header.

AccordionSection паттерн:
```tsx
<div className="border-b" style={{ borderColor: 'var(--line)' }}>
  <button className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-surface">
    <span>{title}</span>
    <svg className={`rotate-180 when open`} /> {/* chevron down */}
  </button>
  <div className={`overflow-hidden transition-all duration-200 ${open ? 'max-h-96 px-4 pb-3' : 'max-h-0'}`}>
    {children}
  </div>
</div>
```

---

### Activity Card

```tsx
<div
  className="absolute left-1 right-1 rounded-lg overflow-hidden flex flex-col cursor-pointer transition-shadow hover:shadow-md"
  style={{
    top: `${(startTime - 9) * 120}px`,       // HOURS_START=9, CELL_HEIGHT=60, ×2 for 30min
    height: `${Math.max(duration * 120 - 10, 52)}px`,
    backgroundColor: artist.color,            // solid fill, не прозрачный!
  }}
>
  {/* 1. HEADER: time pill (rounded-br-lg, rgba(0,0,0,0.25)) + Private diamond icon */}
  {/* 2. TITLE: text-sm font-semibold text-black (px-2) */}
  {/* 3. AGE: shown if height ≥ 90px — icon + minAge text, text-[13px] text-black */}
  {/* 3b. MASTER: shown if height ≥ 90px — artist.name, text-[13px] text-black truncate */}
  {/* flex-1 spacer */}
  {/* 4. LOCATION: shown if height ≥ 90px — pin icon + locationName, text-[13px] text-black */}
  {/* 5. FOOTER: progress bar (filled + unfilled divs) + occupied/capacity + action button */}
</div>
```

**Collapsing rules:**
- `height >= 90px` (`showExtra=true`): показать age, master, location
- `height < 56px` (`showOnlyPill=true`): только time pill, скрыть всё остальное
- `52px ≤ height < 90px`: только time pill + title

**Footer (progress bar pattern):**
```tsx
<div style={{ border: '1px solid rgba(0,0,0,0.15)' }} className="mx-0 mb-0 rounded-xl overflow-hidden relative">
  {/* filled: width=fillPct*100%, bg=rgba(0,0,0,0.20) */}
  {/* unfilled: left=fillPct*100%, bg=rgba(0,0,0,0.06) */}
  {/* content: z-10, flex justify-between, px-2 py-1.5, text-[13px] text-black */}
  {/*   left: users icon + "occupied/capacity" */}
  {/*   right: + button (public) or ··· button (private) */}
</div>
```

**Time pill:**
```tsx
<span className="inline-block px-2 py-1 rounded-br-lg text-[12px] font-semibold text-white"
      style={{ backgroundColor: 'rgba(0,0,0,0.25)' }}>
  {startTime}–{endTime}
</span>
```

**Private indicator:** diamond SVG icon (`w-5 h-5`, white stroke), top-right. Нет `clip-path`.

> ⚠️ **Отличия от скетча:**
> - Заливка solid (`artist.color`), не прозрачная (`rgba(rgb, 0.12-0.40)`)
> - Footer — progress bar, не `guests X/Y + button` с разделителем
> - Time pill — `rounded-br-lg`, не oval pill
> - Private — diamond icon, не star + clip-path

**Drag states:**
```tsx
// Original card while dragging (hidden):
{ opacity: 0, zIndex: 50, pointerEvents: 'none' }
// DragOverlay (copy shown under cursor):
{ opacity: 0.5, zIndex: 50, scale: '0.98' }
```

**Delete mode:**
```css
body.delete-mode [data-testid^="activity-"] { cursor: not-allowed !important; }
body.delete-mode [data-testid^="activity-"]:hover {
  box-shadow: 0 0 0 2px rgba(200, 80, 60, 0.5) !important;
}
```

Card delete animation: `opacity-0 scale-95` over 150ms.

---

### Toast

```tsx
<div
  className="fixed bottom-[22px] left-1/2 -translate-x-1/2 animate-slide-up
             flex items-center gap-3 rounded-[10px] px-4 py-2.5 shadow-toast"
  style={{ background: '#1a1a1a', color: '#eee' }}
>
  <span>{message}</span>
  {onUndo && <button className="text-brand-light text-sm font-medium">Отменить</button>}
  <button className="text-white/40 hover:text-white/70 text-lg leading-none">×</button>
</div>
```

Animation: `slide-up 200ms ease-out` (translateY 8px → 0 + opacity 0 → 1).

---

### StampFab (плавающая кнопка)

```tsx
<button
  className="fixed right-4 bottom-6 z-30 flex items-center justify-center
             w-12 h-12 rounded-full shadow-panel transition-colors"
  style={{ backgroundColor: 'var(--brand)', color: 'white' }}
>
  {/* Stamp icon SVG */}
</button>
```

Открывает/закрывает RightPanel. Скрывается когда RightPanel открыт.

---

### Select / Filter Input

Общий паттерн для `<select>` фильтров:

```tsx
<select
  className="rounded-lg border px-2 py-1.5 text-xs"
  style={{
    borderColor: 'var(--line)',
    color: 'var(--ink-mid)',
    backgroundColor: 'var(--white)',
  }}
/>
```

---

### Page Layout Shell

```tsx
// app/layout.tsx
<body>
  <ThemeProvider>
    <ToastProvider>
      <ScheduleProvider>
        <Sidebar />                    {/* fixed left, z-30 */}
        <main style={{
          marginLeft: sidebarCollapsed ? '56px' : '230px',
          marginRight: rightPanelOpen  ? '260px' : '0',
          transition: '0.2s ease',
        }}>
          <Toolbar />                  {/* sticky top-0, z-40, h-12 */}
          {children}
        </main>
        <RightPanel />                 {/* fixed right, z-20 */}
        <StampFab />                   {/* fixed right-4 bottom-6, z-30 */}
        <ToastContainer />             {/* fixed, z-50 */}
      </ScheduleProvider>
    </ToastProvider>
  </ThemeProvider>
</body>
```

---

## Patterns

### Active Nav Item
```tsx
className={item.active
  ? 'bg-brand text-white font-medium'
  : 'text-white/60 hover:bg-white/5 hover:text-white/90'}
```

### Section Divider (Sidebar)
```tsx
<div className="border-t border-white/10 mx-3" />
```

### Active Week (MiniCalendar)
```tsx
className={`w-full grid grid-cols-7 rounded-md py-0.5 transition-colors
  ${isActive ? 'bg-brand/30' : 'hover:bg-white/5'}`}
```

### Today Circle (MiniCalendar)
```tsx
className={`w-5 h-5 text-[11px] rounded-full flex items-center justify-center
  ${isDayToday ? 'bg-brand text-white font-bold' : ''}`}
```

### Hover:surface Button (Right Panel / Toolbar)
```tsx
className="... hover:bg-surface transition-colors"
style={{ color: 'var(--ink-mid)' }}
```

### Page Content Area
```tsx
<div className="p-4 space-y-4">
  <div className="rounded-xl border bg-white p-4"
       style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}>
    {/* card content */}
  </div>
</div>
```
