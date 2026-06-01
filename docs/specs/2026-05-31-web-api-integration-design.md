# Web → Backend API Integration Design

> Date: 2026-05-31
> Status: Implemented and Verified
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

### 1.3 Photo — add `is_public` field (guest tagging via `photo_tags`)

```python
# backend/src/models/photo.py
is_public: Mapped[bool] = mapped_column(Boolean, default=False)  # видно на сайте
```

Guest photos are marked via `photo_tags` join table with tag "guest" (added to seed).
Web endpoint `/photos/web` returns `is_public=true` photos; admin endpoint returns all.
Separation by `is_guest` is unnecessary — the tag system handles categorization.

### 1.4 Photo API endpoints

Two routes for different consumers:

```
GET /api/v1/photos/web?activity_id=X    — public, no auth, is_public=true only
GET /api/v1/photos?activity_id=X         — auth required (admin/master), all photos
```

The `/photos/web` endpoint is exclusively for the web frontend. It always filters `is_public=true`. The main `/photos` endpoint is for the admin app (auth via session).

Both return the same schema: `PhotoResponse[]`.

### 1.5 New table: `materials`

```
materials
├── id: UUID (PK)
├── title: String(200)
└── description: Text
```

Standard entity: ORM model + Pydantic schema + CRUD router + SQLAdmin + seed data.

### 1.6 RecordCreate — phone-based flow

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
| `Photo` + `photo_tags` rows | Seed 8-10 photos: `is_public=true` for service images. Guest photos tagged with tag "guest" via `photo_tags` |
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
│   ├── activities.ts            # fetchActivities(), fetchServices(), fetchMasters(), fetchLocations()
│   ├── photos.ts                # fetchWebPhotos(activityId) → GET /api/v1/photos/web
│   └── records.ts               # createRecord() → POST /api/v1/records
├── model/
│   ├── dto/
│   │   ├── schedule.ts          # ScheduleDTO (was ActivityDTO)
│   │   └── ...                  # keep old activity.ts for migration, delete later
│   └── view/
│       ├── schedule.ts          # ScheduleView, ScheduleCardView (was ActivityView)
│       └── ...                  # keep old activity.ts for migration, delete later
├── mappers/
│   ├── join-schedule.ts         # joinActivities() — pure function, 4 arrays → ScheduleIndex
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
| `photos` | `PhotoDTO[]` from `/photos/web` | Fetched per activity. Empty if none. Fields: `url`, `is_public`, `tags` (from photo_tags, e.g. ["гость"]) |
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
| `price_hint` | Computed from `Service.tariffs` | строка: "Взрослый: 3500₽, Детский: 2500₽, Индивидуальный: 5000₽" |
| `next_times` | Computed from activities list | same `service_id`, next 6 dates |

### 3.4 ScheduleView — field mapping

Same transformation as current `toActivityView()`: format dates, prices, durations, assign tag colors.

Tag colors: dynamic hash-based palette (or fixed set for common tags).

### 3.5 joinActivities() — pure function

```typescript
/** Per-location indexes: date → ids, service_id → ids */
interface LocationIndex {
  byDate: Map<string, string[]>;        // date → [id1, id2, ...]
  byServiceId: Map<string, string[]>;   // service_id → [id1, id2, ...]
}

interface ScheduleIndex {
  byId: Map<string, ScheduleDTO>;       // id → ScheduleDTO (single source)

  byLocation: Record<string, LocationIndex>;  // 'all', 'alpika', 'grand', 'p1389'
}

function joinActivities(
  activities: ActivityResponse[],
  services: Map<string, ServiceResponse>,
  masters: Map<string, MasterResponse>,
  locations: Map<string, LocationResponse>,
): ScheduleIndex
```

Steps:
1. Build lookup maps (`Map<id, T>`) for services, masters, locations.
2. For each `ActivityResponse`:
   - Look up service, master, location by ID
   - Compute `price_min/max` from service tariffs
   - Compute `price_hint` from all tariffs: "Взрослый: 3500₽, Детский: 2500₽"
   - Extract `time` (HH:MM) and `date` (YYYY-MM-DD) from `start` ISO field
   - Merge service tags + activity tags (deduplicate by tag string)
   - Build `ScheduleDTO`, store in `byId[dto.id]`
