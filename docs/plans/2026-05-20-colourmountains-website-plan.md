# colourmountains.ru Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать `apps/web/` — публичный сайт colourmountains.ru с главной страницей (hero, card stack carousel, overlays, chat), личным кабинетом и вспомогательными страницами.

**Architecture:** Next.js 14 App Router в `apps/web/` с shared packages (`@memo/domain`, `@memo/api-client`). Единая дизайн-система с админкой (адаптация: `--gold` accent, Playfair Display, `--radius: 16px`). Mobile-first (390px max-width). Overlay-паттерн для всех интерактивных элементов.

**Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind CSS, Framer Motion (card stack), Embla Carousel (calendar line), `@memo/domain`, `@memo/api-client`

---

## Зависимости

- [x] Design spec: `docs/specs/2026-05-20-colourmountains-website-design.md`
- [x] Turborepo монорепо с `apps/admin/`, `packages/domain/`, `packages/api-client/`
- [ ] Backend API endpoints (mock-данные на первом этапе)

---

## Task Classification Legend

| Tier | Criteria | Review Pipeline |
|------|----------|----------------|
| **Trivial** | ≤5 lines, style/text, no logic | Self-review |
| **Small** | 1 файл, <50 lines, props/layout | Spec-review only |
| **Standard** | Multi-file, logic, state, API | Full two-stage |
| **Large** | Architecture, subsystem, >200 lines | Full two-stage + final reviewer |

---

## Task 1: Обновить единую дизайн-систему
**Classification:** Small

**Files:**
- `docs/design-system.md` — обновить токены
- `apps/admin/tailwind.config.ts` — обновить radius и добавить gold

**Steps:**
- [ ] В `docs/design-system.md`:
  - Изменить `--radius: 12px` → `--radius: 16px`
  - Добавить `--gold: #C49A2E`
  - Добавить Playfair Display в Typography
  - Добавить сайтовые shadows: `0 2px 16px rgba(0,0,0,.09)`
- [ ] В `apps/admin/tailwind.config.ts`:
  - Обновить `radius: '12px'` → `radius: '16px'`
  - Добавить `gold: '#C49A2E'` в colors
- [ ] Проверить: `cd apps/admin && npm run build` (без ошибок)

---

## Task 2: Инициализация проекта `apps/web/`
**Classification:** Standard

**Files (новые):**
- `apps/web/package.json`
- `apps/web/next.config.js`
- `apps/web/tsconfig.json`
- `apps/web/tailwind.config.ts`
- `apps/web/postcss.config.js`
- `apps/web/.env.local`

**Steps:**
- [ ] Создать `apps/web/` — Next.js 14 проект с App Router
- [ ] Настроить `package.json` с зависимостями: `next`, `react`, `react-dom`, `typescript`, `tailwindcss`, `postcss`, `autoprefixer`, `framer-motion`, `embla-carousel-react`, `@memo/domain`, `@memo/api-client`
- [ ] Настроить `tsconfig.json` с paths: `@/components/*`, `@/lib/*`, `@/app/*`
- [ ] Настроить `tailwind.config.ts`:
  - Extend colors: brand, gold, ink, surface, line (из design-system)
  - Font families: Inter (body), Playfair Display (headings)
  - Border radius: 16px (lg), 8px (sm)
  - Shadows: карусельный shadow
- [ ] Настроить `next.config.js`:
  - `output: 'export'` (для статического деплоя)
  - `images: { unoptimized: true }` (для static export)
  - `distDir: 'dist'`
- [ ] Добавить `apps/web` в `pnpm-workspace.yaml`
- [ ] Запустить `npm install` в root
- [ ] Проверить: `cd apps/web && npm run build` (базовый build проходит)

---

## Task 3: Глобальные стили и шрифты
**Classification:** Small

**Files (новые):**
- `apps/web/app/globals.css`
- `apps/web/app/layout.tsx`

