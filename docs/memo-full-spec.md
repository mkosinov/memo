# Memo — Full Technical Specification

> Project: "Colour Mountains" (Цветные Горы) art studio management system
> Working directory: `/root/workspace/memo/`
> UI prototype: `/root/workspace/memo/sketches/colour-mountains-v4.html`
> Design session: `/root/workspace/memo/sketches/claude_session.txt`
> Old frontend spec: `/root/workspace/memo-v1/frontend_spec.md`
> Previous implementation: `/root/workspace/memo-v1/memo-frontend/` (Next.js 14)

---

## 1. Overview

Memo is a master class schedule management system for the "Colour Mountains" art studio network (Krasnaya Polyana, Sochi). Replaces manual schedule creation via Yclients.

**Business context:**
- Seasonal business (ski resort) — from 1 artist in low season to 10+ in high season
- 3 studios: Alpika, Grand Hotel Polyana, Polyana 1389
- 6+ artists, each with their own color
- 6+ services (oil, acrylic, watercolor, ceramics, clothing painting, etc.)
- Services are either group (Public, up to 10+ people) or individual (Private, 1 person)

**Users:**
- **Administrator** — creates/edits schedule, manages bookings, clients
- **Artist** — views their weekly schedule
- **Client** — books through a public funnel (4 steps)

---

## 2. UI/UX Specification

### 2.1 Main Screen Structure (Admin Schedule)

