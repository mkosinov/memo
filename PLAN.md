# Memo Frontend v2 — Work Plan

> Date: 2026-05-30
> **P1 Admin Schedule: ✅ Completed 2026-05-15**
> **P2 Booking Management: ✅ Completed 2026-05-17**
> **NavigationProvider Architecture: ✅ Completed 2026-06-02**
> **Backend Foundation: ✅ Completed 2026-05-28** — FastAPI + clean architecture + 161 tests
> **Backend Issues Batch: ✅ Completed 2026-06-18** — #47 wontfix, #60 channel validation, #61 custom_price migration (branch `fix/backend-issues`)
> **Backend Test Optimization: ✅ Completed 2026-06-18** — pytest suite 30+ min → 1m47s (session-scope fixtures, alembic fast-path, truncate-per-test, xdist, pure_unit marker audit) — branch `fix/optimize-backend-tests`
> **Robustness Bundle: ✅ Completed 2026-06-18** — #53 wontfix, #64 React Query errors, #65 5 e2e fixed + 6 fixme'd (branch `fix/robustness-bundle`)
> **E2E 5-Shard CI Split: ✅ Completed 2026-06-19** — #71 project-based CI matrix, wall time 5m→≤5m (branch `ci/e2e-shard-5-projects`)
> **Reconciliation: ✅ Completed 2026-06-19** — Project board statuses synchronized with reality
> **Testing Strategy v2: ✅ Completed 2026-06-19** — Pre-push gate + User Scenarios + 10 full-flow E2E (branch `feat-testing-strategy-v2`)
> **Wave 4.5 — Fix TS Errors Blocking Pre-Push Hook: ✅ Completed 2026-06-19** — 55→0 TS errors, 11 commits, closes #88 (branch `fix/ts-errors-blocking-hook`)
> **Wave 5 — 14 P1/P3 UX Bugs: ✅ Completed 2026-06-19** — closed #74–#86 (except #73) in `ActivityDetailsModal`, `ClientTab`, `ActivityCard`; 14 commits, 7/7 visual checks passed (branch `fix/wave5-ux-bugs`)
> **Wave 5.1 — 11 QA Hotfixes: ✅ Completed 2026-06-19** — follow-up to Wave 5 (4 commits, 1012+560 tests pass)
> **Stage 5 API Integration: ✅ Completed 2026-05-30** — admin connected to real API
> **Stage 10 (Web): ✅ Completed 2026-05-27** — colourmountains.ru public website (285 tests)

## Deadline (updated 2026-06-19)

| Milestone | Original Date | Current Status |
|-----------|---------------|----------------|
| **Full release** | **June 15, 2026** | ⏳ Overdue — TBD reschedule. Stages 7–9 still in Backlog; open issues #37 (inline filters), #48 (optimistic update) pending. |

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

**Result:** Client can book a master class end-to-end with real backend. Core UX implemented, but project issue #6 remains open for any remaining follow-ups.

---

## Stage 7: P4 — Artist App (Mobile)

> **Status: Backlog, scheduled post-MVP**

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

> **Status: Backlog, scheduled post-MVP**

- [ ] **ChatPage** (`/chat`) — port
- [ ] ChatMessage, ChatInput, QuickActions, ServiceRecommendation, TypingIndicator
- [ ] Keyword-based matching (temporary placeholder)

**Result:** Chat assistant helps choose a service

---

## Stage 9: Tests and Polish

> **Status: Backlog, scheduled post-MVP**

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
| — Backend Issues Batch | 1 | #47 wontfix, #60 channel tolerance, #61 alembic baseline | @backend-coder | ✅ (2026-06-18) |
| — Backend Test Optimization | 1 | pytest suite 30+ min → 1m47s | @tester + @backend-coder | ✅ (2026-06-18) |
| — Robustness Bundle | 2 | Error handling, 5 e2e fixed, 6 fixme'd | @frontend-coder + @debugger | ✅ (2026-06-18) |
| — E2E 5-Shard CI Split | 1 | CI wall time ~5m | @tester + @deployer | ✅ (2026-06-19) |
| — Testing Strategy v2 | 2 | Pre-push gate, User Scenarios, 10 full-flow E2E, smoke CI | @tester + @infra | ✅ (2026-06-19) |
| — Wave 4.5 — Fix TS Errors | 1 | TypeScript errors 55→0 for pre-push hook | @frontend-coder | ✅ (2026-06-19) |
| 7 — P4 Artist App | 4 | Mobile app for artists | @frontend-coder | ⬜ Backlog |
| 8 — P5 AI Concierge | 3 | Chat assistant | @frontend-coder | ⬜ Backlog |
| 9 — Tests and Polish | 3 | Tests, a11y, build, SEO | @tester + @frontend-coder | ⬜ Backlog |

**Open issues before MVP:** #37 (inline column filters + sort), #48 (optimistic update for mutations).