**Steps:**
- [ ] Создать `globals.css`:
  - CSS-переменные (из design-system): `--bg`, `--card-bg`, `--surface`, `--brand`, `--gold`, `--ink`, etc.
  - Импорт Google Fonts: Inter, Playfair Display
  - Базовые стили: `body { background: var(--bg); font-family: 'Inter', sans-serif; max-width: 390px; margin: 0 auto; }`
  - Scrollbar hiding для каруселей
  - Скроллбар стилизация
- [ ] Создать `layout.tsx`:
  - Metadata: title "Цветные Горы — Студия рисования", description
  - Root layout с `globals.css`
  - Mobile viewport: `width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no`

---

## Task 4: Базовые компоненты и layout
**Classification:** Standard

**Files (новые):**
- `apps/web/app/components/Header.tsx`
- `apps/web/app/components/HamburgerMenu.tsx`
- `apps/web/app/components/Overlay.tsx`
- `apps/web/app/components/Button.tsx`
- `apps/web/app/components/Pill.tsx`

**Steps:**
- [ ] `Button.tsx`: варианты `primary` (brand bg), `outline` (brand border), `gold` (gold bg). Props: `variant`, `size`, `children`, `onClick`, `disabled`
- [ ] `Pill.tsx`: фильтр-пилл. Props: `active`, `children`, `onClick`. Стили: active = brand bg + white text, inactive = border + ink-mid text
- [ ] `Overlay.tsx`: slide-up overlay (пол-экрана или полноэкранный). Props: `isOpen`, `onClose`, `children`, `size` ('half' | 'full'). Анимация: `translateY(100%) → translateY(0)`
- [ ] `Header.tsx`: логотип (Logo.png) слева, hamburger справа. Фиксированный на мобильном. Прозрачный на hero, белый bg при скролле
- [ ] `HamburgerMenu.tsx`: overlay меню со списком страниц: Услуги, Студии, Пленэр, Корпоративы, Магазин, О нас, Личный кабинет. Slide-in справа

---

## Task 5: Hero секция
**Classification:** Small

**Files (новые):**
- `apps/web/app/sections/Hero.tsx`

**Steps:**
- [ ] Создать Hero:
  - Высота: `36svh`, min 240px, max 300px
  - Фон: placeholder изображение (unsplash горы) + градиент overlay
  - Заголовок: Playfair Display, 26px, белый, gold accent на части текста
  - Pills: «Новичкам подходит • Всё включено • Рядом с вами»
  - Header встроен в hero (логотип + hamburger)
- [ ] Проверить: hero виден без скролла, нижняя часть следующей секции немного видна

---

## Task 6: Календарь-линия (CalendarLine)
**Classification:** Standard

**Files (новые):**
- `apps/web/app/components/CalendarLine.tsx`
- `apps/web/app/hooks/useCalendarDays.ts`

**Steps:**
- [ ] `useCalendarDays.ts`: хук для генерации +14 дней от сегодня. Возвращает массив: `{ date, dayName, dayNumber, isToday, isSelected }`
- [ ] `CalendarLine.tsx`:
  - Embla Carousel горизонтальный скролл
  - Дни недели: короткие названия (Пн, Вт, Ср...)
  - Числа: крупные
  - Текущий выделенный день: красный квадрат border (как настенный календарь) — `border: 2px solid #C8503C` (или brand color)
  - Сегодня: подсветка фона
  - Свайп/скролл горизонтальный
  - Callback `onSelectDay(date)`
- [ ] Стили: sticky под hero, белый фон, нижняя граница

---

## Task 7: Фильтры (FilterPills + LocationFilter)
**Classification:** Small

**Files (новые):**
- `apps/web/app/components/FilterPills.tsx`
- `apps/web/app/components/LocationFilter.tsx`

**Steps:**
- [ ] `FilterPills.tsx`:
  - Pills: «вместе», «взрослым», «детям»
  - Горизонтальный скролл (overflow-x-auto)
  - Single select (только один активен)
  - Использует `Pill.tsx`
