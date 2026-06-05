# ActivityDetailsModal Design Spec

**Date:** 2026-06-03
**Feature:** ActivityDetailsModal — tabbed modal for activity management
**Status:** Draft

## Overview

Replace the current simple ActivityModal with a tabbed ActivityDetailsModal that provides:
- Left sidebar navigation with tabs
- Settings tab (current modal content)
- Client tabs (one per booked client)
- New booking tab ("+")
- Status footer with financial summary
- Delete with undo

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  ActivityDetailsModal                                   │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Context: МК по рисованию · Сб, 7 июня · 14:00   │  │ ← activity summary header
│  └───────────────────────────────────────────────────┘  │
├────────────┬────────────────────────────────────────────┤
│ Left Nav   │  Content Area                              │
│            │                                            │
│ [Настройка]│  (depends on active tab)                   │
│            │                                            │
│ [Иванов    │  Settings: master/service/time/...         │
│  +7 999]   │  Client: visitors, price, payment          │
│            │  New: phone lookup + form                  │
│ [Петров    │                                            │
│  +7 888]   │                                            │
│            │                                            │
│ [  +  ]    │                                            │
├────────────┴────────────────────────────────────────────┤
│ Footer: Стоимость: X ₽  │  К оплате: Y ₽              │
└─────────────────────────────────────────────────────────┘
```

## Tabs

### 1. "Настройка" (Settings) Tab

Layout (top to bottom):

1. **Дата и время начала** — single datetime picker (replaces separate "День" + "Начало" fields)
2. **Услуга** — select from services (auto-fills duration/capacity/tariffs). Right of service: display min_age–max_age range from service (read-only, e.g. "6–12 лет")
3. **Мастер** — select from artists. Each master shows color dot + name (like menubar legend)
4. **Тарифы услуги** — read-only display of available tariffs (for information)
5. **Локация** — select from locations/studios
6. **Вместимость** — number input
7. **Длительность** — HH:MM input (e.g. "01:30"). Stored as minutes internally, displayed as HH:MM.
8. **Приватное событие** — toggle switch (like theme toggle in menubar)

**Removed:** "Occupied" field (computed, not editable).

### 2. Client Tabs (one per booked client)

**Tab label:** `{client.name} +{client.phone}`

**Content:**

#### Client Info
- **Имя** — editable input
- **Телефон** — read-only (unique identifier)
- **Ссылка** — "→ /client/{id}" navigation link

#### Visitors List
Each visitor row:
- **Имя** — editable input
- **Возраст** — number input (optional)
- **Тариф** — select dropdown from `service.tariffs[]`
  - Auto-selected by age (min_age/max_age from tariff)
  - Admin can select different tariff manually
- **Цена** — displayed from selected tariff (kopeks → rubles display)
- **Кнопка удаления** — removes visitor from list

**"+" button** — adds new visitor row

#### Payment Section
- **Сумма** — sum of all visitor tariffs
- **Оплачено** — sum of payments for this record
- **К оплате** = Сумма - Оплачено
- **Метод оплаты** — dropdown: cash/card/transfer
- **Кнопка "Добавить оплату"** — creates Payment record

#### Status Dropdowns
- **Статус записи** — pending / confirmed / cancelled / no_show
- **Статус визита** — waiting / visited / missed / cancelled

**Convention:** lowercase everywhere (matches backend). Frontend domain types updated to lowercase.

#### Delete Button
- **"Удалить запись"** — red button
- On click: start 5-second countdown, show Toast "Запись удалена" with "Undo" button
- If Undo clicked within 5s: cancel delete, dismiss toast, record stays
- If timeout: send `DELETE /records/{id}`, modal closes or refreshes

### 3. "+" Tab (New Booking)

**Form fields:**

1. **Телефон** — text input
   - On blur/change: call `GET /api/v1/clients/search?phone={phone}`
   - If found: auto-fill client name, show existing visitors
   - If not found: show name field for new client

2. **Имя клиента** — text input
   - Auto-filled if phone matched existing client
   - Required for new clients

3. **Посетители** — dynamic list
   - Each row: Имя, Возраст, Тариф (auto-select by age, selectable from dropdown)
   - **"+" button** — adds visitor row
   - Tariffs come from `service.tariffs[]`

4. **Оповещения** — checkbox + channel select
   - Галочка "отправлять оповещения"
   - Канал: Telegram / MAX / WhatsApp

5. **Кнопка "Создать запись"** — submits form

## Footer (Status Bar)

Fixed at bottom of modal:
- **Стоимость:** sum of all record costs (Σ visitor tariffs across all records)
- **К оплате:** sum of remaining balances (Σ (cost - paid) across all records)

## ActivityCard "+" Button

Current behavior: shows toast "Быстрое добавление гостя"
New behavior: opens ActivityDetailsModal on the "+" tab

## Data Flow

### Opening the Modal

```
ActivityCard click → onEdit(activity) → WeekView → setModalActivity + setModalOpen
ActivityCard "+" click → onQuickAdd(activity) → WeekView → setModalActivity + setModalOpen + setActiveTab('+')
```

### Data Loading

When modal opens:
1. Fetch records for this activity: `GET /records?activity_id={id}`
2. For each record: fetch client, visits, payments
3. All data available in RecordsContext (already loaded)

### Status Bar Calculation

```
totalCost = Σ (Σ visit.price for each record)
totalOwed = Σ (totalCost - Σ payment.amount for each record)
```

## Backend Requirements

### Existing Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /records?activity_id=X` | Fetch records for activity |
| `GET /clients/search?phone=X` | Phone lookup (new endpoint) |
| `GET /services` | Services with tariffs |
| `POST /records` | Create new record |
| `PUT /records/{id}` | Update record / restore deleted |
| `DELETE /records/{id}` | Soft-delete record |
| `POST /payments` | Create payment |
| `PUT /payments/{id}` | Update payment |
| `DELETE /payments/{id}` | Delete payment |
| `POST /visitors` | Create visitor |
| `PUT /visitors/{id}` | Update visitor |
| `DELETE /visitors/{id}` | Delete visitor |
| `PUT /visits/{id}/status` | Update visit status |