**Total remaining:** Stages 7–9 still pending (~10 days). Deadline overdue — reschedule TBD.

---

## Documents

- **Business Logic:** `docs/business-logic.md` — statuses, payment, booking

---

## Wave 5 — Closed Issues

- **#74** — Modal height unstable across tabs — fixed with `h-[80vh]` + `overflow-y-auto` content area
- **#75** — "+ Добавить посетителя" has no onClick — wired inline form (name + age + tariff)
- **#76** — "Открыть профиль" opens in new tab — replaced with SPA navigation + modal close
- **#77** — Status labels don't match spec — updated to Ожидание/Посетил/Отменил/Неявка
- **#78** — Status control is a `<select>`, spec calls for icon picker — implemented `StatusPicker` component
- **#79** — React Query cache not invalidated after payment delete — added `invalidateRecord()` in handler
- **#80** — New booking form payload mismatch — audited fields, added `data-testid` + `htmlFor` labels
- **#81** — "Неизвестный" placeholder hides identity — replaced with phone-as-label logic + `placeholder="Не указано"`
- **#82** — Visitor row doesn't render `seats` — added Russian pluralisation helper + display
- **#83** — "Приватное" label and switch on one line — stacked vertically with `flex-col`
- **#84** — Backend `occupied` counts records instead of sum of seats — changed to `sum_active_seats` excluding cancelled/no_show
- **#85** — React Query cache not refreshed after new booking — moved create-record flow into `useRecordMutations` hook with full invalidation
- **#86** — Scheduled grid badge (`z-[110]`) appears above modal (`z-50`) — raised modal to `z-[200]`, documented stack order in globals.css

