# Design Spec — #139: generic DataTable вместо 8 копипастных таблиц

**Date:** 2026-07-17
**Issue:** [#139](https://github.com/mkosinov/memo/issues/139) — refactor(admin): generic DataTable — 8 копипастных таблиц по 450–600 строк (~3500 строк дублирования)
**Status:** Draft — pending review (G1)
**Related:** #140 (ClientsTable сидит на ClientsContext — мигрирует последней, после/вместе с #140), #131 ✅ (переименования колонок клиентов уже влиты)
**Type:** Refactor, admin frontend

---

## §1 Инвентаризация: что дублируется

| Таблица | Строк | Данные | Обработка данных |
|---|---|---|---|
| `records/RecordsTable.tsx` | 598 | `RecordsContext` (joined: records+activities+clients+payments) | client-side |
| `services/ServicesTable.tsx` | 590 | `useQuery(['services'])` | client-side |
| `photos/PhotosTable.tsx` | 556 | `useQuery` | client-side |
| `services/MaterialsTable.tsx` | 550 | `useQuery` | client-side |
| `locations/LocationsTable.tsx` | 536 | `useQuery(['locations'])` | client-side |
| `masters/MastersTable.tsx` | 515 | `useQuery` | client-side |
| `tags/TagsTable.tsx` | 450 | `useQuery(['tags'])` | client-side |
| `clients/ClientsTable.tsx` | ~230 | `ClientsContext` | **server-side** (page/sort/filters — параметры API) |

Дублируемая механика в каждой (кроме различий ниже):

1. **Видимость колонок**: `COLUMNS` конфиг + `useState` c ленивым чтением `localStorage['<entity>-columns']` + try/catch + `ColumnPicker` (уже shared).
2. **Поиск/фильтр по статусу**: локальный state + `useMemo`-фильтрация.
3. **Сортировка**: `sortField`/`sortDir` + идентичный компаратор (string → `localeCompare(…, 'ru')`, number → разность, boolean → true-first).
4. **Пагинация**: `page`/`pageSize` + `slice` + reset-эффект при смене фильтров.
5. **Dropdown действий строки**: `openDropdownId` state + меню «Редактировать/Архивировать/Удалить».
6. **Состояния**: loading-скелетон, `ErrorState` + `parseApiError`, empty-state.
7. **Модалки** create/edit: `editX`/`creatingX` state (сами модалки — per-entity, уже конфигурируются через `*Fields.tsx`).

Известные расхождения-баги (следствие копипасты):
- `TagsTable.tsx:87-89`: фильтр статуса объявлен в state и UI, но игнорируется в предикате.
- Два компонента с именем `ClientCardModal` — **не дубликаты** (проверено diff'ом): `clients/` — полная карточка с табами (210 строк), `records/` — упрощённая read-only (156 строк). Проблема — коллизия имён, а не копипаста. Решение в §5.

---

## §2 Целевой дизайн

Три строительных блока в `app/components/shared/table/`; фильтры и модалки остаются per-entity.

### 2.1 `ColumnDef<T>` — единый тип конфига колонки

```ts
interface ColumnDef<T> {
  key: string;
  label: string;
  width?: string;                     // tailwind-класс, как сейчас
  defaultVisible?: boolean;           // default true
  sortable?: boolean;                 // default true
  sortValue?: (row: T) => string | number | boolean | null | undefined;
                                      // default: (row) => row[key]
  render?: (row: T) => React.ReactNode;  // default: String(row[key] ?? '—')
}
```

`sortValue` закрывает случаи RecordsTable (сортировка по joined-полям: имя клиента, дата активности) без прокидывания join-логики в generic-код.

### 2.2 `useTableState<T>` — вся «механика» одним хуком

```ts
function useTableState<T>(opts: {
  storageKey: string;                 // 'locations-columns' — ключи БЕЗ миграции, совпадают с текущими
  columns: ColumnDef<T>[];
  rows: T[];                          // уже отфильтрованные per-entity фильтрами
  mode?: 'client' | 'server';         // default 'client'
  initialPageSize?: number;           // default 10
}): {
  // колонки
  visibleColumns: ColumnDef<T>[];
  visibleKeys: string[]; setVisibleKeys(keys: string[]): void;  // + запись в localStorage
  // сортировка
  sort: { field: string; dir: 'asc' | 'desc' } | null;
  toggleSort(field: string): void;
  // пагинация
  page: number; setPage(p: number): void;
  pageSize: number; setPageSize(s: number): void;
  totalPages: number;
  // результат (client mode: sorted + sliced; server mode: rows as-is)
  pageRows: T[];
}
```

- В `client`-режиме хук сортирует (единый компаратор из §1 п.3) и нарезает страницу; сброс `page → 0` при изменении входного массива `rows` по длине/ссылке фильтров — обязанность вызывающего через `useEffect` как сейчас, либо параметр `resetPageDeps` (решить на ревью плана; предпочтение — `resetPageDeps`).
- В `server`-режиме (`ClientsTable`) хук управляет только видимостью колонок; `sort`/`page` — controlled-поля, прокинутые снаружи (см. §4, этап 8).

### 2.3 `<DataTable<T>>` — презентационный компонент

```tsx
<DataTable
  columns={visibleColumns}
  rows={pageRows}
  rowKey={(r) => r.id}
  sort={sort} onSortToggle={toggleSort}
  isLoading={isLoading} error={error} onRetry={refetch}
  emptyText="Нет локаций"
  onRowClick={(row) => setEdit(row)}          // optional
  rowActions={(row) => <ActionItem …/>}       // optional; dropdown-обвязка внутри
  footer={<Pagination …/>}
/>
```

Внутри: header с sort-индикаторами, skeleton при `isLoading`, `ErrorState` при `error`, empty-state, dropdown действий (state `openDropdownId` + click-outside — внутри компонента). `ColumnPicker` остаётся отдельным (он и сейчас shared) и рендерится рядом с таблицей на странице, как сейчас.

### Что генерик НЕ делает (осознанно)

- **Фильтры** — остаются per-entity компонентами (`LocationFilters` и т.п.): наборы полей слишком разные, обобщение дало бы конфиго-DSL хуже копипасты. Контракт: страница фильтрует массив сама и отдаёт `rows` в хук.
- **Модалки create/edit** — уже решены паттерном `*Fields.tsx`, не трогаем.
- **Виртуализация/infinite scroll** — OUT, данных мало.

---

## §3 Ожидаемый эффект по объёму

Per-entity файл после миграции: конфиг колонок (`ColumnDef[]` с render'ами) + фильтр-предикат + вызовы хука/компонента + модалки ≈ 120–200 строк вместо 450–600. Суммарно ~2000–2500 строк дублирования уходит; generic-слой ≈ 400–500 строк с тестами.

---

## §4 План миграции (по одной таблице, каждая — отдельный зелёный коммит)

| Этап | Таблица | Причина порядка |
|---|---|---|
| 1 | shared-слой: `ColumnDef`, `useTableState`, `DataTable` + unit-тесты | фундамент, TDD |
| 2 | `TagsTable` | самая маленькая; **фикс бага фильтра статуса** — фильтр либо начинает работать, либо удаляется из UI (решить на ревью: у API тегов нет `is_active` в ответе → скорее удалить контрол) |
| 3 | `LocationsTable` | эталонная «средняя» таблица, есть полный unit-тест |
| 4 | `MastersTable` | аналогична 3 |
| 5 | `PhotosTable` | + специфика превью изображений в `render` |
| 6 | `MaterialsTable`, `ServicesTable` | соседи по странице services |
| 7 | `RecordsTable` | joined-данные → проверка достаточности `sortValue`/`render`; фильтры приходят props'ами — контракт не меняется |
| 8 | `ClientsTable` | server-mode; координация с #140 (если #140 уже распустил ClientsContext — хук страницы отдаёт controlled sort/page; если нет — controlled-поля из контекста). Допустимо вынести в #140 |

Каждый этап: существующие unit-тесты таблицы (`__tests__/LocationsTable.test.tsx` и др.) остаются **без правок логики ассертов** (правки только если ассерты завязаны на внутренние детали разметки) — это сетка безопасности рефакторинга. E2E `*-crud.spec.ts` — без изменений.

---

## §5 Коллизия ClientCardModal

Не сливать (компоненты разные по сути), а развести имена:
- `records/components/ClientCardModal.tsx` → переименовать в `ClientSummaryModal.tsx` (read-only сводка клиента из RecordsTable).
- `clients/components/ClientCardModal.tsx` — остаётся (полная карточка с табами Info/Records).
- Обновить импорты (`records/RecordsTable.tsx:7`) и тест `__tests__/ClientCardModal.test.tsx` (проверить, какой из двух он покрывает; при необходимости разнести на два файла).

---

## §6 Тесты

### Новые unit (shared-слой, TDD — пишутся первыми на этапе 1)
- `useTableState.test.ts`:
  - видимость колонок: default по `defaultVisible`, чтение битого JSON из localStorage → fallback, запись при `setVisibleKeys`;
  - сортировка: строки локалью `ru`, числа, boolean, `null`/`undefined` в хвост, `sortValue`-override, toggle asc→desc→(поле сменилось)→asc;
  - пагинация: `totalPages` при пустом массиве = 1, slice-границы, сброс страницы при смене `rows`;
  - server-mode: `pageRows === rows` (никакой обработки).
- `DataTable.test.tsx`: рендер header/rows по конфигу, sort-индикаторы, loading-скелетон, `ErrorState` с `onRetry`, empty-state, dropdown действий (открытие/click-outside), `onRowClick`.

### Существующие
- Per-table unit-тесты — зелёные без правок ассертов (см. §4).
- `TagsTable.test.tsx` — обновить под решение по фильтру статуса (этап 2).
- E2E: `tags-crud`, `locations-crud`, `masters-crud`, `photos-crud`, `services-crud`, `records.spec`, `clients.spec` — без изменений, прогон после каждого этапа.

---

## §7 User Scenarios → E2E

Новых пользовательских сценариев нет — рефакторинг сохраняет поведение. Существующие E2E-сценарии и есть спецификация:

| # | Сценарий | Покрытие |
|---|---|---|
| US-1 | CRUD каждой сущности через таблицу (создать/редактировать/архивировать) | существующие `*-crud.spec.ts`, без правок |
| US-2 | Скрыть/показать колонку → выбор переживает перезагрузку страницы | существующие тесты ColumnPicker (localStorage-ключи не меняются) |
| US-3 | Сортировка по колонке кликом на заголовок, повторный клик — обратный порядок | существующие unit-тесты таблиц |
| US-4 | Поиск + фильтр → пагинация сбрасывается на первую страницу | существующие unit-тесты таблиц |
| US-5 | (фикс) На `/tags` контрол фильтра статуса либо реально фильтрует, либо отсутствует | обновлённый `TagsTable.test.tsx` |

---

## §8 Scope — IN / OUT

### IN
- `app/components/shared/table/`: `ColumnDef`, `useTableState`, `DataTable` + unit-тесты
- Миграция 7 client-side таблиц (этапы 2–7)
- `ClientsTable` server-mode (этап 8; допустим перенос в #140 — зафиксировать при ревью плана)
- Фикс/удаление фильтра статуса TagsTable
- Переименование `records/ClientCardModal` → `ClientSummaryModal`

### OUT
- Обобщение фильтров и модалок (остаются per-entity)
- Роспуск ClientsContext и смена источников данных (#140)
- Виртуализация, изменение дизайна таблиц, новые фичи таблиц
- `localStorage`-миграции ключей колонок (ключи сохраняются как есть)

---

## §9 Open Risks

| Риск | Mitigation |
|---|---|
| Unit-тесты таблиц завязаны на детали разметки (классы/структура DOM) и покраснеют без смысловой регрессии | Разметку внутри `DataTable` держать максимально близкой к текущей (те же testid/классы ячеек); правки тестов допускаются только точечно с пометкой в коммите |
| `RecordsTable` не уложится в `ColumnDef` (joined-рендеры, статусные бейджи, вложенные модалки) | `render`/`sortValue` принимают row → произвольный JSX; этап 7 в конце — к этому моменту API обкатан на 5 таблицах; если не влезает — расширяем `ColumnDef`, а не форкаем таблицу |
| Одновременная работа над #140 конфликтует на ClientsTable | Этап 8 явно координируется: кто первый мержится, второй ребейзится; допустим перенос этапа 8 в #140 |
| Регресс производительности на больших списках из-за лишних перерендеров generic-слоя | Данных мало (справочники); `useMemo` на sorted/paged внутри хука — как в текущем коде; profiler-проверка на `RecordsTable` (самый большой набор) |
