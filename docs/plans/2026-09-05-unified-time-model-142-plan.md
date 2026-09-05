# Unified Time Model #142 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One canonical time model in admin — `start` floating-local ISO string + integer minutes everywhere, dead transformation layer deleted, `Service` carries tariffs, typed optimistic updates, single date module fixing two latent UTC-shift bugs.

**Architecture:** Bottom-up migration in one PR on branch `feat/unified-time-model-142`: domain package → api-client patch type → new `lib/datetime.ts` module → transformers/buildSchedule slim-down → ScheduleContext contract → grid components (DnD → DayColumn/TimeColumn/NowLine → ActivityCard/OverlapPopover → DayView/WeekView → modal tabs) → records-side UTC fixes → dead-code deletion sweep with grep gates → test migration → domain-rules doc sync. **Type-ripple policy (controlled red):** T1's domain change intentionally breaks admin `tsc`; the breakage window is rule-bounded — every intermediate task's DoD confines residual tsc errors to the explicitly listed files of LATER tasks (T4-T8 carry residue lists) — and T8 closes the window with a full `npm run type-check` green check. Vitest stays green per touched suite throughout (vitest does not typecheck the whole app).

**Tech Stack:** Next.js 14 admin (frontend/admin), pnpm workspace, Zod schemas in packages/domain + packages/api-client, TanStack Query v5, vitest + Playwright (CI = authoritative gate incl. e2e shards; local = fast suites only).

**Spec:** `docs/specs/2026-09-05-unified-time-model-142-design.md` (§ refs below point at it).

**Conventions for all tasks:** work dir = worktree root; commands run from `frontend/admin/` unless noted; UI-touching tasks run `npm run test:all` is NOT required locally (e2e = CI per project policy) — unit gate = `npm test` (vitest run) + `npm run type-check` + `npm run lint`. Never push/merge (architect owns finishing).

**Important sequencing note:** IMPL starts only after #140 (entity-hooks) merges — shared file `ActivityDetailsModal`. If `useSchedule()` consumers or query hooks differ from this plan's anchors (file:line verified at spec time vs main @ b3391ad), mechanically re-anchor: the time-model changes are orthogonal to #140's data-access changes.

---

## Behavioral Delta

How this feature behaves for the user, mapped to spec acceptance criteria:

- **Zero visible change everywhere** → every screen renders exactly as today: same cards, same times, same grid geometry (US-1..US-6 are regression guards).
- **DnD stays exact** → dragging across days/columns at any grid frequency saves and renders the same time; undo restores it (US-1, incl. the historic timezone day-jump guard on Europe/Moscow).
- **Settings tab unchanged** → duration shows/edits as `HH:MM`; datetime snapping behaves identically (US-2).
- **Tariffs render from the domain model** → card details + Settings show the same tariff list; nothing moves visually (US-3).
- **Quick-add ghost matches the saved card** → same preview time range and duration as before (US-4).
- **Latent bug fix (only real delta):** on non-UTC browsers, the records "Дата / Время" column and ClientQuickCard previously showed activity time shifted by the timezone offset (e.g. −3h on Europe/Moscow); they now match the schedule grid (US-5). CI never saw it (UTC runners).
- **Adaptive grid unchanged** → early/late activities extend the grid with padding exactly as before (US-6).

---

## Task 1: Domain — minutes canon, Tariff, delete Activity
### Classification: standard
### Required Docs
- `docs/specs/2026-09-05-unified-time-model-142-design.md` §2.1, §4.1, §6 — canon + exact contract
- `docs/domain-rules/services.md` — Tariff nested shape (title/price/description)

