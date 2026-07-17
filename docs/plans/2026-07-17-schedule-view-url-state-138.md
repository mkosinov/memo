# #138 — schedule view-state → URL, remove `__memo-*` event bus — Implementation Plan

> **Workflow:** gated per `CLAUDE.md`. Spec: `docs/specs/2026-07-17-schedule-view-url-state-138-design.md` (G1 approved). This plan is G2 — pending user approval before coding.

**Goal:** Убрать самодельную шину `__memo-*` DOM-событий между `Menubar` и `ScheduleContext`. View-state расписания (`viewMode`, `selectedDay`) переносится в URL (`/schedule?view=week|day&date=YYYY-MM-DD`) через хук `useScheduleView`. Тестовые события (`__memo-open-modal`/`quick-add`/`close-modal`/`column-reorder`) заменяются реальными взаимодействиями. Контракт `useSchedule()` для потребителей не меняется.

**Architecture:** URL — источник правды для view-state на `/schedule`. `ScheduleContext` и `Menubar` читают/пишут его через `useScheduleView`. Синхронизация URL → `NavigationContext` однонаправленная. dnd-kit получает `activationConstraint`, чтобы реальный клик по карточке отличался от drag; reorder колонок получает `KeyboardSensor` для клавиатурного управления в e2e.

**Tech Stack:** Next.js 14 (App Router, `useSearchParams`/`useRouter`), TypeScript, @dnd-kit, vitest + Playwright.

**Risk-first ordering:** Task 1 — пилот реальных взаимодействий (activationConstraint + один e2e-путь). Если пилот не стабилизируется, скоуп Task 5–6 пересматривается до их старта (эскалация по circuit-breaker).

---

## Behavioral Delta

- **Deep-link:** `/schedule?view=day&date=2026-07-20` открывает day-view нужной даты напрямую. Раньше состояние жило только в памяти, ссылку было не передать.
- **Back-button:** переход по периодам (prev/next, смена режима, выбор дня) пишется в историю браузера; back возвращает предыдущий вид.
- **Клик по дню в MiniCalendar со страницы `/records`:** теперь ведёт на `/schedule` нужной недели (раньше событие уходило «в никуда», т.к. `ScheduleContext` не смонтирован вне `/schedule`).
- **Reorder колонок day-view с клавиатуры:** focus заголовка + Space/стрелки/Space (новая доступность; побочно — механизм для e2e).
- Всё остальное поведение расписания без изменений; рендер идентичен (visual-regression снапшоты не должны дрейфовать).

---

## File Structure

| File | Responsibility | Change |
|------|---------------|--------|
| `frontend/admin/hooks/useScheduleView.ts` | Чтение/запись view-state из URL | **NEW** |
| `frontend/admin/hooks/useScheduleView.test.ts` | Unit-тесты хука | **NEW** |
| `frontend/admin/contexts/ScheduleContext.tsx` | view-state + навигация | Заменить own state и 6 event-эффектов на `useScheduleView`; + sync-эффект URL→NavigationContext |
| `frontend/admin/app/components/layout/Menubar.tsx` | Сайдбар/MiniCalendar | Убрать mirror-state и 2 listener'а, 4 dispatch'а → вызовы `useScheduleView`/`router.push` |
| `frontend/admin/app/components/schedule/WeekView.tsx` | Week grid | Убрать тестовый эффект (`:104-134` аналог), + `activationConstraint` |
| `frontend/admin/app/components/schedule/DayView.tsx` | Day grid | Убрать 2 тестовых эффекта (`:104-134`, `:285-299`), + `activationConstraint`, + `KeyboardSensor` |
| `frontend/admin/hooks/useColumnReorder.ts` | Reorder колонок | Поддержка клавиатурного reorder (если требуется для KeyboardSensor) |
| `frontend/admin/app/(main)/schedule/page.tsx` | Страница расписания | + `<Suspense>` вокруг контента (требование `useSearchParams`) |
| `frontend/admin/e2e/fixtures/helpers.ts` | E2E-хелперы | `navigateToWeek`/`openModal`/`openAddTab` → `page.goto` + реальные клики |
| `frontend/admin/e2e/{unify-caches,dayview-column-reorder,schedule-column-visibility,error-messages,visual-compliance-checks}.spec.ts` | E2E-спеки | Миграция на новые хелперы |
| Unit-тесты `ScheduleContext.test.tsx`, `Menubar.test.tsx`, `WeekView.test.tsx`, `DayView.test.tsx` | | Убрать event-сценарии, мок `useSearchParams` |

