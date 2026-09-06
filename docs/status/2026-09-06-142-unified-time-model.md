# GH #142 — Unified time model & types (minutes canon, floating-local ISO, DTO vs domain)
- **Date**: 2026-09-06
- **Branch**: `feat/unified-time-model-142`
- **Status**: Completed (PR pending)
- **Base**: `111d489` (2026-09-06) — 15 commits (`b6fe044..b56c125`), 60 files, +2079 / −2105

## Summary of Changes
- **Time canon (spec §2):** one canonical time model in admin — `start` floating-local ISO string (`YYYY-MM-DDTHH:MM:00`, RFC 5545 floating time = studio wall clock) + integer minutes from midnight everywhere between api-client and DOM. Hours-as-decimals, hour↔minute conversion arithmetic, and UTC-getter parsing are extinct (grep gates G1–G6).
- **`lib/datetime.ts` — the single date module (new):** `parseLocalISO` (THE parser — zone-less strings parse as local per ES spec, so local getters return the embedded wall clock regardless of browser TZ; `Z`/offset strings accepted for display-only test fixtures), `composeLocalISO` / `dateToLocalISO` (API write path), `formatTime` / `hhmmToMinutes`, `dayIndexToDate` / `weekDayIndex` / `getMonday`, `toISODate`, `generateTimeSlots`, `calculateGridTimeRange` (`GridTimeRange`). Sole schedule-canonical padStart-assembly site; designated future multi-TZ/Temporal integration seam (spec §7/§11).
- **domain package (minutes canon):** `ActivitySchema`/`Activity` deleted (incl. v1 fields); `Service.duration` (hours) → required `durationMinutes`; new nested `TariffSchema` (`id/title/price/description`, service_id FK dropped deliberately); `schedule.ts` `ScheduleAdminDTO.startTime` → `startMinutes` (minutes from midnight). Legacy price twins kept (spec §4.1). New `packages/domain/src/index.test.ts` pins the canon.
- **api-client:** schema-derived `ActivityPatch` type — optimistic updates typed end-to-end, no `Record<string, unknown>` in the mutation path.
- **Transformer layer slim-down:** `lib/transformers.ts` reduced to the three real transformers (master/service/location); `transformActivity`/`parseStart`/`normalizeDay` deleted. `buildAdminSchedule` consumes domain `Service` minutes + tariffs; dead `toScheduleIndex`/`toScheduleItems`/`ScheduleItem`/`ActivityIndex`/`ScheduleIndex`/`dayToDate`/`addToActivityIndex` deleted from `lib/buildSchedule.ts`.
- **ScheduleContext minutes contract (spec §4.4):** add/update signatures in minutes; typed optimistic updates via `ActivityPatch`; tariffs in the services contract (no `servicesRaw` in `ScheduleContextType`); grid bounds via `calculateGridTimeRange` (adaptive working-hours extension + overnight 24h clamp + `gridFrequency` snapping preserved); `composeLocalISO` write path.
- **Grid integer-minute geometry:** `useDnD` drag math in minute space; `DayColumn`/`TimeColumn`/`NowLine` render geometry from `startMinutes`/`slotMinutes` (`topPx = Δmin × cellHeight/30`); `ActivityCard`/`OverlapPopover`/`DayView`/`WeekView` + modal tabs (SettingsTab/NewBookingTab/ActivityDetailsModal) consume `ScheduleAdminDTO` minutes and domain tariffs; rendered time strings byte-identical (`"10:30"`).
- **Records-side UTC bug fix (US-5 — the only visible delta, non-UTC browsers only):** `recordsColumns.tsx` and `ClientQuickCard.tsx` previously derived display time from UTC getters (`getUTCHours` etc.), shifting activity time by the TZ offset (e.g. −3h on Europe/Moscow); both now render studio-local time via `parseLocalISO`, matching the schedule grid. CI never observed it (UTC runners). `parseActivityStart` deleted. New `recordsTimeParity.test.ts` pins grid-vs-records-vs-quickcard parity under `TZ=Europe/Moscow`.
- **Dead-layer deletion (grep gates G1–G6):** `ActivitySchema`/`Activity`, the dead `useActivities` list hook (file now carries only the `useActivity(id)` / `useActivityRecords` point hooks), `toScheduleIndex`/`toScheduleItems`/`ScheduleItem`, `transformActivity`/`parseStart`/`normalizeDay`, `decimalToHHMM`/`hhmmToDecimal`, `parseActivityStart`, legacy `lib/utils.ts` time helpers — all deleted with their tests (`buildSchedule.test.ts` deleted whole; `transformers.test.ts` transformActivity block, `useReactQueryHooks.test.tsx` useActivities suite, `utils.test.ts` −255 ln legacy suite).
- **Docs sync (T12):** `docs/domain-rules/activities.md` §Frontend + `services.md` updated to the minute canon + nested Tariff shape (commit `b56c125` on this branch).

## Tasks (plan)

