# Schedule slot-create + empty-week grid Implementation Plan (#258+#259)

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вернуть создание занятия кликом по свободному слоту (через новый режим `create` в `ActivityDetailsModal`, с предзаполнением дня/времени) и убрать особый случай «пустая неделя» — сетка рендерится всегда с подсказкой.

**Architecture:** Чисто фронтовый трек. Новая форма `CreateActivityTab` живёт внутри существующей табbed-модалки; тело модалки разделяется на подкомпоненты по режимам (Rules of Hooks: record-хуки существующего занятия не должны выполняться в режиме создания). Сохранение — через существующий `addActivity` (расширяется опциональными колбэками результата; мутация fire-and-forget, флаг сохранения сбрасывается в колбэках). Пустая неделя: удаляется early-return, добавляется баннер-подсказка в потоке.

**Tech Stack:** Next.js (app router) + React 18 + TypeScript, vitest + testing-library, Playwright e2e, TanStack Query v5, домен-пакет `@memo/domain`, api-client `@memo/api-client`.

**Спека:** `docs/specs/2026-09-14-schedule-slot-create-empty-week-design.md` (решения D1–D10 обязательны; особенно D7 — никаких новых `z-[N]`, D8 — никакой конфликт-валидации слотов).

**Ревизия 2** — правки по plan-reviewer (NEEDS_CHANGES → все блокеры/мажоры внесены: существующие тест-файлы не затираются, флаг saving живёт до колбэков мутации, error-тост со строкой и kind='error', TabNav-проп опционален, Modal h2 при titleId всегда существует, хелпер недели один, условие подсказки дня = день-активности, якоря и стили по живому коду).

---

## Behavioral Delta

Как поведёт себя продукт для пользователя (маппинг на сценарии спеки §5):

- **S1** → Клик по пустому слоту на обычной неделе открывает модалку «Новое занятие» с уже подставленными днём и временем; выбрал мастера/услугу/локацию → «Создать» → модалка закрылась, карточка в сетке.
- **S2** → Пустая неделя показывает обычную сетку (7 колонок, ось времени, слоты) и подсказку «Нет занятий на эту неделю»; клик-создание на ней работает.
- **S3** → В виде дня то же самое: подсказка «Нет занятий на этот день», клик по слоту создаёт занятие.
- **S4** → Штамп (мастер + услуга + локации) на пустой неделе создаёт занятие кликом по слоту, как на заполненной.
- **S5** → Подсказка различает «нет занятий на эту неделю» и «нет занятий по выбранным фильтрам».
- **D8** → Два занятия в одно и то же время — валидны; никаких предупреждений и блокировок не появляется.
- Неизменное → «+» на карточке (быстрая запись), штамп на заполненной неделе, вкладки существующего занятия, ветки загрузки/ошибки — ведут себя как раньше.

## File Structure

