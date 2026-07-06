# Visit — Domain Rules

## Description
A Visit is the attendance record of a single Visitor within a Record (booking). Each seat in a Record is one Visit. A Visit carries the pricing (tariff/price/custom_price) and the attendance status for that seat. Note: a Visit is distinct from a Visitor — name/age live on the Visitor, not the Visit.

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| id | string | ✅ | — | — | — | Primary key (response only) |
| record_id | string | ✅ | — | — | — | FK to Record |
| visitor_id | string | ❌ | — | — | null | FK to Visitor (null = seat without named guest) |
| tariff_id | string | ❌ | — | — | null | FK to Tariff |
| price | integer | ✅ | 0 | — | — | Цена посещения (Field(ge=0)) |
| custom_price | integer | ❌ | — | — | null | Ручная цена (переопределяет тариф) |
| status | enum | ❌ | — | — | waiting | VisitStatus |
| created_at | string | — | — | — | — | ISO timestamp (response only) |
| updated_at | string | — | — | — | — | ISO timestamp (response only) |
| is_active | bool | — | — | — | — | Soft-delete flag (response only) |

## Cross-field Rules
- None.

## Invariants
- price >= 0 (enforced by Pydantic Field(ge=0))
- record_id must reference existing Record (FK enforced; create returns 404 if parent missing)
- Seats of parent Record = count of active Visits (always computed, never user-set)
- Cascade soft-delete: Visit is soft-deactivated on parent Record delete

## Business Logic

### Backend
- **price >= 0** (only Pydantic field-level constraint)
- **Cascade to parent Record:** Visit create / update / patch / delete recompute the parent Record's seats + status (Phase 1: `domain/record_visits.py` → `recompute_record_seats` + `recompute_record_status`)
- Filtered by record_id on list
- **PATCH** merges only provided fields; `None` means "don't change"

### Frontend
- **Inline editing:** tariff / price / status edited via `PATCH /api/v1/visits/:id`
- **Name / age NOT edited here** — those belong to the Visitor and go through `PUT /api/v1/visitors/:id`
- **Optimistic updates** on unified rows

## API Endpoints
| Method | Path | Description | Request | Response |
|--------|------|-------------|---------|----------|
| GET | /api/v1/visits?record_id=X | List active visits (optionally by record) | — | VisitResponse[] |
| GET | /api/v1/visits/{id} | Get single visit | — | VisitResponse |
| POST | /api/v1/visits | Create (record_id + price required) | VisitCreate | VisitResponse (201) |
| PUT | /api/v1/visits/{id} | Full-replace update | VisitUpdate | VisitResponse |
| PATCH | /api/v1/visits/{id} | Partial update (all optional, no record_id) | VisitPatch | VisitResponse |
| DELETE | /api/v1/visits/{id} | Soft delete | — | 204 |
| PUT | /api/v1/visits/{id}/status | Update status only | VisitStatusUpdate | VisitResponse |

## Relationships
- Visit → belongs to Record (record_id)
- Visit → references a Visitor (visitor_id, nullable)
- Visit → references a Tariff (tariff_id, nullable)
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
- [ ] Cascade soft-delete with Record

## Parity Notes
| Backend (Pydantic) | Frontend (Zod) | Match |
|--------------------|----------------|-------|
| price: ge=0 | price: number | ⚠️ Verify frontend min constraint |
| status: VisitStatus enum | status: enum (values match) | ✅ |
| visitor_id / tariff_id: str \| None | nullable FK | ✅ |
