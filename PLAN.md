# Memo Frontend v2 — Work Plan

> Date: 2026-05-30
> **P1 Admin Schedule: ✅ Completed 2026-05-15**
> **P2 Booking Management: ✅ Completed 2026-05-17**
> **NavigationProvider Architecture: ✅ Completed 2026-06-02**
> **Backend Foundation: ✅ Completed 2026-05-28** — FastAPI + clean architecture + 161 tests
> **Stage 5 API Integration: ✅ Completed 2026-05-30** — admin connected to real API
> **Stage 10 (Web): ✅ Completed 2026-05-27** — colourmountains.ru public website (285 tests)

## Deadline (updated 2026-05-30)

| Milestone | Date | Deliverable |
|-----------|------|-------------|
| **Full release** | **June 15, 2026** | All stages complete |

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
├── frontend/
│   ├── admin/          # Admin panel (Next.js 14, App Router) ✅
│   ├── web/            # colourmountains.ru (Next.js 14) ✅
│   └── master/         # Artist mobile app (future)
├── packages/
│   ├── domain/         # Shared TypeScript types + Zod schemas
│   └── api-client/     # Shared HTTP client for FastAPI
├── backend/            # FastAPI (separate service) ✅
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

## Stage 5: Frontend–Backend API Integration ✅

- [x] Design API integration plan (which endpoints, data flow, error handling)
- [x] Update `@memo/api-client` to point to `/api/v1/` endpoints
- [x] Replace mock data in `frontend/admin/` with real API calls
- [x] Add loading, error, empty states to UI components
- [x] Verify end-to-end: frontend loads real data from backend

**Result:** Admin panel works with real backend data. 488 tests passing.

---

## Stage 6: P3 — Booking Flow E2E Verification

Public website (`frontend/web/`) already has the 4-step booking flow. Now:
- [x] Run full E2E — book a class from start to finish with real backend
- [x] Fix/refine UX — polish CalendarLine, BookingOverlay, pricing, validation
- [x] Connect to backend — wire web booking API to FastAPI `/api/v1/records/` endpoints
- [x] Payment flow — verify/simplify payment step
- [x] Error states — handle backend errors gracefully in booking UI
- [x] Visual compliance — verify against design spec

**Result:** Client can book a master class end-to-end with real backend

---

## Stage 7: P4 — Artist App (Mobile)

New `frontend/master/` — Next.js 14, mobile-first.
- [ ] Create `frontend/master/` — Next.js 14 project
- [ ] **Mobile-first** design (card-based, touch-friendly)
- [ ] ArtistSelector (if an artist handles multiple disciplines)
- [ ] **ArtistWeekView** — weekly schedule
- [ ] **ActivityDetail** — class details, list of registered visitors
- [ ] **AvailabilityToggle** — mark availability/unavailability
- [ ] Push notifications for new bookings (basic)

**Result:** Artists see their schedule and manage availability on mobile

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

## Stage 10: Web — colourmountains.ru (P3 Public Site) ✅

- [x] Home page — hero, gallery, services, about the studio
- [x] **Services page** — list of master classes
- [x] **Booking page** (`/booking`) — 4-step flow
- [x] **Contact page** — `/about`, `/locations`
- [x] Integration with `@memo/domain` and `@memo/api-client`
- [x] MKCarousel, CalendarLine, ActivityDetail, BookingOverlay
- [x] 285 tests — all passing
- [ ] SEO: metadata, sitemap, robots (minor — left for Stage 9)

**Result:** Full colourmountains.ru website with online booking. Merged via PR #40.

---

## Priorities and Time

| Stage | Days | What | Who | Status |
|-------|------|------|-----|--------|
| 0 — Preparation (agents) | 1 | Create 8 agents | @manager | ✅ |
| 1 — Turborepo Infrastructure | 1 | Turborepo + shared packages | @architect | ✅ |
| 2 — Design System + Layout | 1 | Sidebar, Toolbar, RightPanel | @frontend-coder | ✅ |
| 3 — P1 Schedule | 3 | Grid, cards, DnD, stamp, modal, carousel | @frontend-coder | ✅ Completed 2026-06-16 |
| 4 — P2 Booking Management | 2 | Bookings + Client Card | @frontend-coder | ✅ |
| 5 — Frontend–Backend API | 3 | Admin connected to real API | @frontend-coder | ✅ |
| 10 — Web (colourmountains.ru) | 5 | Public website + online booking | @frontend-coder | ✅ |
| 6 — P3 Booking Flow E2E | 4 | Verify + polish + backend wiring | @frontend-coder | ✅ |
| 7 — P4 Artist App | 4 | Mobile app for artists | @frontend-coder | ⬜ |
| 8 — P5 AI Concierge | 3 | Chat assistant | @frontend-coder | ⬜ |
| 9 — Tests and Polish | 3 | Tests, a11y, build, SEO | @tester + @frontend-coder | ⬜ |

**Total remaining:** ~14 days → **June 15**

---

## Documents

- **Business Logic:** `docs/business-logic.md` — statuses, payment, booking

---

## Changelog
- 2026-05-30: **Plan overhaul.** Architecture `apps/` → `frontend/`. Stage 10 (Web) marked ✅. Stage 7+11 merged into "Artist App". Stage 6 re-scoped to "Booking Flow E2E". Deadline → June 15.
- 2026-05-30: **Stage 5 completed.** API Integration — admin works with real backend.
- 2026-05-30: **Backend restructure merged** — `app/` → `src/`, API `/api/v1/`, repositories/ extracted, services renamed.
- 2026-05-19: **Turborepo migration.** Transition from a single `frontend/` to monorepo.
- 2026-05-13: Initial PLAN.md created.
