# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

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

### Infrastructure

- Next.js 14 App Router project scaffolded + configured
- TypeScript strict mode, Tailwind CSS 3, @dnd-kit/core, Vitest
- v4 Design System CSS variables (brand, sidebar, grid, cards, text, status)
- ScheduleContext + UIContext (React Context API)
- 15 test files with 149 passing tests
- Vitest configured with `pool: 'forks'` for subagent compatibility
- Static prerender build (output: 'export') — `npm run build` passing
