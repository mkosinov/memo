# Memo — Full Technical Specification

> Проект: Система управления студией рисования «Цветные Горы» (ColourMountains)
> Рабочая директория: `/root/workspace/memo/`
> UI-прототип: `/root/workspace/memo/sketches/colour-mountains-v4.html`
> Сессия дизайна: `/root/workspace/memo/sketches/claude_session.txt`
> Старый frontend spec: `/root/workspace/memo-v1/frontend_spec.md`
> Предыдущая имплементация: `/root/workspace/memo-v1/memo-frontend/` (Next.js 14)

---

## 1. Overview

Memo — система управления расписанием мастер-классов для сети студий рисования «Цветные Горы» (Красная Поляна, Сочи). Заменяет ручное создание расписания через Yclients.

**Бизнес-контекст:**
- Сезонный бизнес (горнолыжный курорт) — от 1 мастера в низкий сезон до 10+ в высокий
- 3 студии: Альпика, Гранд Отель Поляна, Поляна 1389
- 6+ мастеров, каждый со своим цветом
- 6+ услуг (масло, акрил, акварель, лепка, роспись одежды и др.)
- Услуги бывают групповые (Public, до 10+ чел) и индивидуальные (Private, 1 чел)

**Пользователи:**
- **Администратор** — создаёт/редактирует расписание, управляет бронированиями, клиентами
- **Мастер** — просматривает своё расписание на неделю
- **Клиент** — записывается через публичную воронку (4 шага)

---

## 2. UI/UX Specification

### 2.1 Структура главного экрана (Admin Schedule)

