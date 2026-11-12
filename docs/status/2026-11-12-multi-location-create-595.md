# GH #595 — Мультивыбор локаций при создании занятия (N событий одним «Создать»)

- **Date**: 2026-11-12
- **Branch**: `595-multi-location-create` (HEAD `f45814ed`)
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `bb321bd7` — 7 коммитов `10651f5c..f45814ed` (6 задач + бот-PNG-базлайн), 21 файл, +1700/−227
- **Issue**: #595 — одно нажатие «Создать» в форме создания занятия создаёт N независимых событий — по одному на каждую отмеченную чекбоксом локацию; вместимость при 2+ берётся по умолчанию каждого зала; частичный сбой оставляет форму открытой со снятыми успешными галочками; тосты «Создано занятий: N» / «Создано K из N (…): {первая ошибка по порядку}» / «Создано 0 из N». Frontend-only: контракт и модель не меняются — у события всегда ровно одна локация (FK NOT NULL), N вызовов существующего `POST /activities`.
- **Спека**: `docs/specs/2026-11-12-multi-location-create-595-design.md` (рев.4 — панель 7/7 внесена, BLOCKER TanStack v5 per-call колбэки зафиксирован промисным контрактом)
- **План**: `docs/plans/2026-11-12-multi-location-create-595-plan.md` — 5/5 задач, все done
- **Domain rules**: `docs/domain-rules/activities.md` «Create-form multi-location (GH #595)» — промисный `addActivity`, вместимость по залам, автоснятие успешных, префилл из DayView (вошёл в `07cdaf8f`, до base)

## Что выполнено

1. **Промисный путь создания в ScheduleDataContext (T1, `10651f5c` standard)** —
   мутация создания переведена на `mutateAsync`; авто-инвалидация убрана
   из хукового `onSuccess` (N параллельных вызовов давали бы N
   инвалидаций); `addActivity(input, callbacks?)` — колбэки сохранены
   для существующих потребителей (вызываются вручную по resolve/reject),
   метод **возвращает промис**, после settle — инвалидация семейства
   `activities`; новый `addActivities(inputs)`: N параллельных
   `mutateAsync` → `Promise.allSettled` → ровно одна инвалидация →
   массив исходов (локация → fulfilled/rejected + ошибка). Вкладка не
   полагается на `isPending` наблюдателя и `mutationKey`.
2. **Чекбокс-группа локаций и правила вместимости (T2, `ec809727`
   standard + комплаенс-фикс `6a99886e`)** — `ActivityForm` ветвит поле
   локации по режиму: create → группа чекбоксов (`<fieldset><legend>`
   «Локация», каждая строка — настоящий `<label>`), edit → прежний
   `Combobox` (разметка edit не менялась); контейнер
   `data-testid="create-location"`, чекбоксы `create-location-check`;
   состояние `locationIds: string[]`, при рефетче справочника
   отсутствующие id отбрасываются; вместимость §4.2: ровно 1 (по клику
   пользователя) — автозаполнение `defaultCapacity` с ручной правкой
   (нет дефолта/0 → блок до ввода, канон #280), 2+ — поле скрыто,
   подсказка «Вместимость — по умолчанию каждого зала»
   (`aria-live="polite"`), зал без умолчания (отсутствует ИЛИ 0)
   блокирует «Создать», подсказка называет первый такой по порядку
   чекбоксов; `6a99886e` — снять tone/цвет у подсказки (комплаенс-ревью).
3. **Мульти-отправка, частичный/полный сбой, тосты (T3, `8a2a4c75`
   standard)** — кнопка «Создать» (inline, testid сохранён; футер —
   #598, сознательно не тронут) вызывает `addActivities`: каждой
   локации свой `locationId`, вместимость — умолчание локации при 2+ /
   значение поля при ровно 1; saving-лок до `allSettled`, поля и
   чекбоксы disabled на время полёта; полный успех (N из N) — закрытие,
   тост «Создано занятий: N (…)» (N=1 — прежний); частичный (0<K<N) —
   форма открыта, успешные локации сняты автоматически (повтор шлёт
   только оставшиеся — без дубликатов), тост «Создано K из N (…):
   {сообщение первой неудавшейся по порядку чекбоксов}» (через
   `parseApiError`), при переходе набора к ровно 1 поле вместимости
   появляется с умолчанием оставшейся; полный сбой — ничего не
   снимается, разблокировка после лока, тост «Создано 0 из N (…)»
   (N=1 — прежний error-тост).
4. **Префилл локации из DayView (T4, `ad2deb46` small)** —
   `CreateDefaults` расширен опциональным `locationId`; шов DayView —
   идентификатор колонки пробрасывается пер-колоночным замкнутым
   обработчиком в `onOpenCreateModal` (сигнатура общего колбэка не
   сломана, WeekView без предотметки); guard: префилл только в режиме
   колонок-по-локациям — мастер-колонки и view-only архивные колонки
   без предотметки.
5. **E2E US-1..US-5 + правка спеков + §9-чек (T5, `f111062a` standard)**
   — новый spec `multi-location-create.spec.ts`: US-1 (2 локации → 2
   карточки, вместимость своего зала, тост «Создано занятий: 2»),
   US-3 (зал без умолчания → блок + название), US-4 (route-мок фейла
   POST по `location_id` из тела → «Создано 1 из 2», успешная снята,
   повтор — 1 запрос → закрытие); US-2/US-5 — в
   `dayview-slot-create.spec.ts` (ручная правка вместимости при 1;
   предотмеченный чекбокс колонки + негатив мастер-колонок);
   комбо-шаги переведены на чекбоксы в `schedule-saving-toast`,
   `admin-clicks-empty-slot`, `schedule-empty-week` (+ хелпер
   `e2e/helpers/location-group.ts`); визуальный чек §9 — Check 5 в
   `visual-compliance-checks.spec.ts` (create-location рендерит 3
   чекбокса = справочник). Бот-коммит `f45814ed` — регенерация базлайна
   `modal-create-mode-e2e-linux.png` (mode=changed, run 42).

## Отклонения и фикс-циклы

- **T2:** комплаенс-фикс `6a99886e` — подсказка блокировки вместимости
  без tone/цвета (нейтральный текст вместо цветного).
- **T5:** базлайн `f45814ed` — регенерация снапшота create-режима
  (бот-раннер, изменение разметки формы закономерно сдвинуло пиксели).
- Девиаций от спеки рев.4 нет; спека (`07cdaf8f`) и план (`bb321bd7`) —
  коммиты самой ветки до base, docser их не касался.

## Верификация (финальные прогоны)

| Проверка | Результат |
| --- | --- |
| admin vitest полный | **3146/3146** (189 файлов, exit 0) |
| Scenario e2e set (US-1..US-5 + 4 конвертированных спека) | **24/24** |
| Ревьюерский spot-check | **19/19** |
| visual-compliance spec | **5/5** (Check 5: create-location = 3 чекбокса справочника) |
| `tsc --noEmit` / `next build` | чистые |
| Визуальный гейт §9 спеки | подтверждён e2e + mobile-скриншотом; генерик-раннер не умеет открывать модалку — exit 1 задокументирован как ограничение раннера, не дефект UI |

## Ревью

- T1/T2/T3/T5 — standard (two-stage), T4 — small (1-stage); ревью
  пройдены (compliance ✅ + quality ✅ где применимо); комплаенс-правка
  T2 сложена в ветку (`6a99886e`), фикс-коммитов других нет.

## Behavioral Delta

Новая пользовательская возможность в create-режиме модалки занятия:
локация выбирается чекбоксами (одно «Создать» — N событий в отмеченных
залах), вместимость при 2+ не спрашивается — каждый зал получает своё
умолчание; частичный сбой не теряет введённое и не создаёт дубликатов
при повторе. Ровно 1 отмеченная локация — прежний поток одиночного
создания #280 (тексты тостов, автозаполнение, ручная правка).
Edit-режим (`SettingsTab`), WeekView, штамп сетки, бэкенд и api-client
не тронуты; клик по слоту в дне-по-локациям теперь приносит
предотмеченную локацию колонки.

## PR-заметки

- `Closes #595` — только в описании PR (канон репо), в коммиты не пишется.
- Спека (рев.4 `07cdaf8f`) и план (`bb321bd7`) — коммиты самой ветки;
  domain-rules `activities.md` — пункт GH #595 в `07cdaf8f`.
- `.gitignore` (frontend/admin): `/.next-e2e*/` — мусор e2e webServer
  (`.next-e2e595/`) убран из untracked-noise; каталог на диске
  сохраняется.
- Бэкенд, api-client, model, миграции — ноль изменений (frontend-only
  фича по плану).

## Тронутые файлы (`git diff --name-only bb321bd7..f45814ed`)

```
frontend/admin/__tests__/ActivityDetailsModal.test.tsx
frontend/admin/__tests__/CreateActivityTab.test.tsx
frontend/admin/__tests__/DayView.test.tsx
frontend/admin/__tests__/helpers/mockContexts.ts
frontend/admin/__tests__/helpers/splitScheduleOverrides.ts
frontend/admin/__tests__/schedule/ScheduleDataContext.test.tsx
frontend/admin/app/components/modal/ActivityDetailsModal/ActivityForm.tsx
frontend/admin/app/components/modal/ActivityDetailsModal/CreateActivityTab.tsx
frontend/admin/app/components/modal/ActivityDetailsModal/SettingsTab.tsx
frontend/admin/app/components/schedule/DayView.tsx
frontend/admin/app/components/shared/Combobox.tsx
frontend/admin/app/components/shared/MasterPicker.tsx
frontend/admin/contexts/schedule/ScheduleDataContext.tsx
frontend/admin/e2e/admin-clicks-empty-slot.spec.ts
frontend/admin/e2e/dayview-slot-create.spec.ts
frontend/admin/e2e/helpers/location-group.ts
frontend/admin/e2e/multi-location-create.spec.ts
frontend/admin/e2e/schedule-empty-week.spec.ts
frontend/admin/e2e/schedule-saving-toast.spec.ts
frontend/admin/e2e/visual-compliance-checks.spec.ts
frontend/admin/e2e/visual-regression.spec.ts-snapshots/modal-create-mode-e2e-linux.png
```

## References

- **GitHub Issue**: #595
- **Design Spec**: `docs/specs/2026-11-12-multi-location-create-595-design.md` (рев.4)
- **Plan**: `docs/plans/2026-11-12-multi-location-create-595-plan.md` (5/5)
- **Domain rules**: `docs/domain-rules/activities.md` «Create-form multi-location (GH #595)»
- **Смежные**: #280 (канон create-формы — база фичи), #598 (фикс-высота модалки + футер — сознательный сплит), #258/#259 (инвариант домена «пересечения занятий допустимы»), #576 (копирование недели — прецедент чекбоксов локаций)
- **PR**: _(to be added after PR creation)_
