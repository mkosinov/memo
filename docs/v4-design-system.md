---
type: skill
scope: project
sections: [colors, typography, shadows, spacing, components, icons]
updated: 2026-05-13
source: sketches/colour-mountains-v4.html
---

# v4 Design System — ColourMountains Memo

Визуальная дизайн-система для Memo. Все значения выверены из `colour-mountains-v4.html`.

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
}

/* Dark theme overrides */
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

### Artist Colors

```typescript
const ARTIST_COLORS: Record<string, string> = {
  'Ольга Середа':     '#5B8C7A',  // зелёный мох
  'Юлия Большакова':   '#6B7E9C',  // стальной синий
  'Анастасия П.':      '#A07060',  // терракота
  'Дарья Тюльпина':    '#7A6E9C',  // лавандовый
  'Александра В.':     '#8A7840',  // оливковый
  'Ирина Горох':       '#9A5870',  // ягодный
};
```

### Status Colors

| Status | Style |
|--------|-------|
| CONFIRMED | emerald bg + text |
| CANCELLED | red bg + text |
| NO_SHOW | gray bg + text |

### Gradient Header (устаревший паттерн из v1)

```tsx
<div className="bg-gradient-to-r from-[#667eea] to-[#764ba2] px-5 pt-6 pb-8">
```
> ⚠️ **v4 replaces this** with solid #004D56 or sidebar-style panels.

## Typography

Font family: `'Inter', sans-serif` (Google Fonts)

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Time pill | 10.5px | 600 (bold) | white on artist color |
| Service name | 13px | 600 (semibold) | var(--ink) |
| Age | 11px | 400 | var(--ink-mid) |
| Master name | 11.5px | 400 | var(--ink-mid) |
| Location | 11px | 400 | var(--ink-light) |
| Guests count | 11.5px | 500 | var(--ink-mid) |
| Day headings | 10px | 500 uppercase | var(--ink-light) |
| Day number | 22px | 300 (light) | var(--ink-mid) |
| Period label | 15px | 500 | var(--ink) |
| Nav item | 13px | 400 | rgba(255,255,255,.5) |
| User name | 12.5px | 500 | rgba(255,255,255,.85) |
| User role | 10px | 400 | rgba(255,255,255,.35) |
| Version | 10px | 400 | rgba(255,255,255,.2) |

## Shadows

```css
/* Cards */
box-shadow: 0 1px 4px rgba(0,0,0,.08);
/* Cards hover */
box-shadow: 0 4px 14px rgba(0,0,0,.13);
transform: translateY(-1px);

/* Collapse button */
box-shadow: 0 1px 4px rgba(0,0,0,.12);

/* Panel toggle */
box-shadow: 0 2px 10px rgba(0,0,0,.1);

/* Toast */
box-shadow: 0 4px 20px rgba(0,0,0,.2);

/* Appearance popup */
box-shadow: 0 8px 32px rgba(0,0,0,.14);
```

## Spacing & Sizing

```css
--sidebar-w: 230px;
--sidebar-collapsed-w: 56px;
--right-w: 260px;
--cell-h: 60px;        /* height per hour */
--time-w: 64px;         /* time column width */
```

| Element | Value | Notes |
|---------|-------|-------|
| Sidebar width | 230px | expanded |
| Sidebar collapsed | 56px | only icons |
| Right panel | 260px | slides out |
| Hour height | 60px | 30min = 30px |
| Time column | 64px | sticky left |
| Hours | 9:00–21:00 | 12h × 2 = 24 slots |
| Card padding | 8px 10px 6px | inside |
| Card side gap | 6px | left/right |
| Sidebar padding | 14px | edges |
| Section gap | 8px | between sections |

## Border Radius

| Element | Radius |
|---------|--------|
| Event cards | 12px |
| Buttons, inputs | 8px |
| Avatars, day circles | 50% |
| Time pill | 20px (pill) |
| Collapse btn | 50% |

## Scrollbar

```css
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--line); border-radius: 2px; }
```

## Components (Layout)

### Sidebar
```tsx
<aside className="sidebar" style={{ width: collapsed ? '56px' : '230px' }}>
  {/* Collapse button - circle, 24x24, border, shadow, absolute positioned at right edge */}
  {/* Logo - white PNG, mix-blend-mode: screen */}
  {/* MiniCalendar - grid 7 columns */}
  {/* Navigation - 6 items with SVG icons */}
  {/* MasterLegend - color dots + short names */}
  {/* Bottom: theme tumbler + appearance btn + user btn + version */}
</aside>
```

### Toolbar
```tsx
<div className="toolbar" style={{ height: '52px', background: 'var(--white)', borderBottom: '1px solid var(--line)' }}>
  {/* Week navigation: ◀ period ▶ [Today] */}
  {/* Separator */}
  {/* View toggle: Day | Week (pill style) */}
  {/* Spacer */}
  {/* Filter: master dropdown + location dropdown */}
</div>
```

### Right Panel
```tsx
<aside className="right-panel" style={{ width: open ? '260px' : '0' }}>
  {/* Header: "Инструменты" + × button */}
  {/* Sections (collapsible): */}
  {/*   - Штамп: master ▾, service ▾, locations ☑☐, badge, delete mode toggle */}
  {/*   - Неделя: "Копировать прошлую неделю" + hint */}
</aside>
```

### Event Card
```tsx
<div className="event-card" style={{
  position: 'absolute',
  top: `${(startHour - 9) * 120}px`,   // 60px per hour × 2 = 120 per half-hour slot
  height: `${Math.max(duration * 120 - 10, 52)}px`,
  '--ev-color': artistColor,
  '--ev-bg': `rgba(${rgb}, ${fillOpacity})`,   // 0.12 + (occ/cap) * 0.28
}}>
  {/* Inner: time pill (oval, filled with artist color), title, age icon, master, location */}
  {/* Footer: guests X/Y + action button (+ for public, ··· for private) */}
  {/* Private: clip-path polygon for cut corner + star icon */}
</div>
```

### Toast
```tsx
<div className="toast" style={{
  position: 'fixed', bottom: '22px', left: '50%', transform: 'translateX(-50%)',
  padding: '10px 16px', background: '#1a1a1a', color: '#eee', borderRadius: '10px',
  animation: 'fadeIn .18s ease',
}}>
  <span>{message}</span>
  <button className="toast-undo">Отменить</button>
  <button className="toast-x">×</button>
</div>
```

## Transitions

| Element | Property | Duration | Easing |
|---------|----------|----------|--------|
| Sidebar width | width | 220ms | ease |
| Right panel width | width | 220ms | ease |
| Card hover | box-shadow, transform | 150ms | ease |
| Delete | opacity, transform | 150ms | ease |
| Toast | opacity, transform | 180ms | ease |