```
┌────────────────────────────────────────────────────────────────────────┐
│  SIDEBAR (тёмный #1E2D2F)      │  TOOLBAR                             │
│  ┌──────────┐  кнопка схлопа   │  ◀ 12 — 18 мая ▶  [Сегодня] │ Д│Н    │
│  │  ЛОГОТИП  │  ←─→           │  ─────────────────────────────────── │
│  │ (белый)   │                 │  [Все мастера ▾] [Все локации ▾]     │
│  ├───────────┤                 ├──────────────────────────────────────┤
│  │ МИНИ-КАЛЕНДАРЬ              │  РАСПИСАНИЕ                          │
│  │ Апрель 2026                 │  ┌───┬───┬───┬───┬───┬───┬───┐      │
│  │ ПН ВТ СР ЧТ ПТ СБ ВС       │  │ПН │ВТ │СР │ЧТ │ПТ │СБ │ВС │      │
│  │       1  2  3  4  5  6  7   │  │12 │13 │14 │15 │16 │17 │18 │      │
│  │ ...    ...                  │  ├───┼───┼───┼───┼───┼───┼───┤      │
│  ├─────────────────            │  │9  │   │   │   │   │   │   │      │
│  │ НАВИГАЦИЯ                   │  │   │[ ][ ]│   │   │[ ]│   │      │
│  │ Календарь                   │  │10 │   │   │   │   │   │   │      │
│  │ Мастера                     │  │   │   │[ ]│   │   │   │   │      │
│  │ Локации                     │  │11 │   │   │   │   │   │[ ]│      │
│  │ Услуги                      │  │12 │[ ]│   │   │   │   │   │      │
│  │ Клиенты                     │  │...│...│...│...│...│...│...│      │
│  │ Аналитика                   │  │21 │   │   │   │   │   │   │      │
│  ├─────────────────            │  └───┴───┴───┴───┴───┴───┴───┘      │
│  │ ЛЕГЕНДА                     │    ПРАВАЯ ПАНЕЛЬ (выезжает)          │
│  │ ● Ольга ● Юлия ● Анаст.     │  ┌─────────────────────────────┐    │
│  │ ● Дарья ● Алекс. ● Ирина    │  │ ИНСТРУМЕНТЫ               × │    │
│  ├─────────────────            │  ├─────────────────────────────┤    │
│  │ ☀/☾  [🎨]                   │  │ ▼ ШТАМП                     │    │
│  │ ┌───────────────────┐       │  │ Мастер ▾                    │    │
│  │ │ 👤 Марина К.     ›│       │  │ Услуга ▾                    │    │
│  │ │   Администратор   │       │  │ Локации ☑☐☐               │    │
│  │ └───────────────────┘       │  │ ● Штамп настроен           │    │
│  │ memo v0.0.1                 │  │ 🗑 Режим удаления           │    │
│  └─────────────────────        │  ├─────────────────────────────┤    │
│                                 │  │ ▼ НЕДЕЛЯ                    │    │
│                                 │  │ 🔄 Копировать прошлую      │    │
│                                 │  └─────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Все страницы

#### P1: Admin Schedule Builder (`/`) — главная

**Сайдбар (левый):**
- **Логотип** — белый PNG, на тёмном фоне, над мини-календарём
- **Кнопка схлопывания** — круглая на границе сайдбара. Схлопнутое состояние: 56px ширина, только иконки. Стрелка поворачивается на 180°
- **Мини-календарь** — сетка 7 колонок. Месяц + 1 неделя до и 1 после. Скролл колёсиком мыши = переключение месяцев. Клик по дате = переход к неделе. Подсветка текущей недели/дня
- **Навигация** — 6 пунктов: Календарь, Мастера, Локации, Услуги, Клиенты, Аналитика. Иконки SVG stroke
- **Легенда мастеров** — цветные точки + сокращённые имена
- **Тумблер темы** — ☀/☾, активный элемент с заливкой брендовым цветом
- **Кнопка "Оформление"** — попап: прозрачность панелей (10/25/50/75/100%), цвет фона расписания + его прозрачность
- **Кнопка пользователя** — аватар (инициалы), имя, роль, шеврон → заглушка "Личный кабинет в разработке"
- **Версия** — "memo v0.0.1"

**Тулбар:**
- Навигация ◀ период ▶ + "Сегодня"
- Переключатель День | Неделя (pill-style с тенью у активного)
- Фильтры: "Все мастера ▾" + "Все локации ▾"

**Расписание:**
- Сетка ПН-ВС, 9:00–21:00, шаг 30 мин
- Режим "День": 1 колонка
- Час — сплошная линия, полчаса — пунктирная
- Текущий день: название #004D56, число в залитом круге #004D56
- Линия текущего времени — тонкая #004D56 с точкой
- Drag & drop всегда активен. Alt+drag = копирование

**Правая панель "Инструменты":**
- Кнопка открытия плавает над правым нижним углом. Активна — брендовый цвет
- Секция "Штамп": мастер ▾, услуга ▾, локации ☑, индикатор готовности, "Режим удаления" toggle
- Секция "Неделя": "Копировать прошлую неделю" + подсказка

#### P2: Booking Management (`/bookings`)
- Фильтруемая таблица: дата, локация, услуга, статус
- Статусы: CONFIRMED (зелёный), CANCELLED (красный), NO_SHOW (серый)
- Клик по строке → детальный просмотр
- Кнопка "Создать бронирование"

#### P2: Client Card (`/clients/[id]`)
- Шапка: имя, телефон, email
- Связанные посетители (дети/взрослые)
- История визитов: дата, услуга, локация, кол-во, цена, оплачено, долг

#### P3: Client Booking Flow (`/booking`)
- 4 шага: Локация → Занятие → Запись → Подтверждение
- LocationSelector (карточки), ActivitySchedule (сетка недели), BookingForm (телефон → клиент → посетители), Confirmation (сводка + цены)

#### P4: Artist Schedule (`/artist`)
- Селектор мастера с цветной точкой
- Расписание на неделю (отфильтровано)
- Online/offline toggle
- Mobile-first layout

#### P5: AI Concierge Chat (`/chat`)
- Чат-интерфейс с сообщениями
- Карточки рекомендаций услуг с кнопкой "Записаться"
- Быстрые действия
- Keyword-based matching (заглушка)

---

### 2.3 Карточка события (Event Card)

```
┌──────────────────────────────────┐
│  ┌────────────────────┐          │
│  │ 10:00 — 13:00      │          │  ← овал, заливка цветом мастера, белый текст, 600
│  └────────────────────┘          │
│  Морской пейзаж                  │  ← 2 строки, 600, 13px
│  👤 6-12                        │  ← иконка + возраст (5+,6+,8+,10+,12+,6-12)
│  Ольга Середа                    │  ← полное имя, 11.5px, var(--ink-mid)
│  📍 Гранд Отель Поляна           │  ← локация, 11px, var(--ink-light)
│                                   │
│  ┌───────────────────────────┐   │  ← футер с разделителем
│  │ 👥 3/8               [+]  │   │  ← кол-во гостей + кнопка действия
│  └───────────────────────────┘   │
└──────────────────────────────────┘

Private (индивидуальные): ★ в правом верхнем углу (SVG звезда, fill var(--brand))
                          срезанный уголок clip-path
                          кнопка = ··· вместо +
