# P2: Booking Management + Client Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port two P2 pages (`/bookings` + `/clients/[id]`) from memo-v1 into the v4 design system.

**Architecture:** Static mock data from `lib/mock-data.ts` (new booking entities added). No new contexts. Booking data is imported directly (same pattern as v1). Two page routes: `app/bookings/page.tsx` and `app/clients/[id]/page.tsx`. Booking detail shown as right-side panel (inline, not modal).

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS v3, v4 design system (`docs/design-system.md`).

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `frontend/lib/types.ts` | **Modify** | Add `Client`, `Visitor`, `BookingRecord`, `Visit`, `Payment` interfaces |
| `frontend/lib/mock-data.ts` | **Modify** | Add `CLIENTS`, `VISITORS`, `RECORDS`, `VISITS`, `PAYMENTS`, `BOOKING_ACTIVITIES` |
| `frontend/lib/utils.ts` | **Modify** | Add `formatPrice`, `formatDate` helpers (if not exist) |
| `frontend/app/bookings/page.tsx` | **Create** | BookingsPage — filters + table + detail panel |
| `frontend/app/bookings/components/BookingFilters.tsx` | **Create** | Filter bar: date, location, service, status |
| `frontend/app/bookings/components/BookingTable.tsx` | **Create** | Table with rows and inline detail panel |
| `frontend/app/clients/[id]/page.tsx` | **Create** | ClientCardPage — header + visitors + history |
| `frontend/app/layout.tsx` | **Modify** | Remove `page.tsx` from `<main>`, render children (app router auto) |
| `frontend/app/page.tsx` | No change | Already the Schedule page |

---

## Task 1: Add booking types to `lib/types.ts`

**Files:** `frontend/lib/types.ts`
**Classification: small**

Add these interfaces after the existing `StampState` interface:

```typescript
// ─── Client (Booking) ─────────────────────────────────────────────────────

export interface Client {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
}

export interface Visitor {
  id: string;
  clientId: string;
  name: string;
  age?: number;
  isAdult: boolean;
}

export interface BookingRecord {
  id: string;
  activityId: string;
  clientId: string;
  status: 'CONFIRMED' | 'CANCELLED' | 'NO_SHOW';
  createdAt: string;
  comment?: string;
}

export interface Visit {
  id: string;
  recordId: string;
  visitorId: string;
  isPrimary: boolean;
  priceCharged: number;
  visited: boolean;
}

export interface Payment {
  id: string;
  recordId: string;
  amount: number;
  paid: boolean;
  method?: 'cash' | 'card' | 'transfer';
  createdAt: string;
}
```

**Steps:**
1. Read `frontend/lib/types.ts` — verify current end of file
2. Append the 5 interfaces above after existing `StampState`
3. Run `npm run test` to verify types compile

---

## Task 2: Add booking mock data to `lib/mock-data.ts`

**Files:** `frontend/lib/mock-data.ts`
**Classification: standard**

Add these exports after the existing `getStaticEvents()` function:

```typescript
// ─── Booking Reference Activities ─────────────────────────────────────────
// These are activities referenced by booking records.
// They exist as a separate map so RECORDS can link to them by stable IDs.

export const BOOKING_ACTIVITIES: Activity[] = [
  { id: 'act1', day: 0, masterId: 'm1', startTime: 10, duration: 2, serviceId: 'srv_ceramics', serviceName: 'Керамика ручной работы', minAge: '6+', locationId: 'alpika', occupied: 5, capacity: 8, isPrivate: false },
  { id: 'act2', day: 1, masterId: 'm2', startTime: 11, duration: 1.5, serviceId: 'srv_painting', serviceName: 'Рисование акварелью', minAge: '8+', locationId: 'grand', occupied: 3, capacity: 6, isPrivate: false },
  { id: 'act3', day: 1, masterId: 'm1', startTime: 14, duration: 2, serviceId: 'srv_ceramics', serviceName: 'Керамика ручной работы', minAge: '6+', locationId: 'grand', occupied: 1, capacity: 1, isPrivate: true },
  { id: 'act5', day: 2, masterId: 'm3', startTime: 10, duration: 2, serviceId: 'srv_ceramics', serviceName: 'Керамика ручной работы', minAge: '6+', locationId: 'alpika', occupied: 4, capacity: 8, isPrivate: false },
  { id: 'act7', day: 3, masterId: 'm4', startTime: 12, duration: 2, serviceId: 'srv_painting', serviceName: 'Живопись маслом', minAge: '12+', locationId: 'p1389', occupied: 6, capacity: 10, isPrivate: false },
  { id: 'act8', day: 4, masterId: 'm1', startTime: 9, duration: 2, serviceId: 'srv_painting', serviceName: 'Рисование акрилом', minAge: '10+', locationId: 'grand', occupied: 1, capacity: 1, isPrivate: true },
  { id: 'act10', day: 5, masterId: 'm5', startTime: 15, duration: 2, serviceId: 'srv_sculpture', serviceName: 'Ручная лепка', minAge: '5+', locationId: 'alpika', occupied: 5, capacity: 10, isPrivate: false },
];

// ─── Booking Mock Data ────────────────────────────────────────────────────

export const CLIENTS: Client[] = [
  { id: 'cl1', name: 'Анна Смирнова', phone: '+7 (916) 123-45-67', createdAt: '2025-01-15' },
  { id: 'cl2', name: 'Ольга Кузнецова', phone: '+7 (925) 987-65-43', createdAt: '2025-02-03' },
  { id: 'cl3', name: 'Дмитрий Попов', phone: '+7 (903) 555-12-34', createdAt: '2025-03-10' },
  { id: 'cl4', name: 'Елена Васильева', phone: '+7 (977) 444-33-22', createdAt: '2025-03-22' },
  { id: 'cl5', name: 'Сергей Новиков', phone: '+7 (926) 111-22-33', createdAt: '2025-04-05' },
  { id: 'cl6', name: 'Марина Фёдорова', phone: '+7 (915) 777-88-99', createdAt: '2025-04-18' },
  { id: 'cl7', name: 'Павел Морозов', phone: '+7 (999) 222-33-44', createdAt: '2025-05-01' },
];

export const VISITORS: Visitor[] = [
  { id: 'v1', clientId: 'cl1', name: 'Анна Смирнова', isAdult: true },
  { id: 'v2', clientId: 'cl1', name: 'Маша Смирнова', age: 8, isAdult: false },
  { id: 'v3', clientId: 'cl2', name: 'Ольга Кузнецова', isAdult: true },
  { id: 'v4', clientId: 'cl2', name: 'Петя Кузнецов', age: 10, isAdult: false },
  { id: 'v5', clientId: 'cl3', name: 'Дмитрий Попов', isAdult: true },
  { id: 'v6', clientId: 'cl4', name: 'Елена Васильева', isAdult: true },
  { id: 'v7', clientId: 'cl4', name: 'Катя Васильева', age: 6, isAdult: false },
  { id: 'v8', clientId: 'cl4', name: 'Лиза Васильева', age: 9, isAdult: false },
  { id: 'v9', clientId: 'cl5', name: 'Сергей Новиков', isAdult: true },
  { id: 'v10', clientId: 'cl6', name: 'Марина Фёдорова', isAdult: true },
  { id: 'v11', clientId: 'cl6', name: 'Игорь Фёдоров', age: 12, isAdult: false },
  { id: 'v12', clientId: 'cl7', name: 'Павел Морозов', isAdult: true },
];

export const RECORDS: BookingRecord[] = [
  { id: 'rec1', activityId: 'act1', clientId: 'cl1', status: 'CONFIRMED', createdAt: '2025-05-01', comment: 'День рождения Маши' },
  { id: 'rec2', activityId: 'act1', clientId: 'cl4', status: 'CONFIRMED', createdAt: '2025-05-02' },
  { id: 'rec3', activityId: 'act2', clientId: 'cl3', status: 'CONFIRMED', createdAt: '2025-05-03' },
  { id: 'rec4', activityId: 'act2', clientId: 'cl5', status: 'CANCELLED', createdAt: '2025-05-03', comment: 'Болезнь' },
  { id: 'rec5', activityId: 'act3', clientId: 'cl1', status: 'CONFIRMED', createdAt: '2025-05-04' },
  { id: 'rec6', activityId: 'act5', clientId: 'cl2', status: 'CONFIRMED', createdAt: '2025-05-05' },
  { id: 'rec7', activityId: 'act5', clientId: 'cl6', status: 'NO_SHOW', createdAt: '2025-05-05' },
  { id: 'rec8', activityId: 'act7', clientId: 'cl4', status: 'CONFIRMED', createdAt: '2025-05-06' },
  { id: 'rec9', activityId: 'act7', clientId: 'cl7', status: 'CONFIRMED', createdAt: '2025-05-06' },
  { id: 'rec10', activityId: 'act10', clientId: 'cl1', status: 'CONFIRMED', createdAt: '2025-05-07' },
  { id: 'rec11', activityId: 'act10', clientId: 'cl3', status: 'CANCELLED', createdAt: '2025-05-07' },
  { id: 'rec12', activityId: 'act8', clientId: 'cl2', status: 'CONFIRMED', createdAt: '2025-05-08' },
];

export const VISITS: Visit[] = [
  // rec1: act1 (group, Керамика) — Анна + Маша
  { id: 'vis1', recordId: 'rec1', visitorId: 'v1', isPrimary: false, priceCharged: 2500, visited: true },
  { id: 'vis2', recordId: 'rec1', visitorId: 'v2', isPrimary: false, priceCharged: 1800, visited: true },
  // rec2: act1 (group, Керамика) — Елена + Катя + Лиза
  { id: 'vis3', recordId: 'rec2', visitorId: 'v6', isPrimary: false, priceCharged: 2500, visited: true },
  { id: 'vis4', recordId: 'rec2', visitorId: 'v7', isPrimary: false, priceCharged: 1800, visited: true },
  { id: 'vis5', recordId: 'rec2', visitorId: 'v8', isPrimary: false, priceCharged: 1800, visited: true },
  // rec3: act2 (group, Рисование) — Дмитрий
  { id: 'vis6', recordId: 'rec3', visitorId: 'v5', isPrimary: false, priceCharged: 2800, visited: true },
  // rec5: act3 (private, Керамика) — Анна + Маша (isPrimary pays 8200)
  { id: 'vis7', recordId: 'rec5', visitorId: 'v1', isPrimary: true, priceCharged: 8200, visited: true },
  { id: 'vis8', recordId: 'rec5', visitorId: 'v2', isPrimary: false, priceCharged: 1800, visited: true },
  // rec6: act5 (group, Керамика) — Ольга + Петя
  { id: 'vis9', recordId: 'rec6', visitorId: 'v3', isPrimary: false, priceCharged: 2500, visited: true },
  { id: 'vis10', recordId: 'rec6', visitorId: 'v4', isPrimary: false, priceCharged: 1800, visited: true },
  // rec8: act7 (group, Живопись) — Елена
  { id: 'vis11', recordId: 'rec8', visitorId: 'v6', isPrimary: false, priceCharged: 3500, visited: true },
  // rec9: act7 (group, Живопись) — Павел
  { id: 'vis12', recordId: 'rec9', visitorId: 'v12', isPrimary: false, priceCharged: 3500, visited: true },
  // rec10: act10 (group, Лепка) — Анна + Маша
  { id: 'vis13', recordId: 'rec10', visitorId: 'v1', isPrimary: false, priceCharged: 3000, visited: true },
  { id: 'vis14', recordId: 'rec10', visitorId: 'v2', isPrimary: false, priceCharged: 2200, visited: true },
  // rec12: act8 (private, Рисование) — Ольга + Петя (isPrimary pays 8200)
  { id: 'vis15', recordId: 'rec12', visitorId: 'v3', isPrimary: true, priceCharged: 8200, visited: true },
  { id: 'vis16', recordId: 'rec12', visitorId: 'v4', isPrimary: false, priceCharged: 2000, visited: true },
];

export const PAYMENTS: Payment[] = [
  { id: 'pay1', recordId: 'rec1', amount: 4300, paid: true, method: 'card', createdAt: '2025-05-01' },
  { id: 'pay2', recordId: 'rec2', amount: 6100, paid: true, method: 'transfer', createdAt: '2025-05-02' },
  { id: 'pay3', recordId: 'rec3', amount: 2800, paid: true, method: 'card', createdAt: '2025-05-03' },
  { id: 'pay4', recordId: 'rec5', amount: 10000, paid: true, method: 'cash', createdAt: '2025-05-04' },
  { id: 'pay5', recordId: 'rec6', amount: 4300, paid: false, createdAt: '2025-05-05' },
  { id: 'pay6', recordId: 'rec8', amount: 3500, paid: true, method: 'card', createdAt: '2025-05-06' },
  { id: 'pay7', recordId: 'rec9', amount: 3500, paid: false, createdAt: '2025-05-06' },
  { id: 'pay8', recordId: 'rec10', amount: 5200, paid: true, method: 'transfer', createdAt: '2025-05-07' },
  { id: 'pay9', recordId: 'rec12', amount: 10200, paid: true, method: 'card', createdAt: '2025-05-08' },
];
```