```
┌────────────────────────────────────────────────────────────────────────┐
│  SIDEBAR (dark #1E2D2F)         │  TOOLBAR                             │
│  ┌──────────┐  collapse button  │  ◀ 12 — 18 May ▶  [Today] │ D│W    │
│  │  LOGO    │  ←─→             │  ─────────────────────────────────── │
│  │ (white)  │                   │  [All artists ▾] [All locations ▾]   │
│  ├──────────┤                   ├──────────────────────────────────────┤
│  │ MINI-CALENDAR                │  SCHEDULE                            │
│  │ April 2026                   │  ┌───┬───┬───┬───┬───┬───┬───┐      │
│  │ MO TU WE TH FR SA SU        │  │MO │TU │WE │TH │FR │SA │SU │      │
│  │       1  2  3  4  5  6  7   │  │12 │13 │14 │15 │16 │17 │18 │      │
│  │ ...    ...                  │  ├───┼───┼───┼───┼───┼───┼───┤      │
│  ├─────────────────            │  │9  │   │   │   │   │   │   │      │
│  │ NAVIGATION                  │  │   │[ ][ ]│   │   │[ ]│   │      │
│  │ Calendar                    │  │10 │   │   │   │   │   │   │      │
│  │ Artists                     │  │   │   │[ ]│   │   │   │   │      │
│  │ Locations                   │  │11 │   │   │   │   │   │[ ]│      │
│  │ Services                    │  │12 │[ ]│   │   │   │   │   │      │
│  │ Clients                     │  │...│...│...│...│...│...│...│      │
│  │ Analytics                   │  │21 │   │   │   │   │   │   │      │
│  ├─────────────────            │  └───┴───┴───┴───┴───┴───┴───┘      │
│  │ LEGEND                      │    RIGHT PANEL (slides out)          │
│  │ ● Olga  ● Julia ● Anas.     │  ┌─────────────────────────────┐    │
│  │ ● Daria ● Alex. ● Irina     │  │ TOOLS                    × │    │
│  ├─────────────────            │  ├─────────────────────────────┤    │
│  │ ☀/☾  [🎨]                   │  │ ▼ STAMP                     │    │
│  │ ┌───────────────────┐       │  │ Artist ▾                    │    │
│  │ │ 👤 Marina K.     ›│       │  │ Service ▾                   │    │
│  │ │   Administrator   │       │  │ Locations ☑☐☐             │    │
│  │ └───────────────────┘       │  │ ● Stamp configured         │    │
│  │ memo v0.0.1                 │  │ 🗑 Delete mode              │    │
│  └─────────────────────        │  ├─────────────────────────────┤    │
│                                 │  │ ▼ WEEK                      │    │
│                                 │  │ 🔄 Copy last week          │    │
│                                 │  └─────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.2 All Pages

#### P1: Admin Schedule Builder (`/`) — main

**Sidebar (left):**
- **Logo** — white PNG, on dark background, above mini-calendar
- **Collapse button** — round on sidebar edge. Collapsed state: 56px width, only icons. Arrow rotates 180°
- **Mini-calendar** — 7-column grid. Month + 1 week before and 1 after. Mouse wheel scroll = month switching. Click on date = navigate to week. Current week/day highlight
- **Navigation** — 6 items: Calendar, Artists, Locations, Services, Clients, Analytics. SVG stroke icons
- **Artist legend** — colored dots + abbreviated names
- **Theme toggle** — ☀/☾, active element filled with brand color
- **"Appearance" button** — popup: panel opacity (10/25/50/75/100%), schedule background color + its opacity
- **User button** — avatar (initials), name, role, chevron → placeholder "Profile in development"
- **Version** — "memo v0.0.1"

**Toolbar:**
- Navigation ◀ period ▶ + "Today"
- Day | Week toggle (pill-style with shadow on active)
- Filters: "All artists ▾" + "All locations ▾"

**Schedule:**
- Grid MON-SUN, 9:00–21:00, 30 min step
- "Day" mode: 1 column
- Hour — solid line, half-hour — dashed line
- Current day: name #004D56, number in filled circle #004D56
- Current time line — thin #004D56 with dot
- Drag & drop always active. Alt+drag = copy

**Right panel "Tools":**
- Open button floats over bottom-right corner. Active — brand color
- "Stamp" section: artist ▾, service ▾, locations ☑, readiness indicator, "Delete mode" toggle
- "Week" section: "Copy last week" + hint

#### P2: Booking Management (`/bookings`)
- Filterable table: date, location, service, status
- Statuses: CONFIRMED (green), CANCELLED (red), NO_SHOW (gray)
- Click row → detailed view
- "Create booking" button

#### P2: Client Card (`/clients/[id]`)
- Header: name, phone, email
- Related visitors (children/adults)
- Visit history: date, service, location, count, price, paid, debt

#### P3: Client Booking Flow (`/booking`)
- 4 steps: Location → Activity → Booking → Confirmation
- LocationSelector (cards), ActivitySchedule (week grid), BookingForm (phone → client → visitors), Confirmation (summary + prices)

#### P4: Artist Schedule (`/artist`)
- Artist selector with colored dot
- Weekly schedule (filtered)
- Online/offline toggle
- Mobile-first layout

#### P5: AI Concierge Chat (`/chat`)
- Chat interface with messages
- Service recommendation cards with "Book" button
- Quick actions
- Keyword-based matching (placeholder)

---

### 2.3 Event Card

```
┌──────────────────────────────────┐
│  ┌────────────────────┐          │
│  │ 10:00 — 13:00      │          │  ← oval, artist color fill, white text, 600
│  └────────────────────┘          │
│  Seascape                        │  ← 2 lines, 600, 13px
│  👤 6-12                        │  ← icon + age (5+,6+,8+,10+,12+,6-12)
│  Olga Sereda                     │  ← full name, 11.5px, var(--ink-mid)
│  📍 Grand Hotel Polyana          │  ← location, 11px, var(--ink-light)
│                                   │
│  ┌───────────────────────────┐   │  ← footer with separator
│  │ 👥 3/8               [+]  │   │  ← guest count + action button
│  └───────────────────────────┘   │
└──────────────────────────────────┘

Private (individual): ★ in top-right corner (SVG star, fill var(--brand))
                        cut corner clip-path
                        button = ··· instead of +
