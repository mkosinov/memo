# Web → Backend API Integration Design

> Date: 2026-05-31
> Status: Draft
> Version: 1

## Overview

Connect the web frontend (colourmountains.ru) to the real backend API for the Client Booking Flow (Stage 6 — P3, deadline June 15).

**Approach:** Join on frontend — 4 parallel API calls (activities + services + masters + locations), reference data cached via React Query. Minimal backend schema additions.

---

## 1. Backend Schema Changes

### 1.1 Service — add `material_hint`

```python
# backend/src/models/service.py
material_hint: Mapped[str | None] = mapped_column(Text, nullable=True)
```

Free-text field: "Масло, холст 30×40 см, кисти, мастихин". Replaces `material`, `size`, `material_details` from old mock DTO.

### 1.2 Location — add `location_hint`

```python
# backend/src/models/location.py
location_hint: Mapped[str | None] = mapped_column(Text, nullable=True)
```

Free-text field: "2 этаж, светлая студия с панорамными окнами". Replaces `location_details` from old mock DTO.

### 1.3 Photo — add filter fields

```python
# backend/src/models/photo.py
is_public: Mapped[bool] = mapped_column(Boolean, default=False)  # галерея работ
is_guest: Mapped[bool] = mapped_column(Boolean, default=False)   # полоска guest photos
```

Enables `GET /api/v1/photos?activity_id=X&is_guest=true` filtering.

### 1.4 New table: `materials`

```
materials
├── id: UUID (PK)
├── title: String(200)
└── description: Text
```

Standard entity: ORM model + Pydantic schema + CRUD router + SQLAdmin + seed data.

### 1.5 RecordCreate — phone-based flow

**Goal:** One API call from the web form (phone + names + activity_id), backend finds/creates Client and Visitors automatically.

```python
# backend/src/schemas/record.py

class VisitItem(BaseModel):
    """Nested visit payload — name-based (for web form)."""
    name: str                    # visitor full name
    age: int | None = None      # optional age
    price: int                   # tariff price for this seat

class RecordCreate(BaseModel):
    """Create record with phone-based client lookup."""
    activity_id: str
    phone: str                   # unique — find or create Client
    comment: str | None = None
    visits: list[VisitItem]      # seats = len(visits)
```

**Service logic** (`backend/src/services/record.py`):
1. Find `Client` by `phone`. Not found → create with `name` from first visit's name.
2. For each `VisitItem`: find `Visitor` by `client_id + name`. Not found → create.
3. Create `Record` with resolved `client_id`, auto-calculate `seats = len(visits)`.
4. Create `Visit` rows with resolved `visitor_id`, `price`, `status="waiting"`.

---

## 2. Seed Data Updates

All changes in `backend/src/seed/seed.py`:

| Change | Details |
|--------|---------|
| `Service.image_url` | Add paths to public images: `/images/card-*.jpg` (7 services) |
| `Service.material_hint` | Fill for all 7 services (material + size + kit info) |
| `Service` ↔ `Tag` links | Link services to tags via `service_tags` |
| `Activity` ↔ `Tag` links | Link activities to tags via `activity_tags` |
| `Location.location_hint` | Fill for all 3 locations |
| `Photo` rows | Seed 8-10 photos: `is_public` for service images, `is_guest` for activity guest photos |
| `Material` rows | Seed 4-5 materials (Масло, Акрил, Акварель, Гуашь, Текстильные краски) |
| `Client` → auto-id | Ensure phone-based lookup works with existing seed data |

---

## 3. Frontend Data Flow

### 3.1 Naming Convention

| Context | Before (mock) | After (real API) |
|---------|---------------|------------------|
| Raw API call | `makeMockActivities()` | `fetchActivities()` |
| Enriched result | `ActivityDTO` | `ScheduleDTO` |
| View model | `ActivityView` | `ScheduleView` |
| Mapper | `toActivityView()` | `toScheduleView()` |
| Join function | — | `joinActivities()` |

### 3.2 File Structure

```
frontend/web/app/lib/
├── api/
│   └── activities.ts            # fetchActivities(), fetchServices(), fetchMasters(), fetchLocations(), createRecord()
│       (also: fetchPhotos() — optional for MVP)
├── model/
│   ├── dto/
│   │   ├── schedule.ts          # ScheduleDTO (was ActivityDTO)
│   │   └── ...                  # keep old activity.ts for migration, delete later
│   └── view/
│       ├── schedule.ts          # ScheduleView, ScheduleCardView (was ActivityView)
│       └── ...                  # keep old activity.ts for migration, delete later
├── mappers/
│   ├── join-schedule.ts         # joinActivities() — pure function, 4 arrays → ScheduleDTO[]
│   ├── to-schedule-vm.ts        # toScheduleView() — ScheduleDTO → ScheduleView
│   └── ...
```

### 3.3 ScheduleDTO — field mapping