```

**Правила отображения:**
- **Прозрачность заливки** = заполненность. `fillOp = 0.12 + (occ/cap) * 0.28`. Цвет = цвет мастера
- **Высота** = `max(dur * 2 * 60 - 10, 52)` px
- **Сжатие**: <90px → скрыть возраст и локацию. <56px → только время
- **Hover**: тень увеличивается, translateY(-1px), z-index:10
- **Drag**: opacity 0.5, scale(0.99)
- **Режим удаления**: красная рамка, `cursor:not-allowed`
- **Зазор между карточками**: min 10px padding-top

**Цвета мастеров:**

| Мастер | HEX |
|--------|-----|
| Ольга Середа | #5B8C7A |
| Юлия Большакова | #6B7E9C |
| Анастасия П. | #A07060 |
| Дарья Тюльпина | #7A6E9C |
| Александра В. | #8A7840 |
| Ирина Горох | #9A5870 |

---

### 2.4 Взаимодействия

| Действие | Результат |
|----------|-----------|
| Drag карточки в другой день | Перемещение. Toast + "Отменить" |
| Alt+drag | Копирование. Зелёный пунктир. Toast |
| Клик по пустому слоту | Если штамп настроен → создать с параметрами штампа |
| Клик в режиме удаления | Удаление с анимацией + Toast + "Отменить" |
| Клик "+" на карточке | Toast "Быстрое добавление гостя" |
| Клик "···" на карточке | Toast "Редактирование индивидуального МК" |
| Кнопка "Копировать прошлую неделю" | Toast "События прошлой недели скопированы" |
| Наведение на слот | Пунктирный прямоугольник-превью |

---

### 2.5 Анимации

- **Удаление**: opacity→0 + scale(.95) за 150ms
- **Toast**: slide up 8px + fade in за 180ms
- **Схлопывание сайдбара**: width 220ms ease
- **Правая панель**: width 220ms ease
- **Карточка hover**: box-shadow + translateY(-1px) за 150ms
- **Тема**: мгновенно (CSS-переменные)
- **Мини-календарь**: перерисовка без анимации

---

## 3. Design System

### 3.1 Цвета

| Роль | Светлая | Тёмная |
|------|---------|--------|
| Фон страницы | `#EDEDEE` | `#1a1a1c` |
| Сайдбар | `#1E2D2F` (с opacity) | `#1E2D2F` |
| Карточки | `#ffffff` | `#252528` |
| Поверхность 2 | `#f4f4f5` | `#303035` |
| Текст основной | `#1a1a1a` | `#e8e8ea` |
| Текст втор. | `#555` | `#aaaaae` |
| Текст трет. | `#888` | `#777780` |
| Текст бледный | `#ccc` | `#555560` |
| Линии | `#E0E0E1` | `#3a3a3e` |
| **Бренд** | **`#004D56`** | **`#004D56`** |

### 3.2 Типографика

| Элемент | Размер | Вес | Цвет |
|---------|--------|-----|------|
| Time pill | 10.5px | 600 | Белый |
| Название услуги | 13px | 600 | var(--ink) |
| Возраст | 11px | 400 | var(--ink-mid) |
| Мастер | 11.5px | 400 | var(--ink-mid) |
| Локация | 11px | 400 | var(--ink-light) |
| Счётчик гостей | 11.5px | 500 | var(--ink-mid) |
| Дни недели | 10px | 500 uppercase | var(--ink-light) |
| Число месяца | 22px | 300 | var(--ink-mid) |
| Период | 15px | 500 | var(--ink) |
| Навигация | 13px | 400 | rgba(255,255,255,.5) |
| Имя пользователя | 12.5px | 500 | rgba(255,255,255,.85) |
| Роль | 10px | 400 | rgba(255,255,255,.35) |
| Версия | 10px | 400 | rgba(255,255,255,.2) |

### 3.3 Размеры

- Сайдбар: 230px / схлопнут 56px
- Правая панель: 260px
- Колонка времени: 64px
- Высота часа: 60px (ячейка), 30px (полчаса)
- Часы работы: 9:00–21:00
- Внутренний отступ карточки: 8px 10px 6px
- Снаружи карточки: 6px по бокам
- Border-radius: 12px (карточки), 8px (кнопки), 50% (аватары)

### 3.4 Тени