**Steps:**
1. Read `frontend/lib/mock-data.ts` — find end of file after `getStaticEvents()`
2. Add `BOOKING_ACTIVITIES` array and all 6 booking exports (`CLIENTS`, `VISITORS`, `RECORDS`, `VISITS`, `PAYMENTS`)
3. Add imports for new types at top of file
4. Run `npm run test` to verify imports and types compile

---

## Task 3: Create BookingFilters component

**Files:**
- Create `frontend/app/bookings/components/BookingFilters.tsx`

**Classification: small**

A filter bar with 4 dropdowns + reset button. Follows Toolbar select pattern (`docs/design-system.md`).

```tsx
'use client';

interface BookingFiltersProps {
  date: string;
  locationId: string;
  serviceId: string;
  status: string;
  onDateChange: (v: string) => void;
  onLocationChange: (v: string) => void;
  onServiceChange: (v: string) => void;
  onStatusChange: (v: string) => void;
  onReset: () => void;
}

// Renders 4 selects (date/input, location, service, status) + reset button
// Select style: rounded-lg border px-2 py-1.5 text-xs
// borderColor: var(--line), bg: var(--white), color: var(--ink-mid)
// Options for status: ''=Все статусы, CONFIRMED=Подтверждена, CANCELLED=Отменена, NO_SHOW=Неявка
// Uses LOCATIONS, SERVICES from mock-data
```

