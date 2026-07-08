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

## Cross-Entity Invariants

1. **Capacity:** `occupied + seats <= activity.capacity` (on Record create only)
   - `occupied` is the SUM of `Record.seats` for records matching `active_record_filter()` — i.e. `is_active = True AND status IN ('waiting','visited')`. Cancelled and missed records do NOT occupy a seat. See `src/domain/record_visits.py` and `ACTIVE_RECORD_STATUSES` in `src/domain/visit_status.py`.
2. **Seats = len(visits):** Always computed, never user-set
3. **Cascade soft-delete:** Record → Visits + Payments
4. **No cascade:** Activity delete does NOT affect Records
5. **Phone search:** Exact match, no format validation
6. **Client phone:** No uniqueness constraint (duplicates possible)
7. **Visitor (client_id, name):** Uniqueness enforced at service level only

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
6. **Activity delete orphans Records** (no cascade)

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
