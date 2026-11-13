# Activity — Domain Rules

## Description
An Activity is a scheduled instance of a Service. It ties together a Master, Service, and Location with a specific date/time and capacity.

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| master_id | string | ✅ | — | — | — | FK to Master |
| service_id | string | ✅ | — | — | — | FK to Service |
| location_id | string | ✅ | — | — | — | FK to Location |
| start | datetime | ✅ | — | — | — | Start date/time |
| duration | integer | ✅ | — | — | — | Duration in minutes |
| capacity | integer | ✅ | 0 | 99 | — | Max attendees; **0 = «запись закрыта»** (GH #551, user decision 2026-11-13): booking guard 409s immediately |
| is_private | boolean | ❌ | — | — | false | Private class — hidden from all non-staff surfaces (GH #600) |
| comment | string | ❌ | — | — | null | Internal comment |
| record_info | string | ❌ | — | — | null | Info shown to clients |
| occupied | integer | — | — | — | 0 | Computed: count of active Records |
| service_title | string | — | — | — | null | Computed on LIST endpoints only (joined Service.title); null on single-item endpoints |

## Cross-field Rules
- `capacity` should be >= occupied (but not enforced on update); a capacity of 0 («запись закрыта», GH #551) legitimately coexists with `occupied > 0` — the rule does not apply to a closed activity
- `duration` should match Service.duration (auto-filled on frontend)

## Invariants
- master_id, service_id, location_id must reference existing active records (FK enforced)
- `occupied` is computed on every read, never stored
- **NO slot-conflict validation, by design (GH #258/#259 spec, 2026-09-14):** several activities MAY overlap in the same time slot for the same master/location — the admin schedules them deliberately by agreement with the master. No uniqueness constraint, no 409, no client-side «slot taken» guard — do not add one.
- **Activities of archived entities do NOT disappear from the admin schedule (GH #267 spec, 2026-09-14):** the activities API returns them regardless of directory archived state, and the grid must render them. Visibility is gated per entity: archived services are always visible (no toggle); archived masters/locations are shown when the user's settings `show_archived_masters` (default **on**) / `show_archived_locations` (default **off**) are on; a card with several archived entities shows only when all its gates are on. Gate-passed archived cards bypass the master/location id filters — they are not filter members. Data source: `/masters/all?status=all|archived` (GH #267 amendment to #266 D8 «default acting-only») + existing `status` on locations/services; archived rows carry `archived: true`.
- **Public activity reads live in the /public namespace; the shared staff routes are staff-only (GH #600 spec rev4, user decision 2026-11-12):** anonymous/client visibility of activities is served ONLY by `GET /api/v1/public/activities`, allowlisted in `src/auth/public.py`, with the minimal `ActivityPublicResponse` schema (id, service_id, master_id, location_id, start, duration, capacity, occupied — exactly what the web schedule consumes; `is_private`/`comment`/`record_info`/timestamps/`service_title` never leave). Private rows are excluded server-side from the public list (NULL-safe `IS NOT TRUE`); client booking `POST /api/v1/my/records` with a private `activity_id` → **404** (not 409/422 — the predicate sits in the existence probe's WHERE, before tariff validation). A public single-item route is deliberately NOT built (owner decision, Gate B): no consumer today — the web builds everything from the list; when one appears it lands additively with 404-for-private parity. The shared `GET /api/v1/activities` and `GET /api/v1/activities/{id}` require a staff session — anonymous and client sessions get **401**; staff behavior is unchanged (admin sees all, masters see their own private activities, week copy still skips private). NEVER reintroduce unconditional private-filtering inside the shared `ActivityService.list` (the admin grid + master scope ride it) and never widen `ActivityPublicResponse` beyond what web consumes — additions are additive later. Pattern: ADR-015 `/public` namespace, precedent `/public/photos`; the dictionary wave continues separately in #584.

## Business Logic

### Backend
- **occupied** = SUM(Record.seats) WHERE activity_id = X AND status IN ('waiting','visited')
  - Implemented via `active_record_filter()` in `src/domain/record_visits.py` (shared with the booking guard `check_activity_capacity`)
  - Source of truth: `ACTIVE_RECORD_STATUSES` constant in `src/domain/visit_status.py`
  - Cancelled / missed records free their seats (excluded from the sum)
- **Capacity range validation on every mutation (GH #551, user decision 2026-11-13):** capacity 0–99 enforced by the Pydantic schemas (create / update / patch — 422 outside the range); no DB-level CHECK, deliberate. The booking guard needs no change: capacity 0 → instant 409 `ACTIVITY_AT_CAPACITY` = «запись закрыта». Supersedes the former «no capacity re-validation» note.
- **Cascade on delete:** hard-delete cascades to Records (and transitively their Visits + Payments); photos have `activity_id` set to NULL (photos survive); activity_tag join rows cleaned. Entire cascade is atomic. Execution stays the **handwritten `ActivityService` cascade** — the generic deletion resolver is NOT wired to activities.
- **Deferred delete — unified contract (GH #286, единый контракт #285 rev8):** `DELETE /api/v1/activities/{id}` is deferred (5s undo window, optimistic map-remove, commit by timer on the shared PendingActions pipeline) under the same contract as records. `?dry_run=true` is a pure preview (never touches rows, emits no SSE): empty tree → **204**; records present → **409** `has_dependencies` + tree (nodes `records`/`visits`/`payments`, each carrying `items` one-liners); missing id → **404**; `dry_run=true` + body → **422** `invalid_delete_request`. The real commit body carries the flat, required `expected` per-entity id-sets `{records, visits, payments}`; **subset match per entity runs BEFORE execution** (a server dep absent from `expected` → **409** `stale_dependencies` + current tree; a dep that disappeared mid-window does not block; auto nodes excluded), so a mid-window race gives an honest error + «Обновить», never a partial cascade. Bare DELETE (no flag, no body) → **422** `expected_state_required` (unconditional). Deleting from the details modal (`btn-delete-activity`) uses the same flow; the «Сохраняем…» loading toast no longer fires on delete (deferred deletion is off `SCHEDULE_ACTIVITY_MUTATION_KEY`).
- **FK_MATRIX entry is preview-only (GH #286):** `FK_MATRIX[Activity] = [records (cascade, NOT auto), photos (nullify, auto), activity_tags (cascade, auto)]` is consumed **only** by `collect_dependencies` (dry-run/409 tree). The generic resolver is deliberately NOT connected to execution (`NULLIFY_HANDLERS`/`CASCADE_HANDLERS` unchanged) — the execute path remains the handwritten cascade above (test-locked: `DELETE /activities/{id}` traces to the handwritten service, not the generic resolver).
- **Date-range filtering:** `date_from` / `date_to` are typed `date` query params (YYYY-MM-DD) — invalid date strings are rejected by FastAPI with **422 VALIDATION_ERROR** (was 500 before #191). Bounds are converted to a whole-day inclusive range via the shared `day_range()` util in `backend/src/domain/dates.py` (`datetime.combine` idiom: `date_from` covers from 00:00:00, `date_to` through 23:59:59.999999); the legacy untyped `datetime.fromisoformat` string parsing was removed. Both list paths (with and without date range) funnel through the single stmt builder in `ActivityService.list` (GH #212, former `_list_by_date` absorbed): equality filters → day range → `service_id` → `q` predicate, wrapped via `repo.list_entity` (thin wrapper over the `list_custom` row core, GH #213 §5.1) — the repo owns count (on the unordered stmt, so `total` reflects q/filters) + order/limit/offset; the service owns page↔offset conversion and the `PaginatedResponse` envelope, then populates `service_title` on every item via ONE bounded bulk Service query.
- **Search (`?q=`, GH #212):** case-insensitive substring on the joined `Service.title` OR exact `activity.id` equality when q is a full UUID. `Service` join added ONLY when q is present (default query plan unchanged). `q` contract: min_length=2 / max_length=100 → else 422 VALIDATION_ERROR. `service_id` param intersects with q.
- **`?id=` narrowing (GH #371, #232 contract):** repeated query keys, UUID-only (garbage → 422), ≤100 distinct after dedup (>100 → 422 `too_long`); typed `id IN (…)` narrowing via `ids_in_predicate`, ANDs conjunctively with `date_from`/`date_to`/`q`/`service_id` and the master scope (a foreign id in the set stays absent — narrowing never expands visibility); valid-but-unknown → 200 + empty. Entry form (GH #371): one `ActivityListParams(PaginationParams)` model as `Annotated[..., Query()]` — no scalar query siblings (`date_from`/`date_to` stay `date`, `q` 2..100, `service_id` stays `str` — pre-conversion annotations kept); the optional master scope stays a `Depends(get_optional_scope)` sibling, NOT a query field.
- **Week copy (`POST /activities/copy-week`, GH #242 spec 2026-09-17):** one atomic `@transactional` (single method, direct ORM inserts — do NOT loop the per-row `create()`, which commits per row) copies a source week (`week_start−7d .. −1d`) into the target week (`week_start .. +6d`, `week_start` MUST be a Monday → else 422) with `start + timedelta(days=7)`. The request ALWAYS carries an explicit `locations` list (no "None = all" encoding; empty list → 422, unknown ids → 422). Not copied: `is_private=true` (deliberate business rule — private lessons are not replicated), activities at archived locations, activities whose master is archived AND no active replacement master exists (replacement = first active master in the canonical roster order `sort_order ASC, first_name ASC, id ASC` — `masters.py` — whose linked specialty set intersects the source master's set — справочник `specialties.md`, GH #599: сравнение по id связей `staff_specialties`, не по тексту; удаление направления отвязывает связи каскадом (включая архивных мастеров) — будущие ремапы видят только живые связи, тогда как прежний текст CSV переживал всё). Duplicate protection = merge: the same key `(master_id, service_id, start, duration)` (location/capacity deliberately outside the key) is skipped against target-week rows AND against rows inserted within the same run; a re-click with no edits copies zero. Hard cap: at most 100 rows to insert per call → else 422 (copy in several passes by location). The copy path does NOT call `check_master_active`: activity master ids come from the server-side remap (always active), not user input — this is a separate validation path, not a guard bypass. Accepted race (no lock, by design): two simultaneous copies of the same week may both insert duplicates — accepted, internal single-admin tool (GH #242 rev2, user decision 2026-09-17). Tag links are copied via explicit `activity_tags` join-row inserts + a `tags` mark_changed (create never writes tags).

### Frontend
- **Auto-fill from Service:** When service selected → duration auto-filled (capacity autofill comes from the **location's `defaultCapacity`**, not the service — see the GH #595 rule above; «missing OR 0 counts as no default» applies in single mode too since GH #551 rev.3: a location with capacity 0 = «не задана» autofills the field EMPTY, blocking until explicit input)
- **DateTime canon (GH #142):** datetime-local → `startMinutes` (minutes from midnight) + `dayIndex` (Mon=0..Sun=6) → `composeLocalISO(date, startMinutes)` for API payloads. Duration is integer minutes (`durationMinutes`); display via `formatTime(startMinutes)`.
- **Create-form time source (GH #280):** `ScheduleDataContext.addActivity` takes an exclusive union — `{ start: string }` (ready floating-local ISO from the create form's datetime field; goes to the payload as-is, the chosen date may be outside the open week) **or** `{ dayIndex, startMinutes }` (legacy open-week conversion; grid-only now: WeekView/DayView/dnd stamps (`updateActivity` got its own dual source in GH #553)). Create-form gates: datetime non-empty, duration «ЧЧ:ММ» > 0, capacity 0–99 entered explicitly (empty never sends 0; an explicit 0 = «запись закрыта» — GH #551, 2026-11-13, partial supersede of the #280 «min 1» rule).
- **Edit-form time source (GH #553):** `ScheduleDataContext.updateActivity` takes the same dual time-source semantics as `addActivity` — `{ start: string }` (full local ISO from the edit form's datetime field; goes to the PATCH payload as-is, WINS over the legacy member; the chosen date may be outside the open week — past dates deliberately allowed) with priority over `{ dayIndex, startMinutes }` (legacy open-week conversion; grid-only since #553: WeekView/DayView/dnd stamps). `updateActivity` returns `Promise<void>` (`mutateAsync` + catch-guard, mirror of the promisified `addActivity`; fire-and-forget consumers ignore it) — the details modal awaits it to show the success toast «Сохранено: …» on `start`-patches only (toast canon #261, info kind; rejections stay silent — the optimistic rollback owns errors).
- **Create-form multi-location (GH #595):** the create tab picks locations via checkboxes (1..N); «Создать» fires N `POST /activities` calls in parallel, completion awaited via `Promise.allSettled` — `addActivity` was extended to RETURN A PROMISE (`mutateAsync` inside, callbacks preserved): per-call `mutate` callbacks in TanStack Query v5 fire only for the LAST call (documented "Consecutive mutations"), so callback counters undercount; never rely on observer `isPending` for N parallel calls. The API contract and model stay intact, an activity always has exactly one location. Capacity: set of exactly 1 → that location's `defaultCapacity` auto-filled and editable (no default → 0 → blocked, per the #280 gates); 2+ → the capacity field is hidden, EACH created activity takes its own location's `defaultCapacity` (missing OR 0 counts as no default — 0 = «не задана», GH #551 rev.3), and a checked location without a default blocks «Создать» naming the first such location (aria-live hint). Partial failure (K of N created): the form stays open, successful locations are auto-unchecked (a retry sends only the rest — no duplicates), error toast «Создано K из N (…)» with the first-failed-by-checkbox-order message; cache invalidation runs ONCE after all calls settle. Full success closes the form (toast names the service and the chosen date; N≥2 prefixes the count). A DayView empty-slot click (location-columns mode only) pre-checks the column's location checkbox (WeekView/toolbar open with none checked).
- **Activity modal fixed height (GH #598):** the activity details modal is fixed-height `h-[85dvh]` in ALL its modes (create + edit/quickAdd), with `h-[85vh]` as the legacy fallback; the «Создать» button lives in the modal footer, outside the scrolling body. Scroll owner = the consumer's inner scroll div (gains `min-h-0` + `overscroll-behavior: contain`), NOT the shared Modal wrapper. This deliberately supersedes #262 (which removed the #92 fixed height due to dead whitespace + clipping) for this one modal only — the generic `Modal` default stays auto-height; the `ModalShell.test.tsx` lock covers the default (no fixed class without the prop; the lock regex must match BOTH `vh` and `dvh`). Split from #595 by user decision: separate commits/PRs for independent revert.
- **Single parser:** `frontend/admin/lib/datetime.ts` (`parseLocalISO` et al.) is the ONLY datetime parser — treats input as floating local time (no UTC shifts). Records list and Schedule grid both consume it, guaranteeing parity (same parser, same minutes).
- **Optimistic updates:** Snapshot → apply → rollback on error → invalidate on settle
- **Race protection (GH #141):** no artificial timeout — the PATCH settles naturally (success or real network error). The former 5-second `Promise.race` rollback was removed: it raced the server-side write (UI rolled back while the request kept flying and could still be applied → screen/server desync). In-flight saves surface via a «сохраняем…» indicator + `beforeunload` guard.

## Display label convention (project-wide, GH #211 §7.7)

THE canonical string representation of an activity in the admin frontend — used everywhere an activity renders as an option/label (photo modal typeaheads, filters, dropdowns; future #213 «Активность» column):

- **Format:** `«{dd.mm.yyyy HH:mm} — {location title} — {service_title}»` — DATE FIRST (e.g. «21.08.2026 14:00 — Студия Север — День рождения»), local time.
- **ONE shared formatter:** `formatActivityLabel(activity, locationsMap)` in `frontend/admin/lib/utils.ts` (built on `formatActivityDateTime`); all consumers call it, nobody composes the string inline. `formatActivityStart` was DELETED (was the last non-canonical consumer — GH #211 Task 10).
- **Segment omission:** a segment is dropped when its data is absent — no dangling « — » separators. Location title resolves client-side via the `/locations/all` map (**ACTIVE-only**) — an activity at an ARCHIVED location omits the location segment (id not in map).
- **Separator:** « — » (project convention).
- **#213 cross-pin:** the display-lookup composite (#213) will centralize activity display data further — it must reuse this label, no third format gets invented there.

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/activities | List (date range, `service_id`, `?q=` search filters; invalid dates → 422; items carry `service_title`) — staff-only since GH #600 (`activities:read`, anon/client → 401) |
| GET | /api/v1/activities/{id} | Get with occupied count — staff-only since GH #600 |
| GET | /api/v1/public/activities | Anonymous schedule list (GH #600): minimal `ActivityPublicResponse`, private rows excluded server-side, deterministic sort `start`+`id`, default date window from today; no public single-item route (deferred, owner decision) |
| POST | /api/v1/activities | Create |
| PUT | /api/v1/activities/{id} | Full update |
| PATCH | /api/v1/activities/{id} | Partial update |
| DELETE | /api/v1/activities/{id} | Deferred delete (GH #286, unified contract #285): `?dry_run=true` = pure preview (204 empty / 409 tree+items / 404; +body → 422 `invalid_delete_request`); commit body `{expected: {records, visits, payments}}` — subset match by id before execution (409 `stale_dependencies` + tree); bare DELETE → 422 `expected_state_required`. Execution = handwritten cascade (records + their visits/payments hard-deleted, photos SET NULL, tag join rows cleaned) |
| POST | /api/v1/activities/copy-week | Atomic week copy (merge dedup by master+service+start+duration; private/archived-location skipped; archived-master auto-remap; `week_start` must be Monday) |

## Relationships
- Activity → belongs to Service
- Activity → belongs to Master
- Activity → belongs to Location
- Activity → has many Records
- Activity → has many Tags (M2M)

## Acceptance Criteria
- [ ] occupied computed correctly
- [ ] Auto-fill from Service works
- [ ] Optimistic updates roll back on error
- [ ] Delete cascades hard-delete to Records (and transitively Visits + Payments)
- [ ] Delete follows the deferred contract (dry_run preview / `expected` subset / bare → 422); cascade execution unchanged

## Parity Notes
| Backend (Pydantic) | Frontend (Zod) | Match |
|--------------------|----------------|-------|
| start: datetime | start: string | ⚠️ Type difference |
| All fields required | All fields required | ✅ |
| is_private: default False | is_private: optional | ⚠️ |

## Activity modal fixed height (GH #598)

- **Общий `Modal`** (`frontend/admin/app/components/shared/modal/Modal.tsx`) получил опциональный проп `heightClass` — фикс-высота контейнера. Класс **дополняет** базовый потолок `max-h-[85vh]`, а не заменяет его: потолок остаётся на месте и безвреден (85dvh ≤ 85vh, при фикс-высоте он не активен).
- **Модалка занятия** (ActivityDetailsModal) передаёт `h-[85dvh]` во всех режимах — осознанный суперсед #262 ТОЛЬКО для этой модалки (высота стабильна между вкладками, футер с кнопкой «Создать» всегда виден).
- **Дефолт всех остальных модалок не изменился** — авторазмер по контенту с потолком (#262). Защищено тест-замком `frontend/admin/__tests__/ModalShell.test.tsx`; замок расширен на `dvh` (регэкс `/(?:^|\s)h-\[\d+(d)?vh\]/`, якорь обязателен — без него матчер ловит `h-[85vh]` внутри базового `max-h-[85vh]`).
- Скроллящееся тело обеих панелей модалки занятия несёт единый `data-testid="activity-details-modal-scroll-body"` — селектор геометрических ассертов e2e (US-2). Кнопка «Создать» (`btn-create-activity`) переехала в футер: вкладка создания публикует наверх ТОЛЬКО `canSave` + `submit` (мост по образцу `onSavingChange`, состояние формы остаётся локальным); `<form>` нигде не вводится — Enter-отправка не заявлена.