---

## Task 1: Pilot — real interactions (de-risk §4)

### Classification: standard
### Required Docs
- Spec §4 (тестовые хуки → реальные взаимодействия), §8 (риск flaky-кликов)

### Context
Главный риск issue. Цель — доказать, что клик по `ActivityCard` и клавиатурный reorder работают в Playwright **до** удаления событий. Ничего из production event-кода пока не удаляем — только добавляем `activationConstraint` и мигрируем ОДИН e2e-путь. Если не стабилизируется за 3 попытки — STOP, эскалация (fallback в spec §4).

### Files
- `frontend/admin/app/components/schedule/WeekView.tsx` (modify — sensors)
- `frontend/admin/app/components/schedule/DayView.tsx` (modify — sensors)
- `frontend/admin/e2e/schedule-column-visibility.spec.ts` (modify — pilot path)
- `frontend/admin/e2e/fixtures/helpers.ts` (add `gotoScheduleWeek`/`gotoScheduleDay`, не удаляя старые)

### Steps
- [ ] Добавить `activationConstraint: { distance: 5 }` в `PointerSensor` конфиг DnD в `WeekView` и `DayView` (сейчас `useSensors(useSensor(PointerSensor), useSensor(TouchSensor))` — проверить, где именно сконфигурены сенсоры: в компоненте или внутри `useDnD`).
- [ ] Добавить хелперы `gotoScheduleWeek(page, date)` / `gotoScheduleDay(page, date)` через `page.goto('/schedule?view=...&date=...')` рядом со старыми (URL-параметры пока читает никто — хелпер временно падает; поэтому в этом таске он ещё НЕ используется для навигации, только заготовка). **Уточнение:** навигацию в пилоте оставляем на существующем `navigateToWeek` (событие ещё живо); пилот проверяет только реальный КЛИК, не URL.
- [ ] Переписать в `schedule-column-visibility.spec.ts` открытие модалки/взаимодействие на реальный `card.click()` (вместо dispatch `__memo-open-modal`), оставив навигацию по неделе как есть.
- [ ] Прогнать `npm run test:e2e -- schedule-column-visibility` ≥3 раза подряд — стабильно зелёный.
- [ ] Reorder-пилот: в `dayview-column-reorder.spec.ts` заменить один кейс на клавиатурный reorder (focus заголовка + Space/Arrow/Space) — если `KeyboardSensor` нужен, добавить его в `DayView` сенсоры; прогнать ≥3 раза.

### Gate
Оба пилота стабильны → продолжаем. Иначе STOP + отчёт пользователю (что пробовали, какой fallback).

---

## Task 2: `useScheduleView` hook + tests

### Classification: standard
### Required Docs
- Spec §2 (целевая архитектура, сигнатура хука)

### Files
- `frontend/admin/hooks/useScheduleView.ts` (new)
- `frontend/admin/hooks/useScheduleView.test.ts` (new)

### Steps
- [ ] TDD: сначала `useScheduleView.test.ts` (мок `next/navigation`: `useSearchParams`, `useRouter`, `usePathname`):
  - невалидный/отсутствующий `view` → `'week'`; невалидная/отсутствующая `date` → сегодня
  - `currentWeek` = `getMonday(selectedDay)`
  - `setViewMode('day')` → `router.push` с `?view=day` (сохраняя `date`)
  - `setSelectedDay(d)` → push с `?date=<iso>` (сохраняя `view`)
  - `goToToday()` → `?date=<today>`, `view` не трогается
  - `prevPeriod`/`nextPeriod`: week → ±7 дней; day → ±1 день