| Field | Source | Notes |
|-------|--------|-------|
| `id` | `ActivityResponse.id` | ✅ |
| `title` | `ServiceResponse.title` | ✅ |
| `tags` | `[...Service.tags, ...Activity.tags]` | deduplicated by tag string |
| `image_url` | `ServiceResponse.image_url` | will be populated after seed update |
| `guest_photos` | `string[]` (empty for MVP) | Always `[]` for MVP. Photo endpoint + seeding deferred to next phase. |
| `time` | `ActivityResponse.start → HH:MM` | extract from ISO datetime |
| `duration_minutes` | `ActivityResponse.duration` | ✅ |
| `location_id` | `ActivityResponse.location_id` | ✅ |
| `location_name` | `LocationResponse.name` | ✅ |
| `location_address` | `LocationResponse.address` | ✅ |
| `guests_count` | `ActivityResponse.occupied` | current bookings count |
| `price_min` | `Math.min(...Service.tariffs.map(t => t.price))` | from tariffs |
| `price_max` | `Math.max(...Service.tariffs.map(t => t.price))` | from tariffs |
| `master_name` | `MasterResponse.first_name + ' ' + MasterResponse.last_name` | replaces `teacher_name` |
| `master_avatar` | `MasterResponse.avatar_url` | nullable |
| `date` | `ActivityResponse.start → YYYY-MM-DD` | extract from ISO datetime |
| `material_hint` | `ServiceResponse.material_hint` | free text |
| `location_hint` | `LocationResponse.location_hint` | free text |
| `price_details` | `ServiceResponse.record_info` | if available |
| `next_times` | Computed from activities list | same `service_id`, next 6 dates |

### 3.4 ScheduleView — field mapping

Same transformation as current `toActivityView()`: format dates, prices, durations, assign tag colors.

Tag colors: dynamic hash-based palette (or fixed set for common tags).

### 3.5 joinActivities() — pure function

```typescript
function joinActivities(
  activities: ActivityResponse[],
  services: Map<string, ServiceResponse>,
  masters: Map<string, MasterResponse>,
  locations: Map<string, LocationResponse>,
): ScheduleDTO[]
```

Steps:
1. Build lookup maps (`Map<id, T>`) for services, masters, locations.
2. For each `ActivityResponse`:
   - Look up service, master, location by ID
   - Compute `price_min/max` from service tariffs
   - Extract `time` and `date` from `start` ISO field
   - Merge service tags + activity tags
   - Compute `next_times` (filter activities with same service_id, sort ASC by date, take 6)
3. Return `ScheduleDTO[]`

### 3.6 React Query Caching

- **Reference data** (services, masters, locations): `staleTime: 300_000` (5 min), `gcTime: 600_000`.
- **Activities**: `staleTime: 0` (fresh on every mount), `refetchInterval: 60_000` (auto-refresh for booking count changes).
- **Photos**: `staleTime: 300_000` (rarely changes).

### 3.7 Error handling

- If any of the 4 calls fails → the whole batch fails.
- Error message: "Не удалось загрузить расписание. Попробуйте позже."
- Individual retry: each query retries 2 times with exponential backoff.
- If reference data cached from previous session → allow stale data to show while refetching in background.

---

## 4. createRecord

Replace current `createBooking()` mock with:

```typescript
// frontend/web/app/lib/api/activities.ts

export interface BookingData {
  activityId: string;
  phone: string;
  name: string;
  childCount: number;
  adultCount: number;
  comment?: string;
  priceTotal: number;
}

export async function createRecord(data: BookingData): Promise<{ success: boolean; recordId: string }> {
  const visits = [];
  // adults
  for (let i = 0; i < data.adultCount; i++) {
    visits.push({ name: data.name, price: data.priceTotal / (data.adultCount + data.childCount) });
  }
  // children — named "Ребёнок" by default (or user can specify per-visitor names in future)
  for (let i = 0; i < data.childCount; i++) {
    visits.push({ name: `${data.name} (ребёнок)`, price: data.priceTotal / (data.adultCount + data.childCount) });
  }

  const body = {
    activity_id: data.activityId,
    phone: data.phone,
    comment: data.comment || null,
    visits,
  };

  const result = await apiClient('/api/v1/records', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return { success: true, recordId: result.id };
}
```

---

## 5. UseActivities Hook — React Query version

```typescript
function useActivities(filters: ActivityFiltersView) {
  const activities = useQuery({
    queryKey: ['activities', filters.date, filters.location],
    queryFn: () => fetchAndJoinActivities(filters),
    staleTime: 0,
    refetchInterval: 60_000,
  });

  const services = useQuery({
    queryKey: ['services'],
    queryFn: fetchServices,
    staleTime: 300_000,
    gcTime: 600_000,
  });
  // same for masters, locations
  // ... or use useQueries for parallel fetching
}
```

**Alternative:** A single `useSchedules()` hook that:
1. Fetches all 4 datasets via `useQueries`
2. Joins them with `joinActivities()` in `select` callback
3. Returns `ScheduleView[]` directly

---

## 6. Visual Compliance Checks

- [ ] Фронтенд загружается без ошибок, показывает расписание из реального API (не моков)
- [ ] Карточка активности показывает: заголовок, теги (из Service.tags), цену, мастера, локацию, время, длительность
- [ ] Теги сервиса отображаются корректно на карточке (MKCarousel)
- [ ] Теги активности тоже видны в ActivityOverlay
- [ ] Фильтр по дате / локации / тегу работает
- [ ] `material_hint` и `location_hint` отображаются в деталях
- [ ] `next_times` показывает до 6 pill'ов с ближайшими датами
- [ ] Цены отображаются из тарифов (min/max)
- [ ] Создание записи (Record) с телефоном работает и возвращает bookingId
- [ ] guest_photos не ломает UI (пустой массив или реальные фото)
- [ ] Моковые данные (`makeMockActivities()`) удалены или заменены