| Файл | Действие | Ответственность |
|---|---|---|
| `frontend/admin/app/components/modal/ActivityDetailsModal/CreateActivityTab.tsx` | создать | Форма создания занятия: поля, префиллы, валидация, submit |
| `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx` | изменить | Режим `create`: nullable `activity`, разделение тела на подкомпоненты режимов, заголовок/вкладки/футер, блокировка закрытия при сохранении |
| `frontend/admin/app/components/modal/ActivityDetailsModal/TabNav.tsx` | изменить | `onAddClick` становится опциональным; кнопка «+ Запись» рендерится только при переданном `onAddClick` |
| `frontend/admin/app/components/shared/modal/Modal.tsx` | изменить | Опциональный `titleId`: `<h2 id={titleId}>` рендерится всегда, когда `titleId` передан |
| `frontend/admin/contexts/schedule/ScheduleDataContext.tsx` | изменить | `addActivity`: опциональные колбэки `{ onSuccess, onError }` (второй аргумент `mutate`) |
| `frontend/admin/app/components/schedule/WeekView.tsx` | изменить | Координаты слота в состоянии, гейт модалки, удаление ветки пустой недели, баннер-подсказка |
| `frontend/admin/app/components/schedule/DayView.tsx` | изменить | Те же координаты/гейт; заголовочная надпись пустоты → единый баннер |
| `frontend/admin/__tests__/CreateActivityTab.test.tsx` | создать | Юнит-тесты формы |
| `frontend/admin/__tests__/ActivityDetailsModal.test.tsx` | изменить (файл существует, ~1200 строк) | Добавить `describe('create mode')`, моки по образцу существующих в этом файле |
| `frontend/admin/__tests__/WeekView.test.tsx` | изменить | Пустая неделя → сетка+подсказка; гейт модалки; стаб модалки с `createDefaults` |
| `frontend/admin/__tests__/DayColumn.test.tsx` | изменить | `onOpenModal(dayIndex, slotMinutes)` |
| `frontend/admin/__tests__/page.test.tsx` | изменить | Ожидания пустой недели |
| `frontend/admin/__tests__/DayView.test.tsx` | изменить (файл существует) | Добавить describe: подсказка + режим create в дне |
| `frontend/admin/e2e/fixtures/helpers.ts` | изменить | Экспорт `waitForScheduleGrid` (ждёт сетку, работает на пустой неделе) |
| `frontend/admin/e2e/admin-clicks-empty-slot.spec.ts` | изменить | Убрать `.catch`, полный S1 |
| `frontend/admin/e2e/schedule-empty-week.spec.ts` | создать | S2 + S4 |
| `frontend/admin/e2e/dayview-slot-create.spec.ts` | создать | S3 |
| `frontend/admin/e2e/visual-regression.spec.ts`, `week-view.spec.ts` | изменить/перегенерация | Baseline режима создания; перегенерация затронутых снапшотов отдельным коммитом |
| `CHANGELOG.md` | изменить | Запись в стиле существующих (`### Added`, развёрнутый буллет) |

Запрещено во всех задачах: новые `z-[N]`/inline `zIndex` (D7); обработка Esc (в проекте не делается и здесь не вводится); изменения бэкенда; правки существующих текстов/тестов, не связанные с треком. Приватный хелпер `navigateToWeek` (helpers.ts:44, ждёт `activity-*`) и его вызовы НЕ трогать — на пустой неделе спеки ждут сетку через `waitForScheduleGrid` после собственного dispatch события.

---

## Task 1: CreateActivityTab — форма создания занятия
### Classification: large
### Required Docs
- `docs/specs/2026-09-14-schedule-slot-create-empty-week-design.md` §2.1 (поля, префиллы, семантика сохранения), §3 (границы)
- `docs/domain-rules/activities.md` — поля Activity, auto-fill из услуги, инвариант «нет конфликт-валидации»
- `docs/design-system.md` — токены цвета/отступы для контролов формы (цвета текста/кнопок — из токенов дизайн-системы, не произвольные)

### Task Description

Новый компонент `CreateActivityTab` — единственная вкладка модалки в режиме создания. Живёт в папке модалки, данные берёт из `useScheduleData()` (мастера, услуги, локации, `addActivity`), тосты — из `useUI()`.

