# GH #142 — Unified Time Model (DTO vs domain, hours vs minutes, local-ISO) — Design Spec

Date: 2026-09-05 · Repo: memo · Baseline: main @ cc8bc52 · Phase: DESIGN (G1a PASSED — decisions below are binding, do not re-open)

## 1. Context & Goals

The admin frontend currently runs **three parallel representations of activity time**:

1. **API/DTO world** — `ActivityResponse` (`packages/api-client/src/schemas.ts:168-184`): `start` = naive ISO datetime string (e.g. `"2026-09-03T10:30:00"`, server emits naive `isoformat()` per `backend/src/schemas/activity.py:14`), `duration` = **integer minutes**. This is the wire contract and the backend semantic — correct.
2. **Legacy domain world** — `ActivitySchema` (`packages/domain/src/index.ts:52-79`): `day` (Mon=0), `startTime` **float hours** (10.5 = 10:30), `duration` **float hours**, `durationMinutes` optional, plus dead v1 fields (`isPublic/date/endTime/priceAdult/priceChild/priceIndividual/hasRecords/clientName` — zero non-test consumers). Built by `transformActivity` (`frontend/admin/lib/transformers.ts:25-41`).
3. **Grid DTO world** — `ScheduleAdminDTO` (`packages/domain/src/schedule.ts:29-37`): `date` "YYYY-MM-DD" + `time` "HH:MM" (string-sliced from `start` at `lib/buildSchedule.ts:135-136`) + `durationMinutes` **and additionally** `day` + `startTime` **float hours** computed at `buildSchedule.ts:153-154`. This is the dominant type of the grid; consumers bridge back to hours via `{...a, duration: a.durationMinutes / 60}` (`DayView.tsx:179,471`; `WeekView.tsx:113,272`).

Cross-cutting symptoms:

- **12+ conversion points hours↔minutes** scattered across hooks/components; minutes take precedence where remembered (`ScheduleContext.tsx:388,401-402`), hours are fallback elsewhere (`ActivityCard.tsx:28`, `DayColumn.tsx:288,326`, `OverlapPopover.tsx:238`, `DayView.tsx:322`, `WeekView.tsx:164`).
- **8+ inline `padStart` date/ISO assemblies**: `ScheduleContext.tsx:376-381,412-417`; `DayView.tsx:165-170`; `WeekView.tsx:150-155`; `lib/buildSchedule.ts:24-31` (dayToDate); `lib/utils.ts:197-202` (formatDateISO).
- **UTC-vs-local parser conflict** for the same naive `start` string: `transformers.ts:15-21` uses local getters, `recordsColumns.tsx:24-30` (`parseActivityStart`) uses **UTC getters** (`getUTCDay/getUTCHours`). On a non-UTC browser (the studio runs Europe/Moscow) the records table silently renders activity time **minus 3 hours** while the schedule grid renders it correctly. Tests stay green only because CI/containers run UTC.
- **`servicesRaw` leaks into the context contract** (`ScheduleContextType.servicesRaw`, `ScheduleContext.tsx:92,494`) solely because `transformService` (`transformers.ts:54-65`) drops `tariffs` — the domain `Service` (`packages/domain/src/index.ts:32-48`) has no tariff field, so `ActivityDetailsModal` reads tariffs from raw (`ActivityDetailsModal.tsx:49-53`) and `SettingsTab.tsx:51` paper-casts domain `Service` with `{ tariffs?: ... }`.
- **Optimistic updates are untyped**: mutation payload `Record<string, unknown>` (`ScheduleContext.tsx:314,331-349,397`), passthrough in `patchActivity` (`packages/api-client/src/endpoints.ts:282-287`).
- **Dead layer**: `transformActivity`/`parseStart`/`normalizeDay` live only in tests + the never-called `useActivities` hook (imported but unused at `ScheduleContext.tsx:7`); `toScheduleIndex`/`toScheduleItems`/`ScheduleItem` in `lib/buildSchedule.ts:6-98` have zero non-test consumers.

