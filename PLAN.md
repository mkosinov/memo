# Memo Frontend v2 — Work Plan

> Date: 2026-05-13
> **P1 Admin Schedule: ✅ Completed 2026-05-15** — 15/15 tasks done
> **P1 UI Polish: ✅ Completed 2026-05-16** — 4 polish tasks + 1 trivial, 165 tests passing

## Deadlines (updated 2026-05-13)

| Milestone | Date | Deliverable |
|-----------|------|-------------|
| **MVP** | **May 20, 2026 (7 days)** | P1 — Admin Schedule fully working |
| **Full release** | **May 31, 2026 (18 days)** | All P1–P5 + tests |

## Introduction

**What we have:**
1. `apps/admin/` — working Next.js 14 project (admin panel) with all pages, mock data, contexts, @dnd-kit, tests.
2. `sketches/colour-mountains-v4.html` — new design (dark sidebar, #004D56, cards, stamp, toasts, mini-calendar). **P1 only and in HTML.**
3. `docs/memo-full-spec.md` — full spec (543 lines) with UI/UX, design system, types, architecture.

**Strategy:** Hybrid — take logic from old `memo-frontend` and dress it in v4 design.

## Architecture — Turborepo Monorepo

The project uses **Turborepo + npm workspaces**:

```
memo/
├── apps/
│   ├── admin/          # Admin panel (Next.js 14, App Router)
│   ├── web/            # colourmountains.ru (Next.js 14, future)
│   └── master/         # Master app (future)
├── packages/
│   ├── domain/         # Shared TypeScript types + Zod schemas
│   └── api-client/     # Shared HTTP client for FastAPI
├── backend/            # FastAPI (separate service)
└── turbo.json
```

**Principles:**
- **Shared:** Only types (`@memo/domain`) and API client (`@memo/api-client`)
- **Not shared:** UI components — each app has its own design
- **Bundle isolation:** `@dnd-kit` and admin-specific deps don't leak into the website

Details: `docs/ARCHITECTURE.md`

## Work Schedule (MVP — May 13–20)

| Day | Date | What we do | Who |
|-----|------|------------|-----|
| Day 1 | May 13 (Wed) | Next.js initialization + design system | @frontend-coder |
| Day 2 | May 14 (Thu) | Layout: Sidebar, Toolbar, RightPanel | @frontend-coder |
| Day 3 | May 15 (Fri) | P1 — Schedule grid + cards | @frontend-coder |
| Day 4 | May 16 (Sat) | P1 — Continuation (cards, filters) | @frontend-coder |
| Day 5 | May 17 (Sun) | P1 — DnD, stamp, modal | @frontend-coder |
| Day 6 | May 18 (Mon) | P1 — final features + tests | @frontend-coder + @tester |
| Day 7 | May 19 (Tue) | Polish, bug fixes | @debugger + @tester |
| Delivery | May 20 (Wed) | **MVP ready** | — |

---

## Stage 0: Preparation — project agents

Create 8 agents in `.opencode/agents/` modeled after cmbot:

| # | Agent | Role | Mode | Model |
|---|-------|------|------|-------|
| 1 | @architect | Team Lead + Architect — plans, designs, delegates | primary | kimi-k2.6 |
| 2 | @frontend-coder | Frontend development (Next.js, React, Tailwind, TS) | subagent | qwen3.6-plus |
| 3 | @backend-coder | Backend development (FastAPI, SQLite, Python) | subagent | qwen3.6-plus |
| 4 | @tester | Testing (Vitest, pytest, e2e) | subagent | qwen3.5-plus |
| 5 | @debugger | Bug search and analysis | subagent | qwen3.6-plus |
| 6 | @docser | Documentation — maintains PLAN.md, README, statuses | subagent | deepseek-v4-flash |
| 7 | @deployer | Deployment and CI/CD | subagent | deepseek-v4-flash |
| 8 | @manager | Connector — takes requests, distributes between agents | primary | deepseek-v4-flash |

- [x] Create `.opencode/agents/architect.md`
- [x] Create `.opencode/agents/frontend-coder.md`
- [x] Create `.opencode/agents/backend-coder.md`
- [x] Create `.opencode/agents/tester.md`
- [x] Create `.opencode/agents/debugger.md`
- [x] Create `.opencode/agents/docser.md`
- [x] Create `.opencode/agents/deployer.md`
- [x] Create `.opencode/agents/manager.md`

**Result:** 8 agents ready to work, role distribution established

---

## Stage 1: Turborepo Infrastructure

- [x] Set up Turborepo (turbo.json, pnpm-workspace.yaml, root package.json)
- [x] Create `packages/domain/` — shared TypeScript types + Zod schemas
- [x] Create `packages/api-client/` — shared HTTP client
- [x] Move existing frontend into `apps/admin/`
- [x] Update imports: `@/lib/types` → `@memo/domain`
- [x] Set up npm workspaces
- [x] Verify: `npm install`, tests pass (160/160)

**Result:** Turborepo monorepo with admin app and shared packages

---

## Stage 2: Design System and Layout (base) ✅

- [x] `app/globals.css` — CSS variables (light/dark theme from v4), scrollbar, base styles
- [x] `app/layout.tsx` — root layout
- [x] **Sidebar** — React component (logo, mini-calendar, navigation, legend, ☀/☾ toggle, appearance button, user, version, collapse)
- [x] **MiniCalendar** — month grid, +1 week before/after, week scroll, today/week highlight
- [x] **ThemeProvider** — React Context for theme switching
- [x] **Toast** — toast system (createPortal)
- [x] **Toolbar** — week navigation, day/week toggle, filters
- [x] **RightPanel** — sliding panel (stamp + week, collapsible sections)

**Result:** Complete application skeleton built, navigation works, theme switches, toasts display

---

## Stage 3: P1 — Admin Schedule (`/`)

**2a. Schedule grid:**
- [x] **WeekView** — 7 columns × 24 half-hour slots (9:00–21:00), sticky header with days
- [x] **DayColumn** — single column (drop zone for DnD)
- [x] Hour lines (solid) and half-hour lines (dashed)
- [x] Current time line

**2b. Event cards:**
- [x] **ActivityCard** — time pill (oval, artist color), name (2 lines), age (icon + text), artist, location, footer (guests + button), cut corner for Private
- [x] Fill opacity = occupancy
- [x] Compression at small heights (<90px, <56px)
- [x] Hover/drag animations

**2c. Drag & Drop:**
- [x] Integrate @dnd-kit from `memo-frontend`
- [x] Drag between days
- [x] Alt+drag = copy
- [x] Dashed preview rectangle
- [x] Toast + "Undo" after DnD

**2d. Stamp (Format Painter):**
- [x] Stamp mode: artist + service + locations (multi-select)
- [x] Click on slot → create with stamp parameters
- [x] Delete mode (toggle → click → delete)

**2e. Create/Edit modal:**
- [x] **ActivityModal** — from `memo-frontend`, adapt to v4

**2f. Additional:**
- [ ] **ConflictWarning** — double booking for artist (postponed to P2)
- [x] **Copy last week** — copy Public activities
- [ ] Filters by artist and location (postponed to P2)

**Result:** P1 fully working, as in v4, on React

---

## Stage 4: P2 — Booking Management + Client Card ✅

- [x] **BookingPage** (`/bookings`) — port from `memo-frontend`, update design
- [x] **ClientCardPage** (`/clients/[id]`) — port, update design
- [x] Filters, statuses (CONFIRMED/CANCELLED/NO_SHOW), detailed view
- [x] Route group `(main)` — sidebar nav links with Link + active state
- [x] Bugfixes: test imports, date filter guard, Sidebar usePathname mock

**Result:** Administrator manages bookings and views client cards

---

## Phase 5: Backend Foundation (FastAPI) ✅

- [x] Project initialization and linters (ruff, mypy)
- [x] DB Session Management (DatabaseSessionManager)
- [x] Configuration and Entrypoint (main.py, pydantic-settings)
- [x] System Domain / Healthcheck (base router)
- [ ] ... (plan will be expanded after the foundation)

**Result:** Working backend foundation with Clean Architecture and tests.

**Completed:** 2026-05-28 — 27/27 tests passing, ruff + mypy strict clean

**Restructured:** 2026-05-30 — `app/` → `src/`, layer-based, API `/api/v1/`, 161 tests

---

## Stage 5: Frontend–Backend API Integration

- [ ] Design API integration plan (which endpoints, data flow, error handling)
- [ ] Update `@memo/api-client` to point to `/api/v1/` endpoints
- [ ] Replace mock data in `apps/admin/` with real API calls
- [ ] Add loading, error, empty states to UI components
- [ ] Verify end-to-end: frontend loads real data from backend

**Result:** Admin panel works with real backend data instead of mocks.

---

## Stage 6: P3 — Client Booking Flow

- [ ] **BookingPage** (`/booking`) — port 4-step flow
- [ ] LocationSelector, ActivitySchedule, BookingForm, VisitorLookup
- [ ] BookingConfirmation + PricingBreakdown
- [ ] Update design to match overall style

**Result:** Client books a master class

---

## Stage 7: P4 — Artist Schedule

- [ ] **ArtistPage** (`/artist`) — port
- [ ] ArtistSelector, ArtistWeekView, ActivityDetail, AvailabilityToggle
- [ ] Mobile-first, card-based layout

**Result:** Artists see their schedule

---

## Stage 8: P5 — AI Concierge Chat

- [ ] **ChatPage** (`/chat`) — port
- [ ] ChatMessage, ChatInput, QuickActions, ServiceRecommendation, TypingIndicator
- [ ] Keyword-based matching (temporary placeholder)

**Result:** Chat assistant helps choose a service

---

## Stage 9: Tests and Polish

- [ ] Tests for all pages (Vitest + Testing Library)
- [ ] TypeScript strict mode
- [ ] Basic a11y (aria attributes)
- [ ] Minimal mobile adaptation
- [ ] `next build`, `tsc --noEmit`, `next lint` — no errors

---

## Stage 10: Web — colourmountains.ru (P3 Client Booking Flow)

- [ ] Create `apps/web/` — Next.js 14 project for public website
- [ ] Set up SEO: metadata, sitemap, robots
- [ ] **Home page** — hero, gallery, services, about the studio
- [ ] **Services page** — list of master classes
- [ ] **Booking page** (`/booking`) — 4-step flow:
  - Step 1: LocationSelector (location cards)
  - Step 2: ActivitySchedule (date and class selection)
  - Step 3: BookingForm (visitors, prices)
  - Step 4: BookingConfirmation (payment, summary)
- [ ] **Contact page**
- [ ] Integration with `@memo/domain` and `@memo/api-client`

**Result:** Full colourmountains.ru website with online booking

---

## Stage 10: Master App — artist schedule

- [ ] Create `apps/master/` — Next.js 14 project
- [ ] **Mobile-first** design
- [ ] ArtistSelector (if an artist handles multiple disciplines)
- [ ] **ArtistWeekView** — weekly schedule
- [ ] **ActivityDetail** — class details, list of registered visitors
- [ ] **AvailabilityToggle** — mark availability/unavailability
- [ ] Push notifications for new bookings

**Result:** Artists see their schedule and manage availability

---

## Priorities and Time

| Stage | Days | What we do | Who |
|-------|------|------------|-----|
| 0 — Preparation (agents) | 1 | Create 8 agents | @manager |
| 1 — Turborepo Infrastructure | 1 | Turborepo + shared packages | @architect |
| 2 — Design System + Layout | 1 | Sidebar, Toolbar, RightPanel | @frontend-coder |
| 3 — P1 Schedule | 3 | Grid, cards, DnD, stamp, modal | @frontend-coder |
| 4 — P2 Booking Management | 2 | Bookings + Client Card | @frontend-coder |
| 5 — Frontend–Backend API | 3 | Connect admin to real API | @frontend-coder |
| 6 — P3 Client Booking Flow | 3 | Client booking flow | @frontend-coder |
| 7 — P4 Artist Schedule | 2 | Artist schedule | @frontend-coder |
| 8 — P5 AI Concierge Chat | 2 | Chat assistant | @frontend-coder |
| 9 — Tests and Polish | 2 | Tests, a11y, build | @tester + @frontend-coder |
| 10 — Web (colourmountains.ru) | 5 | Website + online booking | @frontend-coder |
| 11 — Master App | 3 | Master app | @frontend-coder |

**Total:** ~20-25 days for full release (P1–P5 + Web + Master)

---

## Documents

- **Business Logic:** `docs/business-logic.md` — statuses, payment, booking

---

## Changelog
- 2026-05-30: **Stage 2 marked done.** Added Stage 5 (Frontend–Backend API Integration). Renumbered stages 6–11.
- 2026-05-30: **Backend restructure merged** — `app/` → `src/`, API `/api/v1/`, repositories/ extracted, services renamed.
- 2026-05-19: **Turborepo migration.** Transition from a single `frontend/` to monorepo: `apps/admin/`, `packages/domain/`, `packages/api-client/`. MVP deadline removed, stages 9 (Web) and 10 (Master App) added. Architecture updated: `docs/ARCHITECTURE.md`.
- 2026-05-13: Updated deadlines — MVP May 20, Full release May 31. Added daily schedule for MVP sprint.
- 2026-05-13: Initial PLAN.md created with stages 0-8.
