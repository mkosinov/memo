# Client — Domain Rules

## Description
A Client is a customer who books master classes. All fields are nullable — a Client can exist with no name, no phone, no email. Clients are soft-deleted (archived).

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
- **Phone search:** `GET /clients/search?phone=X` — exact match, returns first result or 404
- **Stats aggregation:** records_count, last_record, total_paid, missed_records — computed on list
- **`last_record`** = `MAX(Activity.start)` over all active Records of this client (NO status filter — includes cancelled/missed/waiting). Shows the latest activity date among all records the client was booked for. `null` if the client has no active records. Implemented as a correlated scalar subquery in `ClientService` (`last_record_sq`). NOTE: prior to #131 this was called `last_visit` and filtered by `Visit.status='visited'`.
- **`missed_records`** = `COUNT(Record.id) WHERE Record.status='missed' AND Record.is_active=True` (relies on persisted `Record.status` — see `compute_record_status` in `docs/domain-rules/records.md`). Rule: priority visited > missed > cancelled > waiting. A record with 1 visited + 1 missed visit → `Record.status='visited'` → NOT counted in `missed_records`.
- **`last_record_activity`** (upcoming booking): *not implemented yet* — tracked in #133. Would be `MIN(Activity.start)` over active records where `Activity.start > now()`. Distinct from `last_record`: a client may have a `last_record` in the past AND a `last_record_activity` in the future.
- **Filters:** `status` (default `active`; `archived` | `all` — replaces the retired `is_active` query param), search (ILIKE on name/phone), date ranges, record count ranges (`min_records`/`max_records`), missed ranges (`missed_from`/`missed_to`), payment ranges (`min_paid`/`max_paid`)
- **Sort columns:** name, records_count, last_record, total_paid, missed_records, created_at, updated_at
- **Pagination:** page (default 1), per_page (default 20, max 100)
- **Restore:** `PATCH /api/v1/clients/{id}` with an explicit `{"is_active": bool}` (sticky-field semantics — see `_overview.md` → "is_active semantics on get/update/patch"). The schema-level gap is closed: `ClientPatch` carries sticky `is_active` (PATCH restore path, #184) and `ClientUpdate` requires `is_active: bool` (PUT, #201); only the frontend restore-buttons UI remains a follow-up.

### Frontend
- **No required fields** on create/edit
- **Channel select:** telegram, whatsapp, max; unknown/legacy values (e.g. `'instagram'`, `'vk'`, `'website'` from before the enum was tightened) are normalized to «Не указан» in the dropdown display. Save persists `''`/unknown as `null` (save-time allowed-set conversion `['telegram','whatsapp','max'].includes(channel) ? channel : null`). Legacy channel wash-out on the next edit-save is **one-way** — a legacy row saved once loses its channel value forever (to null); GET read tolerance for untouched legacy rows stays (`TestClientChannelTolerance`).
- **Dirty-check:** hasChanges boolean, Save/Cancel buttons disabled when !hasChanges
- **Empty display:** Name → "Дорогой гость", Phone → "Не указан"

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/clients | List with pagination, filters, sorting — `?status=active` (default) \| `archived` \| `all` |
| GET | /api/v1/clients/search?phone=X | Search by phone |
| GET | /api/v1/clients/{id} | Get with stats |
| POST | /api/v1/clients | Create |
| PUT | /api/v1/clients/{id} | Full update |
| PATCH | /api/v1/clients/{id} | Partial update |
| DELETE | /api/v1/clients/{id} | Soft delete |
| GET | /api/v1/clients/{id}/visitors | List client's visitors |

## Relationships
- Client → has many Visitors
- Client → has many Records
- Client → has many Tags (M2M)

## Enums & Constants
| Enum | Values |
|------|--------|
| Channel | telegram, whatsapp, max |

## Acceptance Criteria
- [ ] All fields nullable
- [ ] Phone search returns exact match
- [ ] Stats computed correctly
- [ ] Soft delete preserves related entities

## Parity Notes
| Backend (Pydantic) | Frontend (Zod) | Match |
|--------------------|----------------|-------|
| **Create:** all fields optional; `channel: Channel \| None` | **Create:** all fields optional; `channel: string` (free-form) | ⚠️ Create path intentionally lenient (booking auto-create, external flows; spec §3.2) |
| **Update:** `ClientUpdate` — 4 required-nullable fields + required `is_active: bool`; `channel: Channel \| None` | **Update:** `ClientUpdateSchema` — 4 required-nullable fields + required `is_active: z.boolean()`; `channel: z.enum([...]).nullable()` | ✅ Update path enforces `Channel` enum on both sides (GH #201) |
| `name: str \| None` | `name: z.string().nullable()` | ✅ Update; Create: `name: string (optional)` — ⚠️ empty string vs null (admin converts `'' → null` on save) |

## Archive semantics on write

Client is a soft-delete entity. See `docs/domain-rules/_overview.md` → "is_active semantics on get/update/patch" for the general rule. **PUT canon (GH #201):** `ClientUpdate` is a standalone 5-key required schema — `name`/`phone`/`email`/`channel` are required-nullable (no defaults; key must be present, explicit `null` = deliberate clear) and `is_active: bool` is required. Omitted key → **422**. Explicit `null` in a personal field erases it (data-wipe semantics — never `'xxxxx'` strings; null renders as «не указан»/«Дорогой гость» in UI and doesn't match phone search). Stats (`records_count`, `total_paid`, …) and Payments are computed/joined by `client_id` — wiping personal fields leaves them **intact**. **PATCH sticky unchanged** (#184): `ClientPatch.is_active` stays `bool | None = None`; absent or `null` preserves the stored value, an explicit boolean applies.

**Null-semantics divergence (footgun for API consumers):** the PATCH media type is plain `application/json`, **not** `application/merge-patch+json` — sticky `null` → preserve **deviates from RFC 7396** (which would clear on `null`); this is documented to avoid misleading OpenAPI/codegen consumers. Consequently the **same JSON `null` carries divergent semantics per method**: **clear on PUT, preserve on PATCH**. Only the frontend restore-buttons UI remains a follow-up (PATCH restore path: `{"is_active": true}`).
