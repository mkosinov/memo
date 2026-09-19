# Design Spec — #138: URL как источник правды для состояния страниц (schedule view-state, период records, календарь-навигатор)

**Date:** 2026-07-17 (draft), **rev2 2026-09-18**, **rev3 2026-09-19** (панель G1b, консолидация), **rev4 2026-09-19** (перезапуск completeness/consistency: оба PASSED_WITH_CONCERNS, находки свёрнуты), **rev5 2026-09-19** (решение G1b-диалога: basePath-gate заменён развязкой /clients, §2.5)
**Issue:** [#138](https://github.com/mkosinov/memo/issues/138) — refactor(admin): убрать CustomEvent-шину `__memo-*` между Menubar и ScheduleContext (view-state → URL/layout)
**Status:** Draft rev5 — Gate B (пользовательское OK)
**Supersedes:** docs/specs/2026-06-01-navigation-provider-design.md — её решение «MiniCalendar = кросс-страничный управляющий элемент периода» отменяется настоящей спекой (календарь становится навигацией + индикатором; период живёт в URL страниц)
**Related:** #141 (распил ScheduleContext — источники путей), #231/#232 (deep-link/фильтры — эта спека закладывает их конвенцию), #103 (переименование RecordsFilters — пересечение файла), #242 (копирование недели — координация по Toolbar)
**Type:** Refactor, admin frontend + e2e infrastructure
**Pilot evidence:** реальный клик по draggable-карточке dnd-kit открывает модалку — `1 passed (49.7s)`, прогон на playground 17.09 (§5.3)

---

## §1 Проблема и инвентаризация

`ScheduleProvider` смонтирован на странице `/schedule` (`app/(main)/schedule/page.tsx:37-39`), `Menubar` — в layout (`app/(main)/layout.tsx:56`), вне провайдера. Общее состояние (`viewMode`, `selectedDay`) синхронизируется через нетипизированные DOM-события на `document`; состояние дублируется по обе стороны шины (`ScheduleViewContext.tsx:49-51` и зеркало `Menubar.tsx:459-479`).

### Инвентаризация событий `__memo-*` (10 штук)

| # | Событие | Направление | Dispatch | Listen |
|---|---|---|---|---|
| 1 | `__memo-go-to-today` | Menubar → ViewContext | `Menubar.tsx:189` | `ScheduleViewContext.tsx:58` |
| 2 | `__memo-select-day` | Menubar → ViewContext | `Menubar.tsx:192` | `ScheduleViewContext.tsx:74` |
| 3 | `__memo-switch-to-week-view` | Menubar → ViewContext | `Menubar.tsx:239` (+e2e) | `ScheduleViewContext.tsx:106` |
| 4 | `__memo-switch-to-day-view` | Menubar → ViewContext | `Menubar.tsx:244` (+e2e) | `ScheduleViewContext.tsx:91` |
| 5 | `__memo-view-mode-changed` | ViewContext → Menubar | `ScheduleViewContext.tsx:112` | `Menubar.tsx:473` |
| 6 | `__memo-selected-day-changed` | ViewContext → Menubar | `ScheduleViewContext.tsx:116` | `Menubar.tsx:474` |
| 7 | `__memo-open-modal` | e2e-only | `e2e/fixtures/helpers.ts:225,251` | `WeekView.tsx:94-96`, `DayView.tsx:137-139` |
| 8 | `__memo-quick-add` | e2e-only | `e2e/fixtures/helpers.ts:292` | `WeekView.tsx:95`, `DayView.tsx:138` |
| 9 | `__memo-close-modal` | e2e-only | `e2e/fixtures/helpers.ts:241` | `WeekView.tsx:96`, `DayView.tsx:139` |
| 10 | `__memo-column-reorder` | e2e-only | `dayview-column-reorder.spec.ts:82` | `DayView.tsx:323` |

E2E-потребители событий: `e2e/fixtures/helpers.ts`, `unify-caches`, `dayview-column-reorder`, `dayview-slot-create`, `schedule-column-visibility`, `schedule-archived-visibility`, `schedule-empty-week`, `visual-compliance-checks`, `error-messages`, `server-push-offline`, `schedule-saving-toast`, `copy-last-week.spec.ts:136` (спека слитого #242 — **11 спеков** + хелперы). Юнит: `__tests__/schedule/ScheduleViewContext.test.tsx:308-430`.

**Причины — три независимых дефекта, объединённые общим DoD:**
1. События №1–6 — заплатка вокруг неправильного места хранения view-state (шина). Причина: `Menubar` вне провайдера.
2. События №7–10 — тестовые бэкдоры вокруг pointer-interception @dnd-kit. Причина — dnd, к шине не относится; склеены общим префиксом и одним grep-DoD.
3. E2E-навигация через №3/№4 — симптом шины (единственный канал смены периода из теста).

Смежная проблема того же корня: `NavigationContext` (layout, `dateFrom`/`dateTo` — «выбранный период») — второе хранилище пересекающегося состояния. Сегодня: расписание при навигации пишет глобальный период, /records следует за календарём; клики по календарю вне /schedule меняют период записей молча для пользователя, а view-поля дублируются шиной. Один источник правды отсутствует.

## §2 Целевая архитектура: URL как источник правды, по одной странице

Общий принцип (согласован на G1a): **период и режим просмотра живут в URL той страницы, которая их показывает**. Одна сущность — одно хранилище. Календарь в меню становится навигацией + индикатором периода *текущей* страницы. `NavigationContext` удаляется целиком — после переезда всех потребителей у него ноль потребителей.

### 2.1 `/schedule?view=&date=&col=`

| Параметр | Значения | Default (отсутствует/невалиден) | Семантика |
|---|---|---|---|
| `view` | `week` \| `day` | `week` | Режим отображения |
| `date` | `YYYY-MM-DD` | сегодня | week-режим: якорь (показывается неделя этой даты); day-режим: просматриваемый день |
| `col` | `masters` \| `locations` | `masters` | Набор колонок day-view (columnMode) |

Хук `hooks/useScheduleView.ts` — единственная точка чтения/записи (единственный писатель URL-полей расписания):

```ts
interface ScheduleView {
  viewMode: 'week' | 'day';   // из ?view, с валидацией
  selectedDay: Date;          // из ?date, с валидацией (fallback: сегодня)
  columnMode: 'masters' | 'locations';  // из ?col, с валидацией
  currentWeek: Date;          // производное: getMonday(?date)
  setViewMode(mode): void;    // router.push — навигация (история растёт)
  setSelectedDay(date): void; // router.push — навигация
  setColumnMode(mode): void;  // router.replace — переключатель отображения, историю не пачкает
  goToToday(): void;
  prevPeriod(): void; nextPeriod(): void;  // ±7 дней (week) / ±1 день (day), router.push
}
```

- Реализация: `useSearchParams` + `useRouter()`. Политика истории: навигационные шаги (`view`, `date`, prev/next, goToToday) — `push` (back = предыдущая неделя); `col` — `replace` (переключатель отображения не создаёт шагов истории).
- **Валидация (формализовано):** `view`/`col` — точное совпадение с enum (`week`|`day`, `masters`|`locations`, регистр значим, пустая строка = отсутствие); `date` — строго `YYYY-MM-DD` и валидная дата (`2026-02-31`, `2026-13-01`, значения с временем/таймзоной — отвергаются; литерал `today` не поддерживается). Всё невалидное → default (`view=week`, `col=masters`, `date=сегодня`) **молча, без UI-ошибки**.
- **Осведомлённость о маршруте не нужна — связь разорвана (§2.5):** провайдер расписания монтируется только на `/schedule`; на `/clients` остаётся лишь `GridSettingsProvider` (см. §2.5). Хук не проверяет pathname.
- **Канонический вывод недели:** `currentWeek = getMonday(?date)` — единственная точка вычисления. Формула не новая: это существующий `getMonday` из `lib/datetime` (понедельник — устоявшаяся конвенция репо: неделя сетки ПН–ВС, инициализация NavigationContext, сид-данные); #138 не выбирает метод, а оставляет один вызов вместо трёх самодельных. `ScheduleDataContext` (диапазон фетча) и `Toolbar` (якорь popover копирования, #242) читают производные хука, свои вычисления из `dateFrom` убирают. Координация с #242 закреплена контрактом: «viewed week» = неделя `?date`.
- **Один писатель:** все записи URL-полей расписания идут через хук (внутри — единый сериализованный helper «обнови параметр, сохранив остальные»); e2e US-2 ассертит «одно взаимодействие = одна запись истории».
- `goToToday()` сохраняет текущий режим (day остаётся day) и ставит `date=сегодня` — сегодняшнее поведение Topbar/Menubar сохраняется. Push к идентичному URL записи истории не создаёт.
- `useSearchParams` в Next 14 требует `<Suspense>`-границу — добавляется по прецеденту `clients/page.tsx:136-138` / `login/page.tsx:27-33` (все пути — относительно `frontend/admin`).

**Потребители и writers:**

| Компонент | Было | Станет |
|---|---|---|
| `ScheduleViewContext.tsx` | own state `viewMode`/`selectedDay`/`columnMode` (`:49-51`) + 4 слушателя + 2 диспетчера (`:54-117`); currentWeek из NavigationContext (`:33-39`); prev/nextPeriod пишут NavigationContext (`:119-149`) | view-поля **проксируются** из `useScheduleView()`; `stamp`, `filterMasterIds`, `filterLocationIds` — без изменений (локальный state); event-эффекты удалены; контракт `ScheduleViewContextType` для потребителей внутри провайдера **не меняется** |
| `Topbar.tsx` | `useNavigation` (`:53`) + `selectDateRange` в `handleViewModeSwitch` (`:108`) и `handleCalendarDateSelect` (`:147-162`) | те же хендлеры работают через сеттеры хука (день-режим по-прежнему якорится на «сегодня, если неделя текущая» — логика переносится в хук); CalendarPopover не меняется; **выбор даты в week-режиме меняет только `?date`, `view` не трогает** (сегодняшнее поведение) |
| `page.tsx` | `useScheduleView().viewMode` из контекста | без изменений (контракт сохранён) |
| `WeekView`/`DayView`/`StampPanel` | контекст | без изменений |
| `Menubar` | зеркальный state (`:459-479`) + 4 dispatch (`:184-245`) + `handleWeekSelect` → `selectDateRange` (`:483-487`) | зеркала и dispatch'ей нет; хендлеры → `router.push('/schedule?...')` (см. §2.3); подсветка — из URL (см. §2.3) |

### 2.2 `/records?from=&to=` — период записей в URL

- `RecordsFilters.tsx`: date-инпуты «Фильтр по дате от/до» (`:141-156`, aria-label сохраняются) пишут **`router.replace`** (правки фильтров частые — не пачкать историю; deep-link сохраняется). Кнопка сброса к текущей неделе (`:120`) — сегодняшнее поведение сохраняется целиком: чистит остальные фильтры И возвращает даты к дефолту (очистка обоих параметров).
- **Валидация/семантика пары (формализовано):** `from`/`to` — строго `YYYY-MM-DD`; пустая строка = «параметра нет»; **`from > to` — пара невалидна, обе стороны откатываются к дефолту** (текущая неделя; то же правило «невалидное → дефолт», что и на /schedule); правка одного инпута **сохраняет** вторую сторону (делибельная ссылка с «половинчатым» фильтром допустима — сегодняшнее поведение). Кнопка сброса удаляет оба параметра из URL (дефолт при чтении = текущая неделя) — её семантика сознательно отличается от ручной правки: сброс = «сбросить период целиком».
- Инвариант ключей: «нет параметров → фетч-ключ равен строкам monday..sunday текущей недели» — пинится юнит-тестом (сегодня `NavigationContext` инициализируется этой же парой, `contexts/NavigationContext.tsx:14-25`).
- `RecordsContext.tsx`: `dateFrom`/`dateTo` читаются из searchParams (`:64` — переезд); fetch-ключ `(qk.records[0], page, perPage, dateFrom, dateTo, filters, sortBy, sortOrder)` (`:81`) сохраняет формат строк — React Query ключи и инвалидации (#239 SSE) не меняются. First-paint deep-link (`?from=2024-01-01`) защищён Suspense-границей страницы — до резолва searchParams фетч не стартует с дефолтным диапазоном.
- Остальные фильтры записей (мастер/локация/услуга/статус/поиск — `RecordFilters` в RecordsContext) остаются в контексте; их переезд — следующий шаг конвенции (#231/#232), не этот issue.
- Дефолт без параметров: текущая неделя (сегодняшняя логика `RecordsFilters.getCurrentWeekRange()` `:28-34` остаётся дефолтом при чтении).
- Обнаружен факт: компонент уже носит имя `RecordsFilters.tsx` (`app/(main)/records/components/`); параллельный #103 аудитит тот же файл — спека ссылается по роли, имя может смениться.

### 2.3 Календарь в меню: навигация + индикатор

`MiniCalendar` перестаёт быть управляющим элементом периода (решение G1a «согласовано»):

- **Механизм чтения периода (канон Next.js):** `Menubar` (layout) не перерисовывается при смене searchParams, но клиентский компонент внутри него, вызывающий `useSearchParams`, — перерисовывается с актуальными параметрами. `MiniCalendar` читает период **текущей страницы** через `useSearchParams` под `<Suspense fallback={null}>` в layout-дереве. Альтернативы отвергнуты: пропсами сверху нельзя (у layout и страницы нет общего предка с данными), общий стор = пересоздание `NavigationContext`, который эта спека удаляет. Следствие: пропсы `selectedWeek`/`selectedDay`/`viewMode`/`onWeekSelect` у `MiniCalendarProps` (`Menubar.tsx:92-98`) **удаляются** — все данные компонент берёт из searchParams, внешних входов больше нет.
- **Клик по дню** (на любой странице) → `router.push('/schedule?view=week&date=<день>')`; **double-click** → `router.push('/schedule?view=day&date=<день>')`. Push к идентичному текущему URL новой записи истории не создаёт (штатное поведение роутера). Хендлеры `handleDayClick`/`handleDayDoubleClick` (`:237-245`), `handleGoToToday` (`:184-194`) — переписываются на push; **`handlePrevMonth`/`handleNextMonth`/month-picker** (`:168-179`, month-picker `:236-249`) — **локальное состояние отображаемого месяца**, синхронизируемое с периодом страницы ПРИ КАЖДОЙ навигации (не только на маунте: ушёл на /records — календарь показывает месяц `?from`, кликнул день — показывает месяц `?date`); `handleWeekSelect` (`:483-487`) и все записи в NavigationContext исчезают.
- **Подсветка = зеркало периода текущей страницы** (searchParams той же страницы). Названия классов-инвариантов в спеке условны: сегодня подсветка — это Tailwind-строки и inline-логика (`bg-brand/30` на строке недели `Menubar.tsx:272-278`, inline-toggle дня `:287-293`), переиспользуется логика, а не имена классов:
  - на `/schedule` (?date присутствует): подсветка недели/дня из `?view=&date=` (логика `:367-395`, питается от хука);
  - на `/records` при явных `?from=&to=` (валидной паре): дни диапазона получают класс-подсветку диапазона (полупрозрачный красный фон, отдельные классы «начало»/«конец» — края читаются явно, вид «[5 6 7]»); диапазон длиннее месяца виден срезом видимого месяца; отображаемый месяц инициализируется месяцом `?from`;
  - на остальных страницах и при отсутствии/невалидности параметров: нейтральная подсветка недели от `new Date()`, без день-подсветки.
  - Подсветка диапазона **появляется только при явных валидных параметрах** в URL (дефолтная текущая неделя records не раскрашивается красным).
- Листание месяца не пишет ни URL, ни историю; day-click с touch-устройств (нет dblclick) ведёт на week-view — сегодняшнее ограничение сохраняется без изменений.

### 2.4 Удаление `NavigationContext`

Все потребители (полный список, grep `useNavigation`):

| Файл | Сегодня | Станет |
|---|---|---|
| `RecordsContext.tsx:64` | читает dateFrom/dateTo | читает searchParams |
| `RecordsFilters.tsx:50` | читает+пишет selectDateRange | читает searchParams, пишет router.replace |
| `ScheduleDataContext.tsx:95` | читает dateFrom/dateTo | читает производные monday/sunday из `useScheduleView` (те же строки → ключи кэша идентичны) |
| `ScheduleViewContext.tsx:33` | читает+пишет | всё из хука (см. §2.1) |
| `Topbar.tsx:53` | пишет selectDateRange | сеттеры хука |
| `Menubar.tsx:370` | читает dateFrom + пишет selectDateRange | читает searchParams; писателя нет |
| `Toolbar.tsx:53` | читает dateFrom (якорь popover копирования недели, #242) | якорь из `useScheduleView().currentWeek` (координация с #242 — см. §8) |

Файл `contexts/NavigationContext.tsx`, его монтирование в `(main)/layout.tsx` (импорт `NavigationProvider`, `:6`/`:93-95`) и тест `__tests__/NavigationContext.test.tsx` удаляются. Юнит-тесты переписываются на мок URL-слоя — **итог по тест-файлам: удалить 1, обновить 12** (grep `NavigationProvider|useNavigation` в `__tests__/` = 13 файлов): удаляется `NavigationContext.test.tsx`; обновляются `RecordsFilters.test.tsx:25`, `RecordsContext.test.tsx:41`, `schedule/ScheduleViewContext.test.tsx:5,135`, `Menubar.test.tsx`, `StampPanel.test.tsx`, `CellHeight.Topbar.test.tsx`, `Topbar.test.tsx`, `page.test.tsx`, `scheduleIntegration.test.tsx`, `optimisticUpdate.test.tsx`, `schedule/ScheduleDataContext.test.tsx`, `Toolbar.test.tsx` + тест-хелперы `helpers/mockContexts.ts:82` и `helpers/splitScheduleOverrides.ts:55` (подтверждённые потребители `setCurrentWeek` — удаление поля из контракта затрагивает их). Из контракта `ScheduleViewContextType` удаляется вестигиальный `setCurrentWeek` (prod-потребителей нет — grep подтверждён). Критерий DoD — grep `useNavigation|NavigationContext` (не только `useNavigation`). **Номера строк в спеке зафиксированы на момент написания; при планировании и IMPL все адреса перепроверять grep'ом** (часть номеров §1/§2 к моменту ревью уже дрейфовала — множество подтверждено, отдельные разошлись).

Суффикс-правило конвенции (запечатано на G1a): **фильтры любой табличной страницы в перспективе живут в её URL**; каждая следующая страница (clients, staff, photos, каталоги, будущие «оплаты») повторяет паттерн schedule/records; календарь автоматически становится индикатором её периода. Для третьей и последующих страниц паттерн сводится в общий хук (правило трёх).

### 2.5 Развязка /clients: провайдеру расписания там не место

Панель нашла, что `ScheduleProvider` смонтирован на двух маршрутах (`clients/page.tsx:135`). Разбор живьём: **ни один компонент зоны /clients не потребляет view/data-слои расписания** — единственный потребитель из расписания это `ClientRecordTab.tsx:19,35`, берущий `useGridSettings()` (настройка `gridFrequency`, персист в localStorage). Полное дерево провайдера (GridSettings → View → Gate → Data) тянуло на /clients два мёртвых слоя.

Решение (вместо basePath-проверок в хуке — решение G1b-диалога): монтировка на /clients заменяется точечным `<GridSettingsProvider>` (экспортируется отдельно, `GridSettingsContext.tsx:50`). Слои View/Gate/Data на /clients больше не монтируются — хук `useScheduleView` остаётся одноразовым (/schedule), pathname-проверки не нужны. Бонус, проверить на IMPL: вместе с Data-слоем с /clients уходит возможный лишний activities-фетч за текущую неделю при каждом открытии страницы клиентов.

### 2.4а Миграция e2e-хуков №7–10 на реальные взаимодействия

| Событие | Замена | Обоснование |
|---|---|---|
| `__memo-quick-add` | реальный клик по пустому слоту | уже работает: `e2e/admin-clicks-empty-slot.spec.ts` (click с fallback), `dayview-slot-create.spec.ts:80` (чистый клик) |
| `__memo-close-modal` | клик по `details-modal-backdrop` | бэкдроп имеет onClick→onClose (`ActivityDetailsModal.tsx:50-53`); Escape в модалке не подключён — факт пилота, Escape не добавляем (без нового поведения) |
| `__memo-open-modal` | реальный клик по ActivityCard | **пилот пройден** (§5.3): `activationConstraint: { distance: 5 }` уже стоит (`WeekView.tsx:180`, `DayView.tsx:366`), клик проходит в onClick |
| `__memo-column-reorder` | `KeyboardSensor` в сенсорах DayView **с `sortableKeyboardCoordinates` из `@dnd-kit/sortable`** (без координатного геттера стрелки двигают drag-оверлей на 25px, а не переставляют) + фокусируемые активаторы колонок + тест focus+Space/стрелки/Space | штатный механизм @dnd-kit; бонус — доступность reorder |

Порядок миграции e2e — пилотный спек первым (`schedule-column-visibility.spec.ts` — только навигационное событие), затем остальные. Хелперы `e2e/fixtures/helpers.ts`: навигационные → `page.goto('/schedule?view=...&date=...')`; модальные → реальные взаимодействия.

## §3 Behavioral Delta (before → after)

| # | Было | Стало |
|---|---|---|
| Д1 | Ссылку на конкретный день/вид расписания дать нельзя | `/schedule?view=day&date=2026-10-01&col=masters` открывается по ссылке, вид воспроизводится |
| Д2 | Back из расписания «вываливает» из приложения | Back возвращает к предыдущему периоду/виду (push-навигация) |
| Д3 | Клик по дню календаря вне /schedule — событие «в никуда» (кроме week-click, молча менявшего период записей) | Клик по календарю всегда открывает `/schedule` на неделе кликнутой даты; double-click — на дне |
| Д4 | Период общий: расписание/календарь меняли диапазон записей (и наоборот через фильтры записей) | Периоды независимы: у каждой страницы свой период в её URL; связка «страницы делят период» убрана |
| Д5 | Период записей не виден нигде, кроме самих фильтров | `/records?from=&to=` делибелен; календарь подсвечивает диапазон красным с видимыми краями |
| Д6 | Календарь «помнит» последний день расписания на чужих страницах (зеркало шины) | Подсветка календаря = период текущей страницы; вне периодных страниц — нейтральная текущая неделя |
| Д7 | Тестовые события `__memo-open-modal`/`close`/`quick-add`/`column-reorder` вшиты в продакшен-компоненты | Реальные взаимодействия (клик по карточке, клик по бэкдропу, клик по слоту), reorder — с клавиатуры (KeyboardSensor, бонус-a11y) |
| Д8 | URL чистый на всех страницах | Адресная строка несёт состояние: `/schedule?...`, `/records?from=&to=` |
| Д9 | Возврат на /records через меню: период «выживал», но это был общий с расписанием период (расписание его двигало) | Возврат через меню — дефолт (текущая неделя, фильтры пустые — для фильтров как сегодня); возврат через «Назад» — период восстанавливается из URL (новое). «Помнить период на уровне пользователя» — отдельная фича вне скоупа |

## §4 Изменения по файлам

| Файл | Изменение |
|---|---|
| `hooks/useScheduleView.ts` | **NEW** — хук из §2.1 + unit-тесты |
| `contexts/schedule/ScheduleViewContext.tsx` | − view-state, − 6 event-эффектов (`:54-117`), − NavigationContext (`:33-39`), − prev/nextPeriod (`:119-149`) → проксирование из хука; stamp/filter* без изменений |
| `app/components/layout/Menubar.tsx` | − зеркальный state и 2 слушателя (`:459-479`), − 4 dispatch (`:184-245`), − `handleWeekSelect` (`:483-487`); хендлеры календаря → `router.push('/schedule?...')`; MiniCalendar: подсветка из searchParams, + классы диапазона, локальный месяц |
| `app/components/layout/Topbar.tsx` | `handleViewModeSwitch`/`handleCalendarDateSelect` → сеттеры хука (selectDateRange уходит) |
| `app/components/layout/Toolbar.tsx` | якорь popover копирования недели из `useScheduleView().currentWeek` (был NavigationContext) |
| `contexts/schedule/ScheduleDataContext.tsx` | диапазон фетча из производных хука (те же строки) |
| `contexts/NavigationContext.tsx` | **DELETE** (+ монтирование в `(main)/layout.tsx:93-95`, + `__tests__/NavigationContext.test.tsx`) |
| `app/(main)/records/components/RecordsFilters.tsx` | date-инпуты → router.replace с `?from=&to=`; сброс → очистка параметров |
| `contexts/RecordsContext.tsx` | dateFrom/dateTo из searchParams (`:64`) |
| `app/(main)/records/page.tsx` | `<Suspense>`-граница (useSearchParams в дереве) |
| `app/(main)/schedule/page.tsx` | `<Suspense>` вокруг содержимого (useSearchParams в дереве) |
| `app/(main)/clients/page.tsx` | `<ScheduleProvider>` → `<GridSettingsProvider>` (§2.5); существующий Suspense остаётся |
| `WeekView.tsx` / `DayView.tsx` | − тестовые эффекты (`WeekView:94-100`, `DayView:137-143`, `DayView:323-325`); + KeyboardSensor с `sortableKeyboardCoordinates` и фокусируемыми активаторами в сенсоры DayView (`:365-367`/`:373-376`) |
| `e2e/fixtures/helpers.ts` + **12 файлов** | `navigateToWeek`/`openModal`/`quickAdd` → реальные взаимодействия/page.goto (`:44-57`, `:165+`, `:292`); 11 e2e-спеков из §1 **+ `copy-last-week.spec.ts:136`** (инвентарь rev2 был неполон — файл принадлежит слитому #242) |
| `__tests__` | `ScheduleViewContext.test.tsx` (тесты событий `:308-430` → тесты хука), `RecordsFilters.test.tsx`/`RecordsContext.test.tsx` (моки URL), Menubar/Topbar/StampPanel/page/scheduleIntegration/optimisticUpdate/ScheduleDataContext тесты (моки NavigationProvider → URL), Menubar unit — при необходимости |

## §5 Тесты

### 5.1 Unit
- `useScheduleView.test.ts`: парсинг/валидация (`view`/`col` вне enum → default, битая/частичная `date` → сегодня, литерал `today` отвергается), prev/next в обоих режимах, goToToday сохраняет режим, политика push (view/date) vs replace (col).
- `ScheduleViewContext.test.tsx`: событийные тесты (`:308-430`) → контрактные (проксирование полей, stamp/filter*); заводится мок-фикстура `createMockUseScheduleView` (аналог существующего `createMockScheduleView`) — хук мокается в одном месте, тесты событий переписываются на него.
- `RecordsFilters.test.tsx` / `RecordsContext.test.tsx`: мок NavigationContext → мок searchParams/router; сценарии «инпут меняет URL (replace)», «сброс чистит параметры + фильтры», «пара from>to → дефолт», «пустые строки = отсутствие», «нет параметров → ключ фетча = monday..sunday».
- `NavigationContext.test.tsx` — удалён вместе с контекстом; остальные 9 тест-файлов (список в §2.4) — моки обновляются.

### 5.2 E2E
- Новые сценарии: §6 US-1–US-5; **US-2 ассертит «одно взаимодействие = одна запись истории»** (одиночный писатель — защита от двойного push).
- Мигрированные хелперы: `gotoScheduleWeek(page, date)` / `gotoScheduleDay(page, date)` через `page.goto`.
- Существующие records-спеки, работающие с датами через `input[aria-label="Фильтр по дате от/до"]` (`records-view.spec.ts:517-530`), сохраняют локаторы и `waitForResponse` — меняется только транспорт значения (URL вместо контекста), API-запросы те же.
- visual-regression снапшоты не меняются (Suspense-boundary с `fallback={null}` вокруг уже клиентского контента).

### 5.3 Пилот (выполнен 17.09, playground)
- Спека «реальный клик по draggable ActivityCard → модалка»: **1 passed (49.7s)** — клик, бэкдроп-клик закрытие, повторный клик. `activationConstraint` уже в коде, реальные клики стабильны.
- Факт: Escape в `ActivityDetailsModal` не подключён — закрытие реальными средствами (бэкдроп/кнопки), Escape в скоуп не добавляем.
- Урок инфраструктуры: e2e против плейграунда требует полного `localhost` (испечённый `NEXT_PUBLIC_API_URL`), иначе SameSite-cookie молча теряется.
- **Пилот перегоняется повторно после миграции** (клик по карточке теперь идёт через push-навигацию и Suspense-рендер) — в DoD (§9).

## §6 User Scenarios → E2E

| # | Сценарий | Покрытие |
|---|---|---|
| US-1 | Админ открывает ссылку `/schedule?view=day&date=...` → day-view нужного дня | новый тест (deep-link) |
| US-2 | Листание недели кнопками → URL меняется; browser-back → предыдущая неделя | новый тест (navigation) |
| US-3 | Клик по дню в календаре со страницы /records → открывается `/schedule`, week-view недели даты; double-click → day-view дня | новый тест |
| US-4 | На /records задать «дата от/до» → URL получает `?from=&to=`; календарь подсвечивает диапазон (красный, края видны) | новый тест + правка существующих records-спеков минимальна |
| US-5 | Поделиться ссылкой /records с периодом → у получателя тот же диапазон и та же подсветка | новый тест |
| US-6 | Перестановка колонок day-view с клавиатуры (focus + Space/стрелки) | перепись `dayview-column-reorder.spec.ts` |
| US-7 | Клик по карточке занятия открывает детали; клик по фону закрывает | миграция существующих спеков с хука на реальные клики |

## §7 Scope — IN / OUT

### IN
- URL-параметры `/schedule` (`view`/`date`/`col`), хук `useScheduleView` + тесты
- URL-параметры `/records` (`from`/`to`) — только даты; фетч RecordsContext из URL
- Развязка /clients: `<ScheduleProvider>` → `<GridSettingsProvider>` (§2.5)
- Удаление всех 10 событий `__memo-*` и их слушателей из production-кода
- `KeyboardSensor` для reorder колонок
- Миграция `e2e/fixtures/helpers.ts` и 11 спеков (вкл. `copy-last-week.spec.ts` — его `__memo-switch-to-week-view` заменяется на `page.goto('/schedule?view=week&date=...')`)
- Календарь: навигация на `/schedule`, подсветка периода текущей страницы (диапазонные классы)
- **Удаление `NavigationContext` целиком** (контекст + провайдер + тест, 7 потребителей переписаны)

### OUT
- Остальные фильтры /records (мастер/локация/услуга/статус/поиск) в URL — следующий шаг конвенции (#231/#232)
- Фильтры остальных страниц (clients, staff, photos, каталоги) — по той же конвенции, отдельными issue
- Будущая страница «оплаты» — рождается сразу с URL-фильтрами (не в этом issue)
- Фетчинг/мутации/кэши schedule (identity ключей сохранена), настройки сетки cellHeight/gridFrequency (#141), stamp/filter* view-контекста
- Escape-закрытие модалки деталей (не подключено и не подключается в этом issue)
- Семантика копирования недели (#242) — только координация якоря (§8)

## §8 Open Risks

| Риск | Mitigation |
|---|---|
| Реальный клик по карточке flaky | Пилот пройден (§5.3) — активный риск закрыт; остаточный — KeyboardSensor (штатный API, верифицируется юнит+e2e на IMPL) |
| Двойной рендер при push-переходах (searchParams меняют route) | React Query ключи строковые те же —activities не перефетчиваются в пределах недели; проверить на пилоте IMPL |
| Suspense-boundary дрейф visual-снапшотов | Boundary `fallback={null}` вокруг клиентского контента — рендер идентичен; прецедент clients/login |
| Menubar читает searchParams в layout (static-render ограничение Next 14) | Канон: layout не перерисовывается, но клиентский компонент с `useSearchParams` внутри — да (подтверждено доками Next.js). `<Suspense>` вокруг читающих поддеревьев layout — **вся Menubar может потребовать границы** (она уже использует `usePathname`), не только MiniCalendar; проверка компиляции на IMPL |
| Ключи records-кэша при переезде | `dateFrom`/`dateTo` остаются строками ISO в том же формате (`RecordsContext.tsx:81-86`) — ключи и SSE-инвалидация (#239) не меняются; инвариант «нет параметров = monday..sunday» пинится юнит-тестом |
| Координация с #242 (копировать прошлую неделю): Toolbar-якорь | Кто мержится вторым, тот перепривязывает якорь (`dateFrom` → `currentWeek` хука); один файл, механическая правка |
| Файл RecordsFilters переименуется в #103 | Спека ссылается по роли; план берёт имя файла на момент IMPL |

## §9 Definition of Done (из #138, уточнено)

- `grep -rn "__memo-" app contexts hooks e2e` → пусто (включая e2e — хелперы и все 11 спеков мигрированы)
- `grep -rn "useNavigation\|NavigationContext" app contexts` → пусто (контекст удалён)
- `/schedule?view=day&date=...` и `/records?from=...&to=...` открываются deep-link'ами (US-1, US-5 зелёные)
- Все schedule/records e2e-сьюты зелёные без тестовых событий
- Контракт `ScheduleViewContextType` для потребителей не изменён, кроме удаления вестигиального `setCurrentWeek`
- Пилот «клик по карточке → модалка» зелёный повторно — уже на URL-архитектуре
- Все пути в плане задач указываются от `frontend/admin/` (монорепо)