- [ ] `LocationFilter.tsx`:
  - Dropdown селект с иконкой локации
  - Опции: все локации из API
  - Приоритет загрузки: 1) cookies, 2) GPS (заглушка на первом этапе)
  - Сохранение выбора в cookies

---

## Task 8: Card Stack карусель (MKCarousel)
**Classification:** Large

**Files (новые):**
- `apps/web/app/components/MKCarousel.tsx`
- `apps/web/app/components/MKCard.tsx`
- `apps/web/app/hooks/useCardStack.ts`

**Steps:**
- [ ] `MKCard.tsx`:
  - Фото МК (крупное, aspect-ratio 4:3)
  - Тег категории (цветной pill: золотой/зелёный/розовый для взрослым/вместе/детям)
  - Название: Playfair Display, 18px, bold
  - Время + длительность
  - Локация (иконка + текст)
  - Social proof: «Уже 3 гостя»
  - Материал: «Акрил • 30×40»
  - Цена: диапазон «3 500 – 5 500 ₽»
  - Кнопка «Записаться» (brand bg)
- [ ] `useCardStack.ts`:
  - Управление состоянием стопки: `cards[]`, `currentIndex`, `direction`
  - Свайп жесты: pan left/right
  - Анимация выхода: translateX + rotate
  - Callback: `onSwipe(card, direction)`, `onTap(card)`
- [ ] `MKCarousel.tsx`:
  - Рендерит 3 карточки одновременно (видимая + 2 под ней)
  - Подкарточки: scale(0.95), translateY(8px), rotate(±2deg)
  - Framer Motion для анимаций свайпа
  - Tap на видимую → `onSelect(card)`
  - Swipe left/right → следующая/предыдущая
- [ ] Тест: карточки рендерятся, свайп работает, тап открывает детали

---

## Task 9: ActivityDetail Overlay
**Classification:** Standard

**Files (новые):**
- `apps/web/app/components/ActivityDetail.tsx`

**Steps:**
- [ ] Overlay (пол-экрана, slide-up):
  - Фото МК (крупное, на всю ширину)
  - Фото гостей (горизонтальная полоса, если есть)
  - Имя + аватар преподавателя
  - Дата и время
  - Материал + кнопка «Подробнее» → открывает MaterialDetails popup
  - Стоимость (диапазон) + кнопка «Подробнее» → PriceDetails popup
  - Кнопка «в следующий раз» + кнопка «Подробнее» → NextTime popup
  - Локация + кнопка «Подробнее» → LocationDetails popup
  - Кнопка «Участвовать» → открывает BookingOverlay
- [ ] Кнопка закрытия (крестик) вверху
- [ ] Свайп вниз для закрытия

---

## Task 10: Booking Overlay
**Classification:** Standard

**Files (новые):**
- `apps/web/app/components/BookingOverlay.tsx`
- `apps/web/app/components/Counter.tsx`
- `apps/web/app/components/ContactForm.tsx`

**Steps:**
- [ ] `Counter.tsx`: счётчик участников (+/-). Props: `label`, `subLabel`, `value`, `onChange`, `min`, `max`. Кнопки круглые, border
- [ ] `ContactForm.tsx`:
  - Поля: Имя (text), Телефон (tel), Комментарий (textarea, опционально)
  - Валидация: имя ≥ 2 символов, телефон ≥ 10 цифр
  - Dropdown: «Куда отправить подтверждение» — Max / Telegram / WhatsApp
- [ ] `BookingOverlay.tsx` (полноэкранный):
  - Top bar: «← Назад» + заголовок «Оформление записи»
  - Саммари МК (фото, название, время, локация)
  - Счётчики: Взрослые / Дети (с ценами)
  - Итого (динамически)
  - Форма контактов
  - Кнопка «Записаться» (disabled до валидации)
  - Success state:
    - Иконка 🎨
    - «Вы записаны!»
    - Детали записи
    - Кнопка «Получить напоминание в WhatsApp»
