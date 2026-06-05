# Design: Admin Clients Page

**Date:** 2026-06-04
**Status:** Draft
**Scope:** Admin frontend only (localhost:3101)

---

## 1. Overview

Admin page `/clients` — table of all clients with server-side filtering, pagination, sorting, and a master-detail modal for viewing/editing clients and their records.

---

## 2. Backend Changes

### 2.1. Make `name`, `phone` and `channel` nullable

**Migration:**
```sql
ALTER TABLE clients ALTER COLUMN name DROP NOT NULL;
ALTER TABLE clients ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE clients ALTER COLUMN channel DROP NOT NULL;
```

**ORM changes (`src/models/client.py`):**
```python
name: Mapped[str | None] = mapped_column(String(200), nullable=True)
phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
channel: Mapped[str | None] = mapped_column(String(50), nullable=True)
```

**Schema changes (`src/schemas/client.py`):**
```python
class ClientBase(BaseModel):
    name: str | None = None
    phone: str | None = None
    email: str | None = None
    channel: Channel | None = None
```

**Default name:** The database stores `NULL` when name is not provided. The default `"Дорогой гость"` is applied at the **display layer** (frontend + API response), NOT in the database. This keeps data clean and allows different contexts to use different defaults (notifications, reports, UI).

### 2.2. Extended `GET /api/v1/clients`

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | int | 1 | Page number |
| `per_page` | int | 20 (max: 100) | Items per page |
| `search` | str | — | Search by name or phone (LIKE %query%) |
| `is_active` | bool | — | Filter by active status |
| `created_from` | date | — | Created after |
| `created_to` | date | — | Created before |
| `updated_from` | date | — | Updated after |
| `updated_to` | date | — | Updated before |
| `min_visits` | int | — | Minimum visit count |
| `max_visits` | int | — | Maximum visit count |
| `min_paid` | int | — | Minimum total paid (in kopecks) |
| `max_paid` | int | — | Maximum total paid |
| `missed_from` | int | — | Minimum missed visits |
| `missed_to` | int | — | Maximum missed visits |
| `sort_by` | str | `name` | Sort field: `name`, `phone`, `visits_count`, `last_visit`, `total_paid`, `created_at` |
| `sort_order` | str | `asc` | Sort direction: `asc` or `desc` |

**Response (200):**
```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Анна Смирнова",
      "phone": "+7 (916) 123-45-67",
      "email": "anna@example.com",
      "channel": "telegram",
      "is_active": true,
      "created_at": "2025-01-15T10:00:00",
      "updated_at": "2025-06-01T14:30:00",
      "visits_count": 12,
      "last_visit": "2025-06-01",
      "total_paid": 36000,
      "missed_visits": 1
    }
  ],
  "total": 156,
  "page": 1,
  "per_page": 20
}
```

**Name display:** The API returns `name: null` when not set. Frontend displays `"Дорогой гость"` as a fallback. This keeps the database clean and allows different display defaults per context (e.g., notifications might use "Клиент без имени", reports might group as "Без имени").

**SQLAlchemy implementation:** Subquery with `func.count`, `func.max`, `func.sum` + LEFT JOIN on visits/payments + filters + pagination.

**Note:** Existing `GET /api/v1/clients` (without stats) remains unchanged — used by RecordsContext for lookups.

### 2.3. API Client package

Add to `@memo/api-client`:
- `getClientsWithStats(params)` → `ClientWithStatsResponse[]`
- `createClient(data)` (already exists)
- `updateClient(id, data)` — PUT (already exists)
- `patchClient(id, data)` — PATCH (new)
- `deleteClient(id)` (already exists)
- `getClientVisitors(id)` (already exists)

---

## 3. Frontend Structure

### 3.1. Routes

```
app/(main)/clients/
├── page.tsx                    ← Clients list (table)
├── components/
│   ├── ClientsTable.tsx        ← Table with columns
│   ├── ClientsFilters.tsx      ← Filter panel
│   └── ClientCardModal.tsx     ← Master-detail modal
```

### 3.2. ClientsContext

```typescript
interface ClientsState {
  clients: ClientWithStats[];
  total: number;
  page: number;
  perPage: number;
  filters: ClientFilters;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  isLoading: boolean;
  error: string | null;
}

interface ClientsContextType extends ClientsState {
  setPage: (page: number) => void;
  setPerPage: (perPage: number) => void;
  setFilters: (filters: Partial<ClientFilters>) => void;
  setSort: (field: string, order: 'asc' | 'desc') => void;
  resetFilters: () => void;
  createClient: (data: ClientCreate) => Promise<void>;
  updateClient: (id: string, data: ClientUpdate) => Promise<void>;
  deleteClient: (id: string) => Promise<void>;
}
```

