# Memo — Domain Rules Overview

## Entities

| Entity | Description | Key Relationships | Complexity |
|--------|-------------|-------------------|------------|
| Service | Master class type | has many Tariffs | Medium |
| Tariff | Pricing tier | belongs to Service | Low |
| Master | Мастер (ведёт мастер-класс) | has color, specialties | Low |
| Location | Studio space | has capacity | Low |
| Activity | Scheduled instance | belongs to Service, Master, Location | Medium |
| Client | Customer | has contacts, stats | Medium |
| Visitor | Individual attendee | belongs to Client | Low |
| Record | Booking | belongs to Activity, Client; has Visits | **High** |
| Visit | Attendance | belongs to Record, Visitor | Low |
| Payment | Transaction | belongs to Record | Low |

## Shared Enums

### RecordStatus
| Value | Label | Description |
|-------|-------|-------------|
| pending | Ожидает | Newly created |
| confirmed | Подтверждена | Client confirmed |
| cancelled | Отменена | Cancelled |
| no_show | Неявка | Client did not attend |

### VisitStatus
| Value | Label | Description |
|-------|-------|-------------|
| waiting | Ожидает | Visit pending |
| visited | Пришла | Attended |
| missed | Пропущена | Did not attend |
| cancelled | Отменена | Cancelled |

### Channel
| Value | Label |
|-------|-------|
| telegram | Telegram |
| whatsapp | WhatsApp |
| max | Max |

### PaymentMethod
| Value | Label |
|-------|-------|
| cash | Наличные |
| card | Карта |
| transfer | Перевод |

## Naming Conventions

| Business term | Code name | Forbidden | Notes |
|---------------|-----------|-----------|-------|
| Мастер | `Master` | ~~Artist~~, ~~artist~~ | Типы, переменные, компоненты, API — везде Master |
| Мастер-класс | `Activity` | ~~Class~~, ~~Workshop~~ | Запланированное занятие |
| Запись | `Record` | ~~Booking~~ | Бронирование клиентом |
| Посещение | `Visit` | ~~Attendance~~ | Факт прихода конкретного гостя |
| Студия / Локация | `Location` | ~~Studio~~, ~~Room~~ | Помещение для проведения |
| Услуга | `Service` | ~~Course~~, ~~Type~~ | Тип мастер-класса |
| Клиент | `Client` | ~~Customer~~, ~~User~~ | Человек, который бронирует |
| Гость | `Visitor` | ~~Guest~~, ~~Attendee~~ | Конкретный участник записи |

**Rule:** When introducing new code, always use the code name from this table. If you see a forbidden name in existing code, rename it.

## Deletion Policy

| Delete semantics | Entities |
|---|---|
| **Hard-delete with resolutions** + archive endpoints (`POST /archive`, `POST /restore`) | Master, Location, Service, Material, Client |
| **Hard-delete** (row physically removed) | Tag, Photo, Visitor, Activity, Record, UserSettings |
| Already hard-delete (untouched) | Payment, Visit |
| Stays as-is (implicit soft-delete, out of scope) | User, Tariff (carry `is_active`, used e.g. in `admin/setup.py:35`) |

> **GH #207:** the 5 archive-aware entities moved from soft-delete to hard-delete-with-resolutions. Archive/restore is exclusively via dedicated `POST /{id}/archive` + `POST /{id}/restore` endpoints — `is_active` is no longer accepted on PUT/PATCH (auto-closes #178, #201). See "Archive terminology boundary" below and "Hard-delete FK dependency matrix" further down.

## Archive terminology boundary (is_active at API = archived)

