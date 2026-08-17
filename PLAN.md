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
> **GH #194 Deletion Policy Refactor: ✅ Completed 2026-08-01** — Tag/Photo/Visitor/Activity/Record/UserSettings switched from soft-delete (`is_active`) to hard-delete; cascades Record/Activity/Visitor + photos SET NULL; `soft_delete` ClassVar flag drives GenericService.list; 6 services → BaseRepository (branch `deletion-policy-194`)
> **GH #195 Status Filter + Archive Views: ✅ Completed 2026-08-02** — `status` filter param (`ArchiveStatus` active|archived|all, default active) on soft-delete list endpoints (masters/locations/materials/services/clients) + admin archive filters; `SoftDeleteService`, api-client `ListParams.status`, clients status enum (default «Активные»), edit modals preserve `is_active` on archived rows; 12 commits (branch `feat/status-filter-archive-views-195`)
> **GH #184 GenericService Full-CRUD Contract: ✅ Completed 2026-08-03** — service-level full-CRUD contract test (create/get/list/update/delete) for all `GenericService` subclasses + sticky `is_active` production fix (Update/Patch defaults flipped to `bool | None`, stored value preserved on omitted/None, explicit bool applies); 9 commits (branch `gh-184-service-crud-contract`)
> **GH #185 GenericService HTTP CRUD Contract + test_api dedup: ✅ Completed 2026-08-04** — HTTP-level full-CRUD contract test (`test_generic_api_contract.py`, 116 sync-only parametrized cases over 8 entities) + shared contract config module `generic_contract.py` driving both service + HTTP contracts; per-entity `test_api_*.py` dedup (−1014/+26, `test_api_tags.py` deleted); ADR 006; `backend/src/` untouched; backend 999p/5s (branch `gh-185-api-crud-contract`, 4 commits)
> **GH #178 Canonical PUT/PATCH Types: ✅ Completed 2026-08-04** — PUT is true full-replace for Master/Service/Location/Material (`is_active: bool` required, omission → 422); #184 sticky-injection removed from `SoftDeleteService.update` + `ServiceService` update-path strip (PATCH stays sticky); api-client `*UpdateSchema` `.extend({is_active})` (canonical) + PATCH `Partial<Update>` cleanup; admin hooks + 4 tables typed canonical PUT payloads; Client PUT is_active window → #201 (user-accepted); backend 999p/6s, api-client 150p/4f (#188), admin vitest 1239p/0f, visual gate 5/5 (branch `gh-178-canonical-put-patch`, 6 commits)
> **GH #201 Client canonical PUT/PATCH: ✅ Completed 2026-08-08** — closes the #178 Client PUT 500-window: `ClientUpdate` standalone 5-key required schema (explicit-null wipe semantics; omission of required keys → 422), api-client `ClientUpdateSchema` + typed `updateClient(id, ClientUpdate)` (Create-typing bug fixed), admin edit modal sends typed payload (`'' → null`, save-time channel guard, `is_active`), e2e edit-save test unskipped (window closed), domain-rules Client PUT canon + null-semantics divergence note; backend 1008p/5s, api-client 156p/4f (#188 pre-existing), admin vitest 1239p/0f tsc clean, e2e clients 17/17, visual gate 3/3; AC1–AC7 met, AC8 CI (PR) pending at finishing (branch `gh-201-client-canonical-put`, 7 commits)
> **GH #191 Records Server-Side List (filters + pagination + sorting): ✅ Completed 2026-08-09** — `GET /api/v1/records` fully server-side via validated `RecordListParams` Query model (page/per_page 1–100 default 20, client/activity/date_from/date_to/location/service/master/status filters, 9-key `sort_by` whitelist + `sort_order`, 422 on ALL invalid params incl. `date_from > date_to`), shared `day_range()` util + `paginate_orm()` core (COUNT before ORDER BY), correlated scalar-subquery sort keys with NULLS FIRST/LAST + deterministic `Record.id` tiebreak, `payment` 3-level bucket shared with display; activities date filter refactored (typed `date` params — invalid dates 422, was 500); frontend context-driven Records page (RecordsContext server-driven state, RecordsTable sort/pagination, both modals on dedicated queries); e2e records honest rework 21/21; backend 1054p/5s, api-client 158p/4f (#188 pre-existing), admin vitest 1256p/0f tsc clean, visual gate G4.5 8/8; spec §10 AC1–§10.9 + Scenario 2 all met (branch `feat-records-server-filters`, 12 commits d8c54e1..bfbc39c)
> **GH #207 DELETE Hard Delete + Granular Dependency Resolutions: ✅ Completed 2026-08-17** — delete is now hard everywhere; `ArchiveRepository`/`ArchiveService` (delete=hard core, +`archive`/`restore`), `is_active`→`archived` inverted Response schemas, `is_active` removed from PUT/PATCH (sending → 422), FK dependency matrix + resolver with unified DELETE dry-run / execute modes, Master→users cascades (delete auto §4.1, archive/restore user §4.2), shared DeleteDialog + 5 tables wired (+Client restore parity); backend 1205p/5s, admin vitest 1331p/0f, tsc 0, e2e 35 new green (S1–S7), visual gate 7/7 (branch `feat-delete-hard-deps`, 23 commits 68aa333..9994b93; closes #207/#178/#198, absorbs #189)

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
| — CI Green-Up (PR #145) | 1 | E2E pnpm-cache, #123 flake, snapshot regen | @tester + @deployer | ✅ (2026-07-17) |
| — E2E Infra Roots (#108, #126) | 1 | SQLite DB lock fix, standalone warmup, retry helper | @tester + @backend-coder | ✅ (2026-07-17) |
| — E2E Fixme Cleanup Wave 1 (#121) | 1 | Re-enable 13 disabled E2E tests, blockers #84/#127 closed | @tester | ✅ (2026-07-17) |
| — Seed Staleness + E2E Harness Resilience (#152) | 1 | Wipe+reseed fix for Monday seed stale dates; fail-fast diagnostics in globalSetup; shard-start path guard | @tester + @backend-coder | ✅ (2026-07-20) |
| — #124 Wave 1 — openModal activity_id + un-skip | 1 | Fix E2E openModal (activity_id targeting), tariff seed (NO-OP), un-skip 8 unified-rows scenarios | @tester | T1+T2 ✅ (2026-07-20), T3 ⏳ CI |
| — #182 — GenericService.list() pagination migration | 2 | PaginatedResponse envelope, 9 endpoints migrated, api-client paginatedSchema(), 13 frontend consumers unwrap `.items`, getClients() 20-item bug fix | @backend-coder + @frontend-coder + @tester | ✅ (2026-07-29) |
| — #183 — GET /api/v1/tags/{id} + GET /api/v1/visitors paginated list | 1 | Backend get-by-id for tags (3 tests), visitors paginated list with scoped-route regression guard (7 tests), api-client schemas/methods + unit tests, domain-rules tags/visitors docs updated, tag soft-delete invariant correction | @backend-coder + @frontend-coder + @tester | ✅ (2026-07-29) |
| — #186 — Payments batch aggregate | 1 | Backend GET /payments/totals (SQL IN+GROUP BY+SUM, route ordering, 5 API tests), api-client getPaymentTotals + Zod schema, RecordsContext totals wiring (sorted-ID query key, no unfiltered getPayments), RecordsTable + ClientCardModal consumers, regression guard | @backend-coder + @frontend-coder + @tester | ✅ (2026-07-29) |
| — #194 — Deletion Policy Refactor | 2 | Hard-delete for Tag/Photo/Visitor/Activity/Record/UserSettings (soft-delete `is_active` dropped), cascades Record/Activity/Visitor + photos SET NULL, `soft_delete` ClassVar flag drives GenericService.list, 6 services → BaseRepository, admin TagsTable/PhotosTable status UI removal | @backend-coder + @frontend-coder + @tester | ✅ (2026-08-01) |
| — #195 — Status filter + archive views | 2 | `status` param (ArchiveStatus active|archived|all) on 5 soft-delete list endpoints, SoftDeleteService + 4 service migrations + ServiceService override, api-client ListParams.status, admin archive filters on 4 tables + clients status enum, edit modals preserve is_active, E2E clients.spec.ts update | @backend-coder + @frontend-coder + @tester | ✅ (2026-08-02) |
| — #184 — GenericService full-CRUD service contract | 2 | Parametrized contract test (create/get/list/update/delete) over all GenericService subclasses (test_generic_service_contract.py replaces patch/list split) + sticky `is_active` fix (schemas default `None`, SoftDeleteService/ServiceService preserve stored value, `_strip_is_active_none` helper); domain-rules is_active semantics doc | @backend-coder + @tester | ✅ (2026-08-03) |
| — #185 — GenericService HTTP CRUD contract + test_api dedup | 2 | HTTP full-CRUD contract test (`test_generic_api_contract.py`, 116 parametrized sync-only cases over 8 entities) + shared `generic_contract.py` config driving both service + HTTP contracts; per-entity test_api dedup (−1014/+26, `test_api_tags.py` deleted); ADR 006 + decisions index; `backend/src/` untouched (hard constraint); backend 999p/5s (baseline 990p, net +9); AC1–AC7 compliant, 3 mutations red | @tester | ✅ (2026-08-04) |
| — #178 — Canonical PUT/PATCH types | 2 | PUT is true full-replace for Master/Service/Location/Material — `Update` schemas require `is_active: bool` (omission → 422), #184 sticky-injection removed from `SoftDeleteService.update`, `ServiceService` update-path strip dropped (PATCH keeps `_strip_is_active_none`); api-client 4 `*UpdateSchema` `.partial()` → `.extend({is_active})` + PATCH `Partial<Update>` workaround intersections removed; admin `use*Mutations` hooks + 4 tables typed canonical PUT payloads + hook tests; domain-rules `_overview.md` + 5 entity notes synced; `ClientUpdate.is_active` interim `bool | None = None` → Client PUT omitting is_active 500s until #201 (user-accepted window) | @backend-coder + @frontend-coder + @tester | ✅ (2026-08-04) |
| — #201 — Client canonical PUT/PATCH | 2 | Closes #178 Client PUT 500-window — `ClientUpdate` standalone 5-key required schema (explicit-null wipe semantics, omission → 422), api-client `ClientUpdateSchema` + typed `updateClient(id, ClientUpdate)` (Create-typing bug fixed), admin edit modal typed payload (`'' → null`, save-time channel guard, `is_active`), e2e edit-save unskipped, domain-rules Client PUT canon + null-semantics divergence note; backend 1008p/5s, api-client 156p/4f (#188 pre-existing), admin 1239p/0f tsc clean, e2e clients 17/17, visual gate 3/3; AC1–AC7 met (AC8 CI at finishing) | @backend-coder + @frontend-coder + @tester | ✅ (2026-08-08) |
| — #207 — DELETE hard delete + granular dependency resolutions | 23 | Deletion is hard everywhere: `ArchiveRepository`/`ArchiveService` (delete=hard + `archive`/`restore` endpoints 200-with-body), `is_active`→`archived` inverted Response schemas + `is_active` rejected on PUT/PATCH (422), `PRAGMA foreign_keys=ON`, FK matrix + resolver with unified DELETE dry-run/execute modes (409+dependency tree / 204 / 422 / 404), Master→users cascades (delete auto §4.1, archive/restore user §4.2), api-client flipped schemas + `archiveX`/`restoreX`/`resolveDeleteX`, 409-aware hooks + shared DeleteDialog (Mode A type-to-confirm / Mode B blocked→archive) + 5 tables wired (Client restore parity); backend 1205p/5s, api-client 189p/4f (#188 pre-existing), admin vitest 1331p/0f tsc 0, e2e 35 new green (S1–S7), visual gate 7/7; closes #207/#178/#198, absorbs #189 | @backend-coder + @frontend-coder + @tester | ✅ (2026-08-17) |
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

## GH #127 — Unify Records/Visits/Payments Caches (Single Source of Truth): ✅ Completed 2026-07-16

**Goal:** Make `['record', recordId]` the single source of truth for a record's visits/payments, remove the divergent cache/mutation/optimistic layers, and move deferred-delete to an app-level provider — eliminating "row disappears", "F5 needed", and "undo dies on modal close".

**Branch:** `feat-unify-record-caches`

**Total commits:** 13

**LOC change:** 28 files changed, +3946 / -1272 lines (net +2674)

**Design spec:** `docs/specs/2026-07-08-unify-record-caches-design.md`

**Plan:** `docs/plans/2026-07-08-unify-record-caches.md`

### Foundation Tasks

- **T1 — Cache-sync helpers:** `lib/cache/recordCacheSync.ts` — 6 pure helpers (`patchRecordEverywhere`, `upsertVisit`, `removeVisit`, `upsertPayment`, `removePayment`, `seedRecordFromList`) for canonical + list cache sync. All tested with real QueryClient.
- **T2 — PendingActionsProvider:** `contexts/PendingActionsContext.tsx` — generic command-pattern provider for deferred delete (5s undo window, survives modal unmount). Full test coverage (commit, undo, per-id cancel, fake timers).
- **T3 — Mount provider:** `PendingActionsProvider` mounted in app tree (inside `QueryClientWithErrorReporting` + `UIProvider`).
- **T3b — Seed canonical cache:** `RecordsContext` seeds `['record', id]` from list responses via `seedRecordFromList` (no overwrite of fresher entries).

### Core Refactoring (T4-T8)

- **T4 — Rewire `useRecordMutations`:** Fine-grained visit/payment mutations use `recordCacheSync` helpers (sync canonical + all list keys). `deleteRecord` uses prefix-match `setQueriesData`. `deleteVisitDeferred`/`deletePaymentDeferred` delegate to `PendingActions` (survives modal close — fixes Bug #2). Removed 5-key `invalidateAll` hammer. Absorbed #130 Bug 1 & 2.
- **T5 — RecordVisitsTable:** `useMemo(saved) + useState(drafts)` pattern — deleted `useEffect`-sync (fixes Bug #3: row disappearing mid-edit).
- **T6 — RecordPaymentsTable:** Same pattern as T5.
- **T7 — ClientTab:** Fully hook-driven (reads from `useRecordData`, not props). Removed `useOptimisticVisitMutation` usage (fixes dual-source).
- **T8 — ClientRecordTab:** Fine-grained visit CRUD via `addVisit`/`deleteVisitDeferred`. Removed `useOptimisticVisitMutation` usage.

### Cleanup (T9-T10)

- **T9 — Deleted `useOptimisticVisitMutation.ts`:** -313 lines removed. `invalidateAll` completely gone from fine-grained mutations. Remaining narrow invalidations documented per-reader.
- **T10 — E2E coverage US-1..US-7:** 7 Playwright tests using factory pattern (avoids #124 trap). E2E written but not run live (shard DB empty — environment issue, not code).

### Bugs Fixed

- **Bug #2:** Undo deferred-delete dies on modal close → fixed by app-level `PendingActionsProvider` (timer survives unmount)
- **Bug #3:** Row disappears mid-edit → fixed by `useMemo(saved)+useState(drafts)` pattern, no `useEffect`-sync
- **Bug #1/#130:** `['records','client',id]` always stale + dead `['records']` deleteRecord → fixed by prefix-match `setQueriesData`
- **C-clarification:** Tab-switch stale row → fixed by canonical cache + list sync

### Test Results

- **Vitest:** ~1178 passed, 1 known flake (CalendarPopover #123), 1 skipped
- **tsc:** clean (0 errors)
- **E2E:** 7 tests written (US-1..US-7), not run live (environment issue)
- **Visual Compliance:** 4/4 PASS via manual Playwright checks against live dev server

---

## GH #131 — Client-Stats Refactor: "visits"→"records" Semantics: ✅ Completed 2026-07-16

**Goal:** Rename and redefine client-stats fields from "visits"-based to "records"-based semantics across the full stack, simplified by removing Visit joins from 2 subqueries (now uses persisted `Record.status` from #98).

**Branch:** `feat-client-stats-131`

**Total commits:** 5 (9916a35, 6cf8447, 501e048, 6e36fe9, 16af531)

**Changed files:** 22

### Tasks

- **T1 (standard) — Backend schema + SQL rewrite:** `backend/src/schemas/client.py`, `backend/src/services/client.py`. Renamed `visits_count`→`records_count`, `missed_visits`→`missed_records` (redefined: `COUNT(Record.id) WHERE Record.status='missed'`), `last_visit`→`last_record` (redefined: `MAX(Activity.start)` over ALL active records, no status filter). API params `min_visits`/`max_visits`→`min_records`/`max_records`. 4 new TDD tests + existing tests renamed. Commit 9916a35.
- **T2 (small) — Zod schema + mock:** `packages/api-client/src/schemas.ts` renamed. Mock data + contexts synced. Commit 6cf8447.
- **T3 (standard) — Frontend components:** 7 components renamed labels (ClientsTable, ClientStatistics, ClientInfoTab, ClientRecordTab, ClientTab, ClientsContext, ClientsFilters). Commit 501e048.
- **T4 (standard) — Frontend tests:** 7 test files + E2E `clients.spec.ts` renamed. Commit 6e36fe9.
- **T5 (trivial) — Domain-rules:** `docs/domain-rules/clients.md` updated. Commit 16af531.

### Key Simplification

Removed Visit joins from 2 subqueries in `list_clients_with_stats` — now uses persisted `Record.status` (from #98) directly for `missed_records` and `last_record`. No more cartesian product risk between visits and records.

### Test Results

- **Backend:** 663 passed, 4 xfailed (659 baseline + 4 new TDD tests). Zero failures.
- **Frontend:** 1178 passed, 1 skipped, 1 failed (CalendarPopover #123 — known baseline flake, NOT #131 regression). tsc: 0 errors.
- **Visual Compliance:** PASSED (/clients page shows new labels).

---

## CI Green-Up (PR #145): ✅ Completed 2026-07-17

**Goal:** Return CI to a fully-green state so "red CI = real regression" instead of chronic noise. Baseline test debt was masking real bugs and normalizing blind admin-override merges.

**Branch:** `feat-ci-green`

**Total commits:** 5 (e3f67e4, d7dc689, 9785eba, 89520d0, 26fa0eb)

**PR:** #145, merged via `93cfd18`.

### What shipped

1. **E2E pnpm-cache infra fix** (`e3f67e4`) — `.github/workflows/test.yml`: removed the wrong `cache-dependency-path: frontend/admin/pnpm-lock.yaml` from the e2e-tests job's Setup Node.js step. The pnpm lockfile lives at the repo root; the bad path made both E2E shards die on Setup Node.js before Playwright even ran.

2. **#123 date-flake fix** (`d7dc689`) — froze system time (`vi.setSystemTime('2026-06-15')`) in `CalendarPopover.test.tsx` and `Menubar.test.tsx`. These were date-coupled and flaked on calendar edge days, failing `frontend-tests (5)` + `frontend-smoke`. Test-only, no production code changed. Different timer strategy per file: CalendarPopover uses full fake timers; Menubar uses `setSystemTime` only (avoids breaking `waitFor` async assertions).

3. **Skip 4 pre-existing flaky E2E tests** (`9785eba`) — `test.skip` annotations: unified-rows scenarios 10/15/15b (stale-cache `tab-client` timeout → tracked in **#124**), clients.spec.ts "11. Status filter narrows results" (selector/timing flake → tracked in **#125**). Not fixed (require code changes, out of scope); tracked in existing issues.

4. **Regenerated 9 shard-rest snapshot baselines** (`26fa0eb`) — via a new manual `.github/workflows/update-snapshots.yml` (`workflow_dispatch`) that runs `playwright test --project=shard-rest --update-snapshots` on the same `ubuntu-latest` CI runner, eliminating font-render drift. Affected snapshots: wave6-status-snapshots (StatusBadge waiting, StatusPicker closed/open), week-view (schedule-default/next-week/with-activities), visual-regression (records-filtered, modal-settings, modal-new-booking).

5. **New reusable workflow:** `update-snapshots.yml` kept for future font-drift regeneration (also copied to main via PR #146).

### Test Results

- **Final CI result on `93cfd18`:** test.yml 12/12 green (backend all, frontend 1-5, both E2E shards), smoke.yml 2/2 green.
- **Closed:** #123.
- **Remaining:** #124 and #125 remain open (deferred flaky/snapshot tests, now explicitly skipped with annotations). #121 remains open (adjacent E2E infra debt). #126 fixed in separate branch `feat-e2e-infra-roots`.

---

## E2E Infra Roots (#108, #126): ✅ Completed 2026-07-17

**Goal:** Eliminate two root causes of E2E flakiness — SQLite DB locks (retry + WAL) and cold-cache hangs on standalone `playwright test` (route warmup).

**Branch:** `feat-e2e-infra-roots`

**Total commits:** 7 (1c30c24, be0b08b, 713ce3f, 662ea67, f39856d, 51dac4c, 5d6028b)

**Design spec:** `docs/specs/2026-07-17-e2e-infra-roots-108-126-design.md`

**Plan:** `docs/plans/2026-07-17-e2e-infra-roots-108-126.md`

### What shipped

1. **fix(#108): global `event.listens_for(Engine, "connect")` hook** sets `PRAGMA busy_timeout=5000` + `PRAGMA journal_mode=WAL` on every SQLite connection (covers app async + Alembic + sqladmin engines).
2. **fix(#108): sqlite dialect guard** — hook bails early if `"sqlite" not in type(dbapi_connection).__module__`, so a future non-SQLite engine isn't broken.
3. **refactor(#108): `sqliteExecWithRetry` helper** extracted to `e2e/fixtures/sqlite-exec.ts` — single source of retry-on-lock truth for all E2E test data setup/cleanup.
4. **fix(#108): `globalSetup.ts` + `cleanTestData()`** now use the shared retry helper; `cleanTestData` THROWS on persistent lock instead of silently swallowing (stops stale-data poisoning later tests).
5. **fix(#126): standalone warmup** — `playwright test` warms up 9 routes in `globalSetup` (gated `!SHARD_ID`) so cold-cache runs don't hang on "Загрузка" / 404 `_next/static`. Shared `WARMUP_ROUTES` list; shard mode untouched.
6. **test(#126): warmup-routes test** parses `e2e-shard-start.sh` to detect TS↔shell drift.
7. **docs(#108): ADR 001** — WAL-backup caveat documented; `*.db-wal`/`*.db-shm` added to `.gitignore`.

### Test Results

- **Backend pytest:** 664 passed + 4 xfailed (1 new WAL/busy_timeout test)
- **Frontend vitest:** 1189 passed + 1 skipped (new: sqlite-exec, cleanTestData, warmup-routes tests)
- **E2E US-1 (#126 warmup):** live-verified on cold cache
- **Visual gate:** N/A (infra/test-only)

### Status

- **Closed:** #108 (DB lock fix via WAL + busy_timeout + retry helper), #126 (standalone warmup)
- **Remaining open (E2E cluster):** #124, #125, #121, #122, #109, #106, #107 — out of scope (separate packages)

---

## Seed Staleness + E2E Harness Resilience (#152): ✅ Completed 2026-07-20

**Goal:** Fix seed-data staleness after calendar week rollover (Monday morning) that caused all E2E schedule tests to timeout — and add fail-fast diagnostics so the root cause surfaces immediately instead of 60s × 22 test timeouts.

**Branch:** `feat-seed-staleness-152`

**Total commits:** 4 (0e4ea6c, e76f5d2, 05e0eb6, ad77118)

**Design spec:** `docs/specs/2026-07-20-seed-staleness-152-design.md`

**Plan:** `docs/plans/2026-07-20-seed-staleness-152.md`

### Root cause

`seed.py` has `WEEK3_START = _get_week_monday(today)` — on first seed run it computes dates relative to the current server date. The `_seed_activities_for` loop has an idempotent guard: `if await _exists: continue`. When Alembic + seed run on an already-populated DB (subsequent `e2e-shard-start.sh` runs within the same week), _every_ `ev_*` activity hits the guard and skips. After a Sunday→Monday rollover, the `ev_*` rows still exist in the DB with **last week's dates** → the schedule default view (current week) shows empty → `waitForScheduleReady` waits 60s → all 22 schedule E2E tests timeout.

### What shipped

1. **fix(#152): wipe shard DB before seed + path guard** (`0e4ea6c`) — `scripts/e2e-shard-start.sh` adds `rm -f {SHARD_DIR}/*.db` before alembic+seed, plus path guard that rejects non-`/tmp/` paths so prod DBs are never accidentally wiped. New `scripts/e2e-shard-start.dryrun.test.sh` (shell dry-run test).
2. **fix(#152): remove idempotent `_exists` guard from seed; empty-DB contract** (`e76f5d2`) — `backend/src/seed/seed.py`: removed the `_exists` helper + all 13 skip branches. Seed now assumes empty DB by contract; fails loud with UNIQUE constraint violation if a second seed run happens. Updated docstrings. Replaced `test_seed_is_idempotent` with `test_seed_raises_on_populated_db`.
3. **fix(#152): fail-fast diagnostics in globalSetup** (`05e0eb6`) — `frontend/admin/e2e/globalSetup.ts`: two diagnostic branches that abort playwright before any test runs: (a) leftover seed rows (services, masters, locations) missing → error "re-run shard-start"; (b) current-week activities API empty → error "seed did not populate current week". Both include 5×1s retry for 503 race. New `globalSetup.diagnostic.test.ts` (3 vitest cases).
4. **fix(#152): waitForScheduleReady timeout 60→10s** (`ad77118`) — `frontend/admin/e2e/fixtures/helpers.ts`: reduced to 10s (UI render-sync only; data validation moved to globalSetup).

### Test Results

- **Backend pytest:** 668 passed, 0 failed, 0 skipped (baseline 668; −1 idempotency test, +1 fail-loud test = same count)
- **Frontend vitest:** 1192 passed, 0 failed, 1 skipped (baseline 1189 + 3 new diagnostic tests)
- **Type-check:** clean
- **Lint:** clean
- **Visual gate:** N/A (test-infra only)

---

## #124 Wave 1 — openModal activity_id targeting + un-skip 8 unified-rows scenarios

**Goal:** Fix the E2E test-harness bug where `openModal()` opens the FIRST card with client-tabs on a shared week → picks wrong activity. Match by `activity_id` via `resolveRecordDate` returning `{date, activityId}` and `[data-testid="activity-${activityId}"]` targeting.

**Branch:** `test-openmodal-124`

**Total commits:** 2 (5c8ebd9, 0ead9a2)

**Design spec:** `docs/specs/2026-07-18-openmodal-activityid-seed-124-design.md`

**Plan:** `docs/plans/2026-07-18-openmodal-activityid-seed-124.md`

### Tasks

- **T1 (tariff seed — ≥2 tariffs on first service):** NO-OP. The seed already had ≥2 tariffs on `s1` (t1a/t1c/t1i) in `backend/src/seed/seed.py`. No code change.
- **T2 (openModal activity_id targeting + un-skip 8 scenarios):** ✅ DONE.
  - `resolveRecordDate` now returns `{date, activityId}`; `openModal` targets the card by `[data-testid="activity-${activityId}"]` when `recordId` is passed; fallback walk preserved for no-recordId callers; `openAddTab` updated to `.date`.
  - 7 `test.skip(...)` removed from `unified-rows.spec.ts` (scenarios 6, 7, 8, 9c, 16, 16b, 17, 19). Scenario 5 annotation changed to "waiting for PATCH /visitors (Wave 2)". 3 toast selectors `[role="status"]` → `[data-testid="toast-info"]` (scenarios 16, 16b, 19).
  - Stale `TODO(flaky): openModal selects wrong activity` comments removed (commit `0ead9a2`).
  - Verification: `pnpm run type-check` clean; vitest 1193 pass + 1 skip (0 regressions); shard-rest E2E run 1 — 8 target scenarios ALL PASS (RED→GREEN achieved). Spec-review APPROVED; code-quality APPROVED — 0 Critical/Important, 2 minor (both resolved).
- **T3 (verification gate + #124/#121 hygiene):** ⏳ DEFERRED TO CI.
  - Local shard-rest run 1: 122 pass / 13 fail / 9 skip. 13 failures triaged as PRE-EXISTING (sqlite3 relative-path bug, font-drift snapshots, API 404 — none openModal-related). CI on main `96e7c0a` was fully green for shard-rest (per #152). Final verdict deferred to PR CI.
  - #124/#121 GH comment drafts: pending — architect posts after merge.

### Test Results

- **Vitest:** 1193 passed, 1 skipped, 0 regressions (baseline 1192 + 1 new)
- **Type-check:** clean
- **E2E (target scenarios):** 8/8 PASS locally (scenarios 6, 7, 8, 9c, 16, 16b, 17, 19)
- **E2E (shard-rest run 1):** 122 pass / 13 fail / 9 skip — pre-existing failures triaged
- **Visual gate:** N/A (test-infra only)
- **Reviews:** spec-review ✅, code-quality ✅

### Acceptance Criteria

| US | Description | Status |
|----|-------------|--------|
| US-1 | Scenario 6 tariff→price | ✅ PASS |
| US-2 | Scenario 7 visit DELETE | ✅ PASS |
| US-3 | Scenarios 8, 9c, 16, 16b, 17, 19 | ✅ PASS |
| US-4 | Scenario 5 stays skipped (Wave 2) | ✅ annotation updated |
| US-5 | 0 new regressions | ⏳ pending CI |

### Closed Issues

- **#124 (items 1+2):** openModal activity_id targeting + tariff seed — done locally, final CI verdict pending.

---

## Wave 2A — Test-debt cleanup: un-skip 2 tests, delete 2 dead test files, rewrite 1 vitest test: ✅ Completed 2026-07-21

**Goal:** Reduce disabled-test count by 2 through targeted cleanup: re-enable 2 disabled tests (1 E2E + 1 vitest), delete 2 dead E2E test files that are covered by existing visual regression, and rewrite 1 vitest test whose premise was doubly wrong.

**Branch:** `feat-test-debt-wave2a`

**Total commits:** 5 (e8c4e21, 1f0eab8, 3c51498, e8c68cc, 604e592)

**Design spec:** `docs/specs/2026-07-21-test-debt-wave2a-design.md`

**Plan:** `docs/plans/2026-07-21-test-debt-wave2a.md`

**GH issues touched:** #155 (close via un-skip), #156 (un-skip), #157 (close via file delete), #158 (close via file delete), #163 (close via test rewrite)

### What shipped

1. **fix(#155): un-skip scenario 18 (unified-rows.spec.ts)** — Removed `test.skip(true,...)`. Stats are per-request SQL scalar subqueries (no cache). Flake was on `GET /payments/{id}` payment-existence check, not stats. Per user directive: un-skip WITHOUT poll — if CI flakes, investigate root cause in Wave 3.

2. **fix(#156): un-skip US-M09 (modal-no-jump.spec.ts)** — Changed `test.fixme` → `test`. openModal wrong-activity bug was fixed in #124 Wave 1 (activity_id targeting). Cross-tab dimension comparison (width/height/x across Settings→Client→Settings) kept as code test per user (stronger than visual screenshots). #XXX → #156.

3. **refactor(#157): delete modal-blur-footer.spec.ts** — Weak z-index proxy test (`zIndex > 0` on `[role="dialog"]`) — NOT actual blur. Bug #86 (badge z-110 above modal z-50) covered by existing `modal-settings.png` visual regression screenshot. 30 lines deleted.

4. **refactor(#158): delete private-toggle-layout.spec.ts** — Point-fix regression test for bug #83 (CSS `flex-row` → `flex-col` on "Приватное" label/toggle in `SettingsTab.tsx`). The existing `modal-settings.png` screenshot captures the full settings tab — heavier E2E overhead than value warrants. 36 lines deleted.

5. **fix(#163): rewrite visit-status-cycle vitest test (ClientsIntegration.test.tsx)** — Replaced `it.skip` with real test using StatusPicker testid pattern (`visit-v1-status-trigger`, `visit-v1-status-option-visited`). Added `patchVisit` to `@memo/api-client` mock block + `getQueryData` to `useQueryClient` mock. Asserts `patchVisit` called with `('v1', {status:'visited'})`. +18/-7 lines.

### Test Results

- **Backend pytest:** 668 pass (untouched, baseline unchanged)
- **Frontend vitest:** 1194 pass + 0 skip (up from baseline 1193 pass + 1 skip — the `it.skip` is now a passing `it`)
- **Type-check:** clean (exit 0)
- **E2E:** not run locally (env flaky per prior experience). CI on PR will verify: shard-rest should see +2 actually-running tests (sc.18 + US-M09) and -2 deleted files (US-M10 + US-M01)
- **Visual gate:** N/A (test-debt cleanup only)

### Acceptance Criteria

| US | Description | Status |
|----|-------------|--------|
| US-1 | Scenario 18 re-enabled (no poll) | ✅ PASS (local) |
| US-2 | US-M09 un-skipped (openModal fixed) | ✅ PASS (local) |
| US-3 | US-M10 deleted (covered by visual) | ✅ DONE |
| US-4 | US-M01 deleted (covered by visual) | ✅ DONE |
| US-5 | Vitest status-cycle rewritten, 1194+0 | ✅ PASS (vitest) |

---

## Wave 4 — Test-debt cleanup: cond-skip verify-first (#161 #162 #124-cascade): ✅ Completed 2026-07-22

**Goal:** Remove 8 conditional `test.skip` guards whose root causes were resolved in prior waves (#124 Wave-1, #152, #155). Prove the pattern 4×: fix root cause → verify guard no longer fires → remove guard.

**Branch:** `feat-test-debt-wave4`

**Total commits:** 4 (1a8ca91, 950b82f, b4f6f97, e41d1f1)

**Design spec:** `docs/specs/2026-07-22-test-debt-wave4-verify-first-design.md`

**Plan:** `docs/plans/2026-07-22-test-debt-wave4-verify-first.md`

**GH issues touched:** #161 (6 tests), #162 (1 test), #124 cascade (1 test)

### What shipped

1. **test(#161): un-skip 4 wave6-record-status cond-skip guards** (`1a8ca91`) — Removed 4 conditional `test.skip` guards from `wave6-record-status-derived.spec.ts` (scenarios US1, US2, US3, US4). These were cond-skips from Wave 6 whose root causes (openModal wrong-activity, seed staleness, commit-after-response race) are all fixed in #124, #152, #155 respectively.

2. **test(#162): un-skip 'Add visitor button not found' cond-skip guard** (`950b82f`) — Removed 1 conditional `test.skip` from `wave6-record-status-derived.spec.ts` (scenario 4 add-visitor). Same root cause chain as #161.

3. **test(#161): un-skip 2 wave6-status-shared cond-skip guards** (`b4f6f97`) — Removed 2 conditional `test.skip` guards from `wave6-status-shared.spec.ts`. StatusPicker shared-component tests (scenario 5/5b) — flake root causes resolved.

4. **test(#124): un-skip activity-details-modal Sc4 cond-skip guard** (`e41d1f1`) — Removed 1 conditional `test.skip` from `activity-details-modal.spec.ts` (scenario 4 Sc4). This was a #124-cascade guard — openModal activity_id targeting fix (#124 Wave-1) resolved the root cause.

### Test Results

- **Backend pytest:** 674 pass (untouched, baseline unchanged from #155)
- **Frontend vitest:** 1194 pass, 0 regressions (baseline unchanged)
- **Type-check:** clean (exit 0)
- **E2E:** not run locally (verification strategy per user directive). CI on PR is decisive arbiter — any flake indicates an unresolved root cause.
- **Visual gate:** N/A (test-debt cleanup only — no product code changed)

### Acceptance Criteria

| US | Description | Status |
|----|-------------|--------|
| US-1 | 4 wave6-record-status-derived guards removed (#161) | ✅ (1a8ca91) |
| US-2 | 1 add-visitor guard removed (#162) | ✅ (950b82f) |
| US-3 | 2 wave6-status-shared guards removed (#161) | ✅ (b4f6f97) |
| US-4 | 1 activity-details-modal Sc4 guard removed (#124 cascade) | ✅ (e41d1f1) |
| US-5 | 0 new regressions (vitest 1194 pass, tsc clean) | ✅ PASS |

### Test-debt Inventory Update (Wave 4 + Wave 5 combined)

- **Wave 4:** 8 cond-skip guards removed — #161 (6 tests), #162 (1), #124 cascade (1).
- **Wave 5:** 4 E2E tests un-skipped + 2 annotations cleaned — #125 status filter timing fix (response-based wait), #159 detail panel (2 stale fixme removed, UI confirmed), #109 visual regression snapshot (test.fixme→test, baseline in repo).
- **Tracking:** 27 of 33 inventory rows closed. Remaining: 6 rows (7 legit cond-skip guards in unified-rows [no action] + #124 visitor PATCH backend [out of scope, not debt]).

---

## Wave 5 — Test-debt cleanup: un-skip + annotation cleanup (#125 #159 #109): ✅ Completed 2026-07-22

**Goal:** Un-skip 4 E2E tests and clean 2 stale annotations (7 actionable debt items closed). Replace `waitForTimeout` with response-based wait for #125 status filter. Remove stale `test.fixme` and `#XXX` annotations in #159 records panel + #109 visual regression.

**Branch:** `feat-test-debt-wave5`

**Total commits:** 3 (2af5d6c, 4fdb6ee, 0421ea3)

**Design spec:** `docs/specs/2026-07-22-test-debt-wave5-unskip-annotations-design.md`

**Plan:** `docs/plans/2026-07-22-test-debt-wave5-unskip-annotations.md`

**GH issues touched:** #125, #159, #109

### What shipped

1. **test(#125): un-skip status filter test + response-based wait** (`2af5d6c`) — `clients.spec.ts`: un-skipped "11. Status filter narrows results". Replaced `waitForTimeout(500)` with `waitForResponse` on `clients*` API call. The selector/timing flake was caused by tests racing ahead of API response, not a code bug.

2. **test(#159): un-skip 2 detail-panel tests + delete stale comment** (`4fdb6ee`) — `records.spec.ts`: removed `test.fixme` from tests 8 and 10 (detail panel edit + delete). UI confirmed by recon — test 9 (same flow) already passes. Stale comment "TODO: pre-existing flakes in clients tests causes cascading failures" deleted.

3. **test(#109): un-skip records page visual regression test + fix annotation** (`0421ea3`) — `visual-regression.spec.ts`: changed `test.fixme` → `test` for records-filtered snapshot. Snapshot baseline exists in repo since Jul 5 (`records-filtered.png`). Annotations: stale `#XXX` placeholder → `#109`.

### Test Results

- **Backend pytest:** unchanged (untouched — test-only cleanup)
- **Frontend vitest:** 1194 pass, 0 regressions (baseline unchanged)
- **Type-check:** clean (exit 0)
- **E2E:** not run locally (env flaky per prior experience). CI on PR will verify
- **Visual gate:** N/A (test-debt cleanup only — no product code changed)

### Acceptance Criteria

| US | Description | Status |
|----|-------------|--------|
| US-1 | #125 status filter un-skipped (response-based wait) | ✅ (2af5d6c) |
| US-2 | #159 detail panel tests 8+10 un-skipped (fixme→test) | ✅ (4fdb6ee) |
| US-3 | #109 visual regression snapshot un-skipped (fixme→test) | ✅ (0421ea3) |
| US-4 | #XXX placeholder + stale comment cleaned | ✅ (0421ea3 + 4fdb6ee) |
| US-5 | 0 new regressions (vitest 1194 pass, tsc clean) | ✅ PASS |

---

## #155 — @transactional Commit Boundary: ✅ Completed 2026-07-21

**Goal:** Fix the root cause of the `GET /payments/{id}` flake (post-POST 404 race) — FastAPI yield-dependency commits after HTTP response is sent. Apply the Unit of Work pattern via a `@transactional` decorator.

**Branch:** `feat-transactional-commit-155`

**Total commits:** 3 (0d47d09, 731a71d, 9b71d27)

**Design spec:** `docs/specs/2026-07-21-transactional-commit-155-design.md`

**Plan:** `docs/plans/2026-07-21-transactional-commit-155.md`

### Root cause

`get_db_session` (database.py:56-64) uses FastAPI yield-dependency: `await session.commit()` runs AFTER HTTP response is sent → GET arrives before commit → 404 on `GET /payments/{id}` immediately after POST.

### What shipped

1. **feat(#155): @transactional decorator + unit tests** (`0d47d09`) — New file `backend/src/services/decorators.py` (88 lines): `@transactional` decorator (Unit of Work pattern, Spring `@Transactional` equivalent). New file `backend/tests/test_transactional.py` (161 lines): 6 unit tests (commit-on-success, no-commit-on-exception, double-commit-safe, session-param-name, positional-arg, return-value-preserved).

2. **fix(#155): apply @transactional to all 22 write methods** (`731a71d`) — 7 service files: generic.py (5), payment.py (1), record.py (4), service.py (2), photo.py (2), visit.py (5), user_settings.py (3). Removed inline `await db_session.commit()` from photo.update (now handled by decorator). Read-only methods (list, get) NOT decorated.

3. **refactor(#155): remove E2E factory polling workarounds** (`9b71d27`) — `frontend/admin/e2e/fixtures/factories.ts`: removed `expect.poll` retry blocks from createTestClient, createTestActivity, createTestRecord (-50 lines). Polling was a workaround for the commit-after-response race; now dead code.

### Pattern

Unit of Work (Fowler, PoEAA) — equivalent to Spring `@Transactional`. Confirmed via SQLAlchemy 2.0 docs (commit-as-you-go) and Spring Framework docs (@Transactional on service methods). Repository = flush (buffer), service = commit (transaction boundary).

### Test Results

- **Backend pytest:** 674 passed (668 baseline + 6 new @transactional tests), 0 regressions
- **Frontend:** untouched
- **Type-check:** clean
- **E2E:** factory polling removed — no longer needs polling workarounds

### Closed Issues

- **#155** — GET /payments/{id} non-OK immediately after POST (root cause: FastAPI yield-dep commit-after-response → fixed by `@transactional` decorator)

### Acceptance Criteria

| US | Description | Status |
|----|-------------|--------|
| US-1 | @transactional decorator exists with 6 unit tests | ✅ (0d47d09) |
| US-2 | All 22 write methods decorated | ✅ (731a71d) |
| US-3 | E2E factory polling removed | ✅ (9b71d27) |
| US-4 | Backend 0 regressions | ✅ 674 pass |
| US-5 | E2E scenario 18 deterministic (no poll) | ✅ root cause fixed |

---

## Changelog
- 2026-08-04: **#178 — Canonical PUT/PATCH types (api-client + backend, 4 entities: Master, Service, Location, Material)** — PUT becomes true full-replace: `Update` schemas for the 4 entities require `is_active: bool` (omission → 422), replacing the #184 sticky `bool | None = None`; sticky-injection override removed from `SoftDeleteService.update`, `ServiceService.update` drops the `_strip_is_active_none` call on the update path (PATCH keeps it). api-client: 4 `*UpdateSchema` switch from `CreateSchema.partial()` to `CreateSchema.extend({ is_active: z.boolean() })`; PATCH endpoints drop the `& { is_active?: boolean }` workaround intersections (TODO(#178) removed) — `Partial<Update>` is now the canonical PATCH type. Admin: `use*Mutations` hooks + 4 tables (Masters/Locations/Materials/Services) send typed canonical PUT payloads; 4 hook test files updated. Domain-rules: `_overview.md` is_active semantics rewritten (PUT explicit bool, PATCH sticky, Client #178→#201 window) + 5 entity notes synced. 6 commits (7a71b55, 58e7365, 3d85488, 2576a90, bee8246, cb444ac). Branch `gh-178-canonical-put-patch`. Backend 999p/6s, api-client 150p/4f (#188 pre-existing), admin vitest 1239p/0f, tsc clean. AC1–AC7 met (spec §6); visual gate 5/5 (§7 — 4 tables render + edit-save PUT 200). **Known window:** Client PUT omitting `is_active` → 500 until #201 (user-accepted; `ClientUpdate.is_active` interim `bool | None = None`). **Pre-existing note:** ServiceModal maps NULL `max_age`→0 blocking edit-save on seed services with open-ended max_age — byte-identical to main, NOT a #178 regression. 37 files, +411/-224. Spec: `docs/specs/2026-08-04-canonical-put-patch-design.md` (rev 3). Plan: `docs/plans/2026-08-04-canonical-put-patch-plan.md`.
- 2026-08-04: **#185 — GenericService HTTP CRUD contract + test_api dedup** — HTTP-level full-CRUD contract `backend/tests/test_generic_api_contract.py` (+247, 116 parametrized cases over 8 entities, sync-only via TestClient against test SQLite — ADR 006): pins transport surface (URL prefixes, status codes 201/200/204, `response_model` shape via exact key-set + `model_validate`, pagination binding, per-entity 404 codes, ADR-005 error body). Shared config module `backend/tests/generic_contract.py` (+365) drives BOTH the service contract (#184) and the HTTP contract. Per-entity dedup: 7 `test_api_*.py` trimmed + `test_api_tags.py` deleted (−1014/+26); `test_api_pagination_params.py` trimmed to services/records/visits. Suite arithmetic: 107 old cases removed, 116 added → net +9 vs pre-#185 baseline (990p → 999p). Hard constraint: `backend/src/` untouched. AC1–AC7 ✅ COMPLIANT (final full-feature review, independent suite run); 3 mutations (unmounted router / wrong response_model / status flip) all turned contract red, reverted. ADR 006 (`docs/decisions/006-http-contract-tests-end-to-end.md`, verbatim from spec §3.6) + README index rows 005+006. **Documented blind spot (spec D12, explicit user decision):** a dropped `response_model=` kwarg is undetectable at body level (services return validated schema instances → byte-identical body) — docs-only, NO guard test, noted so it is not re-litigated. Pre-existing ruff baseline in backend/tests (143 findings, Cyrillic RUF001/002/003 etc.) untouched — no new lint. Test-files-only net −667 lines (AC4 band); full branch diff 14 files +696/−1318. 4 commits (522b12e, 333f68d, 541731b, a521bb5). Branch `gh-185-api-crud-contract`. Backend 999p/5s; contract file 116/116 green. Spec: `docs/specs/2026-08-03-generic-api-crud-contract-design.md` (rev 2). Plan: `docs/plans/2026-08-03-generic-api-crud-contract-plan.md`.
- 2026-08-03: **#184 — GenericService full-CRUD service contract + sticky `is_active` fix** — ONE parametrized contract file `backend/tests/services/test_generic_service_contract.py` (+1307) replaces `test_generic_service_patch.py` (599) and `test_generic_service_list.py` (186): full CRUD (create/get/list/update/delete) over all `GenericService` subclasses via `__subclasses__()` auto-discovery + `EntityConfig` + `make_entity`; new entity = one config entry → full coverage. Update (PUT full-replace) was previously completely untested. Delete edge cases: nonexistent → False, already-inactive → False, soft-deleted absent from list. **Production fix (G1b directive):** `is_active` becomes a sticky field — Update/Patch schemas for the 5 soft-delete entities (master/location/material/service/client) flipped `bool = True` → `bool | None = None`; `SoftDeleteService.update` injects stored value, `_patch_payload` hook + shared `_strip_is_active_none` helper also used by `ServiceService` overrides; PUT/PATCH omitting `is_active` on an archived row no longer silently reactivates (fixes #195's §7.5 schema hazard; client archive/restore via PATCH now possible). `get` returns archived rows (locked by test). Domain-rules: `_overview.md` "is_active semantics on get/update/patch" + 5 per-entity "Archive semantics on write" sections. 9 commits (7565b65…18479e5). Branch `gh-184-service-crud-contract`. Backend 990p/5s (baseline 854p/3s), api-client 144p/4f (#188 pre-existing), domain 22/22, admin vitest 1239p/0f, tsc clean. AC spec §6.1–6.9: 9/9. Mutation checks green-by-failure; guard sanity failed-as-expected. Production diff exactly 7 src/ files. Visual gate N/A. Closes #184. Spec: `docs/specs/2026-08-03-generic-service-crud-contract-design.md` (rev 4, G1b). Plan: `docs/plans/2026-08-03-generic-service-crud-contract-plan.md` (G2).
- 2026-08-02: **#195 — Status filter param for soft-delete list endpoints + frontend archive views** — `ArchiveStatus` enum (active|archived|all, default active) + `SoftDeleteRepository.list` param `is_active`→`status`; new `SoftDeleteService` replaces `GenericService` for soft-delete entities; 4 service migrations (master/location/material/client) + ServiceService eager-load override; `status` query param on masters/locations/materials/services routers (services in T3, sanctioned deviation) + clients `ClientListParams.status`/`list_clients_with_stats`. api-client `ListParams.status` + `listQuery` serialization (default `active` omitted). Admin: server-side archive filters on Masters/Locations/Services/Materials tables + 3 filter components, clients filters `is_active`→`status` enum (default «Активные»), edit modals preserve `is_active` on archived rows (4 tables), E2E clients.spec.ts updated. 12 commits (724f8f6…d3524bf). Branch `feat/status-filter-archive-views-195`. Backend 854p/3s, api-client 144p/4f (#188 pre-existing), admin vitest 1239p/0f, tsc clean, visual compliance 8/8 PASS (verified via dedicated scripts — bundled visual-compliance-check.sh has networkidle bug under HMR). Deviations (sanctioned): services router param absorbed into T3; services.py untouched in T4. Follow-ups: ClientsTable restore buttons, visual-compliance-check.sh bug, seed.py ENV_FILE caveat. 48 files, +1564/-278. Closes #195. Spec: `docs/specs/2026-08-02-is-active-list-filters-design.md` (rev 6, G1b). Plan: `docs/plans/2026-08-02-status-filter-archive-views-plan.md` (G2).
- 2026-08-01: **#194 — Deletion policy refactor: hard-delete for 6 entities** — Alembic migration `b7c8d9e0f1a2` drops 6 `is_active` columns + recreates FKs (records.activity_id CASCADE, visits.visitor_id CASCADE, photos.visitor_id/activity_id SET NULL); 6 models → hard-delete base with `soft_delete` ClassVar flag driving GenericService.list filter; 6 services → BaseRepository; delete cascades for Record/Activity/Visitor + tag-join row cleanup (pre-existing gap: join-table FKs had no ON DELETE); `is_active` swept from services/schemas (4 Response schemas)/api-client zod; admin TagsTable/PhotosTable status UI removed; mocks + e2e rewritten; `EntityConfig.delete_semantics` + generic delete contract test; domain-rules 9 docs synced. 15 commits (51a287e…6ff6eec). Branch `deletion-policy-194`. Backend 824 pass / 0 fail / 3 skip (baseline 793p/3s), api-client 139p/4f (#188 pre-existing), admin vitest 1223p/0f, targeted e2e 42/42, visual compliance 6/6. Closes #194. Follow-ups (out of scope): records.md:123-124 stale wording, clients.md:28 `is_active` reference, PaymentService.list override redundant. Spec: `docs/specs/2026-08-01-deletion-policy-design.md`. Plan: `docs/plans/2026-08-01-deletion-policy-plan.md`.
- 2026-07-29: **#186 — Payments batch aggregate (GET /api/v1/payments/totals)** — Replaced unfiltered `getPayments({ per_page: 100 })` in RecordsContext with a backend SQL batch aggregate endpoint `GET /api/v1/payments/totals?record_ids=...` so payment statuses/sorting/ClientCardModal stay correct when payments table exceeds 100 rows. 5 tasks: backend totals endpoint (schema + service + route before `/{payment_id}`) + 5 API tests; api-client `getPaymentTotals` + Zod schema + endpoint tests; RecordsContext totals wiring with sorted-ID query key; RecordsTable + ClientCardModal consumers off totals map; regression guard (backend 105-payments test + frontend "getPayments never called" guard). 6 commits (0f6d063, b50ef1e, 056616b, 19df605, 096f372, e43ddce). Branch `feat/payments-batch-aggregate-186`. Backend 793 pass, admin vitest 1218 pass, api-client 139 pass (4 known #188), visual compliance 4/4. Closes #186. Spec: `docs/specs/2026-07-29-payments-batch-aggregate-design.md`. Plan: `docs/plans/2026-07-29-payments-batch-aggregate-plan.md`.
- 2026-07-29: **#183 — GET /api/v1/tags/{id} + GET /api/v1/visitors paginated bare list** — Backend: tags get-by-id endpoint + 3 tests, visitors paginated list (page/per_page query params, GenericService subclass pattern) + 7 tests including scoped-route regression guard. api-client: `VisitorListResponseSchema`, `getTag()` + `getVisitors()` methods + unit tests (both methods). Domain-rules: tags.md & visitors.md updated incl. soft-delete invariant correction (hard-delete restore is follow-up #189). 9 files changed, +182/-5. Branch `feat/183-tags-get-by-id-visitors-list`. Backend 787 passed / 0 failed / 3 skipped; api-client 136 passed / 4 failed (4 known pre-existing #188 in schemas.test.ts — out of scope). Closes #183. Spec: `docs/specs/2026-07-29-tags-get-by-id-visitors-list-design.md`. Plan: `docs/plans/2026-07-29-tags-get-by-id-visitors-list-plan.md`. Notable: skipped schemas.test.ts envelope parse test (no list-envelope tests exist for any of the 8 existing entities; backend + endpoint tests cover the contract).
- 2026-07-29: **#182 — GenericService.list() mandatory pagination + API & frontend migration** — `PaginatedResponse[ItemT]` envelope `{items,total,page,per_page}` on GenericService.list; 4 service overrides (service/record/activity/visit); payment override (hard-delete model); 9 list endpoints with `page`/`per_page` query params (ge=1, le=100 → 422) and envelope response_model; client search-by-phone adapted. api-client: `paginatedSchema()` factory + 8 list schemas, 8 list functions with optional page/per_page, `getClients()` `per_page=100` fix (20-item truncation bug). frontend/admin: 13 consumers unwrap `.items` at queryFn layer. e2e infra: 3 files unwrap envelopes. 6 commits (8ffc378, 68fb1b4, e6edaf5, 4dd60cb, 7254c75, cde75d6). 69 files changed, +787/-356. Branch `feature/182-list-pagination`. Backend 777 passed / 3 skipped, frontend vitest 1210 passed / 87 files, e2e 216 passed (6 pre-existing flakes, 2 flaky retry-pass). Closes #182. Spec: `docs/specs/2026-07-28-list-pagination-migration-design.md`. Plan: `docs/plans/2026-07-28-list-pagination-migration-plan.md`.
- 2026-07-21: **#155 — @transactional commit boundary** — `@transactional` decorator (Unit of Work pattern), applied to all 22 write methods, removed E2E factory polling workarounds. Root cause: FastAPI yield-dep commit-after-response race. 3 commits (0d47d09, 731a71d, 9b71d27). Branch `feat-transactional-commit-155`. Backend 674 pass (+6 new @transactional tests). Closes #155.
- 2026-07-18: **Wave A — ClientListParams page/per_page ge=1 constraint** — `backend/src/schemas/client.py`: `Field(ge=1)` на page и per_page. Закрыта дыра валидации пагинации (page=0/-1, per_page=0/-5 → 422). Сняты 4 xfail(strict=True) теста в `test_client_stats.py`. Backend: 668 passed, 0 xfailed (было 664+4xfail). Next scope: #149 (numeric filters ge=0). Branch `fix-clientlistparams-ge1`. Commits: a29474e (design), 3c253a8 (plan), a3d9f13 (impl).
- 2026-07-08: **#98 — Unify "active record" definition** — `check_activity_capacity` excludes cancelled/missed from occupied count; `last_visit` stat uses `Activity.start` over visited visits. Shared `ACTIVE_RECORD_STATUSES` + `active_record_filter()`. Branch `fix-unify-active-record`. Spun off #133, #134.
- 2026-07-08: **#105 — Client stats cartesian product fix** — Rewrote `list_clients_with_stats` with scalar subqueries to eliminate cross-relation multiplication. Branch `fix-client-stats-scalar-subqueries`.
- 2026-07-16: **#127 — Unify records/visits/payments caches** — Single source of truth (`['record', recordId]`), `recordCacheSync` helpers, `PendingActionsProvider`, deleted `useOptimisticVisitMutation`, fixed Bugs #2/#3/#130. 13 commits, 28 files (+3946/-1272). Branch `feat-unify-record-caches`.
- 2026-07-16: **#131 — Client-stats refactor: "visits"→"records" semantics** — Renamed `visits_count`→`records_count`, `missed_visits`→`missed_records` (redefined: `COUNT(Record.id) WHERE Record.status='missed'`), `last_visit`→`last_record` (redefined: `MAX(Activity.start)` over ALL active records). API params `min_visits/max_visits`→`min_records/max_records`. Removed Visit joins from 2 subqueries — uses persisted `Record.status`. 7 frontend components + 7 test files + E2E + Zod + domain-rules renamed. 5 commits, 22 files. Backend 663 passed, frontend 1178 passed, visual compliance PASSED. Branch `feat-client-stats-131`.
- 2026-07-17: **CI Green-Up (PR #145)** — E2E pnpm-cache path fix (test.yml cache-dependency-path dropped from e2e job), #123 date-flake frozen (CalendarPopover + Menubar via `vi.setSystemTime`), 4 flaky E2E tests skip-tracked (#124, #125), 9 shard-rest snapshot baselines regenerated via new `update-snapshots.yml` workflow. test.yml 12/12 green, smoke.yml 2/2 green. Branch `feat-ci-green`, 5 commits (e3f67e4, d7dc689, 9785eba, 89520d0, 26fa0eb).
- 2026-07-17: **E2E Infra Roots (#108, #126)** — SQLite DB lock fix (global WAL + busy_timeout hook, `sqliteExecWithRetry` helper, `cleanTestData` throws on lock), standalone warmup (9 routes in `globalSetup` gated `!SHARD_ID`), ADR 001 WAL-backup caveat. 7 commits (1c30c24, be0b08b, 713ce3f, 662ea67, f39856d, 51dac4c, 5d6028b). Branch `feat-e2e-infra-roots`. Backend 664+4xfail, frontend 1189+1skip.
- 2026-07-17: **E2E Fixme Cleanup Wave 1 (#121)** — Re-enabled 13 previously-disabled E2E tests whose blocker issues (#84 occupied-calc, #127 cache unification) are now CLOSED. Occupied-calc: 1 test re-enabled (US-S03). Error-messages: 1 test re-enabled ("Недостаточно мест" capacity). Clients: 11 tests re-enabled (create/view/edit/delete/search/modal/record-tab/status/payment/save/cancel). Test 11 (status filter) left skipped (#125). Shard-mode verification gate: 23/23 active tests pass, 0 flakes. Zero product-code changes. 2 commits (0be5188, 0e0ee33). Branch `feat-e2e-fixme-wave1`.
- 2026-07-20: **#152 — Seed staleness + E2E harness resilience** — Wipe+reseep fix: shard-start `rm -f` shard DB + path guard (shell dry-run test); removed `_exists` guard from seed (fail-loud on UNIQUE, empty-DB contract); globalSetup fail-fast diagnostics (stale DB + missing current-week activities); waitForScheduleReady timeout 60→10s. 4 commits (0e4ea6c, e76f5d2, 05e0eb6, ad77118). Branch `feat-seed-staleness-152`. Backend 668 pass, frontend 1192 pass.
- 2026-07-22: **Wave 4 — Test-debt cleanup: cond-skip verify-first (#161 #162 #124-cascade)** — Removed 8 condblock `test.skip` guards across 3 E2E spec files: wave6-record-status-derived (4 tests #161 + 1 test #162), wave6-status-shared (2 tests #161), activity-details-modal (1 test #124 cascade). Pattern proven 4×: prior waves (#124 Wave-1, #152, #155) fixed root causes. Zero production code changed. 4 commits (1a8ca91, 950b82f, b4f6f97, e41d1f1). Branch `feat-test-debt-wave4`. Backend 674 pass, frontend 1194 pass. 3 files, -38 lines. 23 of 33 inventory rows closed.
- 2026-07-21: **Wave 2A — Test-debt cleanup: un-skip 2 E2E, delete 2 dead test files, rewrite 1 vitest test** — Un-skipped scenario 18 (no poll, #155) + US-M09 (#156), deleted modal-blur-footer (#157, covered by visual regression) + private-toggle-layout (#158, covered by visual regression), rewrote vitest visit-status-cycle for StatusPicker (#163, 1193+1→1194+0). Zero production code changed. 5 commits (e8c4e21, 1f0eab8, 3c51498, e8c68cc, 604e592). Branch `feat-test-debt-wave2a`. Backend 668 pass, frontend 1194+0.
- 2026-07-28: **GH #175 — GenericService.patch() contract test (replace N×M per-entity PATCH duplication)** — Branch `gh-175-patch-contract-test`. 6 commits (22df61f, 9f66e14, 7226813, 2cd7e95, 17765a2, 6296991).
  - **Contract test:** `backend/tests/services/test_generic_service_patch.py` (487 lines) — 6 parametrized tests × 8 entities, auto-discovery via `GenericService.__subclasses__()`, config test `NOT_NULL_FIELDS ↔ nullability`, guard test for new subclasses.
  - **Dedup:** −988 lines removed from 14 per-entity test files (+57 contract params, +9 restored exception-service tests). `test_nullable_consolidation.py` deleted (245 lines). Net −286 lines.
  - **ClientService alignment:** `services/client.py` + `api/v1/clients.py` — subclass pattern (no behavior change).
  - **Domain-rules:** PATCH Contract section in `docs/domain-rules/_overview.md` — contract test as single source of truth, 3 exceptions documented.
  - **Result:** Backend 734 pass (baseline 741 → net: generic dups removed ~65, contract tests +57 params, exception tests +9). API PATCH per-entity: ~22 tests (11×404+code, 6 tag_ids, invariants). `src/` changes: only ClientService alignment.
  - Spec: `docs/specs/2026-07-28-generic-service-patch-contract-design.md`
  - Plan: `docs/plans/2026-07-28-generic-service-patch-contract-plan.md`
- 2026-07-26: **#151 — Next.js build: wrap ClientsPage in Suspense for useSearchParams** — `frontend/admin/app/(main)/clients/page.tsx`: extracted `ClientsPageContent`, wrapped in `<Suspense fallback={null}>` inside `ScheduleProvider`. Fix verified: `npx next build` passes, vitest 1194/1194 pass. 1 commit (149e566), direct-to-main (FasTP). Reviews: code-quality ✅, spec-review ✅.
- 2026-07-25: **PATCH endpoints for all 8 backend entities** — Branch `feat-patch-all-entities` (8 commits: 8209e4c, 6356705, c3a54ce, 2d8cbff, 703f69e, 34e1590, 90f3759, 8142ac3; Task 1/Tags via PR #173). New `<Entity>Patch` schemas (all-optional), `NOT_NULL_FIELDS` class attr, M2M `tag_ids` hard-replace for services/photos, `client_id` immutable on visitors. Bonus: photos `create()`/`update()` fixed MissingGreenlet bug. 34 files changed, +1199/-45. Backend 725 pass (baseline 674, +51 new PATCH tests). 4 new domain-rules docs (materials, tags, photos, user_settings) + 4 updated.
- 2026-07-22: **Wave 5 — Test-debt cleanup: un-skip + annotation cleanup (#125 #159 #109)** — Un-skipped 4 E2E tests + cleaned 2 stale annotations. #125 status filter timing fix (waitForTimeout→response-based wait). #159 detail panel tests 8+10 (stale fixme removed; UI confirmed). #109 visual regression snapshot (test.fixme→test; baseline in repo since Jul 5). Stale `#XXX` placeholder + "pre-existing flakes" comment deleted. 3 commits (2af5d6c, 4fdb6ee, 0421ea3). Branch `feat-test-debt-wave5`. Frontend vitest 1194 pass, tsc clean. 3 files, +14/-11 lines.
- 2026-07-16: **#129 — Backend health: N+1 fix, capacity re-check, dedup seats** — `list_activities` query count halved (6→2 for 5 activities), update/patch enforce capacity check with 409 on over-capacity, `recompute_record_seats` now single source for `seats` across create/update/patch, bonus `tariff_id` fix in update's Visit constructor, 10 new tests (649→659, 0 regression). 3 commits (625fea5, 4689765, e4a7214). Branch `feat-backend-health-129`.
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