```

**Display rules:**
- **Fill opacity** = occupancy. `fillOp = 0.12 + (occ/cap) * 0.28`. Color = artist color
- **Height** = `max(dur * 2 * 60 - 10, 52)` px
- **Compression**: <90px → hide age and location. <56px → only time
- **Hover**: shadow increases, translateY(-1px), z-index:10
- **Drag**: opacity 0.5, scale(0.99)
- **Delete mode**: red border, `cursor:not-allowed`
- **Gap between cards**: min 10px padding-top

**Artist colors:**

| Artist | HEX |
|--------|-----|
| Olga Sereda | #5B8C7A |
| Yulia Bolshakova | #6B7E9C |
| Anastasia P. | #A07060 |
| Daria Tyulpina | #7A6E9C |
| Aleksandra V. | #8A7840 |
| Irina Gorokh | #9A5870 |

---

### 2.4 Interactions

| Action | Result |
|--------|--------|
| Drag card to another day | Move. Toast + "Undo" |
| Alt+drag | Copy. Green dashed outline. Toast |
| Click on empty slot | If stamp is configured → create with stamp parameters |
| Click in delete mode | Delete with animation + Toast + "Undo" |
| Click "+" on card | Toast "Quick add guest" |
| Click "···" on card | Toast "Editing individual Master Class (MK)" |
| "Copy last week" button | Toast "Last week's events copied" |
| Hover over slot | Dashed preview rectangle |

---

### 2.5 Animations

- **Delete**: opacity→0 + scale(.95) over 150ms
- **Toast**: slide up 8px + fade in over 180ms
- **Sidebar collapse**: width 220ms ease
- **Right panel**: width 220ms ease
- **Card hover**: box-shadow + translateY(-1px) over 150ms
- **Theme**: instant (CSS variables)
- **Mini-calendar**: redraw without animation

---

## 3. Design System

### 3.1 Colors

| Role | Light | Dark |
|------|-------|------|
| Page background | `#EDEDEE` | `#1a1a1c` |
| Sidebar | `#1E2D2F` (with opacity) | `#1E2D2F` |
| Cards | `#ffffff` | `#252528` |
| Surface 2 | `#f4f4f5` | `#303035` |
| Primary text | `#1a1a1a` | `#e8e8ea` |
| Secondary text | `#555` | `#aaaaae` |
| Tertiary text | `#888` | `#777780` |
| Faint text | `#ccc` | `#555560` |
| Lines | `#E0E0E1` | `#3a3a3e` |
| **Brand** | **`#004D56`** | **`#004D56`** |

### 3.2 Typography

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Time pill | 10.5px | 600 | White |
| Service name | 13px | 600 | var(--ink) |
| Age | 11px | 400 | var(--ink-mid) |
| Artist | 11.5px | 400 | var(--ink-mid) |
| Location | 11px | 400 | var(--ink-light) |
| Guest count | 11.5px | 500 | var(--ink-mid) |
| Day of week | 10px | 500 uppercase | var(--ink-light) |
| Day number | 22px | 300 | var(--ink-mid) |
| Period | 15px | 500 | var(--ink) |
| Navigation | 13px | 400 | rgba(255,255,255,.5) |
| Username | 12.5px | 500 | rgba(255,255,255,.85) |
| Role | 10px | 400 | rgba(255,255,255,.35) |
| Version | 10px | 400 | rgba(255,255,255,.2) |

### 3.3 Sizes

- Sidebar: 230px / collapsed 56px
- Right panel: 260px
- Time column: 64px
- Hour height: 60px (cell), 30px (half-hour)
- Working hours: 9:00–21:00
- Card inner padding: 8px 10px 6px
- Card outer gap: 6px on sides
- Border-radius: 12px (cards), 8px (buttons), 50% (avatars)

### 3.4 Shadows

- Cards: `0 1px 4px rgba(0,0,0,.08)`
- Cards hover: `0 4px 14px rgba(0,0,0,.13)` + translateY(-1px)
- Collapse btn: `0 1px 4px rgba(0,0,0,.12)`
- Panel toggle: `0 2px 10px rgba(0,0,0,.1)`
- Toast: `0 4px 20px rgba(0,0,0,.2)`
- Popup: `0 8px 32px rgba(0,0,0,.14)`

### 3.5 Scrollbar

```css
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--line); border-radius: 2px; }
```

---

## 4. Data Models