**Goals**

1. ONE canonical time model: `start` = local-ISO string, duration = integer minutes, everywhere between api-client and pixels.
2. Zero fractional-hours arithmetic in the codebase (grid layout = integer-minute math × px/minute).
3. Delete the dead transformation layer and its tests.
4. `Service` carries tariffs; `servicesRaw` leaves the context contract.
5. Typed optimistic updates.
6. One date/time module with a single parsing semantic (local), fixing the records UTC shift.

**Non-goal**: any visible behavior change. Every screen renders exactly as today (see §10 User Scenarios — all are regression guards).

## 2. Time Canon (G1a binding decisions 1-2)

### 2.1 Canonical representations

| Concern | Canonical form | Notes |
|---|---|---|
| Activity start (wire/domain/UI) | local-ISO string `"YYYY-MM-DDTHH:MM:SS"` (no zone suffix) | Server emits naive isoformat; parsed with **local** semantics (see §7) |
| Activity start (computational) | `startMinutes: number` — integer minutes from midnight | Derived once, in `buildAdminSchedule` / the date module |
| Day of week | `dayIndex: number` (Mon=0..Sun=6) | Grid positioning only; canonical date identity is `date: "YYYY-MM-DD"` |
| Duration | `durationMinutes: number` — integer minutes, ALWAYS | Single field; no hours twin |
| Human display | `"HH:MM"` via `formatTime(minutes)` | The ONLY place hours-as-text exist; rendering concern, never re-parsed for math |

### 2.2 What survives in "hours"

- **Grid settings** (not activity time): `workingHoursStart/End` (integers 0-23, user settings, `ScheduleContext.tsx:118-121`), `HOURS_START/HOURS_END` defaults, `gridFrequency` (minutes already), `cellHeight` (px per 30-min slot). These are converted to minutes **at the grid boundary** (`gridStartMinutes = workingHoursStart * 60`); no float hours flow anywhere.
- **Display strings** "10:30" produced by `formatTime`. Never parsed back except in the datetime-local input handler, which goes through `hhmmToMinutes` directly.

### 2.3 Grid layout math (integer minutes)

