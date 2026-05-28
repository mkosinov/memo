# colourmountains.ru Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `apps/web/` — public website colourmountains.ru with main page (hero, card stack carousel, overlays, chat), personal account, and auxiliary pages.

**Architecture:** Next.js 14 App Router in `apps/web/` with shared packages (`@memo/domain`, `@memo/api-client`). Unified design system with admin panel (adaptation: `--gold` accent, Playfair Display, `--radius: 16px`). Mobile-first (390px max-width). Overlay pattern for all interactive elements.

**Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind CSS, Framer Motion (card stack), Embla Carousel (calendar line), `@memo/domain`, `@memo/api-client`

---

## Dependencies

- [x] Design spec: `docs/specs/2026-05-20-colourmountains-website-design.md`
- [x] Turborepo monorepo with `apps/admin/`, `packages/domain/`, `packages/api-client/`
- [ ] Backend API endpoints (mock data at first stage)

## Layered Architecture (approved 2026-05-20)

```
apps/web/app/
├── lib/api/              ← Data layer: fetch calls, returns raw DTO
│   ├── client.ts         ← base HTTP client
│   ├── activities.ts     ← getActivities(filters): Promise<RawActivityDTO[]>
│   ├── locations.ts      ← getLocations(): Promise<RawLocationDTO[]>
│   └── gallery.ts        ← getGallery(limit): Promise<RawPhotoDTO[]>
├── lib/models/           ← ViewModel interfaces (types only)
│   ├── activity.ts       ← ActivityViewModel, ActivityFilters
│   ├── location.ts       ← LocationViewModel
│   └── gallery.ts        ← GalleryPhotoViewModel
├── lib/transforms/       ← Pure functions: raw DTO → ViewModel
│   ├── to-activity-vm.ts
│   ├── to-location-vm.ts
│   └── to-gallery-vm.ts
├── lib/cookies.ts        ← Cookie utils
├── lib/geolocation.ts    ← Geolocation utils
├── hooks/                ← React hooks: data fetching + transforms + state
│   ├── useActivities.ts
│   ├── useLocations.ts
│   ├── useGallery.ts
│   └── useCalendarDays.ts
├── components/           ← Only dumb-components (props from ViewModel)
│   ├── MKCard.tsx
│   ├── CalendarLine.tsx
│   ├── Overlay.tsx, Button.tsx, Pill.tsx, ...
│   └── popups/*          ← PriceDetails, MaterialDetails, NextTime, LocationDetails
├── sections/             ← Composite sections (may use hooks)
│   ├── Hero.tsx
│   ├── Reviews.tsx
│   └── GuestGallery.tsx
└── app/
    └── page.tsx          ← Assembly: hooks → sections → components
```

**Principles:**
- `lib/api/` — only fetch, returns raw TypeScript types (DTO), does NOT know about React
- `lib/transforms/` — pure functions without side effects, raw → ViewModel
- `hooks/` — React hooks: calls API → applies transforms → passes to components
- `components/` + `sections/` — only render from props, nothing knows about API

---

## Task Classification Legend

| Tier | Criteria | Review Pipeline |
|------|----------|----------------|
| **Trivial** | ≤5 lines, style/text, no logic | Self-review |
| **Small** | 1 file, <50 lines, props/layout | Spec-review only |
| **Standard** | Multi-file, logic, state, API | Full two-stage |
| **Large** | Architecture, subsystem, >200 lines | Full two-stage + final reviewer |

---

## Task 1: Update Unified Design System
**Classification:** Small

**Files:**
- `docs/design-system.md` — update tokens
- `apps/admin/tailwind.config.ts` — update radius and add gold

**Steps:**
- [ ] In `docs/design-system.md`:
  - Change `--radius: 12px` → `--radius: 16px`
  - Add `--gold: #C49A2E`
  - Add Playfair Display in Typography
  - Add site shadows: `0 2px 16px rgba(0,0,0,.09)`
- [ ] In `apps/admin/tailwind.config.ts`:
  - Update `radius: '12px'` → `radius: '16px'`
  - Add `gold: '#C49A2E'` to colors
- [ ] Verify: `cd apps/admin && npm run build` (no errors)

---

## Task 2: Initialize Project `apps/web/`
**Classification:** Standard

**Files (new):**
- `apps/web/package.json`
- `apps/web/next.config.js`
- `apps/web/tsconfig.json`
- `apps/web/tailwind.config.ts`
- `apps/web/postcss.config.js`
- `apps/web/.env.local`