**Total:** 13 issues closed (all P1/P3, #73 already closed), 14 commits, 7/7 Visual Compliance checks passed.

---

## Wave 5.1 — 11 QA Hotfixes: ✅ Completed 2026-06-19

Follow-up fixes from manual testing of Wave 5 (branch `fix/wave5-ux-bugs`, 4 commits). All 1012 backend + 560 frontend tests pass.

### Fixed (11 issues):
- **#75** Visitor rows empty — restored full editor (name/age/tariff inputs + X to remove)
- **#76** /clients/{id} → 404 — open ClientCardModal via `?clientId=` query param
- **#77** Status colors — softer palette (cancelled: #F97316, no_show: #4B5563)
- **#79** Delete lag — `setQueryData` optimistic update + 1 refetch; toast z-index raised above modal
- **#80/#85** New client not in cache — added `['clients']` to invalidateAll
- **#81** Name input not resetting on record switch — useEffect on `[record.id, client?.id]`
- **#82** Seats 5 → 0 — added `anonym_visits: int` field; `seats = len(visits) + anonym_visits`
- **#83** Private toggle alignment — `ml-auto` to right edge
- **#84** Status not persisting — wired `onUpdateRecord` to `patchRecord` mutation; status resets on record switch

---

## Wave 6 — Record Status Derivation & Atom Extraction: ✅ Completed 2026-06-20

**Issues addressed:** #78 (StatusPicker refactor), #79 (record row duplication), #82 (anonym_visits editing), #98 (RecordStatus migration)

**Branch:** `fix/wave6-status-derivation-atom-extraction` (off main @ 4cba62b)

**Total commits:** 36 (28 implementation + 4 review cleanups + 2 spec updates + 2 plan/spec)

**LOC reduction:** −749 LOC (−57%)

### Goal

Migrate `RecordStatus` (pending/confirmed/cancelled/no_show) to derived `VisitStatus` (waiting/visited/missed/cancelled) and extract shared record atoms to `app/components/shared/{records,payments,visitors}/` so that `ClientRecordTab` and `ClientTab` are thin wrappers.

### Phases

- **Phase 0 (Backend):** `VisitStatus` enum + `computeRecordStatus` derivation function in TypeScript (`@memo/domain`) and Python (FastAPI). Schema `extra='forbid'` rejects `status` field with 422. Alembic data migration `4d5e6f7a8b9c` re-maps Wave 5 enum values.
- **Phase 1 (Frontend enum):** Single `VISIT_STATUS_CONFIG` in `app/components/shared/config/` replaces 3 duplicates. `StatusPicker` moved to `shared/` and rebuilt on `CustomSelect`. New `StatusBadge` (read-only) component. `safeStatus()` helper for runtime defensive guards.
- **Phase 2 (8 atoms extracted):** `records/types.ts` (RecordWithDerived), `RecordHeader`, `RecordVisitRow`, `PaymentList`, `PaymentForm`, `PaymentTotals`, `AddVisitorForm`, `VisitorRow` — all in `app/components/shared/{records,payments,visitors}/`.
- **Phase 3 (Wire parents):** `useRecordData` returns derived `status: VisitStatus`. `useRecordMutations` gains `updateAnonymVisits` and `updateVisitStatus`. `ClientRecordTab` 746→329 LOC (−56%). `ClientTab` 559→227 LOC (−59%). Total: 1305→556 LOC (−57%, −749 LOC).
- **Phase 4 (E2E + visual regression):** 4 E2E for User Scenarios 1-4 (`wave6-record-status-derived.spec.ts`), 4 E2E for Scenario 5 (`wave6-status-shared.spec.ts`), 6 visual regression snapshots (`wave6-status-snapshots.spec.ts`). Visual Compliance Gate: 6/6 PASS.

### Test Results

- Backend pytest: 572 passing
- Frontend vitest: 70+ passing
- E2E: 14/14 Wave 6 scenarios passing
- Visual regression: 6/6 snapshots passing

### Closed Issues

- **#78** — StatusPicker refactor → rebuilt on CustomSelect in `shared/` (Phase 1)
- **#79** — Record row duplication → 9 atoms extracted, −749 LOC (Phase 2+3)
- **#82** — anonym_visits editing → `updateAnonymVisits` mutation + inline input in `RecordHeader` (Phase 3)
- **#98** — RecordStatus migration → Alembic data migration re-maps Wave 5 enum (Phase 0)

---

## Changelog
- 2026-07-08: **#105 — Client stats cartesian product fix** — Rewrote `list_clients_with_stats` with scalar subqueries to eliminate cross-relation multiplication. Branch `fix-client-stats-scalar-subqueries`.
- 2026-07-07: **Addendum-2: InlineEditableTable unified rows + hard-delete + deferred undo** — 6 main tasks (backend hard-delete + repo split, frontend Zod schema cleanup, optimistic cache sync, tariff dropdown, deferred delete with undo toast, E2E scenarios 15-19) + FasTP Bug #1 (over-capacity toast). Branch `feat-inline-editable-unified-rows`, 17 commits.
- 2026-06-19: **Wave 5 — 14 P1/P3 UX Bugs** — closed #74–#86 (except #73) in ActivityDetailsModal, ClientTab, ActivityCard; 14 commits, 7/7 visual checks passed (branch `fix/wave5-ux-bugs`).
- 2026-06-19: **Wave 4.5 — Fix TS Errors Blocking Pre-Push Hook** — 55→0 TS errors, 11 commits, closes #88. Deleted 2 dead files, added `maxAge` to `ActivitySchema` + `required` to `TagsFieldConfig`, updated 5 test mock files, type guard + `Array.from` fixes. No suppressions added (branch `fix/ts-errors-blocking-hook`).
- 2026-06-19: **Project board reconciled** — 10 status updates applied (#30-#34, #37, #47, #48, #1).
- 2026-06-19: **Testing Strategy v2** — Pre-push gate, User Scenarios doc, 10 new full-flow E2E (RED), smoke-only CI, CONTRIBUTING.md, PR template (branch `feat-testing-strategy-v2`).
- 2026-06-19: **E2E 5-shard CI split merged** (#72) — wall time ~5m.
- 2026-06-19: **Robustness bundle merged** (#70) — error handling + 5 e2e fixed + 6 fixme'd.
- 2026-06-19: **Backend tests optimized to 1m47s** (#69).
- 2026-06-19: **Backend issues batch merged** (#67, #66) — #47 wontfix, #60 channel tolerance, #61 alembic baseline.
- 2026-06-18: **Backend test optimization completed** — pytest 30+ min → 1m47s (branch `fix/optimize-backend-tests`).
- 2026-06-17: **Photo searchable select merged** (#63) — schedule UI improvements.
- 2026-06-11: **Naming conventions added to domain-rules** (#62).
- 2026-06-05-06: **CRUD pages for Masters, Tags, Photos, Materials + ColumnPicker** (#59).
- 2026-06-05: **Unification refactor** (#58) — shared components, hooks, bug fixes.
- 2026-06-05: **Services & Locations Management** (#57).
- 2026-06-02: **NavigationProvider Architecture** merged — centralized date management.
- 2026-06-01: **Stage 6: Booking Flow E2E** — verified with real backend.
- 2026-05-30: **Plan overhaul.** Architecture `apps/` → `frontend/`. Stage 10 (Web) marked ✅. Stage 7+11 merged into "Artist App". Stage 6 re-scoped to "Booking Flow E2E". Deadline → June 15.
- 2026-05-30: **Stage 5 completed.** API Integration — admin works with real backend.
- 2026-05-30: **Backend restructure merged** — `app/` → `src/`, API `/api/v1/`, repositories/ extracted, services renamed.
- 2026-05-28: **Backend Foundation completed** — FastAPI + clean architecture + 161 tests.
- 2026-05-19: **Turborepo migration.** Transition from a single `frontend/` to monorepo.
- 2026-05-13: Initial PLAN.md created.