- Slot generation: `generateTimeSlots(gridFrequency, startMinutes, endMinutes)` → integer minute values.
- Card position: `topPx = (startMinutes - gridStartMinutes) * PX_PER_MINUTE`, `heightPx = durationMinutes * PX_PER_MINUTE`, where `PX_PER_MINUTE = cellHeight / 30` (today's `cellHeight * 2 / 60`, unchanged geometry: 60px per half-hour slot ⇒ 2px/min at default).
- Snapping: `snapToGrid(minutes, gridFrequency)` in minute space; `slotIndexToMinutes(slotIndex, gridFrequency) = gridStartMinutes + slotIndex * gridFrequency`.
- Sub-pixel results are permitted when a non-default `cellHeight` is not a multiple of 30 (CSS handles fractional px; identical visual outcome to today's float-hours math, which had the same property).
- Overlap/time-group comparisons (`OverlapPopover.tsx:24,31,109-110`, `DayColumn.tsx:27,245,395,425-429,487-488`, `calculateGridTimeRange` `lib/utils.ts:240-276`) all operate in minutes.

### 2.4 Contract changes (breaking, sanctioned — pre-production)

| Type | Change |
|---|---|
| `packages/domain` `ActivitySchema` + `Activity` | **Deleted entirely** (with v1 fields). No non-test consumer remains after migration |
| `packages/domain` `ServiceSchema.duration` (hours) | **Deleted**; `durationMinutes: z.number()` becomes the single required duration field |
| `packages/domain` `ServiceSchema` | **+ `tariffs: Tariff[]`** (see §6) |
| `packages/domain` `ScheduleAdminDTO.startTime` (float) | **Replaced** by `startMinutes: number`; `day` keeps its Mon=0 semantic; `time: "HH:MM"` stays as render cache (web-facing `ScheduleDTO` base is untouched) |
| `ScheduleContextType.addActivity / updateActivity` | Signature moves from domain-`Activity` fragments (hours) to `{ dayIndex, startMinutes, durationMinutes, ... }` (§4.4) |
| `ScheduleContextType.servicesRaw` | **Removed** from the public contract (internal raw query for `buildAdminSchedule` stays) |
| api-client `patchActivity` payload | `Record<string, unknown>` → exported `ActivityPatch` type (§5) |

`frontend/web` is not affected: it imports only `ScheduleDTO`, `buildSchedule`, `resolveById`, `ScheduleIndex` from `@memo/domain` (verified: `frontend/web/app/lib/mappers/buildSchedule.ts:1-7`, `frontend/web/app/hooks/useSchedule.ts:6`) — none of the changed symbols.

## 3. Target Data Flow

```
api-client (ActivityResponse: start string, duration minutes)   ← wire, unchanged
   │
   ├─ date-module parseLocalISO(start) → { date, time, startMinutes, dayIndex }
   │    (ONE parser, LOCAL semantics — replaces transformers.parseStart AND recordsColumns.parseActivityStart)
   │
   ├─ buildAdminSchedule(raw…) → ScheduleAdminDTO { date, time, startMinutes, dayIndex, durationMinutes, … }
   │    (still raw-in: masters/services/locations Response arrays — out of scope to re-source, §11)
   │
   ├─ transformMaster / transformService / transformLocation   (transformers.ts keeps ONLY these three)
   │
   └─ ScheduleContext
        ├─ contract: activities: ScheduleAdminDTO[], add/update in minutes-canonical objects
        ├─ optimistic cache writes typed as ActivityResponse patches
        └─ mutations → createActivity(ActivityCreate) / patchActivity(ActivityPatch) — start built by toLocalISO()
```

Components consume `ScheduleAdminDTO` **directly** — the `{...a, duration: a.durationMinutes / 60}` bridges die.

## 4. Migration Inventory (verified against main @ cc8bc52)

### 4.1 Domain package (`packages/domain/src/`)

- `index.ts`: delete `ActivitySchema`/`Activity` (:52-79); `ServiceSchema`: drop `duration`, make `durationMinutes` required, add `tariffs: z.array(TariffSchema)`; add `TariffSchema` (`{ id: string; title: string; price: number; description: string | null }[]` — mirrors `ServiceResponse.tariffs`). Optional legacy price twins on Service (`defaultChildPrice`, `adultPrice`, … :40-44) have no writers/readers via `transformService` — **kept** (removal is cosmetic, not time-canon; noted for a later sweep).
- `schedule.ts`: `ScheduleAdminDTO` — replace `startTime: number` with `startMinutes: number`. Base `ScheduleDTO` untouched (web).

### 4.2 Date module — NEW `frontend/admin/lib/datetime.ts` (§7 for API)

Absorbs from `lib/utils.ts`: `formatTime` (minutes-in), `getMonday`, `formatDateISO` (→ `toISODate`), `generateTimeSlots` (minutes), `calculateGridTimeRange` (minutes); deletes `decimalToHHMM`/`hhmmToDecimal` (:76-86). `lib/utils.ts` keeps pure display helpers (`formatDate`, `formatDateRu`, `formatActivityContext`, `formatActivityLabel`, `displayMasterName`, color utils) — re-importing time primitives from `datetime.ts` where needed for compatibility re-exports during migration.

### 4.3 Transform / build layer (`frontend/admin/lib/`)

- `transformers.ts`: delete `normalizeDay`/`parseStart`/`transformActivity` (:8-41). `transformService` gains `tariffs: raw.tariffs ?? []`, `durationMinutes: raw.duration` (drop `duration: raw.duration / 60`).
- `buildSchedule.ts`: delete `ScheduleItem`/`ActivityIndex`/`ScheduleIndex`/`dayToDate`/`addToActivityIndex`/`toScheduleIndex`/`toScheduleItems` (:6-98 — zero non-test consumers, verified). `buildAdminSchedule` (:115-183) stays raw-in; `startTime: parseInt…+…/60` (:154) → `startMinutes: hh*60+mm` via date-module parse; `dayToDate` logic moves to `datetime.dayIndexToDate`.
- `types.ts` re-exports: drop `Activity`, `ActivitySchema`; keep the rest.

### 4.4 `ScheduleContext.tsx`

- Remove dead `useActivities` import (:7) and `servicesRaw` from the contract (:92, :494). Internal raw queries for `buildAdminSchedule` (:278-287, :463-472) stay.
- `addActivity` (:371-394): accepts `{ dayIndex, masterId, serviceId, locationId, startMinutes, durationMinutes, capacity, isPrivate?, comment? }`; builds `start: toLocalISO(dayIndexToDate(currentWeek, dayIndex), startMinutes)` (replaces padStart block :372-381); sends `duration: durationMinutes` (kills hours-fallback :388).
- `updateActivity` (:396-420): accepts `{ dayIndex?, startMinutes?, durationMinutes?, masterId?, serviceId?, locationId?, capacity?, isPrivate?, comment?, occupied? }`; time pair `(dayIndex, startMinutes)` → `start` string (replaces :408-418); `duration` precedence hacks (:401-402) collapse to one field.
- Optimistic update block (:314, :331-349, rollback :356): typed via `ActivityPatch` (§5); cache writes typed as `ActivityResponse[]`.
- Working-hours → grid boundary: expose `gridStartMinutes`/`gridEndMinutes` (derived from `workingHoursStart/End`, `calculateGridTimeRange` in minutes) instead of leaking hour floats to views. `workingHoursStart/End` themselves stay integer-hour settings (:118-121 contract unchanged).

### 4.5 Grid components (minutes all the way down)

- `hooks/useDnD.ts`: `slotIndexToTime`→`slotIndexToMinutes` (:77-84), `snapToGrid` minute-space (:88-93), `newStartTime`→`newStartMinutes` (:156), drag payloads (:166-167, :184, :198) in minutes; `addActivity`/`updateActivity` calls use the new signatures.
- `app/components/schedule/DayColumn.tsx`: `TIME_GROUPS` (:27) minute bounds; slot props in minutes (:43-44, :60-81, :425-437); card geometry :287-289, :325-327 via PX_PER_MINUTE; stamp ghost end-time :96 (`startTime + service.durationMinutes`).
- `ActivityCard.tsx`: geometry :27-28; footer label :116 `formatTime(startMinutes)–formatTime(startMinutes + durationMinutes)`.
- `DayView.tsx` / `WeekView.tsx`: delete hour-bridges (:179, :471 / :113, :272) — components take `ScheduleAdminDTO[]`; quick-add (:137-159 / :84-106) passes `startMinutes`, `durationMinutes: service.durationMinutes`; local `dateToISO` dups (:165-170 / :150-155) → `datetime.toISODate`; drag ghost (:322, :551, :557 / :164, :319, :325) in minutes.
- `OverlapPopover.tsx`: sorts/column math (:24, :31, :109-110) and timeline geometry (:237-238) in minutes.
- `app/components/modal/ActivityDetailsModal/*`:
  - `ActivityDetailsModal.tsx`: `activity: Activity` → `ScheduleAdminDTO`; context header :237-239 → `new Date(activity.date + 'T' + activity.time + ':00')` (no `formatTime(startTime)` re-assembly); tariffs from `services` (domain) instead of `servicesRaw` (:27, :49-53).
  - `SettingsTab.tsx`: `decimalToHHMM`/`hhmmToDecimal` (:8, :37, :66, :88-92, :103-105, :117) → `formatTime`/`hhmmToMinutes` over `durationMinutes`; datetime-local snap :86-93 in minutes; service autofill :66-72 uses `svc.durationMinutes`; drop the `{ tariffs?: … }` cast (:51).
  - Modal input stays `type="time"`-like `"HH:MM"` — e2e expects `/^\d{2}:\d{2}$/` (`e2e/activity-details-modal.spec.ts:326`), preserved.

### 4.6 Records (UTC-shift fix)

- `app/(main)/records/components/recordsColumns.tsx:24-30`: `parseActivityStart` **deleted**; the "Дата / Время" column (:59-63) uses `datetime.parseLocalISO` (local semantics) — same displayed value as the grid in ANY browser timezone. `RecordsTable.tsx:159-165` likewise. (Today's UTC getters are correct only in a UTC browser.)

### 4.7 api-client

- `endpoints.ts`: `patchActivity(id, data: Record<string, unknown>)` (:282-287) → `patchActivity(id, data: ActivityPatch)`; export `ActivityPatch` from `schemas.ts` = `Partial<Pick<ActivityCreate, 'master_id'|'service_id'|'location_id'|'start'|'duration'|'capacity'|'is_private'|'comment'|'record_info'>> & { occupied?: number }` (occupied is frontend-computed optimistic field, sent today at `ScheduleContext.tsx:344/:406`). No wire change.

## 5. Optimistic Update Typing

- `ActivityPatch` (api-client, §4.7) types the mutation variable + `patchActivity`.
- `ScheduleContext` updateMutation: `mutationFn({ id, data }: { id: string; data: ActivityPatch })`; optimistic mapper iterates `ActivityResponse[]` with a typed field-assign (the `if (data.x !== undefined)` ladder :336-344 becomes a typed `Object.assign`-style spread over allowed keys); rollback :353-357 typed `ActivityResponse[]`.
- `addActivity` path already builds an `ActivityCreate` — stays typed as today (:309).

## 6. Service Contract (+tariffs)

- `Tariff` (domain): `{ id: string; title: string; price: number; description: string | null }` — shape-compatible with `ServiceResponse['tariffs']` items (`packages/api-client/src/schemas.ts` Service tariffs).
- `ServiceSchema.tariffs: Tariff[]` (required, default `[]` from transformer).
- `transformService`: maps `raw.tariffs ?? []` through; `defaultAdultPrice: raw.tariffs?.[0]?.price ?? 0` stays (used).
- Consumers migrate OFF `servicesRaw`:
  - `ActivityDetailsModal.tsx:27,49-53` → `services.find(...)?.tariffs ?? []`.
  - `SettingsTab.tsx:51,235-241` → domain tariffs (cast removed).
  - `buildAdminSchedule` keeps reading tariffs/`material_hint`/`tags` from its raw `ServiceResponse` inputs (§11 out-of-scope to re-source; identical data).
  - `PhotosContext.tsx:147-163` has its own local `servicesRaw` variable — **not** the context contract, untouched.
- `ScheduleContextType` drops `servicesRaw` (:92, :494). `__tests__/helpers/mockContexts.ts:29` updated accordingly.

## 7. Date Module API — `frontend/admin/lib/datetime.ts`

Single parsing semantic: **local**. Server naive strings represent studio-local wall time; `new Date(s)` on a zone-less string parses as local per ES spec — local getters return exactly the embedded wall time regardless of browser TZ. Strings WITH `Z`/offset (test fixtures, e.g. `ScheduleContext.test.tsx:262`) parse to the same instants; local getters then show browser-local wall time — accepted and consistent for display-only paths (matches today's `transformers` behavior, the more correct of the two existing semantics).

```ts
parseLocalISO(start: string): { date: 'YYYY-MM-DD'; time: 'HH:MM'; startMinutes: number; dayIndex: number }  // THE parser
toLocalISO(date: Date): string                 // 'YYYY-MM-DDTHH:MM:SS', no zone — API writes (replaces ScheduleContext padStart blocks)
toLocalISO(date: 'YYYY-MM-DD', startMinutes: number): string  // overload for mutation payloads
toISODate(date: Date): 'YYYY-MM-DD'            // replaces formatDateISO + DayView/WeekView/dayToDate dups
dayIndexToDate(monday: Date, dayIndex: number): 'YYYY-MM-DD'
weekDayIndex(date: Date): number               // Mon=0 (absorbs transformers.normalizeDay)
formatTime(startMinutes: number): 'HH:MM'      // display ONLY
hhmmToMinutes(hhmm: string): number            // input parse (replaces hhmmToDecimal)
getMonday(date: Date): Date
generateTimeSlots(gridFrequency: number, startMinutes: number, endMinutes: number): number[]   // minute slots
calculateGridTimeRange(acts: {startMinutes, durationMinutes}[], whStartH: number, whEndH: number): { startMinutes, endMinutes }  // minute bounds
```

Utils re-export policy: `lib/utils.ts` may temporarily re-export moved helpers for non-schedule consumers (records `formatTime` imports switch to `@/lib/datetime` in this PR — no dangling re-exports at merge).

## 8. Delete List (dead layer + its tests)

| Item | Location | Evidence |
|---|---|---|
| `transformActivity`, `parseStart`, `normalizeDay` | `lib/transformers.ts:8-41` | only callers: tests + dead hook |
| `useActivities` hook | `hooks/useActivities.ts` (14 lines) | imported-but-never-called (`ScheduleContext.tsx:7`); no other importers |
| `toScheduleIndex`, `toScheduleItems`, `ScheduleItem`, `ActivityIndex`, `ScheduleIndex`, `dayToDate`, `addToActivityIndex` | `lib/buildSchedule.ts:6-98` | zero non-test consumers (grep-verified) |
| `ActivitySchema`/`Activity` + v1 fields | `packages/domain/src/index.ts:52-79` | no non-test consumers post-migration |
| `Service.duration` (hours) | `packages/domain/src/index.ts:35` | all consumers migrate to `durationMinutes` |
| `decimalToHHMM`, `hhmmToDecimal` | `lib/utils.ts:76-86` | replaced by `formatTime`/`hhmmToMinutes` |
| `parseActivityStart` | `recordsColumns.tsx:24-30` | replaced by `parseLocalISO` |
| Tests: `transformers.test.ts` (transformActivity blocks :175-253), `buildSchedule.test.ts` (toScheduleIndex/toScheduleItems suites), `useReactQueryHooks.test.tsx` (useActivities suite :220-260 + mock), `scheduleIntegration.test.tsx` (stale-comment fixtures) | `__tests__/` | deleted/rewritten per §9 |

Note: `ScheduleContext.tsx:7` currently imports `useActivities` — the file's actual data path is the direct `useQuery` at :269. Dead import removal is part of the hook deletion.

## 9. Test Migration Plan

**Unit (vitest, `frontend/admin/__tests__/`)** — ~14 files touch `startTime`/`duration` (87 + 143 occurrences):

1. **Fixtures first**: all activity fixtures move to `{ start: 'YYYY-MM-DDTHH:MM:SS' (naive), duration: <minutes>, … }` responses or `ScheduleAdminDTO` with `startMinutes/durationMinutes`. No `startTime:` float or hours-`duration:` remains (grep gate: `grep -rn "startTime:" frontend/admin/__tests__` → 0; `duration: <n>/60` → 0).
2. `datetime.test.ts` — NEW: round-trips `toLocalISO`/`parseLocalISO`; mixed naive/`Z` inputs; `weekDayIndex`; `dayIndexToDate` week edges (Sun→next Mon).
3. `timezone-dnd-bug.test.ts` — **rewritten for the new canon, case stays green**: keep `TZ=Europe/Moscow` + `pool=forks` setting; drop `toScheduleIndex` (deleted) — assert on `buildAdminSchedule` output (`startMinutes`, `dayIndex`, `date`) that a naive `"…T23:30:00"` Sunday activity lands on day 6 / correct date, and DnD-style `(dayIndex, startMinutes) → toLocalISO → parseLocalISO` round-trips with no day jump. Stale comments refreshed.
4. `buildSchedule.test.ts`: legacy suites deleted; `buildAdminSchedule` suite gains `startMinutes`/tariff-through assertions.
5. `transformers.test.ts`: transformService tariffs/durationMinutes; transformActivity block deleted.
6. Component suites (`DayColumn.test` is the largest, ~80 cases): geometry expectations re-expressed in minutes (`topPx = Δmin * cellHeight/30`); rendered time strings unchanged (`"10:30"`).
7. `ScheduleContext.test.tsx`: mixed naive/`Z` fixtures (:262) stay as-is (canon accepts both); mutation assertions on typed payloads.
8. `useReactQueryHooks.test.tsx`: useActivities suite deleted; useServices gains tariffs assertion.

**E2E (Playwright)**: ~6 specs with time fixtures — seeds are naive strings (`factories.ts:71` slices `toISOString()` to naive; `wave5-x-cards-blurred.spec.ts:23` builds `${dayStr}T${startTime}:00`) — unchanged semantics, expected green without edits except where specs import deleted helpers. `activity-details-modal.spec.ts:326` duration input format `HH:MM` preserved. CI e2e shards are the authoritative gate (project policy).

**Gates (definition of done)**:
- `grep -rn "decimalToHHMM\|hhmmToDecimal" frontend/admin` → 0 (excluding web).
- `grep -rn "startTime" frontend/admin --include="*.ts" --include="*.tsx"` → 0 occurrences of float-hour semantics (settings `workingHours*` exempt).
- `grep -rn "duration / 60\|duration \* 60" frontend/admin` → 0.
- `grep -rn "padStart(2, '0')" frontend/admin` → only inside `lib/datetime.ts`.
- `grep -rn "servicesRaw" frontend/admin/contexts` → 0 in the exported contract.
- vitest green (target ≥ today's 1580), tsc 0, lint 0, api-client 243+ green, backend untouched (1489p baseline), CI 15/15 incl. e2e shards.

## 10. User Scenarios (regression protection — zero visible delta)

- **US-1 DnD cross-day (TZ guard)**: With `TZ=Europe/Moscow`, drag a 23:30 Sunday activity to Monday 09:00 in WeekView → it saves `start` = next-day `"T09:00:00"`, renders in Monday column, no day-jump, no −3h shift; undo restores exactly. (unit: timezone suite; e2e: existing week-view drag flows stay green.)
- **US-2 Duration change in Settings**: Open activity → Settings tab shows `HH:MM` duration (e.g. `01:30`); change to `02:00` → card height grows ×(120/90), label end time shifts +30min, PATCH sends `duration: 120` minutes; failed PATCH rolls back card + settings.
- **US-3 Card with tariff**: Service with tariffs «Взрослый 2500₽ / Детский 1500₽» → activity card + ActivityDetailsModal Settings show both tariffs from the domain `Service` (no `servicesRaw`); price hint on card unchanged.
- **US-4 Create via quick-add (stamp/slot)**: Click empty 10:30 slot with stamp ready → activity created with `start` `"…T10:30:00"`, `duration` = service minutes; ghost preview `10:30–12:30` matches saved card exactly.
- **US-5 Records table time parity (TZ bug fix)**: Same activity visible in schedule grid (10:30) and records "Дата / Время" (10:30) on a Europe/Moscow browser — column no longer derives from UTC getters. (unit: parseLocalISO parity test grid-vs-records under non-UTC TZ.)
- **US-6 Adaptive grid bounds**: Activity ending 22:10 with working hours 9–21 → grid extends past 22:00 with ≥1h padding, slot lines at gridFrequency; overnight-capping behavior (endTime > 24h clamp) preserved via minute math.

## 11. Out of Scope

- `frontend/web` (third slicing copy `web/app/lib/mappers/buildSchedule.ts`) — untouched.
- `buildAdminSchedule` input re-sourcing (raw → domain Service/Master/Location) — identical-data refactor, separate concern. Master name-order divergence (`first last` in buildAdminSchedule :148 vs `last first` in `displayMasterName`) is PRE-EXISTING display drift — explicitly not changed here (frozen to keep zero visual delta).
- #140 territory: ClientsContext dissolution, per-tab `useClient`, queryKeys factory — #142 IMPL runs strictly after #140 merges (shared file: ActivityDetailsModal). This spec's file inventory assumes post-#140 main at IMPL time; mechanical rebase only.
- Service legacy price twins removal (§4.1), screen-reader/visual polish, `ScheduleDTO` (web) shape, backend (any changes), records view model (#213 already shipped).
- Copy/localStorage keys; LS `grid-frequency`/`cell-height` values (already minute/px semantics).

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| TZ regressions in grid (the historic DnD bug) | High — wrong day/time on Moscow browsers | Keep `timezone-dnd-bug.test.ts` case green under `TZ=Europe/Moscow` (rewritten); single parser = single semantic |
| Records time parity breaks subtly | Medium | US-5 unit parity test grid-vs-records under non-UTC TZ |
| Fixture drift in ~14 unit files + 6 e2e specs (87+143 occurrences) | Medium — bulk edit mistakes | Fixtures-first migration order; grep gates (§9); CI e2e shards authoritative |
| Overlap/z-index regressions from float→int comparisons | Medium | DayColumn overlap suite re-expressed in minutes; visual e2e (week-view, dayview-column-reorder) green |
| Sub-pixel geometry drift with non-default cellHeight | Low | Same sub-pixel exposure as today (float hours × 120px); visual snapshots guard |
| Test Z-suffixed fixtures vs naive server strings | Low | Canon: both parse via `new Date`; unit covers both forms (§7) |
| Collision with parallel #140 in ActivityDetailsModal | High if sequenced wrong | IMPL gated on #140 merge (G1a decision); plan rebases mechanically |
| e2e flake (known pre-existing set) | Low | Unchanged policy: pre-existing reds classified, not fixed here |

## 13. Acceptance Criteria

- [ ] Canon: `start` local-ISO string + `durationMinutes` integer everywhere between api-client and DOM; grep gates (§9) all zero.
- [ ] `ActivitySchema`, `useActivities`, `toScheduleIndex`/`toScheduleItems`/`ScheduleItem`, `transformActivity`/`parseStart`/`normalizeDay`, `decimalToHHMM`/`hhmmToDecimal`, `parseActivityStart` deleted with their tests.
- [ ] Domain `Service` carries `tariffs`; `ScheduleContextType` has no `servicesRaw`; ActivityDetailsModal/SettingsTab consume domain tariffs.
- [ ] Optimistic updates typed via `ActivityPatch`/`ActivityResponse` — no `Record<string, unknown>` in the mutation path.
- [ ] `lib/datetime.ts` is the only padStart-assembly site; grid math integer-minute.
- [ ] timezone suite green under `TZ=Europe/Moscow`; records/grid parity test green.
- [ ] All suites green: vitest ≥ 1580p/0f, tsc 0, lint 0, api-client green, CI 15/15 (incl. e2e shards); backend untouched.
- [ ] US-1..US-6 pass (unit/e2e mapping §10).

## 14. Behavioral Delta

**User-visible: none intended.** One latent-bug FIX ships inside the zero-delta envelope: on non-UTC browsers the records "Дата / Время" column previously rendered activity time shifted by the UTC offset (e.g. −3h on Europe/Moscow); it now matches the schedule grid (US-5). CI/e2e never observed the bug (UTC runners). All other screens byte-identical.

**Developer-facing (contract)**: domain `Activity`/`ActivitySchema` removed; `Service.duration`→`durationMinutes`(+`tariffs`); `ScheduleAdminDTO.startTime`→`startMinutes`; ScheduleContext add/update signatures in minutes; `servicesRaw` out of contract; api-client exports `ActivityPatch`.