- [ ] **RED.** Создай `frontend/admin/__tests__/CreateActivityTab.test.tsx`. Моки: `useScheduleData` (мастера `[{ id: 'm1' }]` — форма потребляет только `id`; услуги `[{ id: 's1', name: 'Маникюр', durationMinutes: 60 }]`, локации `[{ id: 'l1', name: 'Студия', defaultCapacity: 6 }]`, `addActivity: vi.fn()`), `useUI` (`showToast: vi.fn()`). Тесты:
  1. рендерит поля с тестид-ами `create-master`, `create-service`, `create-location`, `create-day`, `create-time`, `create-duration`, `create-capacity`, `create-private` и кнопку `btn-create-activity`;
  2. `btn-create-activity` задизейблен, пока не выбраны мастер+услуга+локация И время валидно (проверить: только мастер → disabled; мастер+услуга → disabled; все три + валидное время → enabled);
  3. выбор услуги проставляет `create-duration` = `service.durationMinutes` (60); выбор локации проставляет `create-capacity` = `location.defaultCapacity` (6);
  4. день и время предзаполнены из `defaults` (`dayIndex`; время в дробных часах, `input type=number step=0.5` — `540` минут → значение `9.5`; примеры UX: `9.5` = 09:30, `14` = 14:00);
  5. сабмит зовёт `addActivity` ровно с `{ dayIndex, masterId:'m1', serviceId:'s1', locationId:'l1', startMinutes, durationMinutes:60, capacity:6, isPrivate:false }`; success-тост — `expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Создано: Маникюр'))` (формат хвоста — как у штампа `WeekView.tsx:119`, точную строку в тест не зашивать);
  6. мок `addActivity` вызывает `callbacks.onError({ ... })` → `showToast` вызван с `(parseApiError(err).message, 'error')` (строка + kind), значения полей НЕ сброшены, `onSaved` не звался;
  7. после сабмита кнопка остаётся задизейбленной, `onSavingChange(true)` вызван; после вызова `onSuccess`-колбэка — `onSavingChange(false)`.

  Запусти `cd frontend/admin && npx vitest run __tests__/CreateActivityTab.test.tsx` — все тесты красные (компонента нет).
- [ ] **GREEN, шаг 1 — расширить `addActivity`.** `frontend/admin/contexts/schedule/ScheduleDataContext.tsx` (`:200-228`): второй опциональный аргумент `callbacks?: { onSuccess?: () => void; onError?: (err: unknown) => void }`, передаётся вторым аргументом react-query: `createMutation.mutate(vars, callbacks)`. Существующий вызов штампа (`WeekView.tsx:108`, без колбэков) не меняется — контракт не ломается. `useCallback`-зависимости не расширяются (колбэки не идут в замыкание).
- [ ] **GREEN, шаг 2 — компонент.** Создай `CreateActivityTab.tsx`:

```tsx
'use client';
import React, { useState } from 'react';
import { useScheduleData } from '@/contexts/schedule/ScheduleDataContext';
import { useUI } from '@/contexts/UIContext';
import { DAYS, formatTime } from '@/lib/utils';
import { parseApiError } from '@/app/lib/api/parseApiError';

export interface CreateDefaults { dayIndex: number; startMinutes: number; }
interface Props {
  defaults: CreateDefaults;
  onSavingChange: (saving: boolean) => void;
  onSaved: () => void;
}

export function CreateActivityTab({ defaults, onSavingChange, onSaved }: Props) {
  const { masters, services, locations, addActivity } = useScheduleData();
  const { showToast } = useUI();
  const [masterId, setMasterId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [dayIndex, setDayIndex] = useState(defaults.dayIndex);
  const [startHours, setStartHours] = useState(defaults.startMinutes / 60);
  const [durationMinutes, setDurationMinutes] = useState<number | ''>('');
  const [capacity, setCapacity] = useState<number | ''>('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [saving, setSaving] = useState(false);

  const service = services.find((s) => s.id === serviceId);
  const timeValid = Number.isFinite(startHours) && startHours > 0 && startHours < 24;
  const canSave = !!masterId && !!serviceId && !!locationId
    && timeValid && typeof durationMinutes === 'number' && durationMinutes > 0;

  const submit = () => {
    if (!canSave || saving) return;
    const startMinutes = Math.round(startHours * 60);
    setSaving(true); onSavingChange(true);
    addActivity(
      { dayIndex, masterId, serviceId, locationId, startMinutes,
        durationMinutes: Number(durationMinutes), capacity: Number(capacity) || 0, isPrivate },
      {
        onSuccess: () => {
          setSaving(false); onSavingChange(false);
          showToast(`Создано: ${service?.name} — ${DAYS[dayIndex]} ${formatTime(startMinutes)}`);
          onSaved();
        },
        onError: (err) => {
          setSaving(false); onSavingChange(false);
          showToast(parseApiError(err).message, 'error'); // форма остаётся с введённым (спека §2.1.7)
        },
      },
    );
    // ВАЖНО: mutate() — fire-and-forget; НИКАКОГО синхронного setSaving(false) здесь.
    // saving=true живёт до колбэка — модалку нельзя закрыть, кнопку нельзя нажать (спека §2.1.7).
  };
  // render: <div className="p-4 space-y-3"> — label + контрол для каждого поля:
  // select мастера/услуги/локации/дня (DAYS), input[type=number step=0.5 min=0.5 max=23.5] времени,
  // input[type=number min=1] длительности, input[type=number min=0] вместимости,
  // input[type=checkbox] приватности, кнопка «Создать» disabled={!canSave || saving}.
  // Цвета/отступы — токены из docs/design-system.md (var(--ink-light) и т.п.).
}
```