**Steps:**
- [ ] Create `apps/web/` — Next.js 14 project with App Router
- [ ] Configure `package.json` with dependencies: `next`, `react`, `react-dom`, `typescript`, `tailwindcss`, `postcss`, `autoprefixer`, `framer-motion`, `embla-carousel-react`, `@memo/domain`, `@memo/api-client`
- [ ] Configure `tsconfig.json` with paths: `@/components/*`, `@/lib/*`, `@/app/*`
- [ ] Configure `tailwind.config.ts`:
  - Extend colors: brand, gold, ink, surface, line (from design-system)
  - Font families: Inter (body), Playfair Display (headings)
  - Border radius: 16px (lg), 8px (sm)
  - Shadows: carousel shadow
- [ ] Configure `next.config.js`:
  - `output: 'export'` (for static deployment)
  - `images: { unoptimized: true }` (for static export)
  - `distDir: 'dist'`
- [ ] Add `apps/web` to `pnpm-workspace.yaml`
- [ ] Run `npm install` in root
- [ ] Verify: `cd apps/web && npm run build` (basic build passes)

---

## Task 3: Global Styles and Fonts
**Classification:** Small

**Files (new):**
- `apps/web/app/globals.css`
- `apps/web/app/layout.tsx`

**Steps:**
- [ ] Create `globals.css`:
  - CSS variables (from design-system): `--bg`, `--card-bg`, `--surface`, `--brand`, `--gold`, `--ink`, etc.
  - Import Google Fonts: Inter, Playfair Display
  - Base styles: `body { background: var(--bg); font-family: 'Inter', sans-serif; max-width: 390px; margin: 0 auto; }`
  - Scrollbar hiding for carousels
  - Scrollbar styling
- [ ] Create `layout.tsx`:
  - Metadata: title "Colour Mountains — Art Studio", description
  - Root layout with `globals.css`
  - Mobile viewport: `width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no`

---

## Task 4: Base Components and Layout
**Classification:** Standard

**Files (new):**
- `apps/web/app/components/Header.tsx`
- `apps/web/app/components/HamburgerMenu.tsx`
- `apps/web/app/components/Overlay.tsx`
- `apps/web/app/components/Button.tsx`
- `apps/web/app/components/Pill.tsx`

**Architecture notes:** All components are dumb/presentation. Do not call API directly, receive data via props. Header may have local state (hamburger open/closed).

**Steps:**
- [ ] `Button.tsx`: variants `primary` (brand bg), `outline` (brand border), `gold` (gold bg). Props: `variant`, `size`, `children`, `onClick`, `disabled`
- [ ] `Pill.tsx`: filter pill. Props: `active`, `children`, `onClick`. Styles: active = brand bg + white text, inactive = border + ink-mid text
- [ ] `Overlay.tsx`: slide-up overlay (half-screen or full-screen). Props: `isOpen`, `onClose`, `children`, `size` ('half' | 'full'). Animation: `translateY(100%) → translateY(0)`
- [ ] `Header.tsx`: logo (Logo.png) left, hamburger right. Fixed on mobile. Transparent on hero, white bg on scroll
- [ ] `HamburgerMenu.tsx`: overlay menu with page list: Activities, Studios, Plein Air, Corporate Events, Shop, About, Personal Account. Slide-in from right

---

## Task 5: Hero Section
**Classification:** Small

**Files (new):**
- `apps/web/app/sections/Hero.tsx`

**Steps:**
- [ ] Create Hero:
  - Height: `36svh`, min 240px, max 300px
  - Background: placeholder image (unsplash mountains) + gradient overlay
  - Title: Playfair Display, 26px, white, gold accent on part of the text
  - Pills: «Beginners welcome • All included • Near you»
  - Header embedded in hero (logo + hamburger)
- [ ] Verify: hero visible without scrolling, bottom of next section slightly visible

---

## Task 6: Calendar Line
**Classification:** Standard

**Files (new):**
- `apps/web/app/components/CalendarLine.tsx`
- `apps/web/app/hooks/useCalendarDays.ts`

**Steps:**
- [ ] `useCalendarDays.ts`: hook to generate +14 days from today. Returns array: `{ date, dayName, dayNumber, isToday, isSelected }`
- [ ] `CalendarLine.tsx`:
  - Embla Carousel horizontal scroll
  - Day names: short names (Mon, Tue, Wed...)
  - Day numbers: large
  - Current selected day: red square border (like wall calendar) — `border: 2px solid #C8503C` (or brand color)
  - Today: background highlight
  - Swipe/scroll horizontal
  - Callback `onSelectDay(date)`