| # | Task | Classification | Status |
|---|------|----------------|--------|
| T1 | domain — minutes canon, Tariff schema, delete Activity schema | standard | ✅ |
| T2 | api-client — schema-derived `ActivityPatch` | small | ✅ |
| T3 | `lib/datetime.ts` — the date module | standard | ✅ |
| T4 | transformers + buildSchedule — slim to three transformers, `startMinutes` | standard | ✅ |
| T5 | ScheduleContext — minutes contract, typed optimistic, tariffs contract | large | ✅ |
| T6 | useDnD — minute-space drag math | standard | ✅ |
| T7 | DayColumn + TimeColumn + NowLine — grid geometry in minutes | standard | ✅ |
| T8 | ActivityCard + OverlapPopover + DayView + WeekView + modal — DTO consumers | large | ✅ |
| T9 | records-side UTC fixes | small | ✅ |
| T10 | dead-code sweep + utils deletion + grep gates | standard | ✅ |
| T11 | timezone-dnd-bug rewrite + fixture sweep verification | standard | ✅ |
| T12 | domain-rules doc sync | trivial | ✅ |
| T13 | full-suite verification + PR readiness | small | ✅ |

## Acceptance Criteria (spec §13)

| # | Criteria | Status |
|---|----------|--------|
| 1 | Canon: `start` floating-local string + `durationMinutes` everywhere api-client→DOM; grep gates G1–G6 pass | ✅ |
| 2 | `ActivitySchema`, `useActivities`, `toScheduleIndex`/`toScheduleItems`/`ScheduleItem`, `transformActivity`/`parseStart`/`normalizeDay`, `decimalToHHMM`/`hhmmToDecimal`, `parseActivityStart` deleted with tests; UTC-getter sites (recordsColumns, ClientQuickCard) on `parseLocalISO` | ✅ |
| 3 | Domain `Service` carries `tariffs`; `ScheduleContextType` has no `servicesRaw`; modal consumes domain tariffs | ✅ |
| 4 | Optimistic updates typed via `ActivityPatch`/`ActivityResponse` — no `Record<string, unknown>` in mutation path | ✅ |
| 5 | `lib/datetime.ts` only schedule-canonical padStart-assembly site; grid math integer-minute; no utils re-exports | ✅ |
| 6 | timezone suite green under `TZ=Europe/Moscow`; records/grid + ClientQuickCard parity green under non-UTC TZ | ✅ |
| 7 | `docs/domain-rules/activities.md` + `services.md` synced to minute canon (in-PR) | ✅ |
| 8 | All suites green: vitest, tsc 0, lint 0, api-client green, CI incl. e2e shards; backend untouched | ✅ |
| 9 | US-1..US-6 pass (unit/e2e mapping §10) | ✅ (unit; e2e = CI) |

## Behavioral Changes Shipped (all user-approved at G1a / G1b)
- **Zero visible delta everywhere** — every screen renders exactly as before: same cards, same `"HH:MM"` strings, same grid geometry (US-1..US-6 are regression guards; US-2 duration `HH:MM` editing, US-3 tariff display, US-4 quick-add ghost, US-6 adaptive bounds all unchanged).
- **Latent bug fix (the only real delta):** on non-UTC browsers the records «Дата / Время» column and ClientQuickCard previously showed activity time shifted by the timezone offset (e.g. −3h on Europe/Moscow); they now match the schedule grid (US-5). CI never saw it (UTC runners).
- Developer-facing contract: domain `Activity`/`ActivitySchema` removed; `Service.duration` → `durationMinutes` (+`tariffs`); `ScheduleAdminDTO.startTime` → `startMinutes`; ScheduleContext add/update signatures in minutes; `servicesRaw` out of contract; api-client exports `ActivityPatch`.

## Test Results
- **admin vitest:** 1595p/0f (104 files)
- **tsc:** 0 errors · **lint:** 0 errors (33 pre-existing warnings)
- **api-client:** 245p/0f · **domain:** 38p/0f
- **backend:** untouched (empty diff vs base)
- **e2e:** = CI (existing specs unedited; authoritative gate at finishing per project policy). US-1..US-6 covered by unit suites (US-1 timezone suite, US-2/3/4 modal/schedule suites, US-5 recordsTimeParity, US-6 `calculateGridTimeRange` bounds).
- **Reviews:** T1–T11 passed spec + quality two-stage review; T12 trivial spot-check; T13 tester verification.

## Key Files Changed