**Steps:**
1. Create `app/bookings/components/` directory
2. Write `BookingFilters.tsx` component
3. No tests needed (pure render, no logic)
4. Verify `npm run test` passes

---

## Task 4: Create BookingTable with inline detail panel

**Files:**
- Create `frontend/app/bookings/components/BookingTable.tsx`

**Classification: standard**

A table showing all records. Clicking a row shows a right-side detail panel.
Uses v4 design system: page cards with `rounded-xl border`, `var(--line)`, `var(--white)` background.

**Table columns:** Клиент (link), Услуга, Дата/Время, Локация, Статус (badge), Сумма, Оплата

**Detail panel** (slides in right side, ~380px width):
- **Клиент** card: name, phone, link to `/clients/[id]`
- **Занятие** card: service name, date+time, location, artist, status badge
- **Посетители и цены** card: list of visitors with price, total
- **Оплата** card: list of payments with method, amount, paid/unpaid indicator
- **Комментарий** card (if present)

**Status badges** (`docs/design-system.md`):
```
CONFIRMED: bg-[var(--success)]/15 text-[var(--success)]
CANCELLED: bg-[var(--danger)]/15 text-[var(--danger)]
NO_SHOW:   bg-gray-200/50 text-gray-500
```

**Payment status:**
- paid >= total → "✓ Оплачено" (emerald)
- paid > 0 → "Частично (X₽)" (amber)
- paid === 0 → "Не оплачено" (red)

**Format helpers** (can be added to `utils.ts` or inline):
```typescript
function formatPrice(n: number): string {
  return `${n.toLocaleString('ru-RU')}₽`;
}
function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
```

**Steps:**
1. Create `BookingTable.tsx` with table + detail panel states
2. Import: `RECORDS, BOOKING_ACTIVITIES, CLIENTS, SERVICES, LOCATIONS, ARTISTS, VISITS, VISITORS, PAYMENTS`
3. Filter records using props (date, locationId, serviceId, status)
4. Render table with clickable rows
5. Detail panel is conditional (selected record state)
6. Run `npm run test` to verify no breakage

