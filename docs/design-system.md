---
type: design-system
scope: project
sections: [colors, status-colors, status-icons, status-components, typography, shadows, spacing, border-radius, scrollbar, transitions, animations, components, patterns]
updated: 2026-09-16
source: frontend/admin (live code)
---

# Admin Design System — ColourMountains Memo

Visual design system for the Memo admin UI, regenerated from live code
(`frontend/admin`) on 2026-09-16. Historical origin: the v4 sketch
(`sketches/colour-mountains-v4.html`, 2026-05); the sketch is no longer a
reference — this document mirrors the implemented code.

**Maintenance:** this is a living reference (Required Doc for UI tasks).
When a UI change alters something documented here, update the affected
sections and bump `updated:` in the same PR.

Naming: canonical terms per the naming table in
`docs/domain-rules/_overview.md` (`Master`, `Record`, `Visit`, `Staff`,
`Position`, `Activity`, `Location`, `Service`, `Client`, `Visitor`). Real
file paths are quoted as-is (legacy filenames such as `BookingFilters.tsx`
are being renamed by #103).

---

## Colors

### Theme Variables (CSS custom properties)

Source: `frontend/admin/app/globals.css:8-64`. Duplicates and dead vars are
marked explicitly.

```css
:root {
  /* Light theme */
  --bg:         #EDEDEE;   /* defined twice (:9 and :35) — see note below */
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
  --line-dark:  rgba(255,255,255,.1);   /* consumers: none found */

  /* Layout */
  --sidebar-w:           230px;  /* (app/(main)/layout.tsx:75 */
  --sidebar-collapsed-w: 56px;   /* (app/(main)/layout.tsx:77 */
  --right-w:             260px;  /* Toolbar.tsx:100 */
  --cell-h:              60px;   /* consumers: none — the grid uses the cellHeight prop (default 60, DayColumn.tsx:93) */
  --time-w:              64px;   /* consumers: none */
  --toolbar-h:           48px;   /* consumers: none — Topbar uses h-12 */

  /* Grid */
  --grid-line:      #E8EDEE;     /* consumers: none */
  --grid-line-half: #F0F3F4;     /* consumers: none */
  --grid-bg:        #FFFFFF;     /* consumers: none */
  --bg: #FFFFFF;                 /* duplicate of :9 */

  /* Status */
  --success: #6B8E6E;            /* login/page.tsx */
  --warning: #C8A050;            /* login/page.tsx */
  --danger:  #C8503C;            /* ~30 consumers (DeleteDialog.tsx, DiamondIcon.tsx, PasswordModal.tsx, …) */

  /* Misc */
  --radius:    12px;             /* consumers: none — rounded-xl / rounded-card used instead */
  --radius-sm: 8px;              /* consumers: none — rounded-lg used instead */
  --transition: 0.2s ease;       /* consumers: none */
}
```

**Duplicate note:** `--bg` is declared twice inside the same `:root` block
(`globals.css:9` = `#EDEDEE`, `globals.css:35` = `#FFFFFF`, inside the Grid
section). The later declaration wins in CSS, so `body { background:
var(--bg) }` (`globals.css:76`) resolves to `#FFFFFF`. Fixing the duplicate
is a code change — out of scope here (candidate for a separate chore
issue).

```css
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

The theme is applied **before React hydrates** by an inline bootstrap
script (`app/layout.tsx:21-23`) reading the localStorage key `memo-theme`
(`contexts/UIContext.tsx:39`), so a dark-theme reload never flashes light.

Z-index tokens live in a dedicated `:root` block (`globals.css:127-145`,
guard `scripts/check_z_tokens.py`) — consume them as
`z-[var(--z-name)]`; bare z-numbers are forbidden elsewhere.

### Tailwind Color Tokens

Custom tokens are merged into the default scale (`theme.extend`,
`tailwind.config.ts:10`), so Tailwind defaults (`rounded-lg` = 8px, palette
colors, etc.) remain available alongside:

```ts
colors: {
  brand:    { DEFAULT: '#004D56', light: '#006670' },         // :15-16
  sidebar:  { DEFAULT: '#1E2D2F' },                          // :21
  surface:  { DEFAULT: '#f4f4f5', 2: '#303035' },            // :25-27
  card:     { DEFAULT: '#ffffff', dark: '#252528' },         // :30-33
  ink:      { DEFAULT: '#1a1a1a', mid: '#555555',
              light: '#888888', faint: '#cccccc' },          // :35-40
  line:     { DEFAULT: '#E0E0E1', dark: 'rgba(255,255,255,.1)' }, // :43-45
  master:   { olga: '#5B8C7A', yulia: '#6B7E9C', anastasia: '#A07060',
              darya: '#7A6E9C', aleksandra: '#8A7840', irina: '#9A5870' }, // :47-54
  status:   { confirmed: '#10b981', cancelled: '#ef4444', noShow: '#6b7280' }, // :56-60 — LEGACY, see Status Colors
}

boxShadow: {
  card: '0 1px 4px rgba(0,0,0,.08)',
  'card-hover': '0 4px 14px rgba(0,0,0,.13)',
  collapse: '0 1px 4px rgba(0,0,0,.12)',
  panel: '0 2px 10px rgba(0,0,0,.1)',
  toast: '0 4px 20px rgba(0,0,0,.2)',
  popup: '0 8px 32px rgba(0,0,0,.14)',
}                                             // :63-69

borderRadius: { card: '12px', button: '8px' } // :71-74

spacing: {
  sidebar: '230px', 'sidebar-collapsed': '56px',
  'right-panel': '260px', 'time-col': '64px', cell: '60px',
}                                             // :75-81

transitionDuration: { sidebar: '220ms', card: '150ms', toast: '180ms' }, // :82-86

fontFamily: { sans: ['var(--font-inter)', 'sans-serif'] },
```

The `status` palette (`confirmed/cancelled/noShow`) is a **LEGACY** mapping
kept only for backward compatibility — canonical status styling is
`VISIT_STATUS_CONFIG` (see Status Colors). New code must not consume it.

### Master Colors

There is **no hardcoded per-master color constant** anywhere in the code —
two sources instead:

1. **Tailwind token `master.*`** (`tailwind.config.ts:47-54`) — a fixed
   palette:

   | Key | Hex |
   |-----|-----|
   | `master.olga` | `#5B8C7A` |
   | `master.yulia` | `#6B7E9C` |
   | `master.anastasia` | `#A07060` |
   | `master.darya` | `#7A6E9C` |
   | `master.aleksandra` | `#8A7840` |
   | `master.irina` | `#9A5870` |

2. **Runtime source — the data field `staff.master.color`**: the per-master
   color is data, edited in the staff card
   (`(app/(main)/staff/components/StaffModal.tsx:68` — color picker whose
   placeholder default is `#5B8C7A`). Consumers: `ActivityCard` (solid card
   fill, `app/components/schedule/ActivityCard.tsx:121`), `DayColumn`,
   `FilterDropdown`.

The token keys above are palette names, not the names of real staff
members.

### Status Colors

Canonical source:
`frontend/admin/app/components/shared/config/VISIT_STATUS_CONFIG.ts`.
The table mirrors it line by line — do not "correct" it from memory.

| Status | Label | Badge bg / text | Dark bg / text | Border | Icon tint |
|--------|-------|-----------------|----------------|--------|-----------|
| `waiting` | Ожидание | `bg-amber-100` / `text-amber-700` | `bg-amber-900/30` / `text-amber-300` | `border-amber-500` | `#b45309` |
| `visited` | Посетил | `bg-emerald-100` / `text-emerald-700` | `bg-emerald-900/30` / `text-emerald-300` | `border-emerald-500` | `#059669` |
| `missed` | Неявка | `bg-red-100` / `text-red-700` | `bg-red-900/30` / `text-red-300` | `border-red-500` | `#dc2626` |
| `cancelled` | Отменён | `bg-gray-100` / `text-gray-700` | `bg-gray-800` / `text-gray-300` | `border-gray-500` | `#6b7280` |

- Display order: `waiting → visited → cancelled → missed`
  (`VISIT_STATUS_ORDER`, `VISIT_STATUS_CONFIG.ts:55`).
- Icon tint hexes are darker than the Tailwind palette values — they are
  used only for inline icon `color`/`stroke`, not for badge backgrounds.
- Badge pattern: `rounded-full px-2 py-0.5 text-xs font-medium`, composed
  from `bgClass` + `textClass`.

### Status Icons — Inline SVG Convention

All status icons are **inline SVG components** (not from `lucide-react`).

**Location:** `frontend/admin/app/components/shared/icons/StatusIcons.tsx`

| Component | Visual | Line |
|-----------|--------|------|
| `<WaitingIcon />` | Clock in circle | :13 |
| `<VisitedIcon />` | Checkmark in circle | :31 |
| `<MissedIcon />` | Warning triangle | :49 |
| `<CancelledIcon />` | X in circle | :68 |
| `<IconForStatus status={...} />` | Lookup by `VisitStatus` | :88 |

Props: all accept `className` (default `w-3.5 h-3.5`); color is inherited
via `stroke="currentColor"`.

Why inline SVG (not lucide-react): per-status stroke proportions, lucide
equivalents are close but not identical, and four icons do not justify the
dependency. Other UI icons across the admin are being migrated to
`lucide-react` (chore #143) — status icons deliberately stay inline.

### Status Display Components

| Component | Location | Role |
|-----------|----------|------|
| `StatusBadge` | `app/components/shared/StatusBadge.tsx` | **Read-only** pill — icon + label colored by `VISIT_STATUS_CONFIG` |
| `StatusPicker` | `app/components/shared/StatusPicker.tsx` | **Editable** dropdown; renders its own popover (`z-[var(--z-popover)]`, `StatusPicker.tsx:110`) |
| `StatusFiltersPicker` | `app/components/shared/StatusFiltersPicker.tsx` | **Editable** multi-status filter for table header filters |

All use `value` / `onChange` semantics and share the `VISIT_STATUS_CONFIG`
colors. There is no generic custom-select wrapper component in the codebase
— each picker renders its own popover.

---

## Typography

Font family: `Inter` (Google Fonts via `var(--font-inter)`,
`app/layout.tsx:6-12`; applied to `body` in `globals.css:73`).

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Activity card time pill | 12px (`text-[12px]`) | 600 | white on `rgba(0,0,0,0.25)` (`ActivityCard.tsx:136`) |
| Activity card title | `text-sm` | 600 | `text-black` (`ActivityCard.tsx:156`) |
| Card secondary text (master, location, age) | 13px (`text-[13px]`) | 400 | `text-black` (`ActivityCard.tsx:172`) |
| Card footer count | 13px | 500 | `text-black` (`ActivityCard.tsx:219`) |
| Menubar nav item | `text-sm` | 500 active / 400 | white / `text-white/60` (`Menubar.tsx:577-584`) |
| Menubar section label | `text-[10px]` uppercase tracking-wider | 600 | `text-white/40` (`Menubar.tsx:452`) |
| Master legend dot name | `text-xs` | 400 | `text-white/70` (`Menubar.tsx:462`) |
| Version | `text-[10px]` | 400 | `text-white/30` (`Menubar.tsx:723`) |
| Topbar date button | `text-[11px]` | 500 | `var(--ink)` (`Topbar.tsx:195`) |
| View toggle items | `text-xs` | 500 | `Topbar.tsx:277` |

Note: text inside ActivityCard is **`text-black`**, not `var(--ink)` — the
card is filled with the master color (solid), and black guarantees contrast
on any palette value (WCAG rationale in `ActivityCard.tsx:101-104`).

---

## Shadows

Defined as Tailwind tokens (`tailwind.config.ts:63-69`):

| Token | Value |
|-------|-------|
| `shadow-card` | `0 1px 4px rgba(0,0,0,.08)` |
| `shadow-card-hover` | `0 4px 14px rgba(0,0,0,.13)` (with `translateY(-1px)` on hover) |
| `shadow-collapse` | `0 1px 4px rgba(0,0,0,.12)` |
| `shadow-panel` | `0 2px 10px rgba(0,0,0,.1)` |
| `shadow-toast` | `0 4px 20px rgba(0,0,0,.2)` |
| `shadow-popup` | `0 8px 32px rgba(0,0,0,.14)` |

Toast items currently use Tailwind's default `shadow-lg`
(`ToastContainer.tsx:33`), not the `shadow-toast` token.

---

## Spacing & Sizing

| Element | Value | CSS var / Tailwind |
|---------|-------|-------------------|
| Menubar width | 230px | `--sidebar-w` / `spacing.sidebar` (app/(main)/layout.tsx:`75`) |
| Menubar collapsed | 56px | `--sidebar-collapsed-w` (app/(main)/layout.tsx:`77`) |
| Right panel | 260px | `--right-w` (`Toolbar.tsx:100`) |
| Topbar height | 48px | `h-12` (`Topbar.tsx:169`) |
| Grid slot (30 min) | 60px | `cellHeight` prop, default 60 (`DayColumn.tsx:93`, `NowLine.tsx:12`); `spacing.cell` |
| Grid hour | 120px | 2 slots |
| Grid start | 09:00 | `gridStartMinutes` default 540 (`NowLine.tsx:12`) |
| Time column | 64px | `spacing.time-col` |
| Card padding | `px-2 py-1` | inline (`ActivityCard.tsx`) |
| Card horizontal inset | `left-1 right-1` | `ActivityCard.tsx:120` |
| Menubar padding | `px-3` / `px-4` | Tailwind |

Activity card geometry: `top = (startMinutes − gridStart) × cellHeight / 30
+ 4`; `height = max(durMinutes × cellHeight / 30 − 8, 60)`
(`ActivityCard.tsx:31-33`).

---

## Border Radius

| Element | Radius | Tailwind |
|---------|--------|----------|
| Event cards | 8px | `rounded-lg` (Tailwind default; `ActivityCard.tsx:120`) |
| Page cards / footer progress | 12px | `rounded-xl` (`app/(main)/clients/page.tsx:96`, `ActivityCard.tsx:205`) |
| Buttons, inputs, selects | 8px | `rounded-lg` |
| Custom tokens | card 12px / button 8px | `tailwind.config.ts:71-74` |
| Avatars, day circles | 50% | `rounded-full` |
| Time pill | `rounded-br-lg` | top-left flush, bottom-right rounded (`ActivityCard.tsx:136`) |
| Mini-cal day cell | 6px | `rounded-md` (`Menubar.tsx:308`) |
| Status badge | full pill | `rounded-full` |

---

## Scrollbar

Mirrored from `globals.css:59-68`:

```css
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--line); border-radius: 2px; }
```

---

## Transitions

| Element | Properties | Duration | Source |
|---------|------------|----------|--------|
| Menubar width | `all` (width) | 200ms | `duration-200` (`Menubar.tsx:537`) |
| Center content margin | `all` | 300ms | `duration-300` (app/(main)/layout.tsx:`74`) |
| Right panel | `all` (width) | 200ms | `duration-200` (`Toolbar.tsx:99`) |
| Accordion open/close | `max-height` | 200ms | `duration-200` (`Toolbar.tsx:41`) |
| Accordion chevron | `transform` (rotate-180) | 200ms | `Toolbar.tsx:31` |
| Card hover | `box-shadow` | 150ms | `transitionDuration.card` (`tailwind.config.ts:83`) |
| Card delete | `opacity`, `transform` (scale-95) | 150ms | `setTimeout(…, 150)` (`ActivityCard.tsx:79`) |
| Toast slide-up | `opacity`, `translateY(8px→0)` | 200ms ease-out | `animate-slide-up` (`globals.css:104-110`) |
| Nav item colors | `color`, `background` | default 150ms | `transition-colors` (`Menubar.tsx:577`) |

---

## Animations (keyframes)

```css
@keyframes slide-up {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.animate-slide-up { animation: slide-up 200ms ease-out; }
```

Source: `globals.css:104-110`. Used by toast items
(`ToastContainer.tsx:33`).

---

## Components

### Menubar (sidebar)

```tsx
<aside
  className="fixed left-0 top-0 h-full bg-sidebar z-[var(--z-sidebar)]
             transition-all duration-200 flex flex-col"
>                                                        {/* Menubar.tsx:537 */}
  {/* Logo — PNG (not emoji) */}
  <div className="p-6 border-b border-white/10">
    <img src="/logo-white.png" … />                      {/* :509-513 */}
  </div>

  {/* Scrollable: MiniCalendar + divider + nav + «Мастера» + «Справочники» + «Фото» */}
  <div className="flex-1 overflow-y-auto">
    <MiniCalendar />                                     {/* :199 */}
    <nav>{/* 3 items */}</nav>
    {/* «Мастера» — collapsible, colored dots, NOT a link (:554-589) */}
    {/* «Справочники» — collapsible (:591-628) */}
    {/* «Фото» — standalone link (:630-649) */}
  </div>

  {/* Bottom: UserMenu popup (theme slider inside), collapse, version */}
</aside>
```

**Navigation items (3):** Расписание (`/schedule`, calendar), Записи
(`/records`, clipboard), Клиенты (`/clients`, users) — `NAV_ITEMS`
(`Menubar.tsx:135-139`).

**«Справочники»** (collapsible → `DIRECTORY_ITEMS`, `Menubar.tsx:141-152`):
Сотрудники `/staff`, Услуги `/services`, Локации `/locations`, Теги
`/tags`, Должности `/positions`.

**Role filtering (GH #263 T9):** `ADMIN_ONLY_SECTIONS`
(`/clients`, `/locations`, `/tags`, `/staff`, `/positions`,
`Menubar.tsx:146-152`) are hidden from a master's menu, and the layout
guard blocks those routes outright (app/(main)/layout.tsx:`10-15`).

**«Мастера»** (collapsible, `Menubar.tsx:554-589`): a non-link section with
PaletteIcon expanding to the master color-dot list — the schedule legend.
The old standalone legend component was removed as a duplicate
(`Menubar.tsx:654` comment).

**Bottom section:** `UserMenu` popup (`Menubar.tsx:661`; the theme slider
moved there per GH #262 §5.1), collapse button with chevron rotating 180°
when collapsed (`Menubar.tsx:665-679`), version label `memo v0.0.1`
(`Menubar.tsx:723`).

Active state: `bg-brand text-white font-medium`. Inactive:
`text-white/60 hover:bg-white/5 hover:text-white/90` (`Menubar.tsx:577-584`).

### Topbar (schedule top bar)

```tsx
<header className="sticky top-0 z-[var(--z-topbar)] flex h-12 items-center
                   gap-2 border-b px-3 justify-end">    {/* Topbar.tsx:169 */}
  {/* Left: ◀ [week/day arrows] [date → CalendarPopover] ▶ */}
  {/* Right: master filter dropdown + Day/Week pill toggle */}
</header>
```

Date navigation with `CalendarPopover` (`Topbar.tsx:177-227`); view-mode
pill on `bg-surface p-0.5` (`Topbar.tsx:272-306`). Topbar renders only on
the schedule page (`(app/(main)/schedule/page.tsx:14`).

### Toolbar (right panel)

```tsx
<aside
  data-testid="right-panel"
  className="fixed right-0 top-0 z-[var(--z-grid-panel)] h-full border-l
             bg-white transition-all duration-200"
  style={{ width: 'var(--right-w)', borderColor: 'var(--line)' }}
>                                                        {/* Toolbar.tsx:99-107 */}
  {/* Header «Инструменты» + ‹ collapse toggle */}
  {/* AccordionSection «Штамп» → StampPanel (:96) */}
  {/* AccordionSection «Неделя» → Copy Last Week button (:101) */}
</aside>
```

AccordionSection pattern (`Toolbar.tsx:16-49`): full-width button
`px-4 py-3 text-sm font-medium hover:bg-surface`, chevron
`rotate-180` when open, body `overflow-hidden max-h-96 px-4 pb-3` ↔
`max-h-0` (`transition-all duration-200`).

«Copy Last Week» calls `copyLastWeek()` and toasts «Прошлая неделя
скопирована» (`Toolbar.tsx:56-62`). The panel renders only when the right
panel is open (`Toolbar.tsx:67-71`) and is toggled by StampFab. It is
**not** a sticky top toolbar — that role belongs to `Topbar`.

### StampFab (floating button)

```tsx
<button
  className="fixed bottom-6 right-6 z-[var(--z-popover)] flex items-center
             justify-center w-12 h-12 rounded-full shadow-lg
             transition-all duration-200 hover:shadow-xl hover:scale-105
             active:scale-95"
  style={{
    backgroundColor: rightPanelCollapsed ? 'var(--brand)' : 'var(--white)',
    border: `2px solid ${rightPanelCollapsed ? 'var(--brand)' : 'var(--line)'}`,
    color: rightPanelCollapsed ? 'var(--white)' : 'var(--brand)',
  }}
>
  {/* Inline stamp SVG icon */}
</button>                                                {/* StampFab.tsx:10-40 */}
```

Opens/closes the right panel: brand-filled when the panel is closed, white
with a border when open.

### Activity Card

```tsx
<div
  className="absolute left-1 right-1 rounded-lg overflow-hidden flex flex-col
             cursor-pointer transition-shadow hover:shadow-md"
  style={{
    top: `${(startMinutes - gridStart) * cellHeight / 30 + 4}px`,
    height: `${Math.max(durMinutes * cellHeight / 30 - 8, 60)}px`,
    backgroundColor: master.color,   // solid fill, not transparent!
  }}
>                                                        {/* :120-124 */}
  {/* 1. HEADER: time pill (rounded-br-lg) + Private diamond */}
  {/* 2. TITLE (+AGE): text-sm font-semibold text-black; ArchiveBadge if archived */}
  {/* 3. MASTER / LOCATION rows (13px, truncate) — per tier */}
  {/* 5. FOOTER (Standard only): progress bar + quick action */}
</div>
```

**Tier selection** (`ActivityCard.tsx:36-48`, replaces the old
`showExtra`/`showOnlyPill`):

- `isTiny` — duration < 60 min
- `isCompact` — 60–89 min
- `isStandard` — ≥ 90 min; `hasFooter = isStandard`
- Title lines: `want2Line` at height ≥ 134px (with footer) / ≥ 90px (without)
- Master row: shown when `canFit2LineWithMaster` (152/108) for a 2-line
  title, or `canFit1LineWithMaster` (132/88) for a 1-line title

**Header** (`:133-146`): time pill
`px-2 py-1 rounded-br-lg text-[12px] font-semibold text-white` on
`rgba(0,0,0,0.25)`; private activities render the diamond SVG
(`DiamondIcon`) top-right.

**Title + age** (`:152-160`): `text-sm font-semibold text-black`
(`line-clamp-2` when 2 lines, otherwise `truncate`). Archived references
mute the whole card to `opacity-70` (chosen over 60 for WCAG contrast on
the worst-case palette color, `:101-104`) and render `ArchiveBadge` with
parts in fixed order (мастер, услуга, локация).

**Footer — progress bar** (`:205-244`, Standard tier only):

```tsx
<div className="rounded-xl overflow-hidden relative"
     style={{ border: '1px solid rgba(0,0,0,0.15)' }}>
  {/* filled:   width = fillPct%, bg rgba(0,0,0,0.20) */}
  {/* unfilled: left = fillPct%,  bg rgba(0,0,0,0.06) */}
  {/* content: z-[var(--z-base)], px-2 py-1.5, text-[13px] text-black */}
  {/*   left:  users icon + «occupied/capacity» */}
  {/*   right: quick action — + (public) / ··· (private), btn-quick-add */}
</div>
```

**Drag states** (`:63-73`):

```tsx
// original while dragging (hidden):
{ opacity: 0, zIndex: 'var(--z-drag-active)', pointerEvents: 'none' }
// drag copy:
{ opacity: 0.5, zIndex: 'var(--z-drag-active)', scale: '0.98' }
```

**Delete flow** (`:78-95`): click in delete mode → 150ms →
`deleteActivity` + undo toast (undo re-adds via `addActivity`); the card
animates to `opacity-0 scale-95` over 150ms. Delete-mode CSS lives in
`globals.css:112-118`:

```css
body.delete-mode [data-testid^="activity-"] { cursor: not-allowed !important; }
body.delete-mode [data-testid^="activity-"]:hover {
  box-shadow: 0 0 0 2px rgba(200, 80, 60, 0.5) !important;
}
```

### Toast

```tsx
// container — ToastContainer.tsx:25
<div className="fixed bottom-4 right-4 z-[var(--z-toast)] flex flex-col gap-2 max-w-sm">
  {/* item — :33 */}
  <div className="flex items-center gap-3 bg-sidebar text-white px-4 py-3
                  rounded-lg shadow-lg text-sm animate-slide-up
                  ${BORDER_BY_KIND[toast.kind]}">
    {/* loading kind → animate-spin spinner (:37) */}
    <span className="flex-1">{message}</span>
    {onUndo && <button className="text-brand-light font-medium hover:underline">…</button>}
    {/* × — dismiss */}
  </div>
</div>
```

- Bottom-right stack (`bottom-4 right-4`), not bottom-center.
- Kind → border color map: `BORDER_BY_KIND` (`ToastContainer.tsx:15-24`).
- Animation: `slide-up 200ms ease-out` (`globals.css:104-110`).
- Toast API lives in `UIContext` (`contexts/UIContext.tsx`); `duration:
  null` keeps a toast open (loading state, GH #261).
- Persistent variant (GH #330): `showToast(..., persistent)` — no auto-dismiss
  timer, no × dismiss button, not evicted by the last-5 slice; hidden only by
  code via `hideToast(id)` when the condition clears. Use case: the
  connection-lost toast.

### Select / Filter Input

Plain `<select>` pattern (e.g. `ClientsFilters.tsx`,
`BookingFilters.tsx`):

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

Richer inputs live in `shared/` — see the inventory below.

### Page Layout Shell

```
app/layout.tsx (root)
├─ Inter font + theme bootstrap script BEFORE hydration (:21-23)
└─ <Providers>                                          (app/providers.tsx)
   ├─ QueryClientProvider  — staleTime 30s, retry 2,
   │                         refetchOnWindowFocus / refetchOnReconnect: false (GH #239)
   ├─ UIProvider > AuthProvider > UserSettingsProvider
   │             > PendingActionsProvider > ServerEventsProvider
   ├─ <ErrorBoundary> (global)
   └─ <ToastContainer /> (z-[var(--z-toast)])

app/(main)/layout.tsx
└─ ErrorBoundary > AuthGate > NavigationProvider > MainShell
   ├─ AuthGate: unauthenticated → /login?returnTo=…; master on an
   │  admin-only section → <NoAccessScreen />; loading → spinner shell
   │  (:17-64)
   └─ MainShell (flex h-screen overflow-hidden, :70-86)
      ├─ <Menubar /> (:56)
      └─ center div: margin-left var(--sidebar-w | --sidebar-collapsed-w),
         duration-300 (:74)

schedule page (page-local, app/(main)/schedule/page.tsx:31-45)
└─ ScheduleProvider
   ├─ <Topbar />
   ├─ DayView | WeekView
   ├─ <Toolbar /> — only when the right panel is open (:23)
   └─ <StampFab />
```

Toolbar/Topbar/StampFab are **schedule-page furniture**, not global chrome:
definitions live in `app/components/layout/`, and every other page renders
its own content directly under `MainShell`.

### Shared component inventory

Generic building blocks in `frontend/admin/app/components/shared/`
(inventory verified 2026-09-16; 17 top-level files):

| Component | Path | Role |
|-----------|------|------|
| `DataTable` | `shared/DataTable.tsx` | Canonical generic table (GH #139); `ColumnDef` via `tableTypes.ts`, runtime column filtering (GH #141) |
| `ColumnPicker` | `shared/ColumnPicker.tsx` | Column visibility menu for DataTable |
| `Modal` | `shared/modal/Modal.tsx` | Base overlay dialog (backbone of `MyDataModal`, `PasswordModal`) |
| `FullPageError` | `app/components/error/FullPageError.tsx` | Full-screen error with reset; siblings in `components/error/`: `ErrorBoundary`, `NoAccessScreen`, `ErrorState` |
| `DeleteDialog` | `app/components/DeleteDialog.tsx` | Confirm-delete dialog (`z-[var(--z-modal)]`, `:243`) |
| `StatusBadge` | `shared/StatusBadge.tsx` | See Status Display Components |
| `StatusPicker` | `shared/StatusPicker.tsx` | See Status Display Components |
| `StatusFiltersPicker` | `shared/StatusFiltersPicker.tsx` | See Status Display Components |
| `Combobox` | `shared/Combobox.tsx` | Searchable select |
| `MultiSelect` | `shared/MultiSelect.tsx` | Multi-value select |
| `RemoteSearchSelect` | `shared/RemoteSearchSelect.tsx` | Typeahead against the API (GH #221) |
| `FilterDropdown` | `shared/FilterDropdown.tsx` | Header filter dropdown |
| `DateTimePicker` | `shared/DateTimePicker.tsx` | Date+time input |
| `TimePicker` | `shared/TimePicker.tsx` | Time input |
| `CalendarPopover` | `shared/CalendarPopover.tsx` | Date popover (Topbar, filters) |
| `MonthYearPicker` | `shared/MonthYearPicker.tsx` | Month/year switcher (MiniCalendar) |
| `PhoneInput` | `shared/PhoneInput.tsx` | Masked phone input |
| `MasterPicker` | `shared/MasterPicker.tsx` | Master select |
| `ArchiveBadge` | `shared/ArchiveBadge.tsx` | «в архиве» parts badge (ActivityCard, tables) |
| `DiamondIcon` | `shared/DiamondIcon.tsx` | Private-activity icon |
| `VISIT_STATUS_CONFIG` | `shared/config/VISIT_STATUS_CONFIG.ts` | Status colors/labels/icons (see Status Colors) |
| `StatusIcons` | `shared/icons/StatusIcons.tsx` | Inline SVG status icons |

Record-surface components (shared subdirs):

| Component | Path | Role |
|-----------|------|------|
| `RecordTable` | `shared/record/RecordTable.tsx` | Record rows table |
| `InlineEditRow` / `InlineEditCell` | `shared/record/InlineEditRow.tsx`, `InlineEditCell.tsx` | Inline editing primitives (unit tests alongside) |
| `RecordHeader` | `shared/records/RecordHeader.tsx` | Record summary header |
| `RecordVisitRow` | `shared/records/RecordVisitRow.tsx` | Visit row inside a record |
| `PaymentForm` / `PaymentList` / `PaymentTotals` | `shared/payments/…` | Payment add / list / totals |
| `AddVisitorForm` / `VisitorRow` | `shared/visitors/…` | Visitor add / row |

---

## Patterns

### Active Nav Item (Menubar)

```tsx
className={active
  ? 'bg-brand text-white font-medium'
  : 'text-white/60 hover:bg-white/5 hover:text-white/90'}
```

Source: `Menubar.tsx:577-584`.

### Section Divider (Menubar)

```tsx
<div className="border-t border-white/10 mx-3" />
```

Source: `Menubar.tsx:563,690`.

### Active Week (MiniCalendar)

```tsx
className={`… ${isActive ? 'bg-brand/30' : ''}`}
```

Source: `Menubar.tsx:375-381`.

### Today Circle (MiniCalendar)

```tsx
className={`… rounded-full ${isDayToday ? 'bg-brand text-white' : ''}`}
```

Source: `Menubar.tsx:406-412`.

### Hover:surface Button (accordion sections)

```tsx
className="flex w-full items-center justify-between px-4 py-3 text-sm
           font-medium transition-colors hover:bg-surface"
```

Source: `Toolbar.tsx:23-25`.

### Page Content Area

```tsx
<div className="p-4 space-y-4">
  <div className="rounded-xl border p-4" style={{ borderColor: 'var(--line)' }}>
    {/* card content */}
  </div>
</div>
```

Source: `app/(main)/clients/page.tsx:79,96-104`..