### Deleted (with the mechanism)
- `packages/domain/src/index.ts` — `ActivitySchema`/`Activity` (+ v1 fields), `Service.duration` (hours)
- `frontend/admin/hooks/useActivities.ts` — dead `useActivities` list hook (file retains `useActivity(id)`/`useActivityRecords` point hooks)
- `lib/transformers.ts` — `transformActivity`/`parseStart`/`normalizeDay`; `lib/buildSchedule.ts` — `toScheduleIndex`/`toScheduleItems`/`ScheduleItem`/`ActivityIndex`/`ScheduleIndex`/`dayToDate`/`addToActivityIndex`
- `lib/utils.ts` — `decimalToHHMM`/`hhmmToDecimal` + legacy time helpers; `recordsColumns.tsx` — `parseActivityStart`
- `frontend/admin/__tests__/buildSchedule.test.ts` — whole file; legacy blocks in `transformers.test.ts`, `useReactQueryHooks.test.tsx`, `scheduleIntegration.test.tsx`, `utils.test.ts` (−255 ln), `mockData.ts`/`mockContexts.ts`/`clientRecordTabSetup.ts` fixture sweeps

### Created
- `frontend/admin/lib/datetime.ts` — floating-local parse/compose/format/grid-range module (33 tests via `datetime.test.ts`)
- `frontend/admin/__tests__/datetime.test.ts`, `frontend/admin/__tests__/recordsTimeParity.test.ts` (US-5, `TZ=Europe/Moscow`)
- `packages/domain/src/index.test.ts` — canon/Tariff/minutes coverage
- api-client `ActivityPatch` (schemas.ts + endpoints.ts + schemas.test.ts)

### Rewritten / migrated
- `packages/domain/src/index.ts`, `packages/domain/src/schedule.ts` (`ScheduleAdminDTO.startMinutes`)
- `lib/transformers.ts` (3 transformers), `lib/buildSchedule.ts` (`buildAdminSchedule` → domain minutes + tariffs)
- `contexts/ScheduleContext.tsx` (minutes contract, typed optimistic, tariffs, `calculateGridTimeRange` bounds), `hooks/useDnD.ts` (integer-minute drag math)
- schedule grid: `DayColumn`/`TimeColumn`/`NowLine`/`ActivityCard`/`OverlapPopover`/`DayView`/`WeekView`; modal: `ActivityDetailsModal`/`SettingsTab`/`NewBookingTab`
- records: `recordsColumns.tsx`/`ClientQuickCard.tsx`/`RecordsTable.tsx`/`BookingFilters.tsx` — `parseLocalISO` (US-5)
- `timezone-dnd-bug.test.ts` — rewritten on the minutes canon, case stays green under `TZ=Europe/Moscow`

## Docs Impact
- `docs/domain-rules/activities.md` §Frontend + `services.md` — synced to minute canon + nested Tariff shape (commit `b56c125` on this branch, T12). No domain-rules entity field/validation drift remains.
- `docs/ARCHITECTURE.md` — untouched (no new cross-cutting pattern; canon lives in domain-rules + spec §2).
- Spec: `docs/specs/2026-09-05-unified-time-model-142-design.md` · Plan: `docs/plans/2026-09-05-unified-time-model-142-plan.md` (both on main, pushed).

## Known Non-Blocking Observations (final review)
- **DayView grid bounds now week-scope** — bounds derive from the whole visible week's activities, not per-day; spec §4.4-sanctioned (adaptive extension identical for typical single-day weeks).
- **`useDnD` `gridStartMinutes=540` default half-wired** — legacy-equivalent default; consumed only when a day has no activity-provided bound.
- **`dateToLocalISO` / `weekDayIndex` exported with no consumers yet** — the deliberate future Temporal/multi-TZ seam (spec §7); currently exercised by tests only.
- **Stale comment `scheduleIntegration.test.tsx:192`** — says `serviceName`, value is `serviceTitle`; cosmetic, deferred.

## Architectural Notes
- **Why one parser:** before #142 the same naive string was read through at least three mechanisms (decimal-hour transforms, manual padStart assembly, UTC getters) — the UTC-getter reads were the two record-side display bugs and the historic DnD day-jump class. `parseLocalISO` is now the single semantic: zone-less strings parse as local per the ES spec, so local getters return exactly the embedded studio wall time on any browser TZ.
- **Floating-local is a deliberate single-TZ stance** (studio wall clock); multi-TZ/per-location wall clock is out of scope (spec §11) and `lib/datetime.ts` is the single integration seam when it lands.
- **Type-ripple policy (controlled red):** T1's domain change intentionally broke admin `tsc`; residual errors were rule-bounded to later tasks' file lists and the window closed at T8 with a full `type-check` green. Vitest stayed green per touched suite throughout (vitest doesn't typecheck the whole app).
- **Mechanical gates over judgment calls:** grep gates G1–G6 are the definition of done (no conversion arithmetic outside `datetime.ts`, no UTC getters in app/lib/hooks/contexts, no `startTime` identifier, no `servicesRaw` in contract, padStart confined to the date module) — all pass with recorded outputs at T13.

## References
- **GitHub Issue**: #142
- **Design Spec**: `docs/specs/2026-09-05-unified-time-model-142-design.md`
- **Plan**: `docs/plans/2026-09-05-unified-time-model-142-plan.md`
- **PR**: _(to be added after PR creation)_