- [ ] Styles: sticky below hero, white background, bottom border

---

## Task 7: Filters (FilterPills + LocationFilter)
**Classification:** Small

**Files (new):**
- `apps/web/app/components/FilterPills.tsx`
- `apps/web/app/components/LocationFilter.tsx`

**Steps:**
- [ ] `FilterPills.tsx`:
  - Pills: «together», «adults», «children»
  - Horizontal scroll (overflow-x-auto)
  - Single select (only one active)
  - Uses `Pill.tsx`
- [ ] `LocationFilter.tsx`:
  - Dropdown select with location icon
  - Options: all locations from API
  - Load priority: 1) cookies, 2) GPS (placeholder at first stage)
  - Save selection in cookies

---

## Task 8: Card Stack Carousel (MKCarousel)
**Classification:** Large

**Files (new):**
- `apps/web/app/components/MKCarousel.tsx`
- `apps/web/app/components/MKCard.tsx`
- `apps/web/app/hooks/useCardStack.ts`

**Steps:**
- [ ] `MKCard.tsx`:
  - MK photo (large, aspect-ratio 4:3)
  - Category tag (colored pill: gold/green/pink for adults/together/children)
  - Title: Playfair Display, 18px, bold
  - Time + duration
  - Location (icon + text)
  - Social proof: «Already 3 guests»
  - Material: «Acrylic • 30×40»
  - Price: range «3,500 – 5,500 ₽»
  - Book button (brand bg)
- [ ] `useCardStack.ts`:
  - Stack state management: `cards[]`, `currentIndex`, `direction`
  - Swipe gestures: pan left/right
  - Exit animation: translateX + rotate
  - Callback: `onSwipe(card, direction)`, `onTap(card)`
- [ ] `MKCarousel.tsx`:
  - Renders 3 cards simultaneously (visible + 2 below)
  - Under-cards: scale(0.95), translateY(8px), rotate(±2deg)
  - Framer Motion for swipe animations
  - Tap on visible → `onSelect(card)`
  - Swipe left/right → next/previous
- [ ] Test: cards render, swipe works, tap opens details

---

## Task 9: ActivityDetail Overlay
**Classification:** Standard

**Files (new):**
- `apps/web/app/components/ActivityDetail.tsx`

**Steps:**
- [ ] Overlay (half-screen, slide-up):
  - MK photo (large, full-width)
  - Guest photos (horizontal strip, if any)
  - Instructor name + avatar
  - Date and time
  - Material + "Details" button → opens MaterialDetails popup
  - Price (range) + "Details" button → PriceDetails popup
  - "Next time" button + "Details" button → NextTime popup
  - Location + "Details" button → LocationDetails popup
  - "Participate" button → opens BookingOverlay
- [ ] Close button (cross) at top
- [ ] Swipe down to close

---

## Task 10: Booking Overlay
**Classification:** Standard

**Files (new):**
- `apps/web/app/components/BookingOverlay.tsx`
- `apps/web/app/components/Counter.tsx`
- `apps/web/app/components/ContactForm.tsx`

**Steps:**
- [ ] `Counter.tsx`: participants counter (+/-). Props: `label`, `subLabel`, `value`, `onChange`, `min`, `max`. Round buttons, border
- [ ] `ContactForm.tsx`:
  - Fields: Name (text), Phone (tel), Comment (textarea, optional)
  - Validation: name ≥ 2 chars, phone ≥ 10 digits
  - Dropdown: «Where to send confirmation» — Max / Telegram / WhatsApp
- [ ] `BookingOverlay.tsx` (full-screen):
  - Top bar: «← Back» + title «Booking Form»
  - MK summary (photo, name, time, location)
  - Counters: Adults / Children (with prices)
  - Total (dynamic)
  - Contact form
  - «Book» button (disabled until validation)
  - Success state:
    - Icon 🎨
    - «You're booked!»
    - Booking details
    - «Get reminder in WhatsApp» button
- [ ] Swipe down / back button to close

---

## Task 11: Popup Components (PriceDetails, MaterialDetails, NextTime, LocationDetails)
**Classification:** Standard

**Files (new):**
- `apps/web/app/components/PriceDetails.tsx`
- `apps/web/app/components/MaterialDetails.tsx`
- `apps/web/app/components/NextTime.tsx`
- `apps/web/app/components/LocationDetails.tsx`