- [ ] Реализовать хук по сигнатуре из spec §2 (валидация внутри, `formatDateISO`/`getMonday` из `@/lib/utils`).
- [ ] `npm run test -- useScheduleView` — зелёный.

---

## Task 3: Wire ScheduleContext to useScheduleView

### Classification: standard
### Required Docs
- Spec §2 (потребители — таблица), §3 (изменения по файлам)

### Context
Контракт `ScheduleContextType` сохраняется (поля `viewMode`, `selectedDay`, `setViewMode`, `setSelectedDay`, `prevPeriod`, `nextPeriod` проксируются из хука). Потребители контекста не трогаются.

### Files
- `frontend/admin/contexts/ScheduleContext.tsx` (modify)
- `frontend/admin/__tests__/ScheduleContext.test.tsx` (modify)

### Steps
- [ ] Удалить own state `viewMode`/`selectedDay` (`:146-147`).
- [ ] Удалить 6 event-эффектов (`:199-262`): `__memo-go-to-today`, `__memo-select-day`, `__memo-switch-to-day-view`, `__memo-switch-to-week-view`, dispatch `__memo-view-mode-changed`, dispatch `__memo-selected-day-changed`.
- [ ] Удалить локальные `prevPeriod`/`nextPeriod` реализации (`:430-460`) — брать из `useScheduleView`.
- [ ] Вызвать `useScheduleView()`, прокинуть его поля в `contextValue` (сохранив имена и типы).
- [ ] Добавить sync-эффект: при изменении `selectedDay`/`viewMode` из хука вызвать `selectDateRange(monday, sunday)` (URL → NavigationContext, однонаправленно). Убедиться, что `currentWeek`/`weekStart`/`weekEnd` берутся консистентно (сейчас `currentWeek` из `dateFrom` — оставить, т.к. NavigationContext синхронизируется).
- [ ] Обновить `ScheduleContext.test.tsx`: убрать проверки dispatch/listen событий, добавить мок `useScheduleView` (или `next/navigation`).
- [ ] `npm run test -- ScheduleContext` — зелёный.

---

## Task 4: Wire Menubar to useScheduleView / router

### Classification: small
### Required Docs
- Spec §2 (Menubar-строка таблицы), §6 US-3/US-4/US-5

### Files
- `frontend/admin/app/components/layout/Menubar.tsx` (modify)
- `frontend/admin/__tests__/Menubar.test.tsx` (modify)

### Steps
- [ ] Удалить mirror-state `viewMode`/`selectedDay` и 2 listener'а (`:471-489`).
- [ ] Удалить 4 dispatch'а (`:200`, `:203`, `:250`, `:255`).
- [ ] На `/schedule` (`usePathname`): `handleGoToToday`/day-select/day-double-click → вызовы `useScheduleView`. Вне `/schedule`: `router.push('/schedule?view=...&date=...')` (US-5 — клик по календарю ведёт на расписание).
- [ ] `viewMode`/`selectedDay` для рендера MiniCalendar брать из `useScheduleView` (на `/schedule`) либо из URL-параметров напрямую; вне `/schedule` — из `NavigationContext` (`dateFrom`), как сейчас.
- [ ] Обновить `Menubar.test.tsx`: убрать event-сценарии, мок `useSearchParams`/`usePathname`.
- [ ] `npm run test -- Menubar` — зелёный.

---

## Task 5: Remove test-only effects + KeyboardSensor

### Classification: small
### Required Docs
- Spec §3, §4

### Files
- `frontend/admin/app/components/schedule/WeekView.tsx` (modify)
- `frontend/admin/app/components/schedule/DayView.tsx` (modify)
- `frontend/admin/hooks/useColumnReorder.ts` (modify, если нужно для keyboard)
- `frontend/admin/__tests__/WeekView.test.tsx`, `DayView.test.tsx` (modify)