### Task Description
Files: `packages/domain/src/index.ts` (+ `packages/domain/src/*.test.ts` if they reference changed symbols — they don't per spec, verify).

1. Delete `ActivitySchema` + `Activity` type (index.ts:52-79, incl. v1 fields).
2. `ServiceSchema`: drop `duration` (hours); `durationMinutes: z.number().int().min(0)` (required); add `tariffs: z.array(TariffSchema)`.
3. Add above Service:
```ts
// ─── Tariff ───────────────────────────────────────────────────────────────
// Subset of api-client TariffResponse items (service_id FK dropped deliberately).
export const TariffSchema = z.object({
  id: z.string(),
  title: z.string(),
  price: z.number(),
  description: z.string().nullable(),
});
export type Tariff = z.infer<typeof TariffSchema>;
```
4. Keep legacy price twins (`defaultAdultPrice` etc.) — spec §4.1 decision.
5. `packages/domain/src/schedule.ts`: `ScheduleAdminDTO` — `startTime: number` → `startMinutes: z.number().int().min(0).max(1440)` — NOTE: schedule.ts uses plain interfaces, not Zod: just `startMinutes: number; // minutes from midnight`. Update the comment block.
6. Run `npm test` + `npm run type-check` in `packages/domain` — expect PASS there but **tsc in frontend/admin will now fail** (controlled-red window opens here, see Architecture note; residue = files owned by Tasks 4-8, do NOT fix here). Verify only that domain package itself is green: `cd packages/domain && npx tsc --noEmit`.
7. Commit: `feat(domain): minutes canon, Tariff schema, delete Activity schema (#142)`

Note: `frontend/web` imports only `ScheduleDTO`/`buildSchedule`/`resolveById`/`ScheduleIndex` — verify untouched by this change (web is not in the workspace build path of admin; no action needed).

## Task 2: api-client — schema-derived ActivityPatch
### Classification: small
### Required Docs
- Spec §4.7, §5
- `packages/api-client/src/schemas.ts:148-186` (existing ActivityCreateSchema/ActivityResponseSchema)

### Task Description
Files: `packages/api-client/src/schemas.ts`, `packages/api-client/src/endpoints.ts` (:282-287), `packages/api-client/src/index.ts` (exports if schema exports are listed).

1. In schemas.ts after ActivityCreate:
```ts
// ─── ActivityPatch (GH #142) ────────────────────────────────────────────────
// occupied is a documented wire anomaly: server-computed on read, backend
// Pydantic silently ignores it on PATCH; the frontend sends it for optimistic
// parity. Derived from the create schema so drift is a compile error.
export const ActivityPatchSchema = ActivityCreateSchema.partial().extend({
  occupied: z.number().optional(),
});
export type ActivityPatch = z.infer<typeof ActivityPatchSchema>;
```
2. `endpoints.ts` patchActivity signature: `data: Record<string, unknown>` → `data: ActivityPatch` (+ import).
3. Update the schema comment on `ActivityCreateSchema.start` / `ActivityResponseSchema.start`: `// floating local time (RFC 5545), NOT an instant — no zone suffix` (spec §2.1 / best-practices finding).
4. `cd packages/api-client && npm test && npx tsc --noEmit` → green (243+). Residue note: admin `patchActivity` call site (`ScheduleContext.tsx:317`) now type-mismatches (`Record<string, unknown>` vs `ActivityPatch`) — still inside the controlled-red window, owned by Task 5; do not fix here.
5. Commit: `feat(api-client): ActivityPatch type for typed optimistic updates (#142)`

## Task 3: lib/datetime.ts — the date module
### Classification: standard
### Required Docs
- Spec §7 (exact API + naming rationale + import policy)
- `frontend/admin/lib/utils.ts:76-86,150-280` (functions being absorbed/deleted)

### Task Description
Files: create `frontend/admin/lib/datetime.ts`, create `frontend/admin/__tests__/datetime.test.ts`; modify `frontend/admin/lib/utils.ts`.

1. Create `lib/datetime.ts` with EXACTLY this public API (spec §7):
```ts
// ─── Floating-local time module (GH #142) ──────────────────────────────────
// Single-TZ app: naive strings = studio wall clock (RFC 5545 floating time).
// The ONLY place that parses/composes schedule-canonical datetime strings.
// Future multi-TZ / Temporal support lands here (spec §11/§7).

export interface ParsedLocalISO {
  date: string;        // YYYY-MM-DD
  time: string;        // HH:MM (display cache — never a source for time math)
  startMinutes: number; // minutes from midnight
  dayIndex: number;    // Mon=0..Sun=6
}

export function parseLocalISO(start: string): ParsedLocalISO { /* new Date(start); LOCAL getters; dayIndex=(getDay()+6)%7 */ }
export function dateToLocalISO(date: Date): string { /* local getters + padStart — replaces ScheduleContext padStart blocks */ }
export function composeLocalISO(date: string, startMinutes: number): string { /* `${date}T${HH}:${MM}:00` */ }
export function toISODate(date: Date): string { /* local getters — replaces formatDateISO */ }
export function dayIndexToDate(monday: Date, dayIndex: number): string { /* monday + dayIndex days → YYYY-MM-DD */ }
export function weekDayIndex(date: Date): number { /* (getDay()+6)%7 */ }
export function formatTime(startMinutes: number): string { /* floor(min/60) + min%60, padStart — display ONLY */ }
export function hhmmToMinutes(hhmm: string): number { /* h*60+m; invalid → NaN (callers guard as today) */ }
export function getMonday(date: Date): Date { /* as in utils.ts:161-170 */ }
export function generateTimeSlots(gridFrequency: number, startMinutes: number, endMinutes: number): number[] { /* minute ints */ }
export function calculateGridTimeRange(acts: Array<{ startMinutes: number; durationMinutes: number }>, workingHoursStartH: number, workingHoursEndH: number): { startMinutes: number; endMinutes: number } { /* minute-space port of utils.ts:240-276, clamps [0,1440] */ }
```
2. Write `__tests__/datetime.test.ts` FIRST (RED) covering: parseLocalISO on naive + `Z`-suffixed + offset-suffixed strings; round-trips `dateToLocalISO`/`composeLocalISO`/`parseLocalISO`; `weekDayIndex` Mon/Sun; `dayIndexToDate` week edges (dayIndex 0 / 6 / Sunday activity → next-Monday boundary); `formatTime(0)=“00:00”`, `(630)=“10:30”`; `hhmmToMinutes` valid + invalid→NaN; `generateTimeSlots(30, 540, 660)` = [540,570,…,630]; `calculateGridTimeRange` empty-acts default, early-start clamp 0, late-end clamp 1440, padding ≥60min.
3. Implement to GREEN. Note: tests for TZ behavior use `process.env.TZ` like `__tests__/timezone-dnd-bug.test.ts` does (that file sets `TZ=Europe/Moscow`; the vitest config already uses `pool: 'forks'` — TZ tests are safe).
4. **Scope of this task = module + its tests ONLY.** `lib/utils.ts` is NOT touched here: its legacy helpers (`formatTime` float-hours, `getMonday`, `formatDateISO`, `generateTimeSlots`, `calculateGridTimeRange`, `decimalToHHMM`/`hhmmToDecimal`) still have live importers and are deleted in Task 10 (single owner of the utils deletion + importer migration). This keeps Task 3 standalone-green (new module, no importer changes).
5. Commit: `feat(admin): lib/datetime floating-local time module (#142)`

## Task 4: transformers + buildSchedule — slim to three transformers, startMinutes
### Classification: standard
### Required Docs
- Spec §4.3, §6
- `frontend/admin/lib/transformers.ts`, `frontend/admin/lib/buildSchedule.ts` (full read — small files)

### Task Description
Files: `frontend/admin/lib/transformers.ts`, `frontend/admin/lib/buildSchedule.ts`, `frontend/admin/lib/types.ts`, `frontend/admin/__tests__/transformers.test.ts`, `frontend/admin/__tests__/buildSchedule.test.ts`, `frontend/admin/__tests__/buildAdminSchedule.test.ts`.

1. transformers.ts: delete `normalizeDay`/`parseStart`/`transformActivity` (:8-41). `transformService`: drop `duration: raw.duration / 60`, set `durationMinutes: raw.duration`, add `tariffs: raw.tariffs ?? []`. Keep `defaultAdultPrice: raw.tariffs?.[0]?.price ?? 0`.
2. buildSchedule.ts: delete `ScheduleItem`/`ActivityIndex`/`ScheduleIndex`/`dayToDate`/`addToActivityIndex`/`toScheduleIndex`/`toScheduleItems` (:6-98). In `buildAdminSchedule`: `const { date, time, startMinutes } = parseLocalISO(act.start)` replaces :135-136 + :154 float math; `durationMinutes: act.duration` (unchanged); `day: dateToDayIndex(date, weekMonday)` stays (or reuse `dayIndexToDate` — keep `dateToDayIndex` local as-is, it's hour-free already). Import from `@/lib/datetime`.
3. types.ts re-exports: drop `Activity`, `ActivitySchema`.
4. Tests: transformers.test.ts — delete the transformActivity suite (:175-253); transformService assertions updated (`durationMinutes`, `tariffs` passthrough + `[]` default). buildSchedule.test.ts — delete toScheduleIndex/toScheduleItems suites (:151-261) AND migrate the remaining buildAdminSchedule assertions from `startTime: 10` to `startMinutes: 600` (:34, :46, :110 — plus any sibling fixtures). buildAdminSchedule.test.ts — same fixture migration (:84-93 area) + add tariff-through assertion (priceMin/priceMax/priceHint from service tariffs — already asserted? keep parity) + `startMinutes` assertions.
5. Dead-hook removal (same commit — its import of `transformActivity` dies in step 1): delete `hooks/useActivities.ts`, remove the dead import at `ScheduleContext.tsx:7`, delete the `useReactQueryHooks.test.tsx` useActivities suite (:220-260 + `transformActivity` mock :22). In the SAME file, add one useServices tariffs assertion per spec §9.8: after the existing useServices cases, assert `select` output carries `tariffs` (e.g. raw service with 2 tariffs → `result[0].tariffs.length === 2`) and `durationMinutes` (spec §9.8).
6. `npm test` (expect only tests fixed in this task to run green; **residue rule:** admin `tsc` failures at this point are EXPECTED and must be confined to `contexts/ScheduleContext.tsx` (old `Activity`/hours contract — Task 5) and `hooks/useDnD.ts` + view components (Tasks 6-8); list them explicitly in the report). `cd packages/api-client && npx tsc --noEmit` should stay green (api-client compiles independently — its own tsc does not include admin sources).
7. Commit: `feat(admin): transformers slim to master/service/location, buildAdminSchedule startMinutes (#142)`

## Task 5: ScheduleContext — minutes contract, typed optimistic, tariffs contract
### Classification: large
### Required Docs
- Spec §4.4, §5, §6
- `frontend/admin/contexts/ScheduleContext.tsx` (full read)
- `frontend/admin/__tests__/ScheduleContext.test.tsx`, `__tests__/helpers/mockContexts.ts`

### Task Description
Files: `frontend/admin/contexts/ScheduleContext.tsx`, `frontend/admin/contexts/NavigationContext.tsx`, `__tests__/ScheduleContext.test.tsx`, `__tests__/helpers/mockContexts.ts`, `__tests__/scheduleIntegration.test.tsx`.

1. Contract (`ScheduleContextType`):
   - Remove `servicesRaw: ServiceResponse[]` (:92, :494).
   - `addActivity: (a: { dayIndex: number; masterId: string; serviceId: string; locationId: string; startMinutes: number; durationMinutes: number; capacity: number; isPrivate?: boolean; comment?: string }) => void`.
   - `updateActivity: (id: string, updates: { dayIndex?: number; startMinutes?: number; durationMinutes?: number; masterId?: string; serviceId?: string; locationId?: string; capacity?: number; isPrivate?: boolean; comment?: string; occupied?: number }) => void`.
   - Add `gridStartMinutes: number; gridEndMinutes: number;` (derived via calculateGridTimeRange over filteredItems + workingHours; single derivation site — spec §4.4).
2. Implementation:
   - `addActivity` (:371-394): `start: composeLocalISO(dayIndexToDate(currentWeek, a.dayIndex), a.startMinutes)`; `duration: a.durationMinutes`; rest unchanged.
   - `updateActivityFn` (:396-420): time pair → `payload.start = composeLocalISO(dayIndexToDate(currentWeek, updates.dayIndex), updates.startMinutes)`; single `duration` mapping from `durationMinutes` (precedence hacks :401-402 die).
   - updateMutation (:313-363): typed `mutationFn` pre-assigned: `const updateActivityMutationFn = async ({ id, data }: { id: string; data: ActivityPatch }) => { …Promise.race… }`; onMutate optimistic mapper over `ActivityResponse[]` — replace the `Record<string, unknown>` ladder (:331-349) with a typed spread: build `const patch: Partial<ActivityResponse> = {}; if (data.start !== undefined) patch.start = data.start; …` (same key set); rollback (:353-357) `context.previousActivities as ActivityResponse[]`.
   - Internal raw queries (:269-287) stay; `servicesRaw` query feeds `buildAdminSchedule` only (rename local var allowed for clarity, e.g. `servicesRaw` stays as local — only the CONTRACT field dies).
   - gridStart/EndMinutes via `calculateGridTimeRange(filteredItems, workingHoursStart, workingHoursEnd)` in a `useMemo` next to `filteredItems` (:475-486 area).
   - **Date-range helpers migration (this task — they live in the file being edited):** replace the 15 `getMonday`/`formatDateISO` usages inside ScheduleContext.tsx (setCurrentWeek :132-134, prevPeriod/nextPeriod :435-458, week calc :214-233 area) with `@/lib/datetime` `getMonday`/`toISODate` (drop the utils import at :24-25; `CELL_HEIGHT_*`/`GRID_FREQUENCY_*` constant imports stay or move to their new home if utils keeps them — they stay in utils). ALSO migrate `contexts/NavigationContext.tsx:4` (`getMonday`, `formatDateISO`→`toISODate`, usages :15-19) — one-line import swap, same semantics.
3. `__tests__/helpers/mockContexts.ts:29`: remove `servicesRaw: []` from the mock; add `gridStartMinutes`/`gridEndMinutes` sensible defaults (540/1260).
4. `ScheduleContext.test.tsx`: fixtures (:51-52 — services with `duration: 2.5` hours!) migrate to `durationMinutes: 150`; add/update-activity tests assert `start` strings + `duration` minute payloads; mixed naive/`Z` fixture at :262 STAYS (canon accepts both). Update mock query data shapes (activities as raw `ActivityResponse`).
5. `scheduleIntegration.test.tsx`: refresh stale comments about transformActivity/useActivities flow (:148, :188-189); fixtures to raw responses where they emulate the query cache.
6. DoD: `npm test` green for these suites; tsc errors allowed ONLY in unmigrated view components (Tasks 6-8 files — list explicitly).
7. Commit: `feat(admin): ScheduleContext minutes contract, typed optimistic, grid bounds (#142)`

## Task 6: useDnD — minute-space drag math
### Classification: standard
### Required Docs
- Spec §4.5 (useDnD bullets), §2.3
- `frontend/admin/hooks/useDnD.ts` (full read), `frontend/admin/__tests__/useDnD.test.ts`

### Task Description
Files: `frontend/admin/hooks/useDnD.ts`, `__tests__/useDnD.test.ts`.

1. `slotIndexToTime`→`slotIndexToMinutes(slotIndex, gridFrequency, gridStartMinutes)` = `gridStartMinutes + slotIndex * gridFrequency` (HOURS_START default 540; keep default param pattern).
2. `snapToGrid(minutes, gridFrequency)` minute-space (round to nearest multiple of gridFrequency minutes).
3. Drag handlers (:156-203): `newStartMinutes`; drag-copy payload uses new `addActivity` signature (drop `duration`/`serviceName`/`minAge`/`maxAge` legacy fields — the copy needs `durationMinutes` from the source DTO); move-update payload `{ dayIndex, startMinutes, …columnField }`; undo payload likewise from `original.dayIndex/startMinutes` (original is `ScheduleAdminDTO` now).
4. `parseSlotId` unchanged.
5. useDnD.test.ts: fixture + assertion migration to minutes (367-area covers 5/15/30 frequencies — keep those cases, add 60).
6. DoD: suite green; tsc errors confined to Task 7-8 files.
7. Commit: `feat(admin): useDnD integer-minute drag math (#142)`

## Task 7: DayColumn + TimeColumn + NowLine — grid geometry in minutes
### Classification: standard
### Required Docs
- Spec §4.5, §2.3 (PX_PER_MINUTE)
- `frontend/admin/app/components/schedule/DayColumn.tsx` (full read — largest), `TimeColumn.tsx`, `NowLine.tsx`
- `frontend/admin/__tests__/DayColumn.test.tsx` (~80 cases — read the fixture section first)

### Task Description
Files: `DayColumn.tsx`, `TimeColumn.tsx`, `NowLine.tsx`, `__tests__/DayColumn.test.tsx`.

1. DayColumn: `TIME_GROUPS` bounds → minutes (G1 540-779, G2 780-959, G3 960-1439); `DroppableSlot` props rename `startTime`→`slotMinutes`; slot list from `generateTimeSlots(gridFrequency, gridStartMinutes, gridEndMinutes)`; `slotHeight = cellHeight * (gridFrequency / 30)` unchanged; card geometry :287-289/:325-327: `topPx = (a.startMinutes - gridStartMinutes) * cellHeight / 30`, `heightPx = max(a.durationMinutes * cellHeight / 30, 60|52)`; cursor-time :335 `gridStartMinutes + y / (cellHeight / 30)`; overlap/z sort by `startMinutes`; stamp ghost :96 `endTimeMinutes = slotMinutes + service.durationMinutes` (ghost label `formatTime(slotMinutes)–formatTime(endTimeMinutes)`); slot minute-labels via `formatTime`; `gridStart/gridEnd` props become minutes (`gridStartMinutes`).
2. TimeColumn: slots in minutes; hour-line check `minutes % 60 === 0`; labels `formatTime(minutes)`.
3. NowLine: `nowMinutes = now.getHours()*60 + now.getMinutes()`; `pos = (nowMinutes - gridStartMinutes) * cellHeight / 30`; `gridStart` prop → `gridStartMinutes` (default 540).
4. DayColumn.test.tsx: fixtures → `ScheduleAdminDTO` shape (`startMinutes`/`durationMinutes`); geometry expectations re-expressed (`topPx = Δmin * cellHeight / 30`); all rendered time strings unchanged values.
5. DoD: suite green; tsc errors confined to Task 8 files.
6. Commit: `feat(admin): DayColumn/TimeColumn/NowLine minute geometry (#142)`

## Task 8: ActivityCard + OverlapPopover + DayView + WeekView + modal — DTO consumers
### Classification: large
### Required Docs
- Spec §4.5 (all bullets), §6 (tariffs consumers)
- `ActivityCard.tsx`, `OverlapPopover.tsx`, `DayView.tsx`, `WeekView.tsx`, `ActivityDetailsModal.tsx`, `SettingsTab.tsx` (full reads)

### Task Description
Files: those five + `__tests__/ActivityCard.test.tsx`, `__tests__/OverlapPopover.test.tsx`, `__tests__/DayView.test.tsx`, `__tests__/WeekView.test.tsx`, `__tests__/ActivityDetailsModal.test.tsx` (+`__tests__/helpers/mockData.ts`, `__tests__/helpers/clientRecordTabSetup.ts` fixture updates).

1. ActivityCard: `topPx` :27 via minutes; `durMinutes` :28 → `activity.durationMinutes`; footer :116 `formatTime(startMinutes)–formatTime(startMinutes + durationMinutes)`.
2. OverlapPopover: sorts/column math :24/:31/:109-110 in minutes; timeline :237-238 + labels :226 `formatTime(minutes)`.
3. DayView: delete hour-bridge :179 & :471 (`{...a, duration: …/60}`) — pass `ScheduleAdminDTO[]` straight through; quick-add :137-159 passes `startMinutes` + `durationMinutes: service.durationMinutes`; `selectedDayISO` :165-170 → `toISODate(selectedDay)`; drag ghost :322/:551/:557 minutes; consumes `gridStartMinutes/gridEndMinutes` from context (drop local calculateGridTimeRange call :185).
4. WeekView: same — bridges :113/:272 die; quick-add :84-106 minutes; `dateToISO` :150-155 → `toISODate`; ghost :164/:319/:325 minutes; context grid bounds (drop :119 local call).
5. ActivityDetailsModal: `activity: ScheduleAdminDTO`; context label :237-239 → `new Date(activity.date + 'T' + activity.time + ':00')`; tariffs :27/:49-53 from `services` (domain) — `services.find((s) => s.id === activity.serviceId)?.tariffs ?? []`; remove `servicesRaw` from the destructure :27.
6. SettingsTab: drop the `{ tariffs?: … }` cast :51 (domain Service now has tariffs — tariff list :235-245 reads `selectedService.tariffs` typed); `durationStr` :37 `formatTime(activity.durationMinutes)`; snap handler :86-93 minutes (`hhmmToMinutes` on the time input, snap, `composeLocalISO`); duration change :99-105 → `durationMinutes: hhmmToMinutes(value)`; reset :117 same; service autofill :66-72 `durationMinutes: svc.durationMinutes`; `buildDateTimeLocal` :2-15 helper rewritten for minutes (or deleted in favor of composeLocalISO + slicing).
7. All five test files: fixture migration (`startMinutes`, `durationMinutes`, no `startTime:` floats — ActivityDetailsModal.test.tsx:769 `startTime: 14 + 4/60` → `startMinutes: 845`); helpers/mockData.ts Activity mock (:77) + Service mocks (duration→durationMinutes, +tariffs where relevant); clientRecordTabSetup.ts Service fixture :79 gains typed tariffs.
8. DoD: all touched suites green; `npm run type-check` GREEN for the whole admin (this task closes the tsc window — verify explicitly).
9. Commit: `feat(admin): grid views + modal on ScheduleAdminDTO minutes, domain tariffs (#142)`

## Task 9: records-side UTC fixes
### Classification: small
### Required Docs
- Spec §4.6
- `recordsColumns.tsx:18-31`, `RecordsTable.tsx:155-170`, `ClientQuickCard.tsx` (formatTime def :20, usage :155)

### Task Description
Files: `app/(main)/records/components/recordsColumns.tsx`, `RecordsTable.tsx`, `ClientQuickCard.tsx`, `__tests__/` records suites if they exercise parseActivityStart (grep first).

1. Delete `parseActivityStart` (:24-30). Column render (:59-63): `const parsed = parseLocalISO(row.activity_start)` → `formatDateRu(parsed.date)` + `formatTime(parsed.startMinutes)` — import both from `@/lib/datetime` (drop the utils formatTime import :9 if it was float-hours — YES it was: utils formatTime accepted float hours; records callers passed `parsed.startTime` float. Now minutes.).
2. RecordsTable :159-165: same substitution.
3. ClientQuickCard :155: replace `new Date(activity.start).getUTCHours() + getUTCMinutes()/60` + local float-formatTime (:20) with `parseLocalISO(activity.start).startMinutes` + datetime `formatTime`. Delete the local formatTime helper.
4. NEW unit test `__tests__/recordsTimeParity.test.ts` (spec US-5): under `process.env.TZ = 'Europe/Moscow'` (file-top, like timezone-dnd-bug.test.ts), one raw `start: '2026-09-03T10:30:00'` → assert `buildAdminSchedule` item `startMinutes === 630 && time === '10:30'` AND `parseLocalISO(start).startMinutes === 630` (grid/records/quickcard parity — same parser now).
5. DoD: records suites green; parity test green.
6. Commit: `fix(admin): records/ClientQuickCard render studio-local time, not UTC (#142)`

## Task 10: dead-code sweep + utils deletion + grep gates
### Classification: standard
### Required Docs
- Spec §8 (delete list), §9 gates G1-G6
- —

### Task Description
Files: `frontend/admin/lib/utils.ts` (+ any straggler importers surfaced by gates).

1. Delete from utils.ts: `decimalToHHMM`, `hhmmToDecimal`, `formatTime`, `getMonday`, `formatDateISO`, `generateTimeSlots`, `calculateGridTimeRange` (+ GridActivity/GridTimeRange). **Importer migration checklist (grep-verified owners; migrate any not already done in Tasks 5-9):**
   - `app/components/layout/Menubar.tsx:10`, `app/components/layout/Topbar.tsx:5`, `app/(main)/records/components/BookingFilters.tsx:6` — import swap to `@/lib/datetime` (`getMonday` identical, `formatDateISO`→`toISODate` rename; BookingFilters' `formatTime` usage: verify arg — records pass minutes post-Task-9, layout callers display-only).
   - Test-file importers (relative-path imports to fix in this task): `__tests__/Menubar.test.tsx:8`, `__tests__/NavigationContext.test.tsx:5`, `__tests__/optimisticUpdate.test.tsx:7`, `__tests__/ScheduleContext.test.tsx:7`.
   - `__tests__/utils.test.ts:5-16` — delete the describe blocks for all six deleted functions (:52-101, :153-167, :170-213, :292-314, :316-384 — decimalToHHMM/hhmmToDecimal/formatTime/getMonday/formatDateISO/generateTimeSlots/calculateGridTimeRange coverage now lives in `__tests__/datetime.test.ts`); keep the rest of the file (display formatters).
2. Run the GATES (spec §9, all from repo root) and fix any residue:
   - G1 `grep -rn "decimalToHHMM\|hhmmToDecimal" frontend/admin` → 0
   - G2 `grep -rn "duration / 60\|duration \* 60\|\* 60\|/ 60" frontend/admin/app frontend/admin/hooks frontend/admin/contexts frontend/admin/lib` → 0
   - G3 `grep -rn "getUTCHours\|getUTCMinutes\|getUTCDay" frontend/admin/app frontend/admin/lib frontend/admin/hooks frontend/admin/contexts` → 0
   - G4 `grep -n "servicesRaw" frontend/admin/contexts/ScheduleContext.tsx` → only internal query var, absent from ScheduleContextType
   - G5 `grep -rn "padStart(2, '\?0'\?)" frontend/admin` → only lib/datetime.ts + §7-exempt display files (utils formatters, DateTimePicker, TimePicker, RecordPaymentsTable, e2e helpers)
   - G6 `grep -rn "startTime" frontend/admin/app frontend/admin/hooks frontend/admin/lib frontend/admin/contexts frontend/admin/__tests__` → 0 as identifier (e2e local display-string vars exempt)
   - Sweep gates on `frontend/admin/__tests__`: `grep -rn "startTime:" frontend/admin/__tests__` → 0.
3. Also delete `hooks/useActivities.ts` if not already removed in Task 4 (spec §8), and confirm `ScheduleContext.tsx:7` import gone.
4. `npm test && npm run type-check && npm run lint` → all green.
5. Commit: `chore(admin): delete dead time layer, enforce #142 grep gates (#142)`

## Task 11: timezone-dnd-bug rewrite + fixture sweep verification
### Classification: standard
### Required Docs
- Spec §9.3, §9.1, §10 US-1
- `frontend/admin/__tests__/timezone-dnd-bug.test.ts` (full read — 3 tests)

### Task Description
Files: `__tests__/timezone-dnd-bug.test.ts`; verify-only pass over all unit fixture files.

1. Rewrite under `TZ=Europe/Moscow` (keep file-top `process.env.TZ` + note pool=forks):
   - Test 1 (buildAdminSchedule local extraction): naive `"2026-06-07T23:30:00"` (Sunday) → item `{ day: 6, date: '2026-06-07', startMinutes: 1410 }` — no day jump, no −3h.
   - Test 2 (DnD round-trip): `composeLocalISO(dayIndexToDate(MONDAY, 1), 570) → '2026-06-02T09:30:00'` → `parseLocalISO(...).startMinutes === 570 && dayIndex === 1`.
   - Test 3 (grid parity): same fixture through `parseLocalISO` and through buildAdminSchedule — identical startMinutes/time (US-1/US-5 anchor).
   - Refresh stale header comments (the old toScheduleIndex/dayToDate story).
2. Fixture sweep verification (grep, fix any residue): `grep -rn "startTime" frontend/admin/__tests__` → 0; `grep -rn "duration: [0-9]*\.[0-9]" frontend/admin/__tests__` → 0 (float durations in Activity-shaped fixtures); `grep -rn "transformActivity\|toScheduleIndex\|toScheduleItems" frontend/admin/__tests__` → 0.
3. Full local fast suite: `npm test` → green, count ≥ 1580 passing.
4. Commit: `test(admin): timezone DnD suite on minutes canon, fixture sweep clean (#142)`

## Task 12: domain-rules doc sync
### Classification: trivial
### Required Docs
- `docs/domain-rules/activities.md` (§Frontend :43-44), `docs/domain-rules/services.md` (Fields table)
- Spec §4.6 doc-sync note

### Task Description
Files: `docs/domain-rules/activities.md`, `docs/domain-rules/services.md`.

1. activities.md §Frontend: replace "DateTime parsing: datetime-local → startTime (decimal hours) + day (Mon=0) + date (ISO)" and "Duration conversion: HH:MM string ↔ decimal hours ↔ durationMinutes" with the canon: datetime-local → `startMinutes` + `dayIndex` → `composeLocalISO`; duration = integer minutes (`durationMinutes`), display via `formatTime`; note `lib/datetime.ts` as the single parser (floating local time) and the records/grid parity guarantee.
2. services.md: add to Fields or a note under Frontend — domain `Service` (frontend) now carries `tariffs: Tariff[]` (id/title/price/description) via `transformService`; `durationMinutes` is the canonical duration field (no hours twin).
3. Commit: `docs: sync activities/services domain rules with #142 time canon`

## Task 13: full-suite verification + PR readiness
### Classification: small
### Required Docs
- Spec §13 acceptance criteria
- `.opencode/skills/dev-workflow/SKILL.md` (test commands/ports)

### Task Description
Files: none (verification only; fixes route back to owning tasks' files).

1. Full local gate: `cd frontend/admin && npm test && npm run type-check && npm run lint`; `cd packages/api-client && npm test`; `cd packages/domain && npm test`; backend untouched sanity `git status` (no backend/src changes).
2. Re-run all six grep gates G1-G6 (spec §9) — record outputs in the task report.
3. Verify US mapping: US-1 (timezone suite), US-2/3/4 (Task 8 suites), US-5 (recordsTimeParity), US-6 (grid bounds — calculateGridTimeRange tests in datetime.test.ts). All green locally; e2e = CI (existing specs unedited where possible: week-view, dayview-column-reorder, activity-details-modal duration format, records specs).
4. e2e edit check: grep e2e specs for deleted symbols (`grep -rn "startTime\|toScheduleIndex\|parseActivityStart" frontend/admin/e2e`) — expect only display-string locals (exempt) or fixtures via API (naive strings, unchanged).
5. Report per spec §13 checklist; flag any residual concern to architect.
6. Commit (if any residue fixed): `chore(admin): #142 final sweep residue` — else no commit.

---

## Plan Self-Review

- **Spec coverage:** §2 canon → T1/T3; §4.1 → T1; §4.2 → T3(+T10); §4.3 → T4; §4.4/T5 contract → T5; §4.5 → T6/T7/T8; §4.6 → T9; §4.7 → T2; §5 → T5; §6 → T1/T4/T8; §7 → T3; §8 delete list → T4/T10; §9 tests+gates → T3/T4/T5/T6/T7/T8/T9/T10/T11; US-1..6 → T7/T8/T9/T11 + DoD lines; domain-rules sync → T12; AC §13 → T13. Gaps: none.
- **Classification:** T5/T8 large (contract rippling + 5 test files), T1/T3/T4/T6/T7/T10/T11 standard, T2/T9/T13 small, T12 trivial. Matches complexity table (multi-file + state + contract = standard/large).
- **Type consistency:** `startMinutes`/`durationMinutes`/`dayIndex` used identically T1→T13; `ActivityPatch` defined T2, consumed T5; `composeLocalISO`/`parseLocalISO` defined T3, consumed T4-T9.
- **Required Docs:** every task lists docs; testing tasks reference skill docs via IMPL dispatch (architect adds `vitest-playwright-patterns` to coder prompts for T7/T8/T11).
- **No placeholders:** all steps carry exact signatures/commands; intermediate-state rules are explicit ownership rules, not deferrals (T3 step 4 = "module + tests only, utils deletion owned by Task 10"; T4 step 6 = residue confined to later tasks' files; T4 step 5 = dead-hook removal).