- [ ] Прогони `npx vitest run __tests__/CreateActivityTab.test.tsx` — зелёный. Commit: `feat(#258,#259): CreateActivityTab — форма создания занятия с префиллами из слота`.

## Task 2: ActivityDetailsModal — режим create, разделение по режимам
### Classification: large
### Required Docs
- `docs/specs/2026-09-14-schedule-slot-create-empty-week-design.md` §2.1 (механика §2.1.2–§2.1.4 обязательна: подкомпоненты, единственная вкладка, скрытый футер, заголовок/aria)
- `docs/design-system.md` — стиль модалок

### Task Description

Файл `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx` (230 строк). Меняется контракт пропсов, тело делится по режимам. Запрет: условный вызов хуков в одном теле компонента (Rules of Hooks) — record-хуки переезжают в подкомпонент существующего занятия.

- [ ] **RED.** В СУЩЕСТВУЮЩЕМ `frontend/admin/__tests__/ActivityDetailsModal.test.tsx` (не создавать новый!) добавь `describe('create mode')` — моки по образцу соседних describe этого же файла. Тесты:
  1. `mode='create'`, `activity=null`, `createDefaults={dayIndex:2,startMinutes:540}` → заголовок «Новое занятие» доступен по `aria-labelledby`; `tab-nav` РЕНДЕРИТСЯ ровно с одной вкладкой («Создание занятия»); НЕТ `tab-settings`, НЕТ `data-testid^="tab-client-"`, НЕТ `tab-add`; НЕТ `btn-delete-activity`; форма `create-master` видна;
  2. `mode='edit'` с валидным activity-моком → вкладки и футер как раньше (фиксация регресс-периметра);
  3. при `saving=true` клики по `details-modal-backdrop` и `modal-close-btn` НЕ закрывают модалку, при `saving=false` — закрывают.
  Красные.
