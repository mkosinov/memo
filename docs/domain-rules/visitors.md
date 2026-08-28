# Visitor — Domain Rules

## Description
A Visitor is an individual person attending a master class. Visitors belong to a Client (a Client can have multiple Visitors, e.g., parent + child).

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| client_id | string | ✅ | — | — | — | FK to Client |
| name | string | ✅ | — | 200 | — | Имя посетителя |
| age | integer | ❌ | — | — | null | Возраст (null = взрослый) |

## Cross-field Rules
- None.

## Invariants
- Every Visitor belongs to exactly one Client
- (client_id, name) uniqueness enforced at service level (find-or-create), NOT at DB level

## Business Logic

### Backend
- **Scoped to Client:** list_by_client(client_id) returns all visitors for the client
- **Cascade on delete:** hard-delete cascades to Visits (visits hard-deleted); visitor_tag join rows cleaned. Photo `visitor_id` was dropped in GH #211 — photos are NOT linked to visitors (no photo cleanup in this cascade).
- **Auto-created by RecordService** when name-based visit is created
- **List-all endpoint:** `GET /api/v1/visitors` — paginated generic list, introduced in #183 **for contract completeness with GenericService** so visitors is no longer the only generic entity excluded from generic list contract coverage (#184/#185). It supersedes the previous no-list-all rule. The **production-use read path for visitors remains the scoped `GET /clients/{id}/visitors`** — the bare list is a contract endpoint, not a production consumer-facing read path.

### List `?q=` (server `?q=`, GH #212)
The `GET /api/v1/visitors` list endpoint accepts the standard `q` param. Declared on the list params model with `min_length=2` / `max_length=100` via Pydantic `Field` → out-of-range → **422 VALIDATION_ERROR**. The per-entity search-fields matrix lives in `VisitorService.search_fields` (`src/services/visitor.py`):

| Field | Kind | Notes |
|-------|------|-------|
| `Visitor.name` | substring | ilike `%q%` (case-insensitive) |
| `Visitor.id` | uuid | exact equality only when `q` is a full 36-char UUID (case-normalized lowercase). A partial id fragment NEVER matches by id. |

The `q` predicate lands BEFORE the COUNT (inherited from `BaseRepository.list`), so `total` always reflects the q-filtered set. Search is case-insensitive and Cyrillic-safe via the SQLite `lower()` override in `src/db/database.py` (M5).

### Frontend
- **Create form:** name (required), age (optional)
- **Display:** Name + age in parentheses: "Иван (12 л.)" or "Иван (взр.)"
- **No validation** on age min/max

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/visitors | List all (paginated, contract-only — see Business Logic) + `?q=` substring search (name + full-UUID id) — GH #212 |
| GET | /api/v1/visitors/{id} | Get |
| POST | /api/v1/visitors | Create |
| PUT | /api/v1/visitors/{id} | Update |
| PATCH | /api/v1/visitors/{id} | Partial update |
| DELETE | /api/v1/visitors/{id} | Hard delete (cascade: visits hard-deleted, tag join rows cleaned) |

## Relationships
- Visitor → belongs to Client
- Visitor → has many Visits
- Visitor → has many Tags (M2M)

## Acceptance Criteria
- [ ] Name required
- [ ] client_id required
- [ ] Find-or-create by (client_id, name)

## Parity Notes
| Backend (Pydantic) | Frontend (Zod) | Match |
|--------------------|----------------|-------|
| name: str (required) | name: string (required) | ✅ |
| age: int \| None | age: number (optional) | ✅ |
