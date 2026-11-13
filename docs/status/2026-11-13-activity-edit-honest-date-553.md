# GH #553 — Редактирование занятия: честная календарная дата вместо «открытая неделя + день недели»

- **Date**: 2026-11-13
- **Branch**: `553-activity-edit-honest-date` (HEAD `46feb8fd`)
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `2172bd75` — 5 коммитов `e68d73f2..46feb8fd`, 6 файлов, +702/−36
- **Issue**: #553 — форма редактирования занятия отправляет выбранную календарную дату как есть: до-#553 выбор даты в datetime-поле молча конвертировался в «открытая неделя + день недели», поэтому дата вне открытой недели терялась (занятие «не переезжало»). Специфика: прошедшие даты разрешены осознанно (сервер принимает прошлые даты — канон #422), старт-патч — единственный «голос» инстант-патча (тост называет выбранную дату). Frontend-only, бэкенд/api-client/модель не тронуты.
- **Спека**: `docs/specs/2026-10-25-activity-edit-honest-date-design.md` (рев.2.1) — на main, unchanged by IMPL
- **План**: `docs/plans/2026-11-13-activity-edit-honest-date-plan.md` — 5/5 задач, все done — на main, unchanged by IMPL
- **Domain rules**: `docs/domain-rules/activities.md` — буллет «Edit-form time source (GH #553)» (юнион `updateActivity`, приоритет `start`, `Promise<void>`, тост «Сохранено: …»); легаси-член `{ dayIndex, startMinutes }` в буллете #280 помечен grid-only (этот docs-коммит)

## Что выполнено

1. **`start`-ветка контракта обновления (T1, `e68d73f2` small)** —
   `ScheduleDataContext.updateActivity` принимает тот же dual
   time-source юнион, что `addActivity` (#280): `{ start: string }` —
   полный floating-local ISO из datetime-поля формы (в PATCH payload
   as-is; выбранная дата может быть вне открытой недели) — с
   приоритетом над `{ dayIndex, startMinutes }` (легаси-конвертация
   открытой недели; после #553 — только штампы сетки WeekView/DayView/
   dnd). При обоих источниках `start` WINS, легаси-пара молча
   игнорируется (юнит-пин приоритета; реальный отправитель оба не
   шлёт — форма шлёт только `start`, сетка только `dayIndex +
   startMinutes`). Частичный `dayIndex` без `startMinutes` игнорируется
   как прежде (both-fields условие). Путь промисифицирован:
   `mutateAsync` + catch-guard — `updateActivity` возвращает
   `Promise<void>` (зеркало промисифицированного `addActivity` #595);
   fire-and-forget потребители (drag&drop/штампы) игнорируют промис.
2. **Полная дата из формы (T2, `548c86c9` small)** — вкладка
   редактирования (`SettingsTab`) отправляет выбранную календарную
   дату целиком; очистка поля даёт '' — патча нет вовсе (empty guard).
3. **Тост успеха патча даты-времени (T3, `295a2dbb` small)** — уровень
   модалки (`ActivityDetailsModal`): при резолве промиса
   `updateActivity` с `start`-патчем — тост «Сохранено: {услуга} —
   {formatDateRu дата}, {время}» (info kind = дефолт `showToast`;
   канон тостов #261; текст зеркалит create-тост). ТОЛЬКО для
   `start`-патчей: занятие может уйти из открытой недели (карточка
   «исчезает» на рефетче) — тост называет выбранную дату. Остальные
   поля молчаливы; отказ молчалив — catch-guard промиса + onError
   мутации откатывает оптимистичную запись (error-тоста у обновлений
   занятия нет). Модалка не закрывается по исходу патча (гейт B).
4. **E2E US-1 — перенос в другую неделю (T4, `92b00468` standard)** —
   сценарий 16 в `activity-details-modal.spec.ts`: правка даты
   переводит занятие в ДРУГУЮ неделю — выбранная календарная дата
   соблюдена (до-#553 выбор конвертировался в открытую неделю и
   терялся); проверка тоста «Сохранено: {услуга}, {дата по-русски},
   {ЧЧ:ММ}».
5. **E2E US-2/US-3/US-5 (T5, `46feb8fd` standard)** — сценарий 17
   (US-2): перенос в другой день той же недели через форму; сценарий 18
   (US-3): правка только времени — дата-часть не трогается; сценарий
   19 (US-5): открытие и закрытие формы редактирования БЕЗ правок.
   US-4 (drag-тест переноса) не тронут — зелёный без правок ожиданий.

## Отклонения и особенности

- **Визуальный гейт — checks 1–2 перекрыты решением пользователя
  (2026-11-13, вариант (a))**: VCC спеки рев.2.1 предшествует канону
  статической достижимости 2026-11-12 — указанные в спеке чеки
  статически недостижимы генерик-раннером; E2E приняты как
  верификация. Check 3 passed. Follow-up: #615.
- **Два pre-existing сценария 14/15** (`activity-details-modal.spec.ts`)
  — load-флейки полного прогона, зелёные изолированно; ожидания не
  правились.
- **US-4 без правок ожиданий** — drag-перенос продолжает ходить через
  легаси-ветку `{ dayIndex, startMinutes }`, контракт которой сохранён.

## Верификация (финальные прогоны)

| Проверка | Результат |
| --- | --- |
| admin vitest — `ScheduleDataContext.test.tsx` | **54/54** |
| admin vitest — `ActivityDetailsModal.test.tsx` (вкл. 3 toast-теста #553) | **107/107** |
| Соседние specs | зелёные |
| `tsc --noEmit` + eslint | чистые |
| e2e `activity-details-modal.spec.ts` | **20/20** (US-1/2/3/5 новые; 14/15 — load-флейки, зелёные изолированно) |
| Визуальный гейт | check 3 passed; checks 1–2 — user decision 2026-11-13 вариант (a), e2e как верификация (follow-up #615) |

## Ревью

- T1–T3 — small (1-stage), T4/T5 — standard (two-stage); все 5 задач
  done + reviewed.

## Behavioral Delta

Правка даты в форме редактирования: выбранная дата конвертировалась в
«открытая неделя + день недели» (дата вне открытой недели молча
терялась) → полный ISO уходит в PATCH as-is, выбранная календарная
дата соблюдена (вне открытой недели — в том числе в прошлом).
Появился тост успеха «Сохранено: …» для старт-патчей (ранее все
инстант-патчи молчаливы). Контракт `updateActivity` расширен юнионом
#280 с приоритетом `start`; легаси-ветка сетки и drag-поток не изменились.

## PR-заметки

- `Closes #553` — только в описании PR (канон репо), в коммиты не пишется.
- Спека (рев.2.1) и план (5/5) — на main, unchanged by IMPL; дом-правила
  `activities.md` — в этом docs-коммите ветки.
- Бэкенд, api-client, модель, миграции — ноль изменений (frontend-only).

## Тронутые файлы (`git diff --name-only 2172bd75..46feb8fd`)

```
frontend/admin/__tests__/ActivityDetailsModal.test.tsx
frontend/admin/__tests__/schedule/ScheduleDataContext.test.tsx
frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx
frontend/admin/app/components/modal/ActivityDetailsModal/SettingsTab.tsx
frontend/admin/contexts/schedule/ScheduleDataContext.tsx
frontend/admin/e2e/activity-details-modal.spec.ts
```

## References

- **GitHub Issue**: #553
- **Design Spec**: `docs/specs/2026-10-25-activity-edit-honest-date-design.md` (рев.2.1)
- **Plan**: `docs/plans/2026-11-13-activity-edit-honest-date-plan.md` (5/5)
- **Domain rules**: `docs/domain-rules/activities.md`
- **Смежные**: #280 (канон create-юниона — зеркало контракта), #142 (DateTime canon), #595 (прецедент промисификации мутации), #261 (канон тостов), #422 (фиксированная неделя сида; сервер принимает прошедшие даты), #615 (follow-up: канон статической достижимости VCC)
- **PR**: _(to be added after PR creation)_