### Steps
- [ ] `WeekView`: удалить тестовый эффект (`__memo-open-modal`/`quick-add`/`close-modal`, аналог `DayView:104-134`).
- [ ] `DayView`: удалить оба тестовых эффекта (`:104-134` модальные, `:285-299` column-reorder).
- [ ] Закрепить `KeyboardSensor` для reorder (из Task 1) как штатный.
- [ ] Обновить unit-тесты обоих компонентов: убрать проверки, завязанные на тестовые события.
- [ ] `npm run test -- WeekView DayView` — зелёный.

---

## Task 6: Migrate remaining e2e helpers + specs

### Classification: standard
### Required Docs
- Spec §4 (таблица замен), §5 (E2E), §6 (сценарии)

### Context
Только после зелёного Task 1 (пилот доказал реальные взаимодействия). К этому моменту production-события уже удалены (Task 3–5) — старые хелперы сломаны, мигрируем все.

### Files
- `frontend/admin/e2e/fixtures/helpers.ts` (modify)
- `frontend/admin/e2e/unify-caches.spec.ts`, `error-messages.spec.ts`, `visual-compliance-checks.spec.ts` (modify)
- `frontend/admin/e2e/schedule-day-view.spec.ts` или `navigation.spec.ts` (add deep-link + back-button тесты — US-1, US-2, US-5)

### Steps
- [ ] `navigateToWeek` → `gotoScheduleWeek` (`page.goto('/schedule?view=week&date=...')`); удалить dispatch `__memo-switch-to-week-view`.
- [ ] `openModal`: навигация через `gotoScheduleWeek` + реальный `card.click()` (fiber-чтение activity для выбора карточки с записями — оставить); закрытие модалки — `Escape`/кнопка вместо `__memo-close-modal`.
- [ ] `openAddTab`: реальный клик по пустому слоту/кнопке (см. `admin-clicks-empty-slot.spec.ts` как образец) вместо `__memo-quick-add`.
- [ ] Мигрировать 5 спеков из инвентаря на новые хелперы.
- [ ] Добавить тесты: deep-link `/schedule?view=day&date=<с активностью>` (US-1); nextPeriod меняет URL + back возвращает (US-2); клик по календарю с `/records` → `/schedule` (US-5).
- [ ] Прогнать полный e2e schedule-набор — зелёный; visual-regression снапшоты без изменений.

---

## Task 7: Suspense boundary + docs + final verify

### Classification: small

### Files
- `frontend/admin/app/(main)/schedule/page.tsx` (modify)
- `PLAN.md` / `CHANGELOG.md` (update)

### Steps
- [ ] Обернуть контент `/schedule` в `<Suspense fallback={null}>` (требование `useSearchParams` в Next 14) — проверить, что рендер идентичен (visual snapshots не дрейфуют).
- [ ] `grep -rn "__memo-" app contexts hooks e2e` → пусто (DoD #138).
- [ ] `npm run test:all` — весь набор зелёный.
- [ ] Обновить PLAN.md/CHANGELOG.
- [ ] G7: предложить пользователю merge/PR/keep/discard.

---

## Definition of Done (из #138)

- [ ] `grep -rn "__memo-" app contexts hooks e2e` → пусто (включая e2e-хелперы)
- [ ] `/schedule?view=day&date=...` открывается deep-link'ом (US-1 зелёный)
- [ ] Все schedule e2e-сьюты зелёные без тестовых событий
- [ ] Контракт `useSchedule()` не изменился — существующие unit-тесты потребителей проходят без правок логики

## Open questions for G2

1. **Task 1 fallback:** если реальные клики по карточкам flaky даже с `activationConstraint` — согласны на единственный gated-хук за `NEXT_PUBLIC_E2E` (spec §4), или тогда останавливаемся и пересматриваем?
2. **Sensor location:** нужно подтвердить при реализации, сконфигурены ли dnd-сенсоры в `WeekView`/`DayView` или внутри `useDnD` (влияет на точечность Task 1) — это выяснится в первом же файле, отдельного решения не требует.
