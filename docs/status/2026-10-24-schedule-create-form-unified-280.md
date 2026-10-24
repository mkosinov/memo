# GH #280 — Единая форма создания занятия: унификация с формой редактирования

- **Date**: 2026-10-24
- **Branch**: `280-schedule-create-form`
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `406fb0cd` — 5 коммитов (`17667dc6..b393be2b`), 25 файлов,
  +1259/−517
- **Issue**: #280 — форма создания занятия (`CreateActivityTab`) была собрана из
  других контролов и в другом порядке, чем эталонная форма редактирования
  (`SettingsTab`): голые `<select>`, «день недели + часы», длительность в
  минутах, чекбокс. Решение — один общий компонент `ActivityForm` с двумя
  режимами (edit — instant-patch, create — локальный стейт + кнопка
  «Создать»); создание уходит на выбранную календарную дату слота; вместимость
  ≥ 1 в обоих режимах
- **Спека**: `docs/specs/2026-10-23-schedule-create-form-unified-design.md`
  (рев.2 — supersedes блок D4 спеки 2026-09-14)
- **План**: `docs/plans/2026-10-23-schedule-create-form-unified-plan.md` —
  5/5 задач, все done
- **Характер**: frontend/admin-only (расписание); сервер, api-client, БД и
  миграции не меняются — `POST /api/v1/activities` отправляет тот же payload

## Что выполнено

1. **Фундамент — хелперы даты-времени и тестиды комбобоксов (T1,
   `17667dc6`, small)** — `snapMinutes` и `buildDateTimeLocal` переехали из
   `SettingsTab.tsx` в `lib/datetime.ts` (канонический домен функций
   даты-времени рядом с `composeLocalISO`/`hhmmToMinutes`); `SettingsTab`
   импортирует из lib — поведение без изменений; `Combobox` и `MasterPicker`
   получили необязательный проп `containerTestId` на внешней обёртке (паттерн
   эталона `select-service`/`select-location`), внутренние тестиды
   `combobox-*` не тронуты. Юнит+e2e эталона зелёные **без правки ожиданий**.
2. **Общий компонент `ActivityForm` — извлечение эталона (T2,
   `a513642b`, standard)** — разметка и логика контролов эталона вынесены из
   `SettingsTab` в новый `ActivityForm.tsx` (режим `edit`: каждое изменение —
   instant-patch через `onUpdate → updateActivity`, конвертация «открытая
   неделя + день» сохранена); `SettingsTab` стал тонкой обёрткой. Рефактор
   незаметен пользователю; единственная видимая дельта — гейт вместимости
   ≥ 1: пустое/нулевое значение больше не отправляется (решение пользователя
   в спеке, действует в обоих режимах).
3. **Create-режим на общем `ActivityForm` (T3, `9817a2fe`, large)** —
   `CreateActivityTab` — тонкая обёртка над тем же `ActivityForm` в режиме
   `create` (локальный стейт, отправка кнопкой «Создать»); префиллы из слота
   через `CreateDefaults {date, startMinutes}` — календарная дата слота,
   которой раньше в создании не было; `addActivity` в `ScheduleDataContext`
   принял юнион `{start} | {dayIndex, startMinutes}` — полный local-ISO
   `start` идёт в payload напрямую, легаси-конвертация «открытая неделя +
   день» остаётся штампу сетки и `updateActivity` (редактирование + drag&drop);
   источник шага сетки — хук `useGridSettings()` (тот же, что у эталона);
   гейты обязательного набора, тост об успехе с датой через `formatDateRu`,
   тестиды `create-*`; `docs/domain-rules/activities.md` — +1 буллет юниона
   `addActivity`.
4. **e2e US-1..US-5 (T4, `7fd67f45`, standard)** — 4 спеки
   (`admin-clicks-empty-slot`, `dayview-slot-create`, `schedule-empty-week`,
   `schedule-saving-toast`) переведены на канонный комбобокс-паттерн
   (`e2e/helpers/combobox.ts`), `selectOption` убран; US-2 — межнедельный
   сценарий (создание на дату вне открытой недели); US-4 — приватное
   тумблером; **тела edit-сценариев не тронуты**.
5. **Базлайн визуальной регрессии (T5, `b393be2b`, small)** —
   `modal-create-mode-e2e-linux.png` перегнан CI-записью `update-snapshots`
   (mode=changed, run 40060814412) — бото-коммит, ручная регенерация исключена.

