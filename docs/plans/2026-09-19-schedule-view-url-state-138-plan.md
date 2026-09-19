# Plan — #138: URL как источник правды (schedule view-state, период records, календарь-навигатор)

**Goal:** убрать CustomEvent-шину `__memo-*` и `NavigationContext`; состояние просмотра расписания (`view`/`date`/`col`) и период записей (`from`/`to`) живут в URL своих страниц; календарь в меню — навигация на `/schedule` + индикатор периода текущей страницы; тестовые e2e-хуки заменены реальными взаимодействиями.

**Architecture:** Next.js 14 App Router, client-side. Новый хук `hooks/useScheduleView.ts` (useSearchParams + router.push/replace) — единственный писатель schedule-URL; `ScheduleViewContext` проксирует его, контракт для потребителей внутри провайдера сохранён (кроме удаления вестигиального `setCurrentWeek`). React Query ключи остаются строками того же формата — инвалидации (#239 SSE) не меняются. Все пути в задаче — от `frontend/admin/`; номера строк из спеки перепроверять grep'ом.

**Tech Stack:** Next.js 14, React Query, @dnd-kit (Pointer/Touch/Keyboard sensors), Playwright (2 шарда), Vitest.

**Spec:** `docs/specs/2026-07-17-schedule-view-url-state-138-design.md` (rev5). Behavioral Delta — §3 спеки; User Scenarios — §6.

---

## Task 1: Хук `useScheduleView` — чтение/запись schedule-URL

### Classification: standard

### Required Docs
- `lib/datetime.ts` — единственный источник `getMonday`/`toISODate` (дата-формат и неделя ПН–ВС — конвенция репо, новых формул не создавать).

### Steps
1. **NEW** `hooks/useScheduleView.ts` по §2.1 спеки: чтение `?view`/`?date`/`?col` с валидацией (enum exact-match; `date` строго `YYYY-MM-DD` и валидная дата; всё невалидное → дефолты `week`/`masters`/`сегодня`, молча); `currentWeek = getMonday(?date)`.
2. Сеттеры через единый приватный helper «обнови один параметр, сохрани остальные»: `setViewMode`/`setSelectedDay`/`prevPeriod`/`nextPeriod`/`goToToday` — `router.push`; `setColumnMode` — `router.replace`; push к идентичному URL — no-op роутера.
3. Day-якорь (переносится из `Topbar.handleViewModeSwitch`): при week→day «сегодня, если неделя текущая, иначе понедельник недели» — живёт в хуке.
4. `hooks/useScheduleView.test.ts`: валидация (битая/частичная `date`, `2026-02-31`, таймзонный суффикс, литерал `today` → дефолт), prev/next в обоих режимах, goToToday сохраняет режим, day-якорь на границе недели, политика push vs replace, производность currentWeek.

### DoD
- Unit `useScheduleView.test.ts` зелёный (RED-GREEN-REFACTOR).

## Task 2: `ScheduleViewContext` проксирует хук; `ScheduleDataContext` и `Toolbar` на производных хука

### Classification: large

### Required Docs
- `docs/domain-rules/activities.md` (семантика занятий — фетч не меняется).

### Steps
1. `contexts/schedule/ScheduleViewContext.tsx`: удалить own state `viewMode`/`selectedDay`/`columnMode` (`:49-51`), 6 event-эффектов (`:54-117`), prev/nextPeriod (`:119-149`), использование NavigationContext (`:33-39`); view-поля проксировать из `useScheduleView()`; `stamp`/`filterMasterIds`/`filterLocationIds` — без изменений; из `ScheduleViewContextType` удалить `setCurrentWeek`.
2. `contexts/schedule/ScheduleDataContext.tsx` (`:95`): диапазон фетча — производные monday/sunday из контекста-прокси (строки того же формата — ключи кэша идентичны, инвалидации не трогаем).
3. `app/components/layout/Toolbar.tsx` (`:53`): якорь popover копирования недели — `currentWeek` хука (координация с #242: контракт «viewed week = неделя ?date»).
4. Тесты: `__tests__/schedule/ScheduleViewContext.test.tsx` — событийные сценарии (`:308-430`) → контрактные; NEW мок-фикстура `createMockUseScheduleView`; `schedule/ScheduleDataContext.test.tsx`, `__tests__/helpers/mockContexts.ts:82`, `__tests__/helpers/splitScheduleOverrides.ts:55` — моки обновить.
5. `app/(main)/schedule/page.tsx`: `<Suspense fallback={...}>` вокруг содержимого — `useSearchParams` входит в дерево с этим таском, без границы статическая сборка Next 14 падает (спека §4; прецедент `clients/page.tsx:136-138`).

### DoD
- Unit: ScheduleViewContext + ScheduleDataContext зелёные; grep `setCurrentWeek` в `contexts/` пуст; сборка `/schedule` проходит со Suspense-границей.

## Task 3: `Topbar` — хендлеры на сеттерах хука

### Classification: small

### Required Docs
- `docs/design-system.md` (Topbar — канон элементов управления).

### Steps
1. `app/components/layout/Topbar.tsx`: `handleViewModeSwitch` (`:101-127`) и `handleCalendarDateSelect` (`:147-162`) — через сеттеры хука (логика day-якоря «сегодня, если неделя текущая» переносится в хук); `selectDateRange` уходит; выбор даты в week-режиме меняет только `?date`, `view` не трогает.
2. `__tests__/Topbar.test.tsx`, `__tests__/CellHeight.Topbar.test.tsx` — моки URL вместо NavigationContext.

### DoD
- Unit Topbar зелёный; переключение режима/даты не пишет ничего кроме `?view`/`?date`.

## Task 4: `Menubar`/`MiniCalendar` — навигатор + индикатор

### Classification: large

### Required Docs
- `docs/design-system.md` (Menubar/MiniCalendar — визуал и a11y-атрибуты не меняются, кроме новых классов диапазона).

### Steps
1. Удалить зеркальный state и слушателей (`Menubar.tsx:392-412`), 4 dispatch'а (`:106-167`), `handleWeekSelect` (`:416-420`); из `MiniCalendarProps` убрать `selectedWeek`/`selectedDay`/`viewMode`/`onWeekSelect` — все данные из searchParams.
2. `MiniCalendar` под `<Suspense fallback={null}>`: читает период текущей страницы через `useSearchParams`; клик по дню → `router.push('/schedule?view=week&date=<день>')`, double-click → `?view=day&...`; «Сегодня» → push с `date=сегодня`; листание месяца/пикер — локальный state, синхронизируемый с периодом страницы при каждой навигации.
3. Подсветка: /schedule — неделя/день из `?view=&date=` (переиспользование существующей логики `bg-brand/30` + inline-toggle); /records при явной валидной паре `?from=&to=` — диапазонные классы (полупрозрачный красный, отдельные «начало»/«конец», срез видимого месяца, месяц инициализируется от `?from`); прочее — нейтральная неделя от `new Date()`, без день-подсветки.
4. Layout: при необходимости Suspense-граница на всё читающее поддерево Menubar (компиляция — контроль на IMPL).
5. Unit `Menubar.test.tsx`: подсветка трёх состояний, push-цели хендлеров, локальный месяц.

### DoD
- Unit Menubar зелёный; сценарий US-3 покрывается e2e в Task 9.

## Task 5: `/records?from=&to=` — период записей в URL

### Classification: standard

### Required Docs
- `docs/domain-rules/records.md` (контракт `date_from`/`date_to` — строки ISO, формат не меняется).

### Steps
1. `app/(main)/records/components/RecordsFilters.tsx`: date-инпуты (aria-label сохраняются) пишут `router.replace` `?from=&to=` (правка одного инпута сохраняет второй; сброс `:120` удаляет оба параметра и чистит фильтры — сегодняшнее поведение); валидация: пустая строка = «нет параметра», `from > to` → пара невалидна → обе стороны к дефолту.
2. `contexts/RecordsContext.tsx` (`:64`): `dateFrom`/`dateTo` из searchParams; дефолт без параметров — monday..sunday текущей недели (та же строка, что в ключе `:81`).
3. `app/(main)/records/page.tsx`: `<Suspense>` вокруг содержимого.
4. Unit `RecordsFilters.test.tsx` / `RecordsContext.test.tsx`: инпут → URL (replace), сброс чистит, from>to → дефолт, пустые строки = отсутствие, инвариант «нет параметров → ключ = monday..sunday».

### DoD
- Unit зелёный; **E2E для сценариев US-4 и US-5 проходит (RED-GREEN-REFACTOR)** — пишется в Task 9.

## Task 6: Развязка /clients

### Classification: small

### Required Docs
- `docs/design-system.md` (ClientRecordTab — визуал не меняется).

### Steps
1. `app/(main)/clients/page.tsx:135`: `<ScheduleProvider>` → `<GridSettingsProvider>` (экспортируется из `contexts/schedule/GridSettingsContext.tsx:50`); существующий Suspense остаётся.
2. grep зоны clients: не осталось потребителей `useScheduleView`/`useScheduleData`.

### DoD
- Clients page рендерится, `gridFrequency` в ClientRecordTab работает; e2e clients-сьют зелёный (shard-rest).

## Task 7: Удаление `NavigationContext`

### Classification: small

### Required Docs
- Нет (спека §2.4 — полный список потребителей).

### Steps
1. DELETE `contexts/NavigationContext.tsx`, монтирование в `app/(main)/layout.tsx:93-95` (импорт `:6`), `__tests__/NavigationContext.test.tsx`.
2. Моки в оставшихся тестах (`Menubar`, `StampPanel`, `CellHeight.Topbar`, `Topbar`, `page`, `scheduleIntegration`, `optimisticUpdate`, `schedule/ScheduleDataContext`, `Toolbar`) — на URL-моки.

### DoD
- `grep -rn "useNavigation|NavigationContext" app contexts hooks` → пусто; unit-сьют зелёный.

## Task 8: Снос тестовых хуков №7–10 + KeyboardSensor

### Classification: standard

### Required Docs
- `docs/design-system.md` (a11y: фокусируемые активаторы колонок).

### Steps
1. `WeekView.tsx:94-100`, `DayView.tsx:137-143`, `DayView.tsx:323-333` — удалить тестовые слушатели (комментарии-объяснения вместе с ними).
2. `DayView.tsx` сенсоры (`:373-375`): + `KeyboardSensor` с `sortableKeyboardCoordinates` из `@dnd-kit/sortable`; колонкам — фокусируемые активаторы.
3. Проверка: production-код без `__memo-open-modal`/`quick-add`/`close-modal`/`column-reorder`; реальные пути (клик карточки — прецедент пилота, клик бэкдропа `ActivityDetailsModal.tsx:50-53`, клик слота — `admin-clicks-empty-slot.spec.ts`) работают.

### DoD
- Unit WeekView/DayView зелёные; **E2E для сценария US-7 (реальный клик по карточке → модалка) и US-6 (keyboard reorder) проходит** — миграция в Task 9.

## Task 9: Миграция e2e — хелперы, 11 спеков, новые сценарии

### Classification: large

### Required Docs
- `docs/specs/2026-07-17-schedule-view-url-state-138-design.md` §5.2/§6 (карта миграции и сценариев).

### Steps
1. `e2e/fixtures/helpers.ts`: `navigateToWeek` (`:44-51`) → `gotoScheduleWeek(page, date)`/`gotoScheduleDay(page, date)` через `page.goto('/schedule?view=...&date=...')`; `openModal`/`quickAdd`/`close` (`:225,241,251,292`) → реальный клик по карточке/слоту/бэкдропу.
2. Миграция спеков: `unify-caches`, `dayview-column-reorder` (перепись на keyboard, US-6), `dayview-slot-create`, `schedule-column-visibility` (пилот), `schedule-archived-visibility`, `schedule-empty-week`, `visual-compliance-checks`, `error-messages`, `server-push-offline`, `schedule-saving-toast`, `copy-last-week.spec.ts:136` (событие → `page.goto`).
3. Новые сценарии: US-1 deep-link day; US-2 next-период + back + ассерт «одно взаимодействие = одна запись истории»; US-3 календарь с /records → /schedule (week; double-click → day); US-4 records-даты → URL + красный диапазон на календаре; US-5 share-ссылка records с периодом.
4. Существующие records-спеки (`records-view.spec.ts:517-530`) — локаторы и `waitForResponse` без изменений.

### DoD
- Все schedule/records e2e-сьюты зелёные; US-1–US-7 зелёные (RED-GREEN-REFACTOR); `grep -rn "__memo-" e2e` → пусто.

## Task 10: Финальная верификация

### Classification: small

### Required Docs
- `docs/specs/2026-07-17-schedule-view-url-state-138-design.md` §9 (DoD).

### Steps
1. Повторный пилот «клик по карточке → модалка» — уже на URL-архитектуре (push + Suspense).
2. Полный `test-all.sh` (оба шарда) + vitest + lint + typecheck.
3. Финальные grep: `__memo-` (app/contexts/hooks/e2e) и `useNavigation|NavigationContext` (app/contexts/hooks) → пусто.

### DoD
- Всё зелёное; оба grep пусты; спека §9 закрыта целиком.

---

## Порядок и параллельность

T1 → T2 → T3/T4 (параллельно) → T5 → T6 (независима, можно параллельно с T2) → T7 (после T2–T5) → T8 → T9 → T10. Зависимость по файлам: Menubar (T4) и RecordsFilters (T5) не пересекаются; Toolbar (T2) и copy-week (#242) — см. спеку §8.

**Осознанное «красное окно» e2e:** с T2 (хук входит в продакшен-код) старые хелперы на шине (`navigateToWeek`, модальные) ломаются — большинство schedule-e2e красные до T9. Это свойство production-first-порядка, зелёные гейты стоят в T9/T10; «падения» на T2–T8 чинить не нужно, кроме unit-уровня.
