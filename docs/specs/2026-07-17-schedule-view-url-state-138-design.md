# Design Spec — #138: убрать CustomEvent-шину `__memo-*` (view-state расписания → URL)

**Date:** 2026-07-17
**Issue:** [#138](https://github.com/mkosinov/memo/issues/138) — refactor(admin): убрать CustomEvent-шину `__memo-*` между Menubar и ScheduleContext (view-state → URL/layout)
**Status:** Draft — pending review (G1)
**Related:** #141 (распил ScheduleContext — этот spec выносит из него view-state), #140 (доступ к данным)
**Type:** Refactor, admin frontend + e2e infrastructure

---

## §1 Проблема и инвентаризация событий

`ScheduleProvider` смонтирован на странице `/schedule`, а `Menubar` — в layout, вне провайдера. Общее состояние (`viewMode`, `selectedDay`) синхронизируется через нетипизированные DOM-события на `document`, состояние дублируется по обе стороны шины.

Полный список событий `__memo-*` (10 штук):

| # | Событие | Направление | Dispatch | Listen |
|---|---|---|---|---|
| 1 | `__memo-go-to-today` | Menubar → ScheduleContext | `Menubar.tsx:200` | `ScheduleContext.tsx:203` |
| 2 | `__memo-select-day` | Menubar → ScheduleContext | `Menubar.tsx:203` | `ScheduleContext.tsx:219` |
| 3 | `__memo-switch-to-week-view` | Menubar → ScheduleContext | `Menubar.tsx:250` (+e2e) | `ScheduleContext.tsx:251` |
| 4 | `__memo-switch-to-day-view` | Menubar → ScheduleContext | `Menubar.tsx:255` (+e2e) | `ScheduleContext.tsx:236` |
| 5 | `__memo-view-mode-changed` | ScheduleContext → Menubar | `ScheduleContext.tsx:257` | `Menubar.tsx:483` |
| 6 | `__memo-selected-day-changed` | ScheduleContext → Menubar | `ScheduleContext.tsx:261` | `Menubar.tsx:484` |
| 7 | `__memo-open-modal` | **e2e-only** | `e2e/fixtures/helpers.ts:215` | `WeekView.tsx:73`, `DayView.tsx:126` |
| 8 | `__memo-quick-add` | **e2e-only** | `helpers.ts:263` | `WeekView.tsx:74`, `DayView.tsx:127` |
| 9 | `__memo-close-modal` | **e2e-only** | `helpers.ts:230` | `WeekView.tsx:75`, `DayView.tsx:128` |
| 10 | `__memo-column-reorder` | **e2e-only** | `dayview-column-reorder.spec.ts:82` | `DayView.tsx:295` |

E2E-потребители: `e2e/fixtures/helpers.ts`, `unify-caches.spec.ts`, `dayview-column-reorder.spec.ts`, `schedule-column-visibility.spec.ts`, `error-messages.spec.ts`, `visual-compliance-checks.spec.ts`.

События делятся на две категории с разными решениями:
- **№1–6 (навигационные)** — следствие неправильного места хранения view-state. Решение: URL (§2).
- **№7–10 (тестовые хуки)** — обход pointer-interception @dnd-kit в Playwright. Решение: реальные взаимодействия (§4).

---

## §2 Целевая архитектура: URL как источник правды

### Схема URL

```
/schedule?view=week|day&date=YYYY-MM-DD
```

| Параметр | Значения | Default (отсутствует/невалиден) | Семантика |
|---|---|---|---|
| `view` | `week` \| `day` | `week` | Режим отображения |
| `date` | ISO-дата | сегодня | В day-режиме — выбранный день; в week-режиме — любой день недели (неделя = `getMonday(date)`..+6) |

Что это даёт помимо снятия шины: deep-linking («скинуть ссылку на день»), рабочий back-button, тривиальная навигация в e2e (`page.goto`).

### Хук `useScheduleView()` — единственная точка чтения/записи

Новый файл `hooks/useScheduleView.ts`:

```ts
interface ScheduleView {
  viewMode: 'week' | 'day';        // из ?view, с валидацией
  selectedDay: Date;               // из ?date, с валидацией (fallback: сегодня)
  currentWeek: Date;               // производное: getMonday(selectedDay)
  setViewMode(mode): void;         // router.push с обновлённым ?view
  setSelectedDay(date): void;      // router.push с обновлённым ?date
  goToToday(): void;               // ?date=today (view не меняется)
  prevPeriod(): void; nextPeriod(): void;  // ±7 дней (week) / ±1 день (day)
}
```

- Реализация: `useSearchParams` + `useRouter().push` (навигация датами/режимом — это осмысленные шаги для истории браузера; back = предыдущая неделя).
- Валидация параметров — внутри хука (невалидный `view`/`date` → default, без крэша).
- `useSearchParams` в Next 14 требует `<Suspense>`-границу — добавить в `app/(main)/schedule/page.tsx` (страница и так client-side, boundary формальная).

### Потребители

| Компонент | Было | Станет |
|---|---|---|
| `ScheduleContext` | own state `viewMode`/`selectedDay` + 6 event-listeners/dispatchers (`:146-147, 199-262`) | вызывает `useScheduleView()`; поля `viewMode`, `selectedDay`, `setViewMode`, `setSelectedDay`, `prevPeriod`, `nextPeriod` в `ScheduleContextType` **сохраняются** (проксируются из хука) — потребители контекста не меняются |
| `Menubar` / `MiniCalendar` | зеркальный state через события (`:471-489`) + dispatch команд (`:200-255`) | на `/schedule` (по `usePathname`) вызывает `useScheduleView()` напрямую; вне `/schedule` MiniCalendar работает как сейчас через `NavigationContext` |
| `Topbar`, `Toolbar`, `WeekView`, `DayView` | `useSchedule()` | без изменений (контракт контекста сохранён) |

### Синхронизация с `NavigationContext`

`NavigationContext` (`dateFrom`/`dateTo`) остаётся как есть — его используют `/records` и запрос activities. На `/schedule` производный эффект в `ScheduleProvider` держит `NavigationContext` синхронным с URL: при изменении `?date` вызывается `selectDateRange(monday, sunday)`. Направление синхронизации **одно** (URL → NavigationContext), поэтому петля невозможна. Миграция `/records` на URL-параметры — OUT (кандидат в follow-up).

---

## §3 Изменения по файлам

| Файл | Изменение |
|---|---|
| `hooks/useScheduleView.ts` | **NEW** — хук из §2 + unit-тесты |
| `contexts/ScheduleContext.tsx` | − state `viewMode`/`selectedDay`, − 6 event-эффектов (`:199-262`), − `prevPeriod`/`nextPeriod` реализация (`:430-460`) → всё из `useScheduleView()`; + sync-эффект URL → NavigationContext |
| `app/components/layout/Menubar.tsx` | − зеркальный state и 2 listener'а (`:471-489`), − 4 dispatch'а (`:200-255`); `handleGoToToday`/`handleDaySelect`/`handleDayDoubleClick` → вызовы `useScheduleView()` (на `/schedule`) или `router.push('/schedule?...')` (с других страниц — клик по календарю ведёт на расписание, поведение уточнено в §6 US-5) |
| `app/components/schedule/WeekView.tsx` | − тестовый эффект `:50-81` |
| `app/components/schedule/DayView.tsx` | − тестовые эффекты `:109-128, 289-295`; + `KeyboardSensor` в dnd-kit сенсоры колонок (§4) |
| `app/(main)/schedule/page.tsx` | + `<Suspense>` вокруг содержимого |
| `e2e/fixtures/helpers.ts` | навигационные хелперы → `page.goto('/schedule?view=...&date=...')`; модальные хелперы → реальные взаимодействия (§4) |
| 6 e2e-спеков из §1 | миграция на новые хелперы |

---

## §4 Тестовые хуки (№7–10): замена на реальные взаимодействия

Причина существования — «@dnd-kit перехватывает pointer events». Разбор по событию:

| Событие | Замена | Обоснование |
|---|---|---|
| `__memo-quick-add` | реальный клик по пустому слоту | уже работает в `e2e/admin-clicks-empty-slot.spec.ts` — прецедент есть |
| `__memo-close-modal` | `Escape` / клик по кнопке закрытия | модалка — обычный DOM, dnd не при чём |
| `__memo-open-modal` | реальный клик по `ActivityCard` | dnd-kit различает click и drag по `activationConstraint` (distance/delay); если его нет — добавить `activationConstraint: { distance: 5 }` в сенсоры, после чего обычный `card.click()` в Playwright работает. Это и UX-фикс: сейчас случайный микро-drag может глотать клики |
| `__memo-column-reorder` | keyboard-DnD: добавить `KeyboardSensor` в `useColumnReorder`/DayView, в тесте — `focus` + `Space/Arrow/Space` | штатный механизм @dnd-kit; бонус — доступность reorder с клавиатуры |

Порядок миграции e2e — пилотный спек первым (`schedule-column-visibility.spec.ts` — использует только навигационное событие), затем остальные. Если реальный клик по карточке окажется нестабильным после добавления `activationConstraint` — стоп, обсуждение (fallback: единственный gated-хук за `NEXT_PUBLIC_E2E`, но это осознанное отступление от DoD, требует решения пользователя).

---

## §5 Тесты

### Unit (новые)
- `useScheduleView.test.ts`: парсинг/валидация параметров (невалидный view → week, невалидная date → today), `prevPeriod`/`nextPeriod` в обоих режимах, `goToToday` — с моком `next/navigation`.
- Обновить `ScheduleContext.test.tsx`, `Menubar.test.tsx`, `WeekView.test.tsx`, `DayView.test.tsx`: убрать сценарии с dispatch событий, добавить рендер с замоканным `useSearchParams`.
- `__tests__/CellHeight.Topbar.test.tsx`, `DateNavigation.test.ts` — проверка, что контракт `useSchedule()` не изменился (должны пройти без правок; правки = сигнал регрессии контракта).

### E2E
- Мигрированные хелперы: `gotoScheduleWeek(page, date)` / `gotoScheduleDay(page, date)` через `page.goto`.
- Новый сценарий deep-link: открыть `/schedule?view=day&date=<дата с активностью>` напрямую → day-view нужной даты (см. US-1).
- `visual-regression` / `week-view` снапшоты не должны измениться (view-state рефактор не трогает рендер).

---

## §6 User Scenarios → E2E

| # | Сценарий | Покрытие |
|---|---|---|
| US-1 | Админ открывает ссылку `/schedule?view=day&date=2026-07-20` → сразу видит day-view 20 июля | новый тест в `schedule-day-view.spec.ts` |
| US-2 | Админ в day-view листает `nextPeriod` → URL меняется на следующую дату; browser-back возвращает предыдущий день | новый тест (navigation.spec.ts) |
| US-3 | Клик по дню в MiniCalendar на `/schedule` → week-view нужной недели; double-click → day-view этого дня | существующие сценарии Menubar, ассерты по URL вместо событий |
| US-4 | Кнопка «Сегодня» из сайдбара → `?date=today`, выбранный день сброшен | существующий сценарий, обновлённые ассерты |
| US-5 | Клик по дню в MiniCalendar со страницы `/records` → переход на `/schedule?view=week&date=...` | новый тест (navigation.spec.ts) — **уточнение поведения**: сейчас событие уходит «в никуда» (ScheduleContext не смонтирован), после рефакторинга клик осмысленно ведёт на расписание |
| US-6 | Reorder колонок в day-view с клавиатуры (focus + Space/Arrow) | `dayview-column-reorder.spec.ts` (перепись) |

---

## §7 Scope — IN / OUT

### IN
- URL-параметры `view`/`date` на `/schedule`, хук `useScheduleView` + тесты
- Удаление всех 10 событий `__memo-*` и их слушателей из production-кода
- `activationConstraint` для dnd-сенсоров карточек, `KeyboardSensor` для reorder колонок
- Миграция `e2e/fixtures/helpers.ts` и 6 спеков
- Sync-эффект URL → `NavigationContext` на `/schedule`

### OUT
- Миграция `/records` на URL-параметры (follow-up)
- Любые изменения фетчинга/мутаций/кэшей ScheduleContext (#140, #141)
- Настройки сетки cellHeight/gridFrequency/workingHours (#141)
- Изменение визуального поведения schedule-grid

---

## §8 Open Risks

| Риск | Mitigation |
|---|---|
| Реальный клик по ActivityCard flaky в Playwright даже с `activationConstraint` | Пилот на одном спеке до массовой миграции; fallback описан в §4 (gated-хук, требует решения пользователя) |
| `router.push` на каждый prev/next-период раздувает историю браузера | Осознанно: back = прошлая неделя — желаемое поведение. Если раздражает — заменить на `replace` точечно (одно место в хуке) |
| Петля синхронизации URL ↔ NavigationContext | Синхронизация однонаправленная (URL → context), NavigationContext на `/schedule` никто больше не пишет — проверяется grep'ом `selectDateRange` |
| Двойной рендер при переходе по URL-параметрам (search params меняют весь route) | React Query кэш не сбрасывается (ключи те же), activities не перефетчиваются в пределах недели; профилировать на пилоте |
| Снапшоты visual-regression дрейфуют из-за Suspense-boundary | Boundary с `fallback={null}` вокруг уже клиентского контента — рендер идентичен; проверка на пилоте |

---

## §9 Definition of Done (из #138, уточнён)

- `grep -rn "__memo-" app contexts hooks e2e` → пусто (включая e2e — хелперы мигрированы)
- `/schedule?view=day&date=...` открывается deep-link'ом (US-1 зелёный)
- Все schedule e2e-сьюты зелёные без тестовых событий
- Контракт `useSchedule()` для потребителей не изменился (существующие unit-тесты потребителей без правок)