- Карточки: `0 1px 4px rgba(0,0,0,.08)`
- Карточки hover: `0 4px 14px rgba(0,0,0,.13)` + translateY(-1px)
- Collapse btn: `0 1px 4px rgba(0,0,0,.12)`
- Panel toggle: `0 2px 10px rgba(0,0,0,.1)`
- Toast: `0 4px 20px rgba(0,0,0,.2)`
- Popup: `0 8px 32px rgba(0,0,0,.14)`

### 3.5 Scrollbar

```css
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--line); border-radius: 2px; }
```

---

## 4. Data Models

```typescript
interface Artist {
  id: string;
  name: string;
  shortName: string;
  color: string;        // HEX, e.g. "#5B8C7A"
}

interface Studio {
  id: string;
  name: string;
  emoji?: string;
  address?: string;
}

interface Service {
  id: string;
  name: string;
  duration: number;
  maxCapacity: number;
  minAge: string;
  defaultAdultPrice: number;
  defaultChildPrice: number;
  defaultIndividualPrice: number;
  description?: string;
}

interface Activity {
  id: string;
  isPublic: boolean;
  serviceId: string;
  locationId: string;
  artistId: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  priceAdult: number;
  priceChild: number;
  priceIndividual: number;
  hasRecords: boolean;
  clientName?: string;
  comment?: string;
  // derived
  occupied?: number;
}

interface BookingRecord {
  id: string;
  activityId: string;
  clientId: string;
  status: 'CONFIRMED' | 'CANCELLED' | 'NO_SHOW';
  comment?: string;
  createdAt: string;
}

interface Visit {
  id: string;
  recordId: string;
  visitorId: string;
  isPrimary: boolean;
  priceCharged: number;
  visited: boolean;
}

interface Client {
  id: string;
  name: string;
  phone: string;
  email?: string;
}

interface Visitor {
  id: string;
  clientId: string;
  name: string;
  age?: number;
  isAdult: boolean;
}

interface Payment {
  id: string;
  recordId: string;
  amount: number;
  method?: 'cash' | 'card' | 'transfer';
  paid: boolean;
}
```

---

## 5. API Endpoints (целевые)

```
GET    /api/artists
GET    /api/studios
GET    /api/services
GET    /api/schedule?week_start=&location_id=&artist_id=
POST   /api/activities
PUT    /api/activities/:id
DELETE /api/activities/:id
POST   /api/activities/:id/copy
GET    /api/bookings?status=&location=&date_from=&date_to=
GET    /api/bookings/:id
POST   /api/clients/lookup
POST   /api/clients
GET    /api/clients/:id
POST   /api/records
POST   /api/payments
GET    /api/chat/services?query=
```

---

## 6. Design Rationale (почему так, а не иначе)

Из сессии Claude. Ключевые решения:

| # | Решение | Почему |
|---|---------|--------|
| 1 | Тёмный сайдбар | Контраст, отделение навигации от контента. Editorial-стиль |
| 2 | Серый фон #EDEDEE | После сравнения с Figma — современнее кремового |
| 3 | Приватные = срезанный уголок | Бумажный приём (clip-path). Не иконка, не текстура |
| 4 | Прозрачность заливки = заполненность | Визуальное, не требует чтения |
| 5 | Два dropdown вместо ToggleGroup | Одновременная фильтрация по мастеру и студии |
| 6 | Штамп вместо кисти | Понятнее метафора |
| 7 | Toast с отменой (без таймера) | Меньше шума, чем обратный отсчёт |
| 8 | Alt+drag = копирование | Интуитивно, не засоряет UI |
| 9 | #004D56 (брендовый) | Из реального бренда студии |
| 10 | Inter (шрифт) | Пришёл из v4. Calvino/Noah/Athelas обсуждались, но не дошли |
| 11 | Нет кнопки "Создать" | Клик по слоту достаточно |
| 12 | Мини-календарь +1 неделя | Ориентация на стыках месяцев |

**Open Questions (TBD):**
- Employee fields: position_title? email? photo? bio?
- ServiceCategory нужна?
- Address format? coordinates?
- Payment methods confirmed?
- Telegram ID для клиента?
- hasRecords — derived or stored?
- Copy last week → в какую неделю?
- Format painter → удалять с записями?
- Navigation → role-based routing?

---

## 7. Implementation Status

