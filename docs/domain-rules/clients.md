# Client — Domain Rules

## Description
A Client is a customer who books master classes. All fields are nullable — a Client can exist with no name, no phone, no email. Clients are archive-aware (archive/restore via dedicated endpoints; hard-delete-with-resolutions per spec GH #207).

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| name | string | ❌ | — | 200 | null | Имя клиента |
| phone | string | ❌ | — | 20 | null | Телефон (format not enforced) |
| email | string | ❌ | — | 255 | null | Email (format not enforced) |
| channel | enum | ❌ | — | — | null | telegram / whatsapp / max |

## Cross-field Rules
- None. All fields are independent.

## Invariants
- Client can exist with all null fields
- No uniqueness constraint on phone (duplicates possible)
- Stats (records_count, total_paid, etc.) are computed, not stored

## Business Logic

### Backend
- **Phone lookup (exact):** `GET /api/v1/clients/get?phone=X` (GH #212; was `/clients/search` then `searchClientByPhone`). Exact match on `Client.phone`, active-only (archived rows excluded from the lookup), `phone: Query(..., min_length=3)`. First-match-or-404 (returns a single `ClientResponse`); no-match → 404 `ErrorCode.CLIENT_NOT_FOUND`. Since GH #221 the record form no longer calls this route (replaced by the digits-mode list filter + save-time resolution — see Frontend); the route itself is unchanged. The empty-string and `<3-char` cases → **422 VALIDATION_ERROR** via the Query bounds. The api-client fn is `getClientByPhone(phone)`. The lookup is implemented as a one-shot call to `ClientService.list(phone=...)` (search-predicate wired for `phone` exact-equality), so the same q-bound semantics apply (422 outside 2–100 chars). A 4-char or 5-char phone (above `min_length=3` but below the search `min_length=2` floor for the broader list) is accepted here because the phone param uses its own `min_length=3` — the lookup is a separate code path from the list `?q=`.
- **Stats aggregation:** records_count, last_record, total_paid, missed_records — computed on list
- **`last_record`** = `MAX(Activity.start)` over all active Records of this client (NO status filter — includes cancelled/missed/waiting). Shows the latest activity date among all records the client was booked for. `null` if the client has no active records. Implemented as a correlated scalar subquery in `ClientService` (`last_record_sq`). NOTE: prior to #131 this was called `last_visit` and filtered by `Visit.status='visited'`.
- **`missed_records`** = `COUNT(Record.id) WHERE Record.status='missed' AND Record.is_active=True` (relies on persisted `Record.status` — see `compute_record_status` in `docs/domain-rules/records.md`). Rule: priority visited > missed > cancelled > waiting. A record with 1 visited + 1 missed visit → `Record.status='visited'` → NOT counted in `missed_records`.
- **`last_record_activity`** (upcoming booking): *not implemented yet* — tracked in #133. Would be `MIN(Activity.start)` over active records where `Activity.start > now()`. Distinct from `last_record`: a client may have a `last_record` in the past AND a `last_record_activity` in the future.
- **Filters:** `status` (default `active`; `archived` | `all` — replaces the retired `is_active` query param), `?q=` (GH #212 — see "List `?q=`" below; **renamed from `?search=`**; ILIKE on name/phone/email + full-UUID id), date ranges, record count ranges (`min_records`/`max_records`), missed ranges (`missed_from`/`missed_to`), payment ranges (`min_paid`/`max_paid`)
- **Sort columns:** name, records_count, last_record, total_paid, missed_records, created_at, updated_at
- **Pagination:** page (default 1), per_page (default 20, max 100)

### List `?q=` (server `?q=`, GH #212)
Param `q: str | None` declared on `ClientListParams` with `min_length=2` / `max_length=100` via Pydantic `Field` → out-of-range → **422 VALIDATION_ERROR**. Empty/missing `q` is allowed and means "no search filter". Case-insensitive; Cyrillic-safe via the SQLite `lower()` override in `src/db/database.py` (M5).

| Field | Kind | Notes |
|-------|------|-------|
| `Client.name` | substring | ilike `%q%` (case-insensitive) |
| `Client.phone` | substring | ilike `%q%` |
| `Client.email` | substring | **added in GH #212** (was not part of the pre-#212 `?search=` matrix) |
| `Client.id` | uuid | exact equality only when `q` is a full 36-char UUID (case-normalized lowercase). A partial id fragment (e.g. first 8 chars) NEVER matches by id. |

The `q` predicate is applied BEFORE the COUNT in `list_clients_with_stats` (`client.py:170`), so `total` always reflects the q-filtered set — never the unfiltered total. Same goes for every other entity (the matrix is identical in shape). The `phone` exact-lookup route (`GET /api/v1/clients/get?phone=`) is a separate, active-only code path — see "Phone lookup" above.

### List `?phone=` (digits-mode phone filter, GH #221)
Param `phone: str | None` on `ClientListParams`. Non-digits are stripped from the value; the remainder must be **4–15 digits**, otherwise **422 VALIDATION_ERROR** (own bounds, independent of `q`'s 2–100; empty/missing = no filter). Matching mode: **national-digits substring** — query and `Client.phone` are both reduced to digits (leading `7`/`8` dropped when exactly 11 digits remain: RU country/trunk code), and the reduced query must be a **substring anywhere** of the reduced stored phone — so tail-of-number search works (`4567` matches `+79991234567`). `NULL`/empty phones never match. Implemented via the custom SQLite function `memo_phone_national` (registered in `src/db/database.py` next to the `lower()` override, M5 precedent) + `LIKE '%digits%'`; applied in `list_clients_with_stats` before COUNT. Combines with `status`/`q`/pagination as AND (framework pass-through, not a designed combination). Relationship to `q`: `q` stays a literal substring over raw name/phone/email strings; `phone` is the digits-normalized mode — the record-form typeahead uses `phone`, the clients list keeps `q`.
- **Restore:** `POST /api/v1/clients/{id}/restore` (sets `archived: false`, HTTP 200 with body) — spec GH #207. *Previously* restore was via `PATCH /clients/{id}` with explicit `{"is_active": bool}`; that path now 422s (`is_active` removed from all PUT/PATCH schemas — auto-closes #201). Restore-buttons UI parity for Client landed in #207 (closes #198).

### Frontend
- **No required fields** on create/edit
- **Channel select:** telegram, whatsapp, max; unknown/legacy values (e.g. `'instagram'`, `'vk'`, `'website'` from before the enum was tightened) are normalized to «Не указан» in the dropdown display. Save persists `''`/unknown as `null` (save-time allowed-set conversion `['telegram','whatsapp','max'].includes(channel) ? channel : null`). Legacy channel wash-out on the next edit-save is **one-way** — a legacy row saved once loses its channel value forever (to null); GET read tolerance for untouched legacy rows stays (`TestClientChannelTolerance`).
- **Dirty-check:** hasChanges boolean, Save/Cancel buttons disabled when !hasChanges
- **Empty display:** Name → "Дорогой гость", Phone → "Не указан"
- **Deep-link `?clientId=` (GH #216):** navigating to `/clients?clientId={id}` (producer: ActivityDetailsModal) programmatically narrows the table — `setFilters({ search: id, status: 'all' })` → server `q=` full-UUID exact-id match → ≤1 row on page 1 → the page find-effect opens ClientCardModal from the row. Status is force-set to `all` so archived clients are reachable (display default stays `active`). On modal close the search box is NOT auto-cleared — the user sees the narrowed table and clears manually. Dead links (client deleted) strip the param once the narrowed fetch settles empty (no refresh re-narrowing loop). The ClientsFilters search input is controlled: external commits render in the box; user typing is debounced 300ms and never clobbered by its own commits; «Сбросить фильтры» cancels pending debounce and clears the box.
- **Record-form phone typeahead (GH #221):** the NewBookingTab phone field is an adaptive-mask typeahead (libphonenumber-js `AsYouType`, `min` metadata; country auto-detected from the typed prefix — `+7` → RU grouping, `+375` → BY; no country dropdown; caret not managed — mid-string edits may jump to end, v1 limitation). Suggestions are **active-only**, fire from the **4th typed digit** (the formatter's national-number output — never digits scraped from the formatted display; scraped digits would carry the decorative `8`/`+7` and break tail-of-number search), request `GET /api/v1/clients?phone=<digits>&per_page=10` (debounced 300 ms). Suggestion row: `Name · phone`, name falls back to «Без имени». **Picking** a suggestion binds the record to that client by id and freezes phone + name read-only with a clear (×) affordance — editing a client's name happens only in the client card. **Unpicked save**: the visible value must be a **complete valid number** for its detected country (GH #221 decision 11 — `parsePhoneNumberFromString(value, 'RU')?.isValid()`, same library as the mask; incomplete → save blocked with «Проверьте номер телефона — возможно, он введён не полностью», nothing fetched/created); then a **fresh** `?phone=` national-digits fetch of the typed number (never the suggestion snapshot) → the first row whose national digits **EQUAL** the typed digits binds — equality compares both sides through the §3 reduction (`toNationalDigits`, the TS mirror of `to_national_digits` colocated in `useRecordMutations.ts`, so any stored spelling matches; parity with the old first-or-404); no match → create a client with the **visible formatted string** as phone (WYSIWYG); fetch failure → save blocked with a retryable error (no silent duplicate). Shared typeahead component is parameterized (`RemoteSearchSelect` generalized); Photos consumers keep min-2-chars `?q=` behavior unchanged.

## Master role (#263)

Для роли `master` (спека `docs/specs/2026-09-10-master-role-design.md`):

- **Маска контактов в каждом ответе**: `phone` → последние 4 цифры (`+7 909 •••-••-1234`; короче 4 цифр — маскируется целиком; `null` остаётся `null`), `email` → `null`. Имя и `channel` — видны. Действует на `ClientResponse`, `ClientWithStats`, телефон в схеме записи, выдачу typeahead. Маска — только чтение: создание/поиск принимают полный номер.
- **Поиск по номеру — по всем активным**: `?phone=` (digits-mode) и `GET /get?phone=` ищут по всей студии (номер = ключ поиска клиента при записи), ответ маскирован.
- **Список без phone-фильтра — только «свои»** клиенты (есть активная запись к активности мастера).
- **POST — разрешён** (201; флоу записи новому клиенту), **мутации существующих (PUT/PATCH/DELETE/archive/restore) — 403** `AUTH_FORBIDDEN`.
- Чужой клиент по id → 404 `CLIENT_NOT_FOUND`.

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/clients | List with pagination, filters, sorting — `?status=active` (default) \| `archived` \| `all`, `?q=` substring search (name/phone/email + full-UUID id) — GH #212 (was `?search=`; **email added**; renames `search`→`q`); `?phone=` digits-mode national-substring filter (4–15 digits after strip, 422 outside) — GH #221 |
| GET | /api/v1/clients/get?phone=X | Phone lookup — exact, active-only, 404 `CLIENT_NOT_FOUND` if no match, 422 if `len(phone) < 3` (GH #212; **renamed from `/clients/search?phone=`**) — api-client `getClientByPhone` |
| GET | /api/v1/clients/{id} | Get with stats |
| POST | /api/v1/clients | Create |
| PUT | /api/v1/clients/{id} | Full update |
| PATCH | /api/v1/clients/{id} | Partial update |
| DELETE | /api/v1/clients/{id} | Hard delete with resolutions (no body + 0 deps → 204; no body + deps → 409 dry-run; body `{"resolutions": {"records": "nullify", "visitors": "cascade"}}` → 204 on success / 422 on invalid-or-missing) — spec GH #207 |
| POST | /api/v1/clients/{id}/archive | Archive (sets `archived: true`, HTTP 200 with body) — GH #207 |
| POST | /api/v1/clients/{id}/restore | Restore (sets `archived: false`, HTTP 200 with body) — GH #207 (closes #198) |
| GET | /api/v1/clients/{id}/visitors | List client's visitors |

## Relationships
- Client → has many Visitors
- Client → has many Records
- Client → has many Tags (M2M via client_tags)

## Response field: `archived` (inverted)
The Response schema exposes `archived: bool` instead of `is_active` (inversion: `archived = true` = in archive = `is_active = false`). The DB column stays `is_active`. **Two mapper paths for Client** (not one): the generic `ClientResponse` path AND the manual `ClientWithStats` builder in `list_clients_with_stats` — both invert; the manual path is a second inversion point that would silently break the Pydantic model at compile time once `is_active` left the schema (spec §3.1). See `_overview.md` → "Archive terminology boundary".

## Enums & Constants
| Enum | Values |
|------|--------|
| Channel | telegram, whatsapp, max |

## Acceptance Criteria
- [ ] All fields nullable
- [ ] Phone search returns exact match
- [ ] Stats computed correctly
- [ ] `DELETE /{id}` with resolutions: records `nullify` (survive, become anonymous — `client_id=null`), visitors `cascade` (deleted), `client_tags` auto-cascade (deleted), `photos` auto-nullified (survive, become owner-less — GH #211). Payments are record-scoped and survive with the nullified records (NOT deleted by the visitors cascade).

## Parity Notes
| Backend (Pydantic) | Frontend (Zod) | Match |
|--------------------|----------------|-------|
| **Create:** all fields optional; `channel: Channel \| None` | **Create:** all fields optional; `channel: string` (free-form) | ⚠️ Create path intentionally lenient (booking auto-create, external flows; spec §3.2) |
| **Update:** `ClientUpdate` — 4 required-nullable fields (`name`/`phone`/`email`/`channel`); `channel: Channel \| None`. **`is_active` REMOVED** (GH #207 §3.2 — auto-closes #201); a PUT body containing `is_active` → 422. | **Update:** `ClientUpdateSchema` — 4 required-nullable fields; `channel: z.enum([...]).nullable()`. **`is_active` REMOVED**; `archived: z.boolean()` added to Response. | ✅ Update path enforces `Channel` enum on both sides (GH #201); #207 removes `is_active` and inverts to `archived` in Response |
| **Response:** `archived: bool` (inverted from `is_active`) on `ClientResponse` AND on the manual `ClientWithStats` builder in `list_clients_with_stats` (second inversion point — spec §3.1). | **Response:** `archived: z.boolean()` in all Client response schemas (incl. `ClientWithStats`). | ✅ Parity maintained after the GH #207 inversion |
| `name: str \| None` | `name: z.string().nullable()` | ✅ Update; Create: `name: string (optional)` — ⚠️ empty string vs null (admin converts `'' → null` on save) |

## Archive & delete semantics (GH #207)

Client is one of the 5 archive-aware entities. PUT/PATCH no longer accept `is_active` (auto-closes #178, #201); archive/restore only via `POST /archive` + `POST /restore`. Archive/restore is a single-row `is_active` flip — **no cross-entity write**. The 4 required-nullable personal keys on `ClientUpdate` are unchanged (`name`/`phone`/`email`/`channel` — required-nullable, key must be present, explicit `null` = deliberate clear; omitted key → 422; null renders as «не указан»/«Дорогой гость» and doesn't match phone search). Stats (`records_count`, `total_paid`, …) and payments are computed/joined by `client_id`; wiping personal fields leaves them intact.

### Client FK dependencies (DELETE `/{id}`)

| Relation | Nullable? | Action | User choice? |
|---|---|---|---|
| **records** (client_id) | nullable | **nullify** | **choice: `["nullify"]`** — non-auto; user must include `{"records": "nullify"}` in the resolutions body (missing → 422). Record survives, becomes anonymous (`client_id=null`). |
| **visitors** (client_id) | NOT NULL | **cascade** | **choice: `["cascade"]`** — non-auto; user must include `{"visitors": "cascade"}` (missing → 422). Cascade follows `VisitorService._delete_cascade` (visits → visitor_tags → visitor; photo `visitor_id` dropped in GH #211 — photos not part of this cascade). Payments are NOT part of this cascade (record-scoped, survive with the nullified records — see `cascade_preview` below). |
| **client_tags** (join) | NOT NULL PK | **cascade** (auto) | auto — join table rows deleted automatically; omitted from resolutions body. |
| **photos** (client_id) | nullable | **nullify** (auto) | auto — photo survives, becomes owner-less (GH #211). |

- **`cascade_preview` for the visitors cascade: `{"visits": <count>}` only.** `Payment` is **record-scoped** (`payments.record_id → records.id`); Client→records is *nullify* (records survive, become anonymous), so their payments are NOT part of the visitors cascade and survive with the nullified records. Absent for nullify actions (nothing downstream is hard-deleted). (Spec §5.)
- **DELETE `/{id}` (no body):** zero deps → 204 hard delete (row gone). Any dep → 409 + dependency tree (counters + sums only, no rows modified). For a Client with 47 records, 12 visitors (across 45 visits), and 5 client_tags:
  ```json
  {
    "detail": "has_dependencies",
    "dependencies": [
      {"entity": "records", "count": 47, "allowed_actions": ["nullify"]},
      {"entity": "visitors", "count": 12, "allowed_actions": ["cascade"],
       "cascade_preview": {"visits": 45}},
      {"entity": "client_tags", "count": 5, "allowed_actions": ["cascade"]}
    ]
  }
  ```
- **DELETE `/{id}` (with body):** `{"resolutions": {"records": "nullify", "visitors": "cascade"}}` (tags + photos auto — omitted from body). Invalid action → 422 (e.g. `{"records": "cascade"}` — records only allows nullify; `{"activities": "cascade"}` — activities is blocked). Missing a non-auto dep → 422 ("resolution required for entity records/visitors"). Auto deps sent in body are ignored. On success → 204, executed in ONE `@transactional` method: **nullify** records (set `client_id=null`) → **cascade** visitors via the extracted `VisitorService._delete_cascade` core on the shared session (NOT a per-visitor `@transactional` loop — atomicity, §8) → **cascade** client_tags → **nullify** photos (set `client_id=null`, auto) → **hard delete** the client row. (Spec §6.)
- **Result of a successful delete:** records survive with `client_id=null` (anonymous); **payments survive** with their nullified records (record-scoped, NOT deleted by the visitors cascade); photos survive with `client_id=null` (owner-less); visitors + their visits + visitor_tags + client_tags + the client row are physically gone.

### Master-only contrast (NOT applicable to Client)

Master archive/restore cascades to the linked `users.is_active` (§4.2, Change 3). Client archive/restore is a single-row `is_active` flip with **no cross-entity write** — there is no Client→users-style login-account link. (See `masters.md` for the Master special case.)
