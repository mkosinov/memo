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
- **Scoped to Client:** list_by_client(client_id) returns only active visitors
- **Auto-created by RecordService** when name-based visit is created
- No standalone list-all endpoint — only by client

### Frontend
- **Create form:** name (required), age (optional)
- **Display:** Name + age in parentheses: "Иван (12 л.)" or "Иван (взр.)"
- **No validation** on age min/max

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/visitors/{id} | Get |
| POST | /api/v1/visitors | Create |
| PUT | /api/v1/visitors/{id} | Update |
| DELETE | /api/v1/visitors/{id} | Soft delete |

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
