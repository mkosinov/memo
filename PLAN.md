# Memo Frontend v2 — План работ

> Дата: 2026-05-13

## Вводная

**Что имеем:**
1. `memo/memo-frontend/` — рабочий Next.js 14 проект со всеми 6 страницами, мок-данными, контекстами, @dnd-kit, тестами. **Дизайн устарел.**
2. `memo2/sketches/colour-mountains-v4.html` — новый дизайн (тёмный сайдбар, #004D56, карточки, штамп, тосты, мини-календарь). **Только P1 и в HTML.**
3. `memo2/sketches/memo-full-spec.md` — полный spec (543 строки) с UI/UX, дизайн-системой, типами, архитектурой.

**Стратегия:** Гибрид — берём логику из `memo-frontend` и переодеваем в дизайн v4.

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

- [ ] Создать `.opencode/agents/architect.md`
- [ ] Создать `.opencode/agents/frontend-coder.md`
- [ ] Создать `.opencode/agents/backend-coder.md`
- [ ] Создать `.opencode/agents/tester.md`
- [ ] Создать `.opencode/agents/debugger.md`
- [ ] Создать `.opencode/agents/docser.md`
- [ ] Создать `.opencode/agents/deployer.md`
- [ ] Создать `.opencode/agents/manager.md`

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
- [ ] **WeekView** — 7 колонок × 24 полу-часовых слота (9:00–21:00), sticky-шапка с днями
- [ ] **DayColumn** — одна колонка (drop zone для DnD)
- [ ] Линии часов (сплошные) и получасов (пунктир)
- [ ] Линия текущего времени

**2b. Карточки событий:**
- [ ] **ActivityCard** — time pill (овал, цвет мастера), название (2 строки), возраст (иконка + текст), мастер, локация, футер (гости + кнопка), срезанный уголок для Private
- [ ] Прозрачность заливки = заполненность
- [ ] Сжатие при малой высоте (<90px, <56px)
- [ ] Анимации hover/drag

**2c. Drag & Drop:**
- [ ] Интегрировать @dnd-kit из `memo-frontend`
- [ ] Перетаскивание между днями
- [ ] Alt+drag = копирование
- [ ] Пунктирный прямоугольник-превью
- [ ] Toast + "Отменить" после DnD

**2d. Штамп (Format Painter):**
- [ ] Режим штампа: мастер + услуга + локации (мультивыбор)
- [ ] Клик по слоту → создание с параметрами штампа
- [ ] Режим удаления (toggle → клик → удаление)

**2e. Модалка создания/редактирования:**
- [ ] **ActivityModal** — из `memo-frontend`, адаптировать под v4

**2f. Дополнительно:**
- [ ] **ConflictWarning** — двойная занятость мастера
- [ ] **Copy last week** — копирование Public активностей
- [ ] Фильтры по мастеру и локации

**Результат:** P1 работает полностью, как в v4, на React

---

## Этап 4: P2 — Booking Management + Client Card

- [ ] **BookingPage** (`/bookings`) — портировать из `memo-frontend`, обновить дизайн
- [ ] **ClientCardPage** (`/clients/[id]`) — портировать, обновить дизайн
- [ ] Фильтры, статусы (CONFIRMED/CANCELLED/NO_SHOW), детальный просмотр

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

## Приоритеты и время

| Этап | Зависит от | Время |
|------|-----------|-------|
| 0 — Подготовка (агенты) | — | 15 мин |
| 1 — Инфраструктура Next.js | 0 | 30 мин |
| 2 — Дизайн-система + Layout | 1 | 2 ч |
| 3 — P1 Schedule | 2 | 4 ч |
| 4 — P2 Bookings + Client Card | 2 | 1.5 ч |
| 5 — P3 Booking Flow | 2 | 2 ч |
| 6 — P4 Artist Schedule | 2 | 1 ч |
| 7 — P5 Chat | 2 | 1 ч |
| 8 — Тесты и полировка | 3-7 | 1.5 ч |

**Всего:** ~14-15 часов чистого кода
