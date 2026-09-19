# План: DataTable polish minors — озвучка гарда пикера + полная конвенция имён колонок (issue #227)

## Goal

Закрыть два живых минора ревью #139: (1) скринридер озвучивает гард «последней видимой колонки» в ColumnPicker через `aria-describedby` → скрытый текст, не меняя доступное имя контрола и не трогая решение §6.5 (без `disabled`/`aria-disabled`) и e2e; (2) полная конвенция «имя файла = имя экспорта» для всех `*Columns.tsx` — переименование `materialsColumns.tsx` и `recordsColumns.tsx` с правкой импортов. Пункт 1 issue (page-clamp) закрыт фактом — уже реализован и покрыт тестами (#139), в плане отсутствует.

## Architecture

Изменения только во фронтенд-слое представления админки: один общий компонент (`ColumnPicker.tsx` — добавление скрытого описания и атрибута-связки), два переименования файлов конфигурации колонок с правкой путей импорта (прод: `MaterialsTable.tsx`, `RecordsTable.tsx`; тесты: `recordsColumns.test.tsx`, `recordsTimeParity.test.ts`) и два новых юнит-кейса. Слои данных, API, состояние, схема БД — не затрагиваются. Доступное имя контролов не меняется, поэтому существующие тесты с точным сопоставлением имён остаются зелёными без правок.

## Tech Stack

React 18 (`useId`), TypeScript, Tailwind 3.4 (утилита `sr-only` — первое применение в проекте), Vitest + React Testing Library, Playwright (существующие e2e — только регрессия, без правок).

Поведенческая дельта живёт в спеке (`docs/specs/2026-09-19-datatable-polish-minors-227-design.md`, §4) и здесь не повторяется. Сценарии — из спеки §3 (S1–S3).

---

## Task 1: ColumnPicker — озвучка гарда (aria-describedby + sr-only) и два юнит-кейса

### Classification: small

### Required Docs

Спека `docs/specs/2026-09-19-datatable-polish-minors-227-design.md` §5.1 (механизм), §5.3 (тесты). Контекст решения §6.5 — комментарий в `frontend/admin/app/components/shared/ColumnPicker.tsx` (не менять).

### Что сделать

Сценарий: S1 (плюс регрессионная часть S2).

1. `frontend/admin/app/components/shared/ColumnPicker.tsx`:
   - `const uid = useId();` в теле компонента.
   - Пункт колонки рендерить как фрагмент (`<Fragment key={col.key}>`): внутри — текущий `<label>` без изменений; при активном гарде (`disabled = checked && lastVisible`, где `lastVisible = visibleKeys.length === 1`) сразу после label — `<span id={`${uid}-guard-${col.key}`} className="sr-only">Последняя видимая колонка — скрыть нельзя</span>`.
   - Чекбоксу защищённого пункта: `aria-describedby={disabled ? `${uid}-guard-${col.key}` : undefined}`. У незащищённых пунктов атрибут отсутствует и span не рендерится.
   - Имена экспортов, toggle-логика, стили гарда (opacity, cursor) — без изменений.
2. `frontend/admin/__tests__/ColumnPicker.test.tsx` — два новых кейса (§5.3):
   - «Гард активен» (одна видимая колонка): у чекбокса защищённого пункта есть `aria-describedby`; элемент с этим id содержит точный текст «Последняя видимая колонка — скрыть нельзя»; у незащищённых пунктов атрибута нет; контрольная проверка `getByRole('checkbox', { name: '…' })` находит по чистому названию колонки.
   - «Гард не активен» (две и более видимых колонок): ни у одного чекбокса нет `aria-describedby`, sr-only-описаний в DOM нет.

### DoD

- Оба новых кейса зелёные; вся существующая сюита юнит-тестов зелёная **без правок** (включая `DataTable.test.tsx` — кейс «last visible column is guarded» с `getByLabelText('Тег')`).
- `npm run lint` и typecheck зелёные в `frontend/admin`.

## Task 2: Переименование materialsColumns → materialColumns

### Classification: trivial

### Required Docs

Спека §5.2 (первый пункт), §3 S3.

### Что сделать

Сценарий: S3.

1. `git mv "frontend/admin/app/(main)/services/components/materialsColumns.tsx" "frontend/admin/app/(main)/services/components/materialColumns.tsx"` (экспорт `materialColumns` не меняется).
2. Правка пути импорта в единственном прод-импортёре: `frontend/admin/app/(main)/services/components/MaterialsTable.tsx`.

### DoD

- Glob-конвенция для папки services: имя файла = имя экспорта.
- Юнит-тесты таблицы материалов зелёные без правок; `npm run build` зелёный.

## Task 3: Переименование recordsColumns → recordColumns

### Classification: trivial

### Required Docs

Спека §5.2 (второй пункт — включён решением юзера на Gate B), §3 S3.

### Что сделать

Сценарий: S3.

1. `git mv "frontend/admin/app/(main)/records/components/recordsColumns.tsx" "frontend/admin/app/(main)/records/components/recordColumns.tsx"` (экспорт `recordColumns` не меняется).
2. Правки путей импорта (все три):
   - прод: `frontend/admin/app/(main)/records/components/RecordsTable.tsx`;
   - тесты: `frontend/admin/__tests__/recordsColumns.test.tsx:15`, `frontend/admin/__tests__/recordsTimeParity.test.ts:29`.

### DoD

- Конвенция «файл = экспорт» выполняется для всех девяти `*Columns.tsx` админки.
- Юнит-тесты записей (`recordsColumns.test.tsx`, `recordsTimeParity.test.ts`) зелёные — правятся только строки импорта.

## Task 4: Финальная верификация (регрессия S2)

### Classification: trivial

### Required Docs

Спека §3 S2 (границы регрессии, страховка по visual-regression-снапшотам).

### Что сделать

Сценарий: S2 (ничего не сломалось).

1. Полный локальный прогон: vitest-сюита админки, lint, typecheck, build.
2. Точечный e2e-прогон якоря гарда: `tags-crud.spec.ts` (клик по label единственной колонки с ожиданием no-op). Полная e2e-сюита — на PR CI; снапшоты `*-table-picker-open` не трогаются: `sr-only` — `position:absolute`, в раскладку не вмешивается. Если CI всё же покажет дрифт сверх порога — перегенерация этих снапшотов по протоколу спеки (S2), с пометкой в PR.

### DoD

- Vitest, lint, typecheck, build — зелёные; `tags-crud` e2e зелёный локально; PR-CI зелёный.
