# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- **Stage 6: Booking Flow E2E** — 2026-06-01
  - Verified end-to-end booking flow with real FastAPI backend
  - Polished booking UX (CalendarLine, BookingOverlay)
  - Wired booking creation API to FastAPI `/api/v1/records/`
  - Added error handling for booking flow

- **Stage 5: API Integration** — 2026-05-30
  - Migrated admin panel to real FastAPI backend using @tanstack/react-query v5
  - Shared `@memo/api-client` updated to support full CRUD via `/api/v1/`
  - Created transformation layer (API snake_case to UI camelCase)
  - Full loading/error/empty state implementation with Skeletons
  - Migrated ScheduleContext, ScheduleProvider and components to API hooks
  - 203 tests passing (all tests migrated from mock data)

- **Phase 5: Backend Foundation (FastAPI + Clean Architecture) — 2026-05-28**
  - FastAPI application with async SQLAlchemy 2.0 + aiosqlite
  - DatabaseSessionManager with Unit of Work pattern (DI-based session management)
  - Pydantic v2 Settings for configuration (`DATABASE_URL`, environment-based)
  - Lifespan events for DB init/close (startup/shutdown)
  - First domain module: System/Healthcheck (`GET /api/health`)
  - Full TDD infrastructure: 27 tests passing, ruff + mypy strict (0 errors)
  - Clean Architecture: Router → Service → Session dependency flow
  - `docs/specs/2026-05-28-backend-architecture-design.md` and `docs/plans/2026-05-28-backend-foundation.md`

- **P1: Admin Schedule — UI Polish Session (2026-05-16)**
  - ActivityCard restructured to 5-div vertical layout (Header, Title, Age, Location, Footer)
  - DnD ghost preview — responsive DragOverlay width (`w-full`) + card-shaped slot ghost
  - Stamp ghost preview on empty slot hover — card-shaped preview with service name, time, artist color
  - RightPanel toggle — inverted arrows (pointing toward panel content) + stay-visible button style
  - Vitest config — excluded `e2e/` directory from runner
- **P1: Admin Schedule** — complete weekly drag-and-drop schedule grid (`/`)
  - WeekView with 7-day column layout, sticky headers, time column (9:00–21:00)
  - ActivityCard with brightness-mix fill, collapsing at small heights, private event indicator
  - Overlapping card stacking with scroll carousel on hover
  - Current time indicator (NowLine) on today's column
  - Full @dnd-kit drag-and-drop with snap-to-half-hour, alt+drag copy, ghost preview
  - Stamp panel (Format Painter) for rapid event creation via click-to-place
  - Delete mode with fade-out animation and toast undo
  - Toast notification system with auto-dismiss and undo callback
  - Copy last week (public events only)
  - ActivityModal for create/edit with validation
  - Sidebar with MiniCalendar, navigation, artist legend, collapse toggle
  - Toolbar with week navigation, day/week toggle, filters shell, delete mode toggle
  - RightPanel with stamp configuration and week summary

- **P2: Booking Management** (`/bookings`, `/clients/[id]`) — 2026-05-17
  - Booking types: Client, Visitor, BookingRecord, Visit, Payment
  - Mock data: 7 clients, 12 visitors, 12 booking records, 16 visits, 9 payments, 7 booking activities
  - BookingFilters: date, location, service, status with clear button
  - BookingTable: sortable table with inline detail panel (client card, activity, visitors, pricing, payments, comment)
  - ClientCardPage: client info, visits history, booking history
  - Route group `(main)`: pages moved under layout with Sidebar + Toolbar + RightPanel
  - Sidebar nav links using Next.js Link with `usePathname` active highlighting
  - 154 tests passing (15 test files)

### Infrastructure

- Next.js 14 App Router project scaffolded + configured
- TypeScript strict mode, Tailwind CSS 3, @dnd-kit/core, Vitest
- v4 Design System CSS variables (brand, sidebar, grid, cards, text, status)
- ScheduleContext + UIContext (React Context API)
- 15 test files with 165 passing tests
- Vitest configured with `pool: 'forks'` for subagent compatibility
- Static prerender build (output: 'export') — `npm run build` passing