## Верификация (финальное дерево, `b393be2b`)

| Проверка | Результат |
| --- | --- |
| Admin vitest (полный) | **3118/3118** (188 файлов) |
| e2e — 4 переписанные спеки | **13/13** (standalone-стек) |
| Visual Compliance Checks | **8/8** машинных проверок (fallback-драйвер, exit 0) |
| `update-snapshots` базлайн | CI-запись run 40060814412, ровно 1 PNG в диффе |

## DoD-статус / критерий незаметности

- **T1 ✅** — юнит+e2e эталона зелёные без правки ожиданий (аддитивность
  пропа, чистый переезд хелперов).
- **T2 ✅** — то же для edit-режима; правки ожиданий edit-тестов не
  потребовались.
- **T3 ✅** — юниты US-2..US-5 (календарная дата, вместимость ≥ 1, юнион
  `addActivity`, тост с датой).
- **T4 ✅** — e2e US-1..US-5 GREEN.
- **T5 ✅** — базлайн CI-записью + VCC 8/8.

**Критерий незаметности**: ожидания edit-тестов не правились ни в одной
задаче — рефактор эталона на `ActivityForm` поведенчески прозрачен (кроме
санкционированного спекой гейта вместимости ≥ 1). Все DoD плана выполнены.

## Behavioral Delta

1. Форма создания занятия выглядит и устроена как форма редактирования
   (эталон): комбобоксы с поиском, «Дата и время + Длительность + Приватное»
   первой строкой, длительность «ЧЧ:ММ», тумблер приватности, тестиды `create-*`.
2. Создание уходит на выбранную календарную дату слота (раньше — вычисление
   от открытой недели; межнедельные слоты создавались не там).
3. Вместимость ≥ 1 гейтится в обоих режимах: пустое/нулевое значение больше
   не отправляется на сервер.
4. Edit-режим, штамп сетки, drag&drop, сервер — без изменений.

## PR-заметки

- `Closes #280` — только в описании PR (канон репо), в коммиты не пишется.
- Спека/план на ветке с базы, IMPL их не менял; `activities.md` уже несёт
  буллет юниона из T3.

## Тронутые файлы (`git diff --name-only 406fb0cd..b393be2b`)

```
docs/domain-rules/activities.md
frontend/admin/__tests__/ActivityDetailsModal.test.tsx
frontend/admin/__tests__/Combobox.test.tsx
frontend/admin/__tests__/CreateActivityTab.test.tsx
frontend/admin/__tests__/DayView.test.tsx
frontend/admin/__tests__/MasterPicker.test.tsx
frontend/admin/__tests__/WeekView.test.tsx
frontend/admin/__tests__/datetime.test.ts
frontend/admin/__tests__/schedule/ScheduleDataContext.test.tsx
frontend/admin/app/components/modal/ActivityDetailsModal/ActivityForm.tsx
frontend/admin/app/components/modal/ActivityDetailsModal/CreateActivityTab.tsx
frontend/admin/app/components/modal/ActivityDetailsModal/SettingsTab.tsx
frontend/admin/app/components/modal/ActivityDetailsModal/index.ts
frontend/admin/app/components/schedule/DayView.tsx
frontend/admin/app/components/schedule/WeekView.tsx
frontend/admin/app/components/shared/Combobox.tsx
frontend/admin/app/components/shared/MasterPicker.tsx
frontend/admin/contexts/schedule/ScheduleDataContext.tsx
frontend/admin/e2e/admin-clicks-empty-slot.spec.ts
frontend/admin/e2e/dayview-slot-create.spec.ts
frontend/admin/e2e/helpers/combobox.ts
frontend/admin/e2e/schedule-empty-week.spec.ts
frontend/admin/e2e/schedule-saving-toast.spec.ts
frontend/admin/e2e/visual-regression.spec.ts-snapshots/modal-create-mode-e2e-linux.png
frontend/admin/lib/datetime.ts
```

Docs-коммит: `PLAN.md` + `CHANGELOG.md` +
`docs/status/2026-10-24-schedule-create-form-unified-280.md` — только
мета-доки; код/спеки/планы/domain-rules не тронуты.

## References

- **GitHub Issue**: #280
- **Design Spec**: `docs/specs/2026-10-23-schedule-create-form-unified-design.md` (рев.2)
- **Plan**: `docs/plans/2026-10-23-schedule-create-form-unified-plan.md` (5/5)
- **PR**: _(to be added after PR creation)_