### New Backend Endpoint Needed

**Phone lookup:** `GET /api/v1/clients/search?phone={phone}`
- Returns client with visitors if found, 404 if not
- Needed because RecordsContext only has clients for a specific date range, not the full DB

### Delete Pattern: Delayed Delete

- On "Удалить запись" click: start 5-second countdown, show Toast with "Undo"
- If Undo clicked within 5s: cancel the delete, dismiss toast
- If timeout: send `DELETE /records/{id}` request
- No restore endpoint needed — delete never happened if undone

## API Client Additions (@memo/api-client)

Add missing CRUD functions:
- `createRecord(data)` → POST /records
- `updateRecord(id, data)` → PUT /records/{id}
- `deleteRecord(id)` → DELETE /records/{id}
- `createPayment(data)` → POST /payments
- `updatePayment(id, data)` → PUT /payments/{id}
- `deletePayment(id)` → DELETE /payments/{id}
- `createVisitor(data)` → POST /visitors
- `updateVisitor(id, data)` → PUT /visitors/{id}
- `deleteVisitor(id)` → DELETE /visitors/{id}
- `updateVisitStatus(id, status)` → PUT /visits/{id}/status

## Rename: BookingRecord → Record

Full rename across:
- `packages/domain/src/index.ts` — type name
- `frontend/admin/` — all references
- `packages/api-client/` — schema names
- Variable names, imports, comments
- Status enum values: lowercase everywhere (`pending`, `confirmed`, etc.)

## UI Patterns

### Modal Structure
- Overlay: `fixed inset-0 z-50` with blurred backdrop
- Layout: flex row (left nav 240px + content)
- Left nav: vertical tabs with active state highlighting
- Content: scrollable area
- Footer: fixed bottom bar with financial summary

### Toast Undo Pattern (Delayed Delete)
- On delete click: `setTimeout(() => deleteRecord(id), 5000)`
- Show toast: `toast('Запись удалена', { action: { label: 'Отмена', onClick: () => clearTimeout } })`
- If "Отмена" clicked within 5s: `clearTimeout`, dismiss toast
- If timeout fires: actual DELETE request sent

### Tab Navigation
- Left sidebar tabs
- Active tab: highlighted background
- Click to switch content
- "+" tab always at bottom

## Visual Compliance Checks

- [ ] Modal opens on ActivityCard click with correct activity data
- [ ] Activity context header shows service name, day, time
- [ ] Left sidebar shows "Настройка" tab + client tabs + "+" tab
- [ ] Settings tab: datetime picker, service, master, location, capacity, duration (HH:MM), private toggle
- [ ] Settings tab: no "Occupied" field
- [ ] Client tab shows name, phone (readonly), visitors list, payment section
- [ ] Client tab has link to /client/{id}
- [ ] "+" tab shows phone input with lookup behavior
- [ ] "+" tab shows visitor form with tariff selection
- [ ] Footer shows total cost and remaining balance
- [ ] Delete button shows Toast with Undo (delayed delete)
- [ ] ActivityCard "+" button opens modal on "+" tab
- [ ] BookingRecord renamed to Record everywhere
