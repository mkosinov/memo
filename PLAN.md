# Memo Frontend v2 — План работ

> Дата: 2026-05-13
> **P1 Admin Schedule: ✅ Completed 2026-05-15** — 15/15 tasks done
> **P1 UI Polish: ✅ Completed 2026-05-16** — 4 polish tasks + 1 trivial, 165 tests passing

## Дедлайны (обновлено 2026-05-13)

| Веха | Дата | Что сдаём |
|------|------|-----------|
| **MVP** | **20 мая 2026 (7 дней)** | P1 — Admin Schedule полностью рабочий |
| **Full release** | **31 мая 2026 (18 дней)** | Все P1–P5 + тесты |

## Вводная

**Что имеем:**
1. `memo/memo-frontend/` — рабочий Next.js 14 проект со всеми 6 страницами, мок-данными, контекстами, @dnd-kit, тестами. **Дизайн устарел.**
2. `memo2/sketches/colour-mountains-v4.html` — новый дизайн (тёмный сайдбар, #004D56, карточки, штамп, тосты, мини-календарь). **Только P1 и в HTML.**
3. `memo2/docs/memo-full-spec.md` — полный spec (543 строки) с UI/UX, дизайн-системой, типами, архитектурой.

**Стратегия:** Гибрид — берём логику из `memo-frontend` и переодеваем в дизайн v4.

## График работ (MVP — 13–20 мая)

| День | Дата | Что делаем | Кто |
|------|------|-----------|-----|
| День 1 | 13 мая (ср) | Next.js инициализация + дизайн-система | @frontend-coder |
| День 2 | 14 мая (чт) | Layout: Sidebar, Toolbar, RightPanel | @frontend-coder |
| День 3 | 15 мая (пт) | P1 — Сетка расписания + карточки | @frontend-coder |
| День 4 | 16 мая (сб) | P1 — Продолжение (карточки, фильтры) | @frontend-coder |
| День 5 | 17 мая (вс) | P1 — DnD, штамп, модалка | @frontend-coder |
| День 6 | 18 мая (пн) | P1 — финальные фичи + тесты | @frontend-coder + @tester |
| День 7 | 19 мая (вт) | Полировка, фикс багов | @debugger + @tester |
| Сдача | 20 мая (ср) | **MVP готов** | — |

---

## Этап 0: Подготовка — агенты проекта

Создать 8 агентов в `.opencode/agents/` по образу cmbot:

| № | Агент | Роль | Mode | Модель |
|---|-------|------|------|--------|
| 1 | @architect | Team Lead + Архитектор — планирует, проектирует, делегирует | primary | kimi-k2.6 |
| 2 | @frontend-coder | Разработка фронтенда (Next.js, React, Tailwind, TS) | subagent | qwen3.6-plus |
| 3 | @backend-coder | Разработка бэкенда (FastAPI, SQLite, Python) | subagent | qwen3.6-plus |
| 4 | @tester | Тестирование (Vitest, pytest, e2e) | subagent | qwen3.5-plus |
| 5 | @debugger | Поиск и анализ багов | subagent | qwen3.6-plus |
| 6 | @docser | Документация — ведёт PLAN.md, README, статусы | subagent | deepseek-v4-flash |
| 7 | @deployer | Деплой и CI/CD | subagent | deepseek-v4-flash |
| 8 | @manager | Связующий — принимает запросы, распределяет между агентами | primary | deepseek-v4-flash |

- [x] Создать `.opencode/agents/architect.md`
- [x] Создать `.opencode/agents/frontend-coder.md`
- [x] Создать `.opencode/agents/backend-coder.md`
- [x] Создать `.opencode/agents/tester.md`
- [x] Создать `.opencode/agents/debugger.md`
- [x] Создать `.opencode/agents/docser.md`
- [x] Создать `.opencode/agents/deployer.md`
- [x] Создать `.opencode/agents/manager.md`

**Результат:** 8 агентов готовы к работе, распределение ролей зафиксировано

---

## Этап 1: Инфраструктура Next.js

- [ ] Инициализировать Next.js 14 проект в `memo2/frontend/`
- [ ] Настроить Tailwind CSS, TypeScript, ESLint
- [ ] Установить зависимости: `@dnd-kit/core`, `@dnd-kit/sortable`
- [ ] Скопировать `lib/types.ts`, `lib/mock-data.ts` из `memo/memo-frontend/`
- [ ] Скопировать контексты (`schedule-context`, `booking-context`, `artist-context`, `chat-context`)
- [ ] Скопировать Vitest + конфиг
- [ ] `npm run dev` запускается на порту 3000

**Результат:** Пустой Next.js проект с мок-данными и контекстами, готовый к наполнению

---

## Этап 2: Дизайн-система и Layout (база)

- [ ] `app/globals.css` — CSS-переменные (светлая/тёмная тема из v4), скроллбар, базовые стили
- [ ] `app/layout.tsx` — корневой лейаут
- [ ] **Sidebar** — React-компонент (логотип, мини-календарь, навигация, легенда, тумблер ☀/☾, кнопка оформления, пользователь, версия, схлопывание)
- [ ] **MiniCalendar** — сетка месяца, +1 неделя до/после, скролл недель, подсветка today/недели
- [ ] **ThemeProvider** — React Context для переключения темы
- [ ] **Toast** — система тостов (createPortal)
- [ ] **Toolbar** — навигация по неделям, день/неделя, фильтры
- [ ] **RightPanel** — выезжающая панель (штамп + неделя, сворачивание секций)

**Результат:** Весь скелет приложения собран, навигация работает, тема переключается, тосты показываются

---

## Этап 3: P1 — Admin Schedule (`/`)

**2a. Сетка расписания:**
- [x] **WeekView** — 7 колонок × 24 полу-часовых слота (9:00–21:00), sticky-шапка с днями
- [x] **DayColumn** — одна колонка (drop zone для DnD)
- [x] Линии часов (сплошные) и получасов (пунктир)
- [x] Линия текущего времени

**2b. Карточки событий:**
- [x] **ActivityCard** — time pill (овал, цвет мастера), название (2 строки), возраст (иконка + текст), мастер, локация, футер (гости + кнопка), срезанный уголок для Private
- [x] Прозрачность заливки = заполненность
- [x] Сжатие при малой высоте (<90px, <56px)
- [x] Анимации hover/drag

**2c. Drag & Drop:**
- [x] Интегрировать @dnd-kit из `memo-frontend`
- [x] Перетаскивание между днями
- [x] Alt+drag = копирование
- [x] Пунктирный прямоугольник-превью
- [x] Toast + "Отменить" после DnD

**2d. Штамп (Format Painter):**
- [x] Режим штампа: мастер + услуга + локации (мультивыбор)
- [x] Клик по слоту → создание с параметрами штампа
- [x] Режим удаления (toggle → клик → удаление)

**2e. Модалка создания/редактирования:**
- [x] **ActivityModal** — из `memo-frontend`, адаптировать под v4

**2f. Дополнительно:**
- [ ] **ConflictWarning** — двойная занятость мастера (отложено в P2)
- [x] **Copy last week** — копирование Public активностей
- [ ] Фильтры по мастеру и локации (отложено в P2)

**Результат:** P1 работает полностью, как в v4, на React

---

## Этап 4: P2 — Booking Management + Client Card ✅

- [x] **BookingPage** (`/bookings`) — портировать из `memo-frontend`, обновить дизайн
- [x] **ClientCardPage** (`/clients/[id]`) — портировать, обновить дизайн
- [x] Фильтры, статусы (CONFIRMED/CANCELLED/NO_SHOW), детальный просмотр
- [x] Route group `(main)` — sidebar nav links with Link + active state
- [x] Bugfixes: test imports, date filter guard, Sidebar usePathname mock

**Результат:** Администратор управляет бронированиями и видит карточки клиентов

---

## Этап 5: P3 — Client Booking Flow

- [ ] **BookingPage** (`/booking`) — портировать 4-шаговый флоу
- [ ] LocationSelector, ActivitySchedule, BookingForm, VisitorLookup
- [ ] BookingConfirmation + PricingBreakdown
- [ ] Обновить дизайн под общую стилистику

**Результат:** Клиент записывается на мастер-класс

---

## Этап 6: P4 — Artist Schedule

- [ ] **ArtistPage** (`/artist`) — портировать
- [ ] ArtistSelector, ArtistWeekView, ActivityDetail, AvailabilityToggle
- [ ] Mobile-first, card-based layout

**Результат:** Мастера видят своё расписание

---

## Этап 7: P5 — AI Concierge Chat

- [ ] **ChatPage** (`/chat`) — портировать
- [ ] ChatMessage, ChatInput, QuickActions, ServiceRecommendation, TypingIndicator
- [ ] Keyword-based matching (временная заглушка)

**Результат:** Чат-ассистент помогает подобрать услугу

---

## Этап 8: Тесты и полировка

- [ ] Тесты для всех страниц (Vitest + Testing Library)
- [ ] TypeScript strict mode
- [ ] Базовая a11y (aria-атрибуты)
- [ ] Минимальная мобильная адаптация
- [ ] `next build`, `tsc --noEmit`, `next lint` — без ошибок

---

## Приоритеты и время (MVP — 13–20 мая)

| Этап | Дней | Что делаем | Кто |
|------|------|-----------|-----|
| 0 — Подготовка (агенты) | 1 | Создать 8 агентов | @manager |
| 1 — Инфраструктура Next.js | 1 | Инициализация + депсы | @frontend-coder |
| 2 — Дизайн-система + Layout | 1 | Sidebar, Toolbar, RightPanel | @frontend-coder |
| 3 — P1 Schedule | 3 | Сетка, карточки, DnD, штамп, модалка | @frontend-coder |
| 4–7 — P2–P5 | 4 | Портирование страниц | @frontend-coder |
| 8 — Тесты и полировка | 2 | Тесты, a11y, build | @tester + @frontend-coder |

**Всего:** ~14-15 дней на MVP

---
## Документы

- **Бизнес-логика:** `docs/business-logic.md` — статусы, оплата, бронирование

---
## Changelog
- 2026-05-13: Updated deadlines — MVP 20 мая, Full release 31 мая. Added daily schedule for MVP sprint.
- 2026-05-13: Initial PLAN.md created with etapy 0-8.