Uses `@tanstack/react-query` for data fetching.

### 3.3. Cache invalidation

After create/update/delete → invalidate `['clients']` query in both ClientsContext and RecordsContext.

---

## 4. UI Components

### 4.1. ClientsTable

**Columns:**

| Column | Width | Sortable | Format |
|--------|-------|----------|--------|
| Имя | flex-1 | ✅ `name` | Text (display: `name ?? "Дорогой гость"`) |
| Телефон | 160px | ✅ `phone` | Text (display: `phone ?? "Не указан"`) |
| Кол-во визитов | 120px | ✅ `visits_count` | Number |
| Последний визит | 140px | ✅ `last_visit` | DD.MM.YYYY |
| Сумма оплат | 140px | ✅ `total_paid` | 36 000 ₽ |

**Row behavior:**
- Hover: `bg-gray-50`
- Click → opens `ClientCardModal`
- Delete icon on hover (last column)

**States:**
- Loading: skeleton
- Empty: icon + "Нет клиентов" + "Добавить первого"
- Error: toast with retry
- No results: "Ничего не найдено" + "Сбросить фильтры"

### 4.2. ClientsFilters

**Layout:** Panel above table. Search on left, filters on right.

```
🔍 [Поиск по имени или телефону____________]

Статус: [Все ▾] │ Визиты: [от __] [до __] │ Пропущенные: [от __] [до __]
Создан: [от __] [до __] │ Оплата: [от __] [до __]

Сбросить фильтры
```

**Filters:**

| Filter | Type | Description |
|--------|------|-------------|
| Search | Text input | Debounce 300ms |
| Status | Dropdown | Все / Активные / Неактивные |
| Visits (from/to) | Number inputs | Range |
| Missed (from/to) | Number inputs | Range |
| Created (from/to) | Date inputs | Range |
| Paid (from/to) | Number inputs | Range |

**Behavior:**
- Server-side filtering (query params)
- Any filter change → reset to page 1
- "Сбросить фильтры" → clear all fields

### 4.3. ClientCardModal — Master-Detail Layout

**Structure:** Left panel (tabs) + Right panel (content).

```
┌─────────────────────┬─────────────────────────────────────┐
│                     │  [Заголовок]                [X]     │
│  Анна Смирнова      │─────────────────────────────────────│
│  +7 999 123 45 67   │                                     │
│                     │  [Content of active tab]             │
│  ─────────────────  │                                     │
│  01.06.2026 14:00   │                                     │
│  02.07.2026 15:00   │                                     │
│  15.08.2026 12:00   │                                     │
│  ...                │                                     │
└─────────────────────┴─────────────────────────────────────┘
```

#### Left panel (~180px)

- **Header:** Client name + phone (always visible)
- **Record list:** Date + time for each record (clickable)

#### Right panel — Client tab

All fields are **always editable**. Save button activates when changes are made.

**Field groups:**

```
Контактные данные              Статистика
┌─────────────┬─────────────┬─────────────┐
│ Имя:        │ Телефон:    │ Канал:      │
│ [_______ ]  │ [+7 ...   ] │ [___▾]      │
├─────────────┼─────────────┼─────────────┤
│ Email:      │ Статус:     │             │
│ [_______ ]  │ [Активна ✓] │             │
└─────────────┴─────────────┴─────────────┘

Метрики
┌──────────┬──────────┬──────────┬──────────┐
│ Визитов  │ Пропущено│ Последний│ Оплачено │
│    12    │     1    │ 01.06.26 │ 36 000 ₽│
└──────────┴──────────┴──────────┴──────────┘

Даты
┌──────────────────┬──────────────────┐
│ Создан:          │ Обновлён:        │
│ 15.01.2025       │ 01.06.2026       │
└──────────────────┴──────────────────┘

[Удалить клиента]
```

#### Right panel — Record tab

**Field groups:**

