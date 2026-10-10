# Visit — Domain Rules

## Description
A Visit is the attendance record of a single Visitor within a Record. Each seat in a Record is one Visit. A Visit carries the pricing (tariff/price/custom_price) and the attendance status for that seat. Note: a Visit is distinct from a Visitor — name/age live on the Visitor, not the Visit.

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| id | string | ✅ | — | — | — | Primary key (response only) |
| record_id | string | ✅ | — | — | — | FK to Record |
| visitor_id | string | ❌ | — | — | null | FK to Visitor (null = seat without named guest) |
| tariff_id | string | ❌ | — | — | null | FK to Tariff (`ondelete=SET NULL` — GH #357: tariff deletion nulls the link; the visit row and its price survive) |
| price | integer | ✅ | 0 | — | — | Цена посещения (Field(ge=0)) |
| custom_price | integer | ❌ | — | — | null | Ручная цена (переопределяет тариф) |
| status | enum | ❌ | — | — | waiting | VisitStatus |
| created_at | string | — | — | — | — | ISO timestamp (response only) |
| updated_at | string | — | — | — | — | ISO timestamp (response only) |

## Cross-field Rules
- None.

## Invariants
- price >= 0 (enforced by Pydantic Field(ge=0))
- record_id must reference existing Record (FK enforced; create returns 404 if parent missing)
- Seats of parent Record = count of active Visits (always computed, never user-set)
- Cascade hard-delete: Visit is hard-deleted on parent Record delete
- price is a creation-time snapshot — never derived from the tariff at read time (GH #357); the `tariff_id` link is informational (badge display + edit-time re-pick), and a Visit survives its tariff's deletion (`ondelete=SET NULL`)

## Business Logic

### Backend
- **price >= 0** (only Pydantic field-level constraint)
- **Cascade to parent Record:** Visit create / update / patch / delete recompute the parent Record's seats + status (Phase 1: `domain/record_visits.py` → `recompute_record_seats` + `recompute_record_status`)
- **Batch block (GH #324):** `VisitService.delete_visits_by_visitor` removes ALL visits of one visitor (single bulk DELETE) and recomputes EVERY affected record (seats + status — the same `recompute_record_*` hooks as the single path; invariant «визит удалён → запись пересчитана»). Consumers: the Visitor executor (`(Visitor, "visits")` cascade handler), the standalone `VisitorService.delete` and the `delete_client` scenario (#327 — passes `mark_visits=False`, grid parity). Empty visitor → full no-op (no idle recompute). SSE markers: `visits` (suppressed when `mark_visits=False`) + `records` (the recomputed parents).
- Filtered by record_id on list
- **PATCH** merges only provided fields. Null-policy: `null` on NOT NULL fields (`price`, `status`) is ignored ("don't change"); `null` on nullable fields (`visitor_id`, `tariff_id`, `custom_price`) is applied and clears the field. Empty body (no fields set) → full no-op (`updated_at` unchanged, no Record cascade).

### Frontend
- **Inline editing:** tariff / price / status edited via `PATCH /api/v1/visits/:id`
- **Name / age NOT edited here** — those belong to the Visitor and go through `PUT /api/v1/visitors/:id`
- **Optimistic updates** on unified rows
- **PATCH-response cache application (GH #359):** a visit PATCH response is applied to the record cache by **projection** — only the fields present in the serialized request body (plus `updated_at`) are written into the cached visit row; per field the **last-issued request wins** (a late-arriving response of an earlier request never rolls the field back). Whole-object overwrite of a cached visit from a patch response is forbidden. Visit missing from the cache → no-op (a refetch restores truth; no zombie insert of a deleted row). Status change additionally invalidates the record query — solely to refresh the derived parent Record status.

## API Endpoints
| Method | Path | Description | Request | Response |
|--------|------|-------------|---------|----------|
| GET | /api/v1/visits?record_id=X | List active visits (optionally by record) | — | VisitResponse[] |
| GET | /api/v1/visits/{id} | Get single visit | — | VisitResponse |
| POST | /api/v1/visits | Create (record_id + price required) | VisitCreate | VisitResponse (201) |
| PUT | /api/v1/visits/{id} | Full-replace update | VisitUpdate | VisitResponse |
| PATCH | /api/v1/visits/{id} | Partial update (all optional, no record_id) | VisitPatch | VisitResponse |
| DELETE | /api/v1/visits/{id} | Единый флоу #324: лист — `?dry_run=true` → 204; голый → 422; тело `{expected:{}}`; пересчёт родительской записи сохраняется | DeleteBody | 204 |
| PUT | /api/v1/visits/{id}/status | Update status only | VisitStatusUpdate | VisitResponse |

## Relationships
- Visit → belongs to Record (record_id)
- Visit → references a Visitor (visitor_id, nullable)
- Visit → references a Tariff (tariff_id, nullable, `ondelete=SET NULL` — GH #357)
- Name/age are properties of the **Visitor**, not the Visit — edit them via `PUT /api/v1/visitors/:id`, while tariff/price/status go through `PATCH /api/v1/visits/:id`

## Enums & Constants
| Enum | Values |
|------|--------|
| VisitStatus | waiting, visited, missed, cancelled |

## Acceptance Criteria
- [ ] price >= 0
- [ ] status is valid VisitStatus value (default waiting)
- [ ] record_id required on create; POST returns 404 if parent Record missing
- [ ] PATCH updates only provided fields
- [ ] Mutations recompute parent Record seats + status
- [ ] Cascade hard-delete with Record

## Parity Notes
| Backend (Pydantic) | Frontend (Zod) | Match |
|--------------------|----------------|-------|
| price: ge=0 | price: number | ⚠️ Verify frontend min constraint |
| status: VisitStatus enum | status: enum (values match) | ✅ |
| visitor_id / tariff_id: str \| None | nullable FK | ✅ |