```typescript
interface Artist {
  id: string;
  name: string;
  shortName: string;
  color: string;        // HEX, e.g. "#5B8C7A"
}

interface Studio {
  id: string;
  name: string;
  emoji?: string;
  address?: string;
}

interface Service {
  id: string;
  name: string;
  duration: number;
  maxCapacity: number;
  minAge: string;
  defaultAdultPrice: number;
  defaultChildPrice: number;
  defaultIndividualPrice: number;
  description?: string;
}

interface Activity {
  id: string;
  isPublic: boolean;
  serviceId: string;
  locationId: string;
  artistId: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  priceAdult: number;
  priceChild: number;
  priceIndividual: number;
  hasRecords: boolean;
  clientName?: string;
  comment?: string;
  // derived
  occupied?: number;
}

interface BookingRecord {
  id: string;
  activityId: string;
  clientId: string;
  status: 'CONFIRMED' | 'CANCELLED' | 'NO_SHOW';
  comment?: string;
  createdAt: string;
}

interface Visit {
  id: string;
  recordId: string;
  visitorId: string;
  isPrimary: boolean;
  priceCharged: number;
  visited: boolean;
}

interface Client {
  id: string;
  name: string;
  phone: string;
  email?: string;
}

interface Visitor {
  id: string;
  clientId: string;
  name: string;
  age?: number;
  isAdult: boolean;
}

interface Payment {
  id: string;
  recordId: string;
  amount: number;
  method?: 'cash' | 'card' | 'transfer';
  paid: boolean;
}
```

---

## 5. API Endpoints (target)

```
GET    /api/artists
GET    /api/studios
GET    /api/services
GET    /api/schedule?week_start=&location_id=&artist_id=
POST   /api/activities
PUT    /api/activities/:id
DELETE /api/activities/:id
POST   /api/activities/:id/copy
GET    /api/bookings?status=&location=&date_from=&date_to=
GET    /api/bookings/:id
POST   /api/clients/lookup
POST   /api/clients
GET    /api/clients/:id
POST   /api/records
POST   /api/payments
GET    /api/chat/services?query=
```

---

## 6. Design Rationale (why this way and not another)

From the Claude session. Key decisions:

| # | Decision | Why |
|---|----------|-----|
| 1 | Dark sidebar | Contrast, separating navigation from content. Editorial style |
| 2 | Gray background #EDEDEE | After comparison with Figma — more modern than cream |
| 3 | Private = cut corner | Paper approach (clip-path). Not icon, not texture |
| 4 | Fill opacity = occupancy | Visual, no reading required |
| 5 | Two dropdowns instead of ToggleGroup | Simultaneous filtering by artist and studio |
| 6 | Stamp instead of brush | Clearer metaphor |
| 7 | Toast with undo (no timer) | Less noisy than countdown |
| 8 | Alt+drag = copy | Intuitive, doesn't clutter UI |
| 9 | #004D56 (brand) | From the studio's actual brand |
| 10 | Inter (font) | Came from v4. Calvino/Noah/Athelas were discussed but didn't make it |
| 11 | No "Create" button | Clicking a slot is enough |
| 12 | Mini-calendar +1 week | Orientation at month boundaries |

**Open Questions (TBD):**
- Employee fields: position_title? email? photo? bio?
- ServiceCategory needed?
- Address format? coordinates?
- Payment methods confirmed?
- Telegram ID for client?
- hasRecords — derived or stored?
- Copy last week → into which week?
- Format painter → delete with records?
- Navigation → role-based routing?

---

## 7. Implementation Status

| # | Page | Route | v4 HTML | Next.js (prev) | Backend |
|---|------|-------|---------|----------------|--------|
| P1 | Admin Schedule | `/` | ✅ | ✅ | ❌ |
| P2 | Booking Management | `/bookings` | ❌ | ✅ | ❌ |
| P2 | Client Card | `/clients/[id]` | ❌ | ✅ | ❌ |
| P3 | Client Booking | `/booking` | ❌ | ✅ | ❌ |
| P4 | Artist Schedule | `/artist` | ❌ | ✅ | ❌ |
| P5 | AI Concierge | `/chat` | ❌ | ✅ | ❌ |