---

## Task 5: Create BookingsPage

**Files:**
- Create `frontend/app/bookings/page.tsx`

**Classification: small**

Composes `BookingFilters` + `BookingTable`.

```tsx
'use client';

export default function BookingsPage() {
  // State: filters (date, locationId, serviceId, status)
  // Render:
  //   <div className="p-4 space-y-4">
  //     <div className="rounded-xl border bg-white p-4"
  //          style={{ borderColor: 'var(--line)' }}>
  //       <BookingFilters ... />
  //     </div>
  //     <BookingTable ... />
  //   </div>
}
```

**Layout:** follows `docs/design-system.md` page pattern:
- `p-4 space-y-4` on outer container
- Filter section: `rounded-xl border p-4` with `var(--line)`, `var(--white)`
- Table section: same card style

**Steps:**
1. Create `app/bookings/page.tsx`
2. Compose BookingFilters + BookingTable with filter state
3. Add empty state: "Записи не найдены"
4. Run `npm run test`

---

## Task 6: Create ClientCardPage

**Files:**
- Create `frontend/app/clients/[id]/page.tsx`

**Classification: standard**

Three sections in cards:

**Header section:** avatar emoji + client name + phone + stats row (Визитов / Посетителей / Потрачено)

**Связанные посетители section:** grid of visitor cards (name + adult/child age badge)

**История записей section:** list of records (service name + status badge + IND badge + date/time/location + total price + payment status)

Not found state: link back to `/bookings`.

**Layout:** same v4 card pattern as bookings page.

**Steps:**
1. Create `app/clients/[id]/page.tsx`
2. Implement useParams for client ID
3. Compute `recordDetails` via useMemo (join RECORDS + BOOKING_ACTIVITIES + VISITS + PAYMENTS)
4. Handle not-found client
5. Run `npm run test`

---

## Task 7: Wire up Sidebar navigation links

**Files:**
- `frontend/app/components/layout/Sidebar.tsx`

**Classification: small**

Change nav items to use `next/link` with `Link` component from Next.js.

Current nav items:
```typescript
const NAV_ITEMS = [
  { label: 'Расписание', icon: 'calendar', active: true },
  { label: 'Бронирования', icon: 'clipboard', active: false },
  { label: 'Клиенты', icon: 'users', active: false },
  { label: 'Мастера', icon: 'palette', active: false },
  { label: 'Чат', icon: 'chat', active: false },
];
```

Change to:
```typescript
const NAV_ITEMS = [
  { label: 'Расписание',  icon: 'calendar',  href: '/' },
  { label: 'Бронирования', icon: 'clipboard', href: '/bookings' },
  { label: 'Клиенты',     icon: 'users',     href: '/clients' },
  { label: 'Мастера',     icon: 'palette',    href: '#' },
  { label: 'Чат',         icon: 'chat',       href: '/chat' },
] as const;
```

Replace `<button>` nav items with `<Link>` from `next/link`. Use `usePathname()` to determine active state: `pathname === item.href`.

**Steps:**
1. Read `Sidebar.tsx`
2. Add `import Link from 'next/link'` + `import { usePathname } from 'next/navigation'`
3. Change NAV_ITEMS to include `href`
4. Replace `<button>` with `<Link>` for each nav item
5. Use `usePathname()` for active state logic
6. Run `npm run test`

---

## Acceptance Criteria

| Check | How |
|-------|-----|
| `/bookings` renders | Navigate to `/bookings`, see filter + table |
| Filters work | Change any filter → table filters correctly |
| Reset button | Clears all filters |
| Click row → detail panel | Right-side panel shows client, activity, visits, payments |
| Detail client link | Click client name → navigate to `/clients/[id]` |
| `/clients/[id]` renders | See header, visitors, history |
| NotFound client | Visit `/clients/nonexistent` → see error state with link back |
| Sidebar nav active | `/bookings` active when on bookings page, `/` active on schedule |
| v4 design | No gradient headers, no v1 colors |
| Tests pass | `npm run test` — all existing + new tests green |