**Steps:**
- [ ] `PriceDetails.tsx`: list of all tariffs for MK (adult, child, family, etc.). Prices, descriptions
- [ ] `MaterialDetails.tsx`: information about technique (acrylic/oil). What's included, what to bring, drying time
- [ ] `NextTime.tsx`: 3 options for next occurrence of the same MK (date + time + location). «Book» button for each
- [ ] `LocationDetails.tsx`: studio photo, address, business hours, map (placeholder), how to get there
- [ ] All popups: slide-up overlay, less than half-screen (~70%), close by swipe/cross

---

## Task 12: Reviews and Gallery Sections
**Classification:** Small

**Files (new):**
- `apps/web/app/sections/Reviews.tsx`
- `apps/web/app/sections/GuestGallery.tsx`

**Steps:**
- [ ] `Reviews.tsx`:
  - Text: «Great place 4.9★ · See reviews →»
  - Link to `https://yandex.ru/maps/org/...` (target="_blank", rel="noopener noreferrer")
  - Compact, no carousel
- [ ] `GuestGallery.tsx`:
  - Horizontal scroll
  - Work photos (placeholder)
  - Technique tag (acrylic/oil/children) — badge on photo
  - Tap — opens photo in overlay (PhotoGallery popup)

---

## Task 13: Sticky Chat Bar ⏳ RESCHEDULED
**Classification:** Small
**Status:** Moved to Phase P5 (AI Concierge Chat) — integrated with chat backend.

**Files (new):**
- `apps/web/app/components/ChatBar.tsx`

**Steps:**
- [ ] Fixed at bottom, backdrop-filter blur
- [ ] Chips (horizontal scroll):
  - «👶 For an 8-year-old child»
  - «❤️ For two»
  - «🌧 What to do in the rain»
  - «⏱ Only 1 hour available»
- [ ] «Send» button (brand bg)
- [ ] No text input field
- [ ] On chip press → send (mock at first stage)

---

## Task 14: API Integration and Data Layer (Three-Layer Architecture) ⏳ RESCHEDULED
**Classification:** Standard
**Status:** Moved to Phase P3 (Client Booking Flow) — real API endpoints needed before full integration.

**Files (new):**
- `apps/web/app/lib/api/client.ts` — base HTTP client (fetch wrapper)
- `apps/web/app/lib/api/activities.ts` — getActivities, createBooking (mock/fetch)
- `apps/web/app/lib/api/locations.ts` — getLocations (mock/fetch)
- `apps/web/app/lib/api/gallery.ts` — getGallery (mock/fetch)
- `apps/web/app/lib/models/activity.ts` — ActivityViewModel, ActivityFilters interfaces
- `apps/web/app/lib/models/location.ts` — LocationViewModel
- `apps/web/app/lib/models/gallery.ts` — GalleryPhotoViewModel
- `apps/web/app/lib/transforms/to-activity-vm.ts` — raw DTO → ActivityViewModel
- `apps/web/app/lib/transforms/to-location-vm.ts` — raw DTO → LocationViewModel
- `apps/web/app/lib/transforms/to-gallery-vm.ts` — raw DTO → GalleryPhotoViewModel
- `apps/web/app/hooks/useActivities.ts` — React hook (fetch → transform → state)
- `apps/web/app/hooks/useLocations.ts` — React hook
- `apps/web/app/hooks/useGallery.ts` — React hook

**Steps:**
- [ ] `lib/api/client.ts`: wrapper with base URL, error handling, placeholder for mock mode
- [ ] `lib/api/activities.ts`: `getActivities(filters)`, `createBooking(data)` — export pure async functions, return `RawActivityDTO[]`
- [ ] `lib/api/locations.ts`: `getLocations()` — returns `RawLocationDTO[]`
- [ ] `lib/api/gallery.ts`: `getGallery(limit)` — returns `RawPhotoDTO[]`
- [ ] `lib/models/*`: TypeScript ViewModel interfaces (fields already ready for render: priceFormatted, dateFormatted, durationLabel, categoryColor, etc.)
- [ ] `lib/transforms/*`: pure functions `toActivityViewModel(raw): ActivityViewModel`, no side effects
- [ ] `hooks/useActivities.ts`: React hook. Takes `{ date, location, category }`. Calls `getActivities()`, then `toActivityViewModel()`. Returns `{ activities, isLoading, error }`
- [ ] `hooks/useLocations.ts`: similar, returns `{ locations, isLoading, error }`
- [ ] `hooks/useGallery.ts`: similar, returns `{ photos, isLoading, error }`
- [ ] At first stage: mock data inside `lib/api/*` functions, `lib/api-client` not used