Applies to the **5 archive-aware entities** (Master, Location, Service, Material, Client). Implementation: `ArchiveService` + `ArchiveRepository` (renamed from `SoftDeleteService`/`SoftDeleteRepository` per spec GH #207 §3.3-3.4). The DB column `is_active` is **UNCHANGED** (no migration, no rename) — only the API vocabulary moves.

One layer = one vocabulary. The `is_active` ↔ `archived` translation happens in exactly **ONE layer: Service**.

```
Frontend → archived: bool, "В архив"/"Восстановить", POST /archive + /restore
API      → archived: bool (Response schema), POST /archive, POST /restore, ?status=
─────────── Service: archive()→is_active=False, restore()→is_active=True ───────────
Repo     → is_active (filter, patch), delete = hard. NO archive()/restore() methods here.
Model/DB → is_active: bool column (UNCHANGED — no migration, no rename)
```

1. **Response schema: `archived: bool` (INVERSION).** All 5 entity Response schemas expose `archived` instead of `is_active`, with inverted polarity: **`archived = true` = in archive = `is_active = false`**. The DB column stays `is_active`; the Service/response-builder applies `not is_active`. **Two mapper paths for Client** (not one): the generic `ClientResponse` path AND the manual `ClientWithStats` builder in `list_clients_with_stats` — both invert; the manual path is a second inversion point that would silently break the Pydantic model at compile time once `is_active` left the schema (spec §3.1).
2. **`get` returns archived rows** — no `is_active` filter on the get path; `archived` is exposed in all 5 Response schemas. This pairs deliberately with `list()` hiding archived rows: *list hides, get returns* (unchanged).
3. **`PUT`/`PATCH` no longer accept `is_active`** (spec GH #207 §3.2 — **auto-closes #178 and #201**). Archive/restore is exclusively via the dedicated endpoints below. A PUT/PATCH body containing `is_active` → **422** (extra field, same as any unknown field in a strict schema). This is a deliberate break: the #178 entities previously had `is_active` accepted/required on PUT; it is now rejected. **Client `PUT`** keeps its 4 required-nullable personal keys (`name`/`phone`/`email`/`channel`) — required-nullable, no defaults; omitted key → 422; explicit `null` = deliberate clear. **`PATCH`** is plain `application/json` (NOT `application/merge-patch+json`); sticky `null` → preserve **deviates from RFC 7396** (documented to avoid misleading OpenAPI/codegen consumers). The `_strip_is_active_none` helper is deleted (no caller remains).
4. **`POST /{id}/archive`** → `repo.patch(id, {is_active: False})`; response body `{..., "archived": true}`, HTTP **200 with body** (frontend updates the row without a refetch).
5. **`POST /{id}/restore`** → `repo.patch(id, {is_active: True})`; response body `{..., "archived": false}`, HTTP **200 with body**.
6. **`DELETE /{id}` = real hard delete** with the dependency-resolution mechanism (see "Hard-delete FK dependency matrix" below).

- **Master-only cascade (Change 3, §4.2):** `MasterService.archive()`/`restore()` write the linked `users.is_active` in the **same transaction** as the master's `is_active` patch. Archive = user can no longer log in; restore = user can log in again. Master-only special case — see the FK matrix below and `masters.md`.
- **`create` always yields `archived=false`** (`is_active=True`) — Create schemas do not expose the field; adding it there would bypass archive semantics (trap, do not do).
- **`list` hides archived rows** by default (`?status=active`); `?status=archived` shows them, `?status=all` shows both. `?status=` maps to the `is_active` filter in the repo (unchanged — `ArchiveStatus` enum reused).
- **`reorder` silently skips archived rows** (`repositories/generic.py:169`) — a restored row becomes reorder-eligible again.

## Hard-delete FK dependency matrix (DELETE /{id} — spec GH #207 §4)

`DELETE /{id}` is a **real hard delete** (row physically removed) for all 5 entities. When FK dependencies exist, the dependency-resolution mechanism kicks in: dry-run preview (409) or execute-with-resolutions (204). Spec §5-§6 is the source of truth for the contract.

| Entity → Relation | Nullable? | Action | User choice? |
|---|---|---|---|
| **Material** | (no FK deps) | — | — | Zero DB deps; `DELETE /materials/{id}` always 204 |
| Master → **activities** (master_id) | NOT NULL | **block** | N/A — `allowed_actions: []` |
| Master → **users** (master_id) | nullable | **cascade** (auto) | auto — no choice (§4.1, Change 2) |
| Master → **master_tags** (join) | NOT NULL PK | **cascade** (auto) | auto |
| Location → **activities** (location_id) | NOT NULL | **block** | N/A — `allowed_actions: []` |
| Location → **location_tags** (join) | NOT NULL PK | **cascade** (auto) | auto |
| Service → **activities** (service_id) | NOT NULL | **block** | N/A — `allowed_actions: []` |
| Service → **tariffs** (service_id) | NOT NULL | **cascade** (auto) | auto |
| Service → **photos** (service_id) | nullable | **nullify** (auto) | auto |
| Service → **service_tags** (join) | NOT NULL PK | **cascade** (auto) | auto |
| Client → **records** (client_id) | nullable | **nullify** | choice: `["nullify"]` — record survives, becomes anonymous |
| Client → **visitors** (client_id) | NOT NULL | **cascade** | choice: `["cascade"]` — via `VisitorService._delete_cascade` (visits → photos SET NULL → visitor_tags → visitor). Payments are NOT part of the cascade (record-scoped, survive — see cascade_preview rule below). |
| Client → **client_tags** (join) | NOT NULL PK | **cascade** (auto) | auto |

**Key rules:**

- **`activities = always block`** (`allowed_actions: []`). `activities.{master,location,service}_id` are NOT NULL, and `Activity` has no `is_active` (extends `AbstractModel`, not `AbstractModelSoftDelete` per #194) so it cannot be archived. DELETE is impossible while activities exist — the only option is archive.
- **Auto deps** (join tables `*_tags`, unambiguous relations tariffs / photos-service, **Master→users** per §4.1) resolve automatically — no user choice. Server ignores any resolution the user sends for an auto dep; auto wins.
- **Master→users delete cascade (§4.1, Change 2):** `DELETE /masters/{id}` with a linked `users` row hard-deletes the user row automatically (auto-cascade, no user choice). Rationale: User is the login account, Master is the profile; deleting the profile but keeping the account = orphan. The ONLY non-join auto-cascade besides Service→tariffs.
- **Master→users archive/restore cascade (§4.2, Change 3):** `MasterService.archive()`/`restore()` write the linked `users.is_active` in the same transaction. Master-only — the other 4 entities do NOT cascade to any user on archive/restore. This is an archive-cascade (sets `is_active`), not a delete cascade.
- **Client→visitors cascade** runs via an **extracted non-decorated core** (`VisitorService._delete_cascade`) inside the single outer `ClientService.resolve_delete` `@transactional` transaction — NOT a per-visitor `@transactional` loop (atomicity requirement, §8): each `@transactional` commits its own session, so a mid-loop failure would leave prior work committed. Cascade order: visits → photos SET NULL → visitor_tags → visitor. Payments are **not** part of this cascade (record-scoped, survive with the nullified records — see the `cascade_preview` rule below).
- **`cascade_preview` reports visits count only** for the Client → visitors cascade. `Payment` is **record-scoped** (`payments.record_id → records.id`); Client→records is *nullify* (records survive, become anonymous), so their payments are NOT part of the visitors cascade and survive with the nullified records. Absent for nullify actions (nothing downstream is hard-deleted).

### 409 / 422 contract (DELETE `/{id}`)

- **204 (no body, zero deps):** `DELETE /{id}` with no body and zero dependencies → 204 hard delete (row physically gone). Material always (zero deps); any of the 5 with no FK blockers.
- **409 (no body, deps exist):** `DELETE /{id}` with **no body** and any dependency (auto or non-auto) → 409 Conflict + dependency tree (counters + sums only, no individual row data). No rows modified. Sample:
  ```json
  {
    "detail": "has_dependencies",
    "dependencies": [
      {"entity": "activities", "count": 3, "allowed_actions": [], "message": "..."},
      {"entity": "visitors", "count": 12, "allowed_actions": ["cascade"],
       "cascade_preview": {"visits": 45}},
      {"entity": "records", "count": 47, "allowed_actions": ["nullify"]}
    ]
  }
  ```
- **204 (with body, resolutions valid):** `DELETE /{id}` with body `{"resolutions": {"records": "nullify", "visitors": "cascade"}}` — server validates each action against the FK matrix, requires resolutions for **all non-auto deps**, resolves auto deps automatically, then executes **nullify → cascade → hard delete** in ONE transaction. Returns 204 on success. Auto deps are omitted from the user's `resolutions`; if all deps are auto, the body is `{}`.
- **422 (with body, invalid/missing resolution):** A resolution NOT in `allowed_actions` for that entity → 422 (e.g. `{"activities": "cascade"}` → 422 because activities is blocked; `{"records": "cascade"}` → 422 because records only allows nullify). Missing a non-auto dep → 422 ("resolution required for entity X"). Auto deps in the body are silently ignored (no error). Blocked deps (activities, `allowed_actions: []`) → 422 always ("entity has blocking dependencies — archive instead").
- **404** (entity not found). An empty body (or no body) is the dry-run per §5 — produces 204 or 409, never executes.
- **Execution order:** nullify → cascade → hard delete (entity row last), all in ONE `@transactional` method (rollback on any failure).
- **FK backstop:** `PRAGMA foreign_keys=ON` added to the SQLite connect listener in `database.py` (no migration). The service-level transaction remains the **primary** mechanism; DB-level FK is a backstop that catches any non-service write path (raw SQL, migrations, backfills).

## Cross-Entity Invariants

1. **Capacity:** `occupied + seats <= activity.capacity` (on Record create only)
   - `occupied` is the SUM of `Record.seats` for records matching `active_record_filter()` — i.e. `status IN ('waiting','visited')`. Cancelled and missed records do NOT occupy a seat. See `src/domain/record_visits.py` and `ACTIVE_RECORD_STATUSES` in `src/domain/visit_status.py`.
2. **Seats = len(visits):** Always computed, never user-set
3. **Cascade hard-delete:** Record → Visits + Payments
4. **Cascade hard-delete:** Activity delete → Records (and transitively their Visits + Payments); photos SET NULL
5. **Phone search:** Exact match, no format validation
6. **Client phone:** No uniqueness constraint (duplicates possible)
7. **Visitor (client_id, name):** Uniqueness enforced at service level only

## PATCH Contract

`GenericService.patch()` — базовая семантика partial update для всех сущностей:

| Правило | Поведение |
|---------|-----------|
| Partial update | Обновляются только поля, явно переданные в запросе (`exclude_unset=True`) |
| `None` для NOT NULL полей | Молча стрипится (поле не обновляется) |
| `None` для nullable полей | Применяется — поле обнуляется |
| `is_active` on PATCH (5 archive-aware entities) | **REJECTED** — `is_active` removed from all PATCH schemas (GH #207 §3.2 — auto-closes #178, #201); a PATCH body containing `is_active` → **422** (extra field). The `_strip_is_active_none` helper is deleted (no caller remains). Archive/restore only via `POST /{id}/archive` + `POST /{id}/restore` — see "Archive terminology boundary" above. |
| Entity not found | Возвращает `None` → API возвращает 404 |
| `updated_at` | Обновляется автоматически через SQLAlchemy `onupdate` |

**Источник истины:** `backend/tests/services/test_generic_service_contract.py` — параметризованный contract-тест по всем подклассам `GenericService`.

### Исключения (override-семантика)

Некоторые сервисы переопределяют базовую семантику:

| Сервис | Override | Тесты |
|--------|----------|-------|
| `ServiceService` | `tag_ids` — hard-replace; `tariffs` — пересоздаются | `test_api_services.py` |
| `PhotoService` | `tag_ids` — hard-replace | `test_api_photos.py` |
| `RecordService` | `visits`/`seats`/`status` — пересчитываются автоматически | `test_api_records.py` |

### Правила при изменениях

1. **Новый подкласс `GenericService`** → добавить config-запись в contract-тест, иначе guard-тест падает.
2. **Новая NOT NULL колонка в модели** → обновить `NOT_NULL_FIELDS` сервиса; config-тест `test_not_null_fields_match_model` падает, если не совпадают.
3. **Per-entity API-тесты** держат только smoke/wiring (404 + ErrorCode) и override-семантику — generic-семантики **НЕ дублировать** (они уже в contract-тесте).

## Critical Parity Issues (Backend ↔ Frontend)

| # | Entity | Issue |
|---|--------|-------|
| 1 | Record | `visits` optional in Zod, required in Pydantic |
| 2 | Record | `VisitItem` missing `name`/`age` in Zod |
| 3 | Service | Backend has no min/max constraints (Zod has them) |
| 4 | Location | Backend missing `tag_ids` |
| 5 | Payment | Frontend missing `amount > 0` validation |
| 6 | Service | `min_age <= max_age` not enforced in Pydantic |

## Architecture

- **Backend:** FastAPI + SQLite + Pydantic schemas (minimal constraints)
- **Frontend:** Next.js 14 + TypeScript + Zod schemas (richer constraints)
- **Domain rules:** This markdown (single source of truth)
- **Parity:** Backend Pydantic ↔ Frontend Zod must match (currently don't)
- **No auth:** All API endpoints are fully open

## Risk Areas

1. **TOCTOU race condition** on capacity check (Record create)
2. **No capacity re-validation** on Record update
3. **No payment sum validation** (can exceed record price)
4. **No phone format validation** (backend accepts anything)
5. **Hard delete of Tariffs** on Service update (no audit trail)
6. ~~Activity delete orphans Records~~ — resolved: Activity delete now cascades hard-delete to Records

## Planned Improvements (from user requirements)

### 1. Flexible Seats (Record)
- Allow specifying seats count without providing visitor names
- Hybrid: manual seats OR one-by-one visitors
- See records.md for details

### 2. Create Booking Without Name/Phone (Record)
- Allow null name on Client when creating Record
- Allow null phone when creating Record
- See records.md for details

### 3. Booking Count Update After Deletion (Activity)
- **Bug:** ActivityCard occupied count doesn't refresh after deleting a Record
- **Fix:** Invalidate activity queries after Record deletion
- **Where:** ActivityDetailsModal → handleDeleteRecord

### 4. Reusable MasterPicker Component
- **Current:** SettingsTab has hack (colored span over native select)
- **Current:** ClientRecordTab uses CustomSelect without color
- **Goal:** Single MasterPicker component with colored square, reusable across all modals
- **Base:** CustomSelect from PR #56 (supports icon + color)

### 5. Consistent Entity Operations Across Pages
- **Current:** ActivityDetailsModal (schedule) and ClientRecordTab (clients) duplicate logic
- **Goal:** Shared mutation hooks, shared validation, shared UI patterns
- **Approach:** Extract useActivitiesMutations, useRecordsMutations hooks

### 6. Fix Console Errors on Booking Creation
- **Symptom:** Errors in console when creating Record
- **Investigate:** Empty catch blocks, unhandled promise rejections
- **Where:** NewBookingTab API calls
