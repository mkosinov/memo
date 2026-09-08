# Material — Domain Rules

## Description
A Material is a physical supply or tool used in master classes (e.g., paint, clay, canvas). Materials are simple catalog entries referenced by Services.

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| title | string | ✅ | — | — | — | Название материала |
| description | string | ✅ | — | — | — | Описание |

## Cross-field Rules
- None.

## Invariants
- ~~Materials can be hard-deleted via `DELETE /{id}` unconditionally~~ **GH #223 (landed — plan `docs/plans/2026-09-07-materials-services-link-223-plan.md`):** `service_materials` links make Material FK-dependent — unlinked → 204 as before; linked → 409 + dependency tree, body `{"resolutions": {}}` → links auto-cascade + hard delete → 204 (generic GH #207 mechanics). See Archive & delete semantics below.
- Archived state via `POST /{id}/archive` (sets `archived: true`) and restored via `POST /{id}/restore` (sets `archived: false`). See `_overview.md` → "Hard-delete FK dependency matrix".

## Business Logic

### Backend
- Pure CRUD, no business logic beyond generic service

### Frontend
- EntityModal: title + description (both required)

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/materials | List records — `?status=active` (default) \| `archived` \| `all` |
| GET | /api/v1/materials/{id} | Get |
| POST | /api/v1/materials | Create |
| PUT | /api/v1/materials/{id} | Full update |
| PATCH | /api/v1/materials/{id} | Partial update |
| DELETE | /api/v1/materials/{id} | Hard delete — **GH #223 (landed):** no links → 204 (no body); linked to services → 409 + dependency tree, body `{"resolutions": {}}` → auto-cascade links + 204 — spec GH #207 |
| POST | /api/v1/materials/{id}/archive | Archive (sets `archived: true`, HTTP 200 with body) — GH #207 |
| POST | /api/v1/materials/{id}/restore | Restore (sets `archived: false`, HTTP 200 with body) — GH #207 |

## List contract (GH #205)

- **Paginated `GET /api/v1/materials`**: `page` (≥1), `per_page` (1-100, default 20), `status` (active|archived|all, default active), `sort_by` (Literal whitelist: `title, description, archived, created_at`; 422 on unknown), `sort_order` (asc|desc, default asc). Default order: `title ASC, id ASC` (spec §4.4).
- **Bare `GET /api/v1/materials/all`**: bare JSON array (no envelope), `status` parity with paginated, deterministic order = same default. Protective `BARE_LIST_MAX_ROWS = 1000` → 422 English error naming entity + paginated endpoint (spec §4.3).
- **Consumers**: Materials table = server-paginated via `MaterialsContext`; `getAllMaterials` ships for #214 combobox (no current lookup consumer) = `/all` (spec §5.5).
- **Search matrix (spec §6)**: **list `?q=` (GH #212) is the delivered contract** — substring on `Material.title` + `Material.description` (each field ilike'd separately), plus exact `Material.id` equality when `q` parses as a full 36-char UUID. `q: str | None` declared on the list params model with `min_length=2` / `max_length=100` via Pydantic `Field` → out-of-range → **422 VALIDATION_ERROR**. The `q` predicate lands BEFORE the COUNT (inherited from `BaseRepository.list`), so `total` always reflects the q-filtered set. The per-entity search-fields matrix lives in `MaterialService.search_fields` (`src/services/material.py`). Dictionary form dropdowns still consume `/all` directly via `getAllMaterials` (#214 combobox; client filter over the bare array).

## Relationships
- Service ↔ Materials — M2M via `service_materials` (association object: service_id + material_id composite PK, `note: Text NULL` per link). **GH #223 (landed).** Display rule for the materials **text block** (web client): link `note` if present, else material `description` (override pattern); compact badges (admin services table) show titles only. Service write API takes `materials: [{material_id, note?}]` (create/PUT hard-replace; PATCH absent → preserve); unknown material_id → 422 (explicit pre-validation, deviation from tags' rely-on-FK). Services list gains `?material_id=<uuid>` filter (unknown-but-valid id → `{"items": [], "total": 0}`). Admin picker for new links = `/all?status=active` (archived materials not offered).
- `MaterialResponse` gains `used_in_services_count: int` (default 0) = number of **non-archived** services linked — one canonical definition regardless of the request's `status` param; computed on list/all/get and mutation returns via one aggregate (GH #223, landed). Archive/restore does NOT touch links; links to archived materials keep working and keep rendering (archived ≠ hidden).

## Response field: `archived` (inverted)
The Response schema exposes `archived: bool` instead of `is_active` (inversion: `archived = true` = in archive = `is_active = false`). The DB column stays `is_active`; `MaterialService` applies the inversion. See `_overview.md` → "Archive terminology boundary".

## Archive & delete semantics (GH #207)

Material is one of the 5 archive-aware entities. PUT/PATCH no longer accept `is_active` (auto-closes #178); archive/restore only via `POST /archive` + `POST /restore`. Archive/restore is a single-row `is_active` flip — **no cross-entity write**.

### Material FK dependencies (DELETE `/{id}`)

**GH #223 (landed):** one auto-cascade dependency —

| Relation | Nullable? | Action | User choice? |
|---|---|---|---|
| **service_materials** (join) | NOT NULL PK | **cascade** (auto) | auto — `allowed_actions: ["cascade"]`; resolutions body `{}` suffices |

Before #223 this section said "None — always 204": the join table changed that. Unlinked material → 204 (no body) exactly as before; linked → 409 + tree, body `{"resolutions": {}}` → one-transaction auto-cascade + hard delete → 204. No blocked variant exists. The admin Materials DeleteDialog 409 branch becomes live code.