---

## Task 15: Main Page (Assembly)
**Classification:** Standard

**Files:**
- `apps/web/app/page.tsx` (modify)

**Steps:**
- [ ] Assemble main page from sections:
  1. Hero
  2. CalendarLine (sticky)
  3. FilterPills + LocationFilter
  4. MKCarousel
  5. Reviews
  6. GuestGallery
  7. ChatBar (fixed bottom)
- [ ] State management: selected day, category filter, location → filter carousel
- [ ] ActivityDetail overlay: opens on card tap
- [ ] Booking overlay: opens from ActivityDetail
- [ ] Verify: page renders without errors, all sections visible

---

## Task 16: Auxiliary Pages ⏳ RESCHEDULED
**Classification:** Standard
**Status:** Moved to Phase P3+ — pages `/services`, `/locations`, `/pleinair`, `/corporate`, `/shop`, `/about`, `/cabinet`, `/booking` will be built when booking flow and backend are ready.

**Files (new):**
- `apps/web/app/services/page.tsx`
- `apps/web/app/locations/page.tsx`
- `apps/web/app/pleinair/page.tsx`
- `apps/web/app/corporate/page.tsx`
- `apps/web/app/shop/page.tsx`
- `apps/web/app/about/page.tsx`
- `apps/web/app/cabinet/page.tsx`
- `apps/web/app/booking/page.tsx`

**Steps:**
- [ ] Each page: basic layout with Header, placeholder content (h1 + short text)
- [ ] `/cabinet`: placeholder «Personal Account» with login form (phone)
- [ ] `/booking`: standalone page with BookingOverlay (for direct links)
- [ ] All pages mobile (max-width 390px, centered)
- [ ] Verify: navigation between pages works

---

## Task 17: Cookie and Geolocation Utils ⏳ RESCHEDULED
**Classification:** Small
**Status:** Moved to Phase P3 (Client Booking Flow) — needed for location-aware booking flow.

**Files (new):**
- `apps/web/app/lib/cookies.ts`
- `apps/web/app/lib/geolocation.ts`

**Steps:**
- [ ] `cookies.ts`: `getLocationCookie()`, `setLocationCookie(locationId)` (expires 30 days)
- [ ] `geolocation.ts`: `getCurrentPosition()` → Promise with coordinates. Fallback: null. At first stage — placeholder
- [ ] Integration: on main page load → `getLocationCookie()` → if none, try geolocation → `setLocationCookie()`

---

## Task 18: Tests and Build
**Classification:** Standard

**Files (new):**
- `apps/web/vitest.config.ts`
- `apps/web/app/**/*.test.tsx`

**Steps:**
- [ ] Set up Vitest + React Testing Library + jsdom
- [ ] Tests:
  - Hero renders
  - CalendarLine: days generated, day selection works
  - FilterPills: filtering works
  - MKCarousel: cards render
  - ActivityDetail: opens on tap
  - BookingOverlay: form validates
  - Reviews: link to Yandex has target="_blank"
- [ ] `npm run test` — all tests pass
- [ ] `npm run build` — build without errors

---

## Self-Review

**Spec coverage check:**
- [x] Hero (35% viewport) — Task 5
- [x] Calendar line (red square) — Task 6
- [x] Filters (together/adults/children) — Task 7
- [x] Card Stack carousel — Task 8
- [x] ActivityDetail overlay — Task 9
- [x] Booking overlay (summary, counters, form, dropdown Max/Telegram/WhatsApp) — Task 10
- [x] PriceDetails, MaterialDetails, NextTime, LocationDetails popups — Task 11
- [x] Reviews (compact + link to Yandex) — Task 12
- [x] GuestGallery — Task 12
- [x] ChatBar (chips only + button) — Task 13
- [x] Cookie + geolocation — Task 17
- [x] Other pages — Task 16
- [x] Personal account (/cabinet) — Task 16
- [x] /booking standalone — Task 16

**Placeholder scan:** No TBD/TODO. All tasks contain specific steps.

**Type consistency:** Hooks return typed data, components accept Props interfaces.

---

## Execution Handoff

**Plan complete and saved to `docs/plans/2026-05-20-colourmountains-website-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