- [ ] Свайп вниз / кнопка назад для закрытия

---

## Task 11: Popup-компоненты (PriceDetails, MaterialDetails, NextTime, LocationDetails)
**Classification:** Standard

**Files (новые):**
- `apps/web/app/components/PriceDetails.tsx`
- `apps/web/app/components/MaterialDetails.tsx`
- `apps/web/app/components/NextTime.tsx`
- `apps/web/app/components/LocationDetails.tsx`

**Steps:**
- [ ] `PriceDetails.tsx`: список всех тарифов для МК (взрослый, ребёнок, семейный и т.д.). Цены, описания
- [ ] `MaterialDetails.tsx`: информация о технике (акрил/масло). Что входит, что взять с собой, сколько сохнет
- [ ] `NextTime.tsx`: 3 варианта следующего такого же МК (дата + время + локация). Кнопка «Записаться» на каждый
- [ ] `LocationDetails.tsx`: фото студии, адрес, часы работы, карта (placeholder), как добраться
- [ ] Все popup: slide-up overlay, меньше пол-экрана (~70%), закрытие по свайпу/крестику

---

## Task 12: Reviews и Gallery секции
**Classification:** Small

**Files (новые):**
- `apps/web/app/sections/Reviews.tsx`
- `apps/web/app/sections/GuestGallery.tsx`

**Steps:**
- [ ] `Reviews.tsx`:
  - Текст: «Хорошее место 4.9★ · Посмотреть отзывы →»
  - Ссылка `https://yandex.ru/maps/org/...` (target="_blank", rel="noopener noreferrer")
  - Компактно, без карусели
- [ ] `GuestGallery.tsx`:
  - Горизонтальный скролл
  - Фото работ (placeholder)
  - Тег техники (акрил/масло/дети) — badge на фото
  - По тапу — открытие фото в оверлее (PhotoGallery popup)

---

## Task 13: Sticky Chat Bar
**Classification:** Small

**Files (новые):**
- `apps/web/app/components/ChatBar.tsx`

**Steps:**
- [ ] Фиксирован снизу, backdrop-filter blur
- [ ] Chips (горизонтальный скролл):
  - «👶 Для ребёнка 8 лет»
  - «❤️ Для двоих»
  - «🌧 Чем заняться в дождь»
  - «⏱ Есть только 1 час»
- [ ] Кнопка «Отправить» (brand bg)
- [ ] Без поля ввода текста
- [ ] По нажатию chip → отправка (mock на первом этапе)

---

## Task 14: API интеграция и data layer
**Classification:** Standard

**Files (новые):**
- `apps/web/app/hooks/useActivities.ts`
- `apps/web/app/hooks/useLocations.ts`
- `apps/web/app/hooks/useGallery.ts`
- `apps/web/app/lib/api.ts`

**Steps:**
- [ ] `api.ts`: обёртка над `@memo/api-client` для web-приложения
  - `getActivities(filters)` — МК с фильтрами
  - `getLocations()` — список студий
  - `getGallery(limit)` — фото гостей
  - `createBooking(data)` — создание записи
- [ ] `useActivities.ts`: React Query / SWR хук. Принимает `date`, `location`, `category`. Возвращает `activities[]`, `isLoading`, `error`
- [ ] `useLocations.ts`: хук для локаций. Возвращает `locations[]`
- [ ] `useGallery.ts`: хук для галереи. Возвращает `photos[]`
- [ ] На первом этапе: mock-данные (как в `sketches/client_website_main_page_sketch.html`), API — заглушки

---

## Task 15: Главная страница (сборка)
**Classification:** Standard

**Files:**
- `apps/web/app/page.tsx` (modify)