```
Мероприятие                    Статус
┌─────────────┬─────────────┬─────────────┐
│ Мастер:     │ Активность: │ Место:      │
│ [Ольга ▾]   │ [Живопись ▾]│ [Мастерская▾]│
├─────────────┼─────────────┼─────────────┤
│ Дата:       │ Время:      │             │
│ 01.06.2026  │ 14:00       │             │
└─────────────┴─────────────┴─────────────┘

Посетители
┌──────────────────────────────────────┐
│ Анна (взр.)    [Пришла ▾]     1500₽ │
│ Маша (8 л.)    [Пришла ▾]     1500₽ │
└──────────────────────────────────────┘

Оплата
┌──────────────────┬──────────┬──────────┐
│ Итого: 3 000 ₽  │ Оплачено:│ Остаток: │
│                  │ 3 000 ₽  │    0 ₽   │
├──────────────────┴──────────┴──────────┤
│ [card ▾] [3000] [Добавить оплату]     │
└────────────────────────────────────────┘

Комментарий
┌────────────────────────────────────────┐
│ [____________________________]         │
└────────────────────────────────────────┘

[Удалить запись]
```

### 4.4. Save button behavior

```
Disabled (gray):    [Сохранить]   — no changes made
Enabled (brand):    [Сохранить]   — unsaved changes exist
```

When any field changes → Save becomes enabled.
Click Save → API call → Save becomes disabled.
Click "Отмена" → reset to original values → Save becomes disabled.

---

## 5. CRUD Operations

### 5.0. API Response Codes

| Метод | URL | Ответ | Описание |
|-------|-----|-------|----------|
| `POST` | `/api/v1/clients` | **201** + `ClientResponse` | Создание |
| `GET` | `/api/v1/clients` | **200** + `list[ClientResponse]` | Список (без stats) |
| `GET` | `/api/v1/clients/{id}` | **200** + `ClientResponse` | Получение |
| `PUT` | `/api/v1/clients/{id}` | **200** + `ClientResponse` | Полная замена (все поля) |
| `PATCH` | `/api/v1/clients/{id}` | **200** + `ClientResponse` | Частичное обновление (только изменённые поля) |
| `DELETE` | `/api/v1/clients/{id}` | **204** (no content) | Мягкое удаление |

**PATCH schema:**
```python
class ClientPatch(BaseModel):
    name: str | None = None
    phone: str | None = None
    email: str | None = None
    channel: Channel | None = None
```

### 5.1. Create client

1. Click "+ Новый клиент" above table
2. Modal opens with empty form (Create mode)
3. Fill fields → Save activates
4. Click Save → `POST /api/v1/clients` → **201**
5. Modal switches to View mode (record selected)
6. Table refreshes

### 5.2. Edit client

1. Click table row → modal opens
2. All fields are editable immediately
3. Change any field → Save activates
4. Click Save → `PUT /api/v1/clients/{id}` → **200**
5. "Отмена" → reset changes

### 5.3. Delete client

1. In client tab, click "Удалить клиента"
2. Confirmation dialog: "Удалить Анну Смирнову? Это скроет клиента из списка."
3. Confirm → `DELETE /api/v1/clients/{id}` → **204**
4. Modal closes, table refreshes

### 5.4. Delete record

1. In record tab, click "Удалить запись"
2. Toast with undo (5 sec) → `DELETE /api/v1/records/{id}` → **204**

---

## 6. Error Handling

| Situation | Behavior |
|-----------|----------|
| Load error | Toast "Не удалось загрузить клиентов" + Retry |
| Create error | Toast "Не удалось создать клиента" + highlight field |
| Save error | Toast "Не удалось сохранить" + data not reset |
| Delete error | Toast "Не удалось удалить" |
| Empty list | Icon + "Нет клиентов" + "Добавить первого" |
| No search results | "Ничего не найдено" + "Сбросить фильтры" |
| Duplicate phone | 409 → Toast "Клиент с таким телефоном уже существует" |

---

## 7. Testing

| Type | Coverage |
|------|----------|
| Backend unit | Service: filtering, pagination, aggregation |
| Backend API | All endpoints: happy path + edge cases (404, 409, empty filters) |
| Frontend component | ClientsTable, ClientsFilters, ClientCardModal (render, interaction) |
| Frontend integration | ClientsContext + react-query (queries, mutations, invalidation) |
| E2E | Full cycle: create → view → edit → delete |

---

## 8. Visual Compliance Checks

- [ ] "Клиенты" nav item in Menubar is visible and clickable
- [ ] Clients table loads and displays rows with 5 columns
- [ ] Search input is visible above the table
- [ ] Filter panel is visible with all filter controls
- [ ] Pagination controls are visible at the bottom
- [ ] Clicking a table row opens ClientCardModal
- [ ] ClientCardModal shows left panel with client name + record list
- [ ] Client tab shows editable fields in grouped layout
- [ ] Record tab shows editable fields with visitors and payment
- [ ] Save button is disabled initially, enabled after field change
- [ ] "+ Новый клиент" button opens modal with empty form
- [ ] Delete confirmation dialog appears on "Удалить клиента"