- [ ] **GREEN, шаг 1 — TabNav.** `TabNav.tsx`: проп `onAddClick?: () => void` (опциональный — существующие вызывающие, передающие хендлер, не меняются); блок кнопки добавления (`:53-63`) обернуть в `{onAddClick && (...)}`. В режиме создания вызывающий просто НЕ передаёт `onAddClick` — кнопка исчезает, TS-контракт существующих вызовов цел.
- [ ] **GREEN, шаг 2 — Modal.** `shared/modal/Modal.tsx`: опциональный `titleId?: string`. `<h2>` рендерится ВСЕГДА, когда передан `titleId` (даже при пустом title): условие рендера h2 — `titleId !== undefined || (title !== null && title !== undefined && title !== false)`, разметка `<h2 id={titleId} className=...>{title}</h2>`. Остальным вызовам ничего не меняется.
- [ ] **GREEN, шаг 3 — разделение тела (границы явно).** В `ActivityDetailsModal.tsx`:
  - пропсы: `activity?: ScheduleAdminDTO | null`, `mode: 'edit' | 'quickAdd' | 'create'`, `createDefaults?: CreateDefaults`;
  - РОДИТЕЛЬ держит: `if (!isOpen) return null` (`:184`), внешний `<div role="dialog" aria-modal data-testid="activity-details-modal">` + backdrop (`:192-195`, `onClick` — `if (!saving) onClose()`), состояние `saving`, и свитч режимов;
  - `mode === 'create'` → внутри родительского dialog-div рендерится `<CreateActivityPanel>` (внутренний компонент этого же файла): свой `<Modal title="Новое занятие" titleId="activity-modal-title" onClose={saving ? undefined : onClose} footer={null} ...>` (скрытие крестика через `onClose={undefined}` — Modal прячет кнопку, см. `Modal.tsx:57`), `aria-labelledby="activity-modal-title"` на родительском div, `<TabNav tabs={[{ id: 'create', label: 'Создание занятия' }]} activeTab="create" onTabChange={noop} />` (без `onAddClick`), `<CreateActivityTab defaults={createDefaults!} onSavingChange={setSaving} onSaved={onClose} />`;
  - иначе → `<ExistingActivityContent>` (внутренний компонент, куда переезжает тело текущего компонента): все хуки (`:39-:49`), хендлеры (`:102-146`), tabs-memo (`:55-99`), `renderContent()` (`:150-182`) И свой `<Modal title={activity.serviceTitle || 'Мероприятие'} ...>` с футером удаления (`:205-215`), TabNav (`:218-223`) и контентом (`:224-226`) — как сейчас;
  - итог: dialog-div/backdrop — ровно ОДИН, в родителе; каждая ветка рендерит свой `<Modal>`; дублирования dialog-div нет.
- [ ] Новые тесты зелёные; полный `npx vitest run` зелёный (существующие 99 тестов файла — регресс-периметр). Commit: `feat(#258,#259): режим create в ActivityDetailsModal — подкомпоненты режимов, единственная вкладка, блокировка закрытия при сохранении`.

## Task 3: WeekView — координаты слота и гейт модалки
### Classification: standard
### Required Docs
- `docs/specs/2026-09-14-schedule-slot-create-empty-week-design.md` §2.1.1, §2.1.2, D6
- `docs/domain-rules/activities.md` — DateTime canon (dayIndex/startMinutes)

### Task Description

`frontend/admin/app/components/schedule/WeekView.tsx`. Сегодня: `openCreateModal` (`:44-48`) не принимает координаты; гейт `:329-336` требует `modalActivity`.

- [ ] **RED.**
  1. В `__tests__/DayColumn.test.tsx` добавь тест рядом с `:247-265`: `DayColumn` c `stampReady=false` и `onOpenModal={vi.fn()}` → `fireEvent.click` на `slots[0]` → `onOpenModal` вызван с `(2, 540)` (путь сегодня не покрыт).
  2. В `__tests__/WeekView.test.tsx`: СНАЧАЛА расширь стаб модалки (`:51-54`) — экспортируй в DOM `mode`, наличие `activity` и `createDefaults`: `props.isOpen ? <div data-testid="activity-details-modal" data-mode={props.mode} data-has-activity={String(!!props.activity)} data-defaults={JSON.stringify(props.createDefaults ?? null)} /> : null`; затем расширь стаб `DayColumn` (`:43-45`) — клик вызывает `onOpenCreateModal?.(1, 540)`; тест: после клика у стаба модалки `data-mode="create"`, `data-has-activity="false"`, `data-defaults='{"dayIndex":1,"startMinutes":540}'`.
  Красные.