**Steps:**
- [ ] Собрать главную страницу из секций:
  1. Hero
  2. CalendarLine (sticky)
  3. FilterPills + LocationFilter
  4. MKCarousel
  5. Reviews
  6. GuestGallery
  7. ChatBar (fixed bottom)
- [ ] State management: выбранный день, фильтр категории, локация → фильтруют карусель
- [ ] ActivityDetail overlay: открывается по тапу на карточку
- [ ] Booking overlay: открывается из ActivityDetail
- [ ] Проверить: страница рендерится без ошибок, все секции видны

---

## Task 16: Вспомогательные страницы
**Classification:** Standard

**Files (новые):**
- `apps/web/app/services/page.tsx`
- `apps/web/app/locations/page.tsx`
- `apps/web/app/pleinair/page.tsx`
- `apps/web/app/corporate/page.tsx`
- `apps/web/app/shop/page.tsx`
- `apps/web/app/about/page.tsx`
- `apps/web/app/cabinet/page.tsx`
- `apps/web/app/booking/page.tsx`

**Steps:**
- [ ] Каждая страница: базовый layout с Header, заглушка-контент (h1 + короткий текст)
- [ ] `/cabinet`: заглушка «Личный кабинет» с формой входа (телефон)
- [ ] `/booking`: standalone страница с BookingOverlay (для прямых ссылок)
- [ ] Все страницы мобильные (max-width 390px, centered)
- [ ] Проверить: навигация между страницами работает

---

## Task 17: Cookie и geolocation utils
**Classification:** Small

**Files (новые):**
- `apps/web/app/lib/cookies.ts`
- `apps/web/app/lib/geolocation.ts`

**Steps:**
- [ ] `cookies.ts`: `getLocationCookie()`, `setLocationCookie(locationId)` (expires 30 дней)
- [ ] `geolocation.ts`: `getCurrentPosition()` → Promise с координатами. Fallback: null. На первом этапе — заглушка
- [ ] Интеграция: при загрузке главной → `getLocationCookie()` → если нет, попытка geolocation → `setLocationCookie()`

---

## Task 18: Тесты и build
**Classification:** Standard

**Files (новые):**
- `apps/web/vitest.config.ts`
- `apps/web/app/**/*.test.tsx`

**Steps:**
- [ ] Настроить Vitest + React Testing Library + jsdom
- [ ] Тесты:
  - Hero рендерится
  - CalendarLine: дни генерируются, выбор дня работает
  - FilterPills: фильтрация работает
  - MKCarousel: карточки рендерятся
  - ActivityDetail: открывается по тапу
  - BookingOverlay: форма валидируется
  - Reviews: ссылка на Яндекс имеет target="_blank"
- [ ] `npm run test` — все тесты проходят
- [ ] `npm run build` — билд без ошибок

---

## Self-Review

**Spec coverage check:**
- [x] Hero (35% viewport) — Task 5
- [x] Календарь-линия (красный квадрат) — Task 6
- [x] Фильтры (вместе/взрослым/детям) — Task 7
- [x] Card Stack carousel — Task 8
- [x] ActivityDetail overlay — Task 9
- [x] Booking overlay (саммари, счётчики, форма, dropdown Max/Telegram/WhatsApp) — Task 10
- [x] PriceDetails, MaterialDetails, NextTime, LocationDetails popups — Task 11
- [x] Reviews (компакт + ссылка на Яндекс) — Task 12
- [x] GuestGallery — Task 12
- [x] ChatBar (только chips + кнопка) — Task 13
- [x] Cookie + geolocation — Task 17
- [x] Остальные страницы — Task 16
- [x] Личный кабинет (/cabinet) — Task 16
- [x] /booking standalone — Task 16

**Placeholder scan:** Нет TBD/TODO. Все задачи содержат конкретные шаги.

**Type consistency:** Хуки возвращают типизированные данные, компоненты принимают Props интерфейсы.

---

## Execution Handoff

**Plan complete and saved to `docs/plans/2026-05-20-colourmountains-website-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**