**Previous version (memo-frontend) — works:**
- All 6 pages with components
- React Context (schedule, booking, artist, chat)
- Mock data: 5 artists, 3 locations, 6 services, 20+ events
- @dnd-kit for DnD
- Vitest tests
- `npm run dev` → port 3000

---

## 8. Architecture (target)

```
memo-frontend/
├── app/
│   ├── page.tsx                  # P1: /
│   ├── booking/page.tsx          # P3: /booking
│   ├── bookings/page.tsx         # P2: /bookings
│   ├── clients/[id]/page.tsx     # P2: /clients/[id]
│   ├── artist/page.tsx           # P4: /artist
│   └── chat/page.tsx             # P5: /chat
├── components/
│   ├── schedule/                 # P1
│   │   ├── SchedulePage.tsx
│   │   ├── Toolbar.tsx
│   │   ├── ViewSwitcher.tsx
│   │   ├── FilterBar.tsx
│   │   ├── WeekView.tsx
│   │   ├── DayColumn.tsx
│   │   ├── ActivityCard.tsx
│   │   ├── ActivityModal.tsx
│   │   ├── ConflictWarning.tsx
│   │   ├── Legend.tsx
│   │   └── FormatPainter.tsx
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── MiniCalendar.tsx
│   │   ├── RightPanel.tsx
│   │   └── Navbar.tsx
│   ├── booking/                  # P3
│   │   ├── LocationSelector.tsx
│   │   ├── ActivitySchedule.tsx
│   │   ├── BookingForm.tsx
│   │   ├── BookingConfirmation.tsx
│   │   ├── VisitorLookup.tsx
│   │   └── PricingBreakdown.tsx
│   ├── artist/                   # P4
│   │   ├── ArtistSelector.tsx
│   │   ├── ArtistWeekView.tsx
│   │   ├── ActivityDetail.tsx
│   │   └── AvailabilityToggle.tsx
│   ├── chat/                     # P5
│   │   ├── ChatMessage.tsx
│   │   ├── ChatInput.tsx
│   │   ├── QuickActions.tsx
│   │   ├── ServiceRecommendation.tsx
│   │   └── TypingIndicator.tsx
│   └── ui/                       # Shared
│       ├── Toast.tsx
│       ├── Badge.tsx
│       ├── Button.tsx
│       ├── Select.tsx
│       └── Modal.tsx
├── lib/
│   ├── types.ts
│   ├── mock-data.ts
│   ├── schedule-context.tsx
│   ├── booking-context.tsx
│   ├── artist-context.tsx
│   └── chat-context.tsx
└── __tests__/
```

**Stack:** Next.js 14 (App Router) + TypeScript + Tailwind CSS 3 + @dnd-kit

---

## 9. Design Differences v4 vs Old Spec

| Aspect | Old spec | v4 (current) |
|--------|----------|--------------|
| Primary | #667eea → #764ba2 | **#004D56** |
| Background | #f0f2f5 | **#EDEDEE** |
| Cards | white with shadow | **transparent fill** with artist color |
| Sidebar | none | **dark** #1E2D2F |
| Right panel | none | **sliding** |
| Private | none | **cut corner** |
| Age | text | **square + icon** |
| DnD | @dnd-kit | HTML5 native (in prototype) |
| View switch | Day/Week/Month/List | **Day/Week** |
| Toast | none | **yes** with Undo |
| Dark theme | none | **yes** |
| Mini-calendar | none | **yes** in sidebar |

---

## 10. Quick Start

```bash
# Previous implementation
cd /root/workspace/memo-v1/memo-frontend
npm install
npm run dev              # localhost:3000
npm test
npx next build

# New implementation (memo2)
cd /root/workspace/memo
# TODO: initialize Next.js project
```

---

*Document created: 2026-05-13*
*Sources: colour-mountains-v4.html, claude_session.txt, frontend_spec.md (memo/), memo-frontend/ code*