- [ ] **GREEN.** В `WeekView.tsx`: состояния `modalDayIndex`/`modalStartMinutes` (рядом с `:40-42`); `openCreateModal(dayIndex: number, startMinutes: number)` сохраняет их и ставит `modalMode='create'`; гейт `:329-336` → `{modalOpen && (<ActivityDetailsModal isOpen activity={modalActivity} mode={modalMode} createDefaults={{ dayIndex: modalDayIndex, startMinutes: modalStartMinutes }} ... />)}`; тип `onOpenCreateModal` в `DayColumn.tsx` — `(dayIndex: number, slotMinutes: number) => void` (совместим с `DroppableSlot.onOpenModal` `:142-150`). `openEditModal`/`openQuickAdd` координаты не трогают — режим не create.
- [ ] Зелёные оба файла; полный `npx vitest run` зелёный. Commit: `feat(#258,#259): клик по слоту открывает режим create с координатами слота (WeekView)`.

## Task 4: WeekView — пустая неделя: сетка всегда + подсказка
### Classification: standard
### Required Docs
- `docs/specs/2026-09-14-schedule-slot-create-empty-week-design.md` §2.2, D2, S5→юнит (D9)
- `docs/design-system.md` — токены текстов

### Task Description

- [ ] **RED.** `__tests__/WeekView.test.tsx`: тест «пустая неделя» (`:93-99`) переписать: при пустых `activities` рендерятся стабы `day-column-0…6` И `data-testid="schedule-empty-hint"` с текстом «Нет занятий на эту неделю»; второй тест: при моке view с `filterMasterIds=['x']` текст «Нет занятий по выбранным фильтрам». `__tests__/page.test.tsx` (`:57-65`): ожидания «сетка + подсказка» вместо «пустое состояние». Красные.
- [ ] **GREEN.** В `WeekView.tsx`: удалить ветку `:201-209` целиком; `const hasFilters = filterMasterIds.length > 0 || filterLocationIds.length > 0;` объявить рядом с другими производными ДО return (в скоупе обычного рендера). В обычном рендере, непосредственно перед `<DndContext>` (баннер в потоке, без позиционирования и z): `{activities.length === 0 && (<div data-testid="schedule-empty-hint" role="status" aria-live="polite" className="px-4 py-2 text-sm" style={{ color: 'var(--ink-light)' }}>{hasFilters ? 'Нет занятий по выбранным фильтрам' : 'Нет занятий на эту неделю'}</div>)}`.
- [ ] Зелёные; `npx vitest run` зелёный. Commit: `feat(#259): пустая неделя рендерит сетку с подсказкой role=status (S5-тексты в юнитах)`.

## Task 5: DayView — унификация подсказки и режима create
### Classification: small
### Required Docs
- `docs/specs/2026-09-14-schedule-slot-create-empty-week-design.md` §2.2 (вид дня), D3
- `docs/domain-rules/activities.md` — DateTime canon

### Task Description

`frontend/admin/app/components/schedule/DayView.tsx` (560 строк). Сетка дня и слоты уже рендерятся при пустом дне — меняются только три места.

- [ ] **RED.** В СУЩЕСТВУЮЩЕМ `__tests__/DayView.test.tsx` (не создавать новый!) добавить describe (моки по образцу файла; стаб модалки — как в Task 3 с `data-mode`/`data-has-activity`/`data-defaults`): 1) день без занятий → `schedule-empty-hint` с текстом «Нет занятий на этот день» (при моке фильтров — «Нет занятий по выбранным фильтрам»); условие подсказки проверять НА ДЕНЬ-активностях: колонка мастера с нулём занятий ТОЖЕ показывает подсказку; 2) клик по стабу DayColumn (вызывает `onOpenCreateModal(0, 600)`) → у стаба модалки `data-mode="create"`, `data-has-activity="false"`, `data-defaults='{"dayIndex":0,"startMinutes":600}'`. Красные.
- [ ] **GREEN.** В `DayView.tsx`: `openCreateModal` (`:85-89`) — та же схема координат, что в Task 3 (состояния + `modalMode='create'`); гейт `:550-557` → `modalOpen &&`; блок «Нет занятий на этот день» (`:434-438`, условие `orderedColumns.length === 0`) удалить; баннер `schedule-empty-hint` (`role="status"`, `aria-live="polite"`, в потоке непосредственно перед `<DndContext>`) с условием «день-активности пусты»: `dayActivities.length === 0` — производная от activities выбранного дня с учётом фильтров (см. `:167`); условие покрывает и случай «нет колонок», и «колонки есть, занятий ноль». Тексты: «Нет занятий на этот день» / «Нет занятий по выбранным фильтрам» (`hasFilters` из `useScheduleView`).
- [ ] Зелёные; полный `npx vitest run` зелёный. Commit: `feat(#258,#259): DayView — create с координатами слота, единый баннер пустоты`.