| # | Страница | Роут | v4 HTML | Next.js (prev) | Бэкенд |
|---|----------|------|---------|----------------|--------|
| P1 | Admin Schedule | `/` | ✅ | ✅ | ❌ |
| P2 | Booking Management | `/bookings` | ❌ | ✅ | ❌ |
| P2 | Client Card | `/clients/[id]` | ❌ | ✅ | ❌ |
| P3 | Client Booking | `/booking` | ❌ | ✅ | ❌ |
| P4 | Artist Schedule | `/artist` | ❌ | ✅ | ❌ |
| P5 | AI Concierge | `/chat` | ❌ | ✅ | ❌ |

**Предыдущая версия (memo-frontend) — работает:**
- Все 6 страниц с компонентами
- React Context (schedule, booking, artist, chat)
- Mock data: 5 артистов, 3 локации, 6 услуг, 20+ событий
- @dnd-kit для DnD
- Vitest тесты
- `npm run dev` → порт 3000

---

## 8. Архитектура (целевая)

```
memo-frontend/
├── app/
│   ├── page.tsx                  # P1: /
│   ├── booking/page.tsx          # P3: /booking
│   ├── bookings/page.tsx         # P2: /bookings
│   ├── clients/[id]/page.tsx     # P2: /clients/[id]
│   ├── artist/page.tsx           # P4: /artist
│   └── chat/page.tsx             # P5: /chat
├── components/
│   ├── schedule/                 # P1
│   │   ├── SchedulePage.tsx
│   │   ├── Toolbar.tsx
│   │   ├── ViewSwitcher.tsx
│   │   ├── FilterBar.tsx
│   │   ├── WeekView.tsx
│   │   ├── DayColumn.tsx
│   │   ├── ActivityCard.tsx
│   │   ├── ActivityModal.tsx
│   │   ├── ConflictWarning.tsx
│   │   ├── Legend.tsx
│   │   └── FormatPainter.tsx
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── MiniCalendar.tsx
│   │   ├── RightPanel.tsx
│   │   └── Navbar.tsx
│   ├── booking/                  # P3
│   │   ├── LocationSelector.tsx
│   │   ├── ActivitySchedule.tsx
│   │   ├── BookingForm.tsx
│   │   ├── BookingConfirmation.tsx
│   │   ├── VisitorLookup.tsx
│   │   └── PricingBreakdown.tsx
│   ├── artist/                   # P4
│   │   ├── ArtistSelector.tsx
│   │   ├── ArtistWeekView.tsx
│   │   ├── ActivityDetail.tsx
│   │   └── AvailabilityToggle.tsx
│   ├── chat/                     # P5
│   │   ├── ChatMessage.tsx
│   │   ├── ChatInput.tsx
│   │   ├── QuickActions.tsx
│   │   ├── ServiceRecommendation.tsx
│   │   └── TypingIndicator.tsx
│   └── ui/                       # Общие
│       ├── Toast.tsx
│       ├── Badge.tsx
│       ├── Button.tsx
│       ├── Select.tsx
│       └── Modal.tsx
├── lib/
│   ├── types.ts
│   ├── mock-data.ts
│   ├── schedule-context.tsx
│   ├── booking-context.tsx
│   ├── artist-context.tsx
│   └── chat-context.tsx
└── __tests__/
```

**Стек:** Next.js 14 (App Router) + TypeScript + Tailwind CSS 3 + @dnd-kit

---

## 9. Дизайн-отличия v4 от старого spec

| Аспект | Старый spec | v4 (актуальный) |
|--------|-------------|-----------------|
| Primary | #667eea → #764ba2 | **#004D56** |
| Фон | #f0f2f5 | **#EDEDEE** |
| Карточки | белые с тенью | **прозрачная заливка** цветом мастера |
| Сайдбар | нет | **тёмный** #1E2D2F |
| Правая панель | нет | **выезжающая** |
| Приватные | нет | **срезанный уголок** |
| Возраст | текст | **квадратик + иконка** |
| DnD | @dnd-kit | HTML5 native (в прототипе) |
| View switch | Day/Week/Month/List | **День/Неделя** |
| Toast | нет | **есть** с Отменить |
| Тёмная тема | нет | **есть** |
| Мини-календарь | нет | **есть** в сайдбаре |

---

## 10. Quick Start

```bash
# Предыдущая имплементация
cd /root/workspace/memo-v1/memo-frontend
npm install
npm run dev              # localhost:3000
npm test
npx next build

# Новая имплементация (memo2)
cd /root/workspace/memo
# TODO: инициализировать Next.js проект
```

---

*Документ создан: 2026-05-13*
*Источники: colour-mountains-v4.html, claude_session.txt, frontend_spec.md (memo/), код memo-frontend/*