3. Build `LocationIndex` per location:
   - For each DTO, push its `id` to `byLocation[location_id].byDate[date]`
   - Also push its `id` to `byLocation[location_id].byServiceId[service_id]`
   - Same for `byLocation['all']` (global index across all locations)
4. Compute `next_times` for each ScheduleDTO:
   - Lookup `byLocation[activity.location_id].byServiceId[service_id]`
   - Filter future dates only, sort ASC, take first 6
5. Return `ScheduleIndex`.

### 3.6 React Query Caching

- **Reference data** (services, masters, locations): `staleTime: 300_000` (5 min), `gcTime: 600_000`.
- **Activities**: `staleTime: 0` (fresh on every mount), `refetchInterval: 60_000` (auto-refresh for booking count changes).
- **Photos**: `staleTime: 300_000` (rarely changes). Fetched per-activity on demand (when overlay opens).

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

## 5. useSchedule Hook — React Query version

```typescript
interface UseScheduleResult {
  schedules: ScheduleView[];                          // all activities (flat, for carousel)
  getByDate(date: string, locationId?: string): ScheduleView[];  // O(1) lookup
  isLoading: boolean;
  error: ApiError | null;
}

function useSchedule(filters: ActivityFiltersView): UseScheduleResult {
  // 1. Fetch all 4 datasets in parallel
  const queries = useQueries({
    queries: [
      { queryKey: ['activities', filters], queryFn: () => fetchActivities(filters), staleTime: 0, refetchInterval: 60_000 },
      { queryKey: ['services'], queryFn: fetchServices, staleTime: 300_000, gcTime: 600_000 },
      { queryKey: ['masters'], queryFn: fetchMasters, staleTime: 300_000, gcTime: 600_000 },
      { queryKey: ['locations'], queryFn: fetchLocations, staleTime: 300_000, gcTime: 600_000 },
    ],
  });

  // 2. Join → ScheduleIndex
  const index = useMemo(() => {
    if (queries.some(q => q.isLoading || q.isError)) return null;
    return joinActivities(
      queries[0].data!,
      new Map(queries[1].data!.map(s => [s.id, s])),
      new Map(queries[2].data!.map(m => [m.id, m])),
      new Map(queries[3].data!.map(l => [l.id, l])),
    );
  }, [queries.map(q => q.data)]);

  // 3. Convert to views
  const allSchedules = useMemo(() => {
    if (!index) return [];
    return [...index.byId.values()].map(toScheduleView);
  }, [index]);

  const getByDate = useCallback((date: string, locationId = 'all') => {
    if (!index) return [];
    const ids = index.byLocation[locationId]?.byDate.get(date) ?? [];
    return ids.map(id => toScheduleView(index.byId.get(id)!));
  }, [index]);

  return {
    schedules: allSchedules,
    getByDate,
    isLoading: queries.some(q => q.isLoading),
    error: queries.find(q => q.error)?.error ?? null,
  };
}
```

---

## 6. Visual Compliance Checks

- [ ] Фронтенд загружается без ошибок, показывает расписание из реального API (не моков)
- [ ] Карточка активности показывает: заголовок, теги (из Service.tags), цену, мастера, локацию, время, длительность
- [ ] Теги сервиса отображаются корректно на карточке (MKCarousel)
- [ ] Теги активности тоже видны в ActivityOverlay
- [ ] `getByDate(date, locationId)` возвращает корректные ScheduleView (O(1))
- [ ] Фильтр по дате / локации / тегу работает
- [ ] `material_hint` и `location_hint` отображаются в деталях
- [ ] `next_times` показывает до 6 pill'ов с ближайшими датами
- [ ] Цены отображаются из тарифов (min/max)
- [ ] Создание записи (Record) с телефоном работает и возвращает bookingId
- [ ] Фото (public) отображаются в галерее активности через `/photos/web` endpoint
- [ ] price_hint показывает все варианты тарифов в деталях активности
- [ ] Моковые данные (`makeMockActivities()`) удалены или заменены
