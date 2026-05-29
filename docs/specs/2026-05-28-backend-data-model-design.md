# Backend Data Model Design — Memo

> Date: 2026-05-28
> Status: Draft
> Source: Brainstorming session with user

## Architecture

Clean Architecture layers:
- `app/db/models/` — SQLAlchemy ORM models
- `app/domain/<entity>/` — router, schemas, service, repository per entity
- `app/admin/` — SQLAdmin integration

All tables use **plural** naming convention.

---

## StrEnums

```python
class Specialty(StrEnum):
    PAINTING = "живопись"
    CERAMICS = "керамика"

class Position(StrEnum):
    MASTER = "мастер"
    ADMIN = "администратор"

class UserRole(StrEnum):
    ADMIN = "admin"
    MASTER = "master"

class BookingStatus(StrEnum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"

class VisitStatus(StrEnum):
    WAITING = "waiting"
    VISITED = "visited"
    MISSED = "missed"
    CANCELLED = "cancelled"

class PaymentMethod(StrEnum):
    CASH = "cash"
    CARD = "card"
    TRANSFER = "transfer"
```

---

## AbstractModel

Base class for all ORM models. Not a table itself (`__abstract__ = True`).

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | PK, default uuid4 |
| created_at | datetime | default utcnow |
| updated_at | datetime | default utcnow, onupdate utcnow |
| is_active | bool | default True |

---

## Models

### 1. `masters` — Master

| Field | Type | Constraints |
|-------|------|-------------|
| first_name | str | |
| last_name | str | |
| color | str | hex color, e.g. "#5B8C7A" |
| position | Position | MASTER or ADMIN |
| specialty | Specialty | PAINTING or CERAMICS |
| avatar_url | str? | |

### 2. `users` — User

| Field | Type | Constraints |
|-------|------|-------------|
| phone | str | unique, primary auth |
| email | str? | unique |
| password_hash | str | |
| role | UserRole | ADMIN or MASTER |
| master_id | UUID? | FK → masters.id, unique (1:1) |

### 3. `locations` — Location / Studio

| Field | Type | Constraints |
|-------|------|-------------|
| name | str | |
| address | str? | |
| description | str? | |
| capacity | int | max visitors |
| yandex_map_url | str? | |
| review_url | str? | |
| record_info | str? | additional info |
| image_url | str? | main photo |

### 4. `services` — Service

| Field | Type | Constraints |
|-------|------|-------------|
| title | str | |
| description | str | |
| image_url | str | main photo |
| specialty | Specialty | PAINTING or CERAMICS |
| min_age | int | minimum age |
| max_age | int | maximum age |
| duration | int | minutes |
| record_info | str | notification info for clients |

### 5. `tariffs` — Tariff (one-to-many from Service)

| Field | Type | Constraints |
|-------|------|-------------|
| service_id | UUID | FK → services.id |
| title | str | e.g. "Взрослый", "Детский" |
| description | str? | |
| price | int | in RUB |

### 6. `tags` — Tag (universal)

| Field | Type | Constraints |
|-------|------|-------------|
| tag | str | e.g. "новинка", "хит" |

Join tables:
- `service_tags`: `service_id` (FK) + `tag_id` (FK)
- `activity_tags`: `activity_id` (FK) + `tag_id` (FK)
- `photo_tags`: `photo_id` (FK) + `tag_id` (FK)

### 7. `activities` — Activity (schedule event)

| Field | Type | Constraints |
|-------|------|-------------|
| master_id | UUID | FK → masters.id |
| service_id | UUID | FK → services.id |
| location_id | UUID | FK → locations.id |
| start | datetime | exact start date+time |
| duration | int | minutes |
| capacity | int | max participants |
| is_private | bool | |
| comment | str? | |
| record_info | str? | additional info |

`occupied` is computed (count of related Records with CONFIRMED status).

### 8. `clients` — Client

| Field | Type | Constraints |
|-------|------|-------------|
| name | str | |
| phone | str | |
| email | str? | |
| channel | str | preferred comms: "phone", "email", "telegram", "whatsapp" |

### 9. `visitors` — Visitor

| Field | Type | Constraints |
|-------|------|-------------|
| client_id | UUID | FK → clients.id |
| name | str | |
| age | int? | |

Photos via `photos` table (see Photo).

### 10. `photos` — Photo (universal gallery)

| Field | Type | Constraints |
|-------|------|-------------|
| filename | str | file path on disk |
| visitor_id | UUID? | FK → visitors.id |
| service_id | UUID? | FK → services.id |
| activity_id | UUID? | FK → activities.id |

Tags via `photo_tags` join table.

At least one of `visitor_id` / `service_id` / `activity_id` should be set (application-level constraint).

### 11. `records` — Booking Record

| Field | Type | Constraints |
|-------|------|-------------|
| activity_id | UUID | FK → activities.id |
| client_id | UUID? | FK → clients.id |
| status | BookingStatus | PENDING / CONFIRMED / CANCELLED / NO_SHOW |
| seats | int | how many spots booked |
| comment | str? | |

### 12. `visits` — Visit (Record → Visitor link)

| Field | Type | Constraints |
|-------|------|-------------|
| record_id | UUID | FK → records.id |
| visitor_id | UUID | FK → visitors.id |
| price | int | cost for this visitor's spot |
| status | VisitStatus | WAITING / VISITED / MISSED / CANCELLED |

### 13. `payments` — Payment

| Field | Type | Constraints |
|-------|------|-------------|
| record_id | UUID | FK → records.id |
| amount | int | in RUB |
| method | PaymentMethod? | CASH / CARD / TRANSFER |

Multiple payments can exist per Record (partial payments, installments).

---

## ER Diagram Overview

```
Specialty(StrEnum) ──┐
                     ├── Master.specialty
Position(StrEnum)  ──┤── Master.position
                     ├── Service.specialty
UserRole(StrEnum)   ─┤── User.role
BookingStatus(StrEnum)── Record.status
VisitStatus(StrEnum) ── Visit.status
PaymentMethod(StrEnum)─ Payment.method

AbstractModel
├── Master ─── User (1:1)
├── Location
├── Service ─── Tariff (1:N)
│               └── Tag (M:N via service_tags)
├── Activity ─── Tag (M:N via activity_tags)
│               └── Record (1:N) ─── Visit (1:N) ─── Visitor
│                                  └── Payment (1:N)     │
│                                                         └── Client (1:N)
├── Client ─── Visitor (1:N) ────┘
├── Photo (M:N with Tag via photo_tags)
└── Tag (universal)
```

---

## API Endpoints (planned)

Per entity, standard CRUD:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/{entities}` | List all (with filters) |
| GET | `/api/{entities}/{id}` | Get one |
| POST | `/api/{entities}` | Create |
| PATCH | `/api/{entities}/{id}` | Update |
| DELETE | `/api/{entities}/{id}` | Soft delete (is_active=false) |

Entities: masters, locations, services, activities, clients, visitors, records, payments.

---

## Visual Compliance Checks

- [ ] SQLAdmin dashboard loads and shows all registered models
- [ ] CRUD operations work for each model in SQLAdmin
- [ ] API healthcheck endpoint still works (`GET /api/health`)
- [ ] All CRUD endpoints return proper JSON matching frontend `@memo/domain` schemas
- [ ] Ruff + mypy pass with no errors
- [ ] All tests pass (foundation tests + new model/repo/service tests)