## Task 6: e2e-хелпер + S1 (починка admin-clicks-empty-slot)
### Classification: standard
### Required Docs
- `docs/specs/2026-09-14-schedule-slot-create-empty-week-design.md` §5 S1, §6
- `docs/tests_workflow.md` — правила e2e (workers=1, seed-reset)
- навык `vitest-playwright-patterns` (если доступен контейнеру)

### Task Description

- [ ] `frontend/admin/e2e/fixtures/helpers.ts`: добавить и экспортировать ТОЛЬКО
  `export async function waitForScheduleGrid(page: Page)` — `await page.waitForSelector('[data-testid="day-column-0"]', { timeout: 10_000 })` (сетка рендерится и на пустой неделе после Task 4; работает и с карточками). Приватный `navigateToWeek` (`:44`) и все существующие хелперы не трогать: их ожидание `activity-*` остаётся как есть.
- [ ] **RED→GREEN.** Переписать `admin-clicks-empty-slot.spec.ts` (24 строки) без `.catch`: `waitForScheduleReady` → клик `page.locator('[data-testid="empty-slot"]').first()` → `const dialog = page.getByRole('dialog', { name: 'Новое занятие' }); await expect(dialog).toBeVisible();` → в диалоге `create-master`/`create-service`/`create-location` — `selectOption({ index: 1 })` → клик `data-testid="btn-create-activity"` → `await expect(dialog).toBeHidden()` и число `[data-testid^="activity-"]` выросло на 1. Примечание: слоты живут в `DndContext` (`@dnd-kit`) — если обычный `.click()` перехватится drag-сенсором, fallback `page.locator(...).dispatchEvent('click')`. Прогон в контейнере; после Tasks 1–5 тест зелёный — результат RED/GREEN зафиксировать в отчёте задачи. Commit: `test(#258,#259): e2e S1 — починка admin-clicks-empty-slot без .catch`.

## Task 7: e2e S2 + S4 — schedule-empty-week.spec.ts
### Classification: standard
### Required Docs
- `docs/specs/2026-09-14-schedule-slot-create-empty-week-design.md` §5 S2, S4
- `docs/tests_workflow.md`

### Task Description

- [ ] **RED→GREEN.** Новый `frontend/admin/e2e/schedule-empty-week.spec.ts`. Пустая неделя: `'2099-01-05'`; переход — инлайн-dispatch как в `dayview-column-reorder.spec.ts:54`: `await page.evaluate(() => document.dispatchEvent(new CustomEvent('__memo-switch-to-week-view', { detail: { date: '2099-01-05' } })));` затем `await waitForScheduleGrid(page);`. Чистота состояния — штатный per-test seed-reset (#252, авто-фикстура), никаких ручных afterEach-удалений не нужно.
  - **S2:** подсказка `await expect(page.getByTestId('schedule-empty-hint')).toHaveText('Нет занятий на эту неделю')` → клик первый `empty-slot` → диалог «Новое занятие» виден → заполнить три селекта (`selectOption({ index: 1 })`) → «Создать» → диалог скрылся, `[data-testid^="activity-"]` появился, подсказка `toHaveCount(0)`.
  - **S4:** `navigateToWeekDate`-аналог (dispatch + `waitForScheduleGrid`) → в штамп-панели: мастер — селект внутри `getByTestId('stamp-master-picker')`, `selectOption({ index: 1 })`; услуга — Combobox `getByLabel('Услуга')`, открыть и кликнуть первую опцию; чекбокс первой локации → `await expect(page.getByTestId('stamp-summary')).toBeVisible()` → клик `empty-slot` → появилась карточка `[data-testid^="activity-"]`, модалка НЕ открывалась (`getByRole('dialog')` absent).
  Прогон в контейнере; RED/GREEN в отчёт. Commit: `test(#259): e2e S2+S4 — пустая неделя: клик-создание и штамп`.

## Task 8: e2e S3 — вид дня
### Classification: small
### Required Docs
- `docs/specs/2026-09-14-schedule-slot-create-empty-week-design.md` §5 S3

### Task Description

- [ ] **RED→GREEN.** Новый `frontend/admin/e2e/dayview-slot-create.spec.ts`: dispatch `__memo-switch-to-day-view` с `{ detail: { date: '2099-01-05' } }` (паттерн `dayview-column-reorder.spec.ts:54`) → `waitForScheduleGrid` → подсказка «Нет занятий на этот день» видна → клик `empty-slot` → диалог «Новое занятие» → заполнить селекты → «Создать» → карточка появилась. Commit: `test(#258,#259): e2e S3 — создание по клику в виде дня`.

## Task 9: Визуальные снапшоты
### Classification: small
### Required Docs
- `docs/specs/2026-09-14-schedule-slot-create-empty-week-design.md` §6 (дисциплина перегенерации)
- `frontend/admin/e2e/visual-regression.spec.ts`, `week-view.spec.ts`

### Task Description

- [ ] Прогони `npx playwright test week-view visual-regression`. Упавшие снапшоты сравнить по diff: ожидаемое изменение (пустая неделя теперь с сеткой/подсказкой, D2) → перегенерировать ТОЛЬКО затронутые (`--update-snapshots`) отдельным коммитом `chore(#259): перегенерация визуальных базлайнов пустой недели (D2)`, в теле коммита ПЕРЕЧИСЛИТЬ имена перегенерированных снапшотов; если diff неожиданный (сместилась заполненная неделя) — это регресс, чинить код, не снапшот.
- [ ] В `visual-regression.spec.ts` добавить baseline режима создания: клик по `empty-slot` → скриншот `activity-details-modal-container` (подход существующих модальных шотов этого файла). Commit: `test(#258,#259): baseline модалки в режиме создания`.

## Task 10: Полный прогон, CHANGELOG, PR
### Classification: small
### Required Docs
- `docs/tests_workflow.md` — порядок полного прогона
- `CHANGELOG.md` — формат записей (`### Added`, развёрнутые буллеты)

### Task Description

- [ ] Полный юнит: `cd frontend/admin && npx vitest run` — зелёный, ноль новых скипнутых.
- [ ] Полный e2e: `npx playwright test` (workers=1) — зелёный; при 503 admission тяжёлые шары повторить позже (правило параллельных IMPL, спека §4).
- [ ] `CHANGELOG.md`: запись в стиле существующих (секция Added, развёрнутый буллет): что вернулось (клик-создание через режим create модалки), что изменилось (пустая неделя всегда с сеткой и подсказкой), ссылки #258/#259.
- [ ] Запушить ветку, открыть PR: заголовок `feat(#258,#259): создание занятия кликом по слоту + пустая неделя с сеткой`, тело — выжимка Behavioral Delta + `Closes #258` и `Closes #259` (issues закроются сами на мерже). Отчёт архитектору: `## Board Update Needed` (менеджер переключит карточки на `PR (G7)`).
