# План: #286 «Удаление занятия по единому контракту отложенного удаления»

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Удаление занятия (обоих call sites — карточка сетки и кнопка модалки деталей) переезжает на общий отложенный пайплайн (`PendingActionsContext`) по единому контракту #285 rev8: клик → проверка актуальности кэша (ручная stale-проверка + `await fetchQuery`) → `?dry_run=true` → пусто: окно отмены 5с / есть записи: DeleteDialog с тремя группами однострочников (записи/визиты/платежи) → confirm → окно → commit с телом `{expected: {records, visits, payments}}` (subset-сверка per-entity по рекурсивному поддереву, 409 → откат + «данные изменились» + «Обновить»). Bare DELETE → 422. Recreate-undo (`addActivity` в `ActivityCard`) удаляется; индикатор «Сохраняем…» на удалении подавлен.

**Architecture:** Три слоя. (1) Бэкенд: Activity проводится в `FK_MATRIX`/`collect_dependencies` как **preview-only** (records cascade НЕ-auto + photos nullify auto + activity_tags auto); `DELETE /activities/{id}` получает `?dry_run=true` (204/409+items/404; dry_run+тело → 422), тело `{expected}` flat-параметрами (subset-сверка — переиспользование хелпера #285 Task 2), bare DELETE → 422 `expected_state_required`; исполнение — рукописный сервис без изменений (тест-лок). (2) Фронт: `ScheduleDataContext` — владелец deferred-механики (`deleteActivityDeferred`, optimistic replace-by-id, staleAwareOnError-activities); `ActivityCard`/`ActivityDetailsModal` — только инициация; DeleteDialog получает entityType `'activity'` + баннер-проп. (3) Тесты: обновляемые (`schedule-saving-toast`, `server-push-invalidation`, `test_events_emit.py`, e2e-cleanup `factories.ts`, `ActivityCard.test.tsx`) + новые S1–S6.

**Tech Stack:** FastAPI + SQLAlchemy (backend), TanStack Query v5 / React 18 (frontend/admin), vitest+jsdom (unit), Playwright (e2e), `uv run --extra dev pytest`.

**Спека:** `docs/specs/2026-09-17-activity-deferred-deletion-design.md` (rev2 — панель 6/6; оба call sites; баннер при рефетче; nested-counts НЕ строим; 422 безусловно).

**Хард-гейт: T0.** #285 смержена (expected-check-хелпер, `auto`/`items` в `DependencyNode`, action-слот, `staleAwareOnError` — их в main сегодня НЕТ).depends-on issue: #94 (смержен `8520609`), #285. Перед каждым коммитом — `git pull --rebase origin main`.

---

## Behavioral Delta

Как это поведёт себя для пользователя (маппинг на сценарии спеки §6):

- **S1 (свободное занятие):** клик в режиме удаления (или кнопка в модалке) — карточка исчезает сразу, undo-тост «Удалено. Отменить» с кольцом отсчёта; сервер не тронут 5 секунд; через окно занятие удалено из БД. «Сохраняем…» на удалении НЕ появляется.
- **S2 (отмена):** «Отменить» в окне — карточка возвращается (replace-by-id, соседние обновления не откатываются); ни одного удаляющего запроса не ушло.
- **S3 (каскад через диалог):** занятие с записями — диалог «занятия»: «Записи — будут удалены:» + однострочники (клиент/услуга/дата, ≤10 + «и ещё N»); если кэш устарел и при клике был рефетч — первая строка диалога «Карточка обновлена по данным сервера». Confirm — карточка исчезла, undo-тост; через окно каскад (записи/визиты/платежи).
- **S4 (отмена каскада):** после confirm «Отменить» — карточка вернулась, БД не тронута.
- **S5 (провал commit):** сеть off в окне — по истечении карточка вернулась, красный тост.
- **S6 (гонка середины окна):** коллега добавил запись в подтверждённое занятие — commit 409 → карточка вернулась, тост «Не удалось удалить: данные изменились» с кнопкой «Обновить» (клик перечитывает неделю).
- **Модалка:** кнопка «Удалить активность» в `ActivityDetailsModal` ведёт тот же поток (dry-run → диалог при зависимостях → окно отмены); модалка закрывается сразу, удаление завершается фоном; тост «Активность удалена» удалён.
- **Без изменений:** каскадная семантика (записи+вложенные удаляются, фото отвязываются), диалоги/удаления других сущностей, undo визитов/оплат, «Сохраняем…» на create/update, SSE-карта, кольцо у всех undo-тостов.
- **Изменение контракта API занятий:** bare DELETE без флага и без тела → 422 `expected_state_required`; `dry_run=true` + тело → 422 `invalid_delete_request`; предпросмотр — только `?dry_run=true`.

## Структура файлов

- Бэкенд: `backend/src/domain/deletion.py` (FK_MATRIX, collect, items/label-билдер), `backend/src/api/v1/activities.py` (DELETE), `backend/src/services/activity.py` (без изменений execution), `backend/tests/test_events_emit.py` (обновление), новые юнит-тесты.
- api-client: `packages/api-client/src/endpoints.ts`.
- Фронт: `frontend/admin/contexts/schedule/ScheduleDataContext.tsx`, `app/components/schedule/ActivityCard.tsx`, `app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx`, `app/components/DeleteDialog.tsx`, `app/components/layout/Topbar.tsx` (без правок — гард-следствии D6), `contexts/PendingActionsContext.tsx` (без правок — всё приходит из #285), `lib/invalidate.ts` (без правок).
- E2E: `frontend/admin/e2e/schedule-saving-toast.spec.ts`, `frontend/admin/e2e/server-push-invalidation.spec.ts`, `frontend/admin/e2e/fixtures/factories.ts`, новый файл `activity-deferred-delete.spec.ts`.
- Доки: `docs/domain-rules/activities.md`, `docs/domain-rules/_overview.md`, `docs/specs/2026-09-14-saving-toast-design.md` (S5), `docs/specs/2026-09-16-deferred-record-deletion-design.md` (NOTE §3/§9), `CHANGELOG.md`.

---

## Task 1: Бэкенд — FK_MATRIX/collect для Activity + label-билдер записей

- [x] `FK_MATRIX[Activity] = [records (cascade, НЕ auto), photos (nullify, auto=True), activity_tags (cascade, auto=True)]` в `backend/src/domain/deletion.py` (зеркало фактических FK: `models/record.py:19`, photos SET NULL `activity.py:265-267`).
- [x] Рекурсивный сбор дерева занятия на два уровня (решение юзера 17.09): records (прямые дети) + visits/payments каждой записи (record_tags — auto, исключён; у Visit/Payment новых не-auto узлов нет).
- [x] **Preview-only инвариант:** generic-резолвер для (Activity, photos/activity_tags/records) НЕ подключается к исполнению (`NULLIFY_HANDLERS`/`CASCADE_HANDLERS` не расширяются) — матрица потребляется только collect'ом; юнит-тест-лок: `DELETE /activities/{id}` идёт рукописным сервисом (трассировка/мок), не generic-резолвером.
- [x] Три узла с `items`: records — label «{услуга}, {дата}, {клиент|Аноним}» (услуга через `activity.service_id`, клиент nullable → fallback; join из одного запроса, PII-граница D9б #285); visits/payments — label-билдеры #285 Task 3 переиспользуются как есть («{услуга}, {цена}» / «{сумма}, {метод}»).
- [x] Юниты: collect_dependencies(Activity) — три узла с items (records не-auto; visits/payments второй уровень; photos/activity_tags auto, без items); пустое дерево на занятии без записей; label-билдеры (формат, fallback).

## Task 2: Бэкенд — контракт DELETE /activities/{id}

- [ ] `?dry_run=true` (Annotated-стиль, как D1 #285): 204 без удаления на пустом дереве; 409 `{detail: has_dependencies, dependencies}` с `items` у records-узлов при зависимостях; 404 на отсутствующем id (**probe существования** — паттерн #285); `dry_run=true` + тело → 422 `invalid_delete_request`.
- [ ] Тело реального DELETE — два flat-параметра (не embed — урок wave 2 #285): `expected` (id-множества per-entity: records/visits/payments, required) — subset-сверка через хелпер #285 Task 2: существование → collect (рекурсивное поддерево) → сверка per-entity (auto-исключены; 409 по id ЛЮБОГО узла, отсутствующим в expected; появление визита в подтверждённой записи ловится) → исполнение рукописным сервисом; расхождение → 409 `stale_dependencies` с деревом+items (`exclude_none=True`).
- [ ] Bare DELETE без флага и без тела → 422 `expected_state_required` **безусловно** (`ErrorDetail(ErrorCode.EXPECTED_STATE_REQUIRED)` — канон соседних эндпоинтов).
- [ ] `_WRITE_GUARD` наследуется всеми ветками (без ослабления).
- [ ] Юниты: 422 (голый; dry_run+тело), 404 dry-run (probe), 204 dry-run пустого, subset per-entity (новая запись ИЛИ новый визит/платёж за окно → 409; исчезнувшие — не блокируют; auto-исключение), порядок «сверка до исполнения» (fail-closed, частичного каскада нет), label-билдеры (records формат+fallback; visit/payment переиспользование).

## Task 3: api-client — `dryRunDeleteActivity` + `deleteActivityWithExpected`

- [ ] `dryRunDeleteActivity(id)` — `DELETE /activities/{id}?dry_run=true` → 204 (пусто) / 409 (дерево, `ApiError.dependencies` — парсинг уже есть) / 404/422.
- [ ] `deleteActivityWithExpected(id, {expected: {records: string[], visits: string[], payments: string[]}})` — DELETE с телом; bare `deleteActivity` удаляется из пакета (потребитель — контекстный deleteMutation — удаляется в T4; e2e-cleanup переписывается в T7).
- [ ] Юниты контрактов: сигнатуры, парсинг 409-пейлоада с items, 422-проброс.

## Task 4: ScheduleDataContext — `deleteActivityDeferred` (владелец механики)

- [ ] Удалить `deleteMutation` (:211-216) и `deleteActivityById` (:277-279); `SCHEDULE_ACTIVITY_MUTATION_KEY` остаётся только у create/update (D6 спеки; Topbar beforeunload-guard не покрывает deferred-удаление — принято).
- [ ] `deleteActivityDeferred(id)`: (1) stale-проверка `getQueryState(weekKey)` → `isInvalidated || возраст > staleTime` → `await fetchQuery({queryKey: weekKey, staleTime: 0, meta: {silent: true}})` (глобальный QueryCache.onError тостит сам — escape hatch `providers.tsx:17-24`; флаг `refetched`); (2) `dryRunDeleteActivity`; (3) пусто → `await cancelQueries(weekKey)` → snapshot (weekKey + activitiesForRecords при наличии) → optimistic map-remove → enqueue `{id: 'delete-activity-${id}', delayMs: 5000, undo: replace-by-id restore (D4 спеки — НЕ restore значения), commit: deleteActivityWithExpected(id, {expected: {}}) + invalidateEntities(['activities'])` (чистый путь — все три множества пустые); (4) 409+dependencies → вернуть `{kind: 'needs-confirm', dependencies, refetched}` наверх (диалог); (5) onError = `staleAwareOnError(queryClient, 'activities')` (параметризация хелпера #285 Task 5: 409+dependencies → undo + тост «Не удалось удалить: данные изменились» + action «Обновить» → invalidateEntities(['activities']); 404 — тихий; прочее — дефолт).
- [ ] Confirm-метод (для диалога): enqueue с `expected` = полный список id из items всех трёх узлов (не display-cap 10) — подтверждение = сущностный чекбокс диалога (D9в #285).
- [ ] **Sweep `deleteActivity`:** после переписывания потребителей (T5) — `git grep -n "deleteActivity\b" frontend/admin`; удалить экспорт `deleteActivity` из value-объекта контекста (:365) и импорты из `ActivityCard.tsx:27`/`ActivityDetailsModal.tsx:207`; осиротевших потребителей нет.
- [ ] `deletingRef`-гвард карточки: reset в finally (fail-closed); 150мс-анимация сохраняется как отклик клика до завершения dry-run.
- [ ] Юнит `__tests__/ScheduleDataContext.test.tsx` (или новый файл) — `deleteActivityDeferred`-ветки: (а) dry-run 409 → needs-confirm БЕЗ enqueue; (б) 204 → enqueue; (в) `expected` доходит до тела commit (`{}` у чистого пути, items у каскадного); (г) undo = replace-by-id (SSE-обновления соседних карточек за окно не откатываются).
- [ ] Юнит `staleAwareOnError(queryClient, 'activities')` — три ветки отдельными кейсами: (а) 409+dependencies → undo + тост «Не удалось удалить: данные изменились» с action «Обновить» → `invalidateEntities(['activities'])`; (б) 404 → тихий успех; (в) прочие → дефолт (undo + красный тост).
- [ ] Юнит `ActivityCard.test.tsx:413-452` переписан под async-поток.

## Task 5: Call sites — ActivityCard + ActivityDetailsModal

- [ ] `ActivityCard.tsx:71-93`: ветка удаления → `deleteActivityDeferred(id)`; needs-confirm → контекст держит pending-confirm состояние (`{activityId, dependencies, refetched}`) → диалог рендерит WeekView/DayView (переживает unmount карточки); recreate-undo-ветка (`addActivity` :78-88) удаляется (сама `addActivity` — публичный API контекста — остаётся: `DayView.tsx:155`, `WeekView.tsx:112`, `CreateActivityTab.tsx:62`, `useDnD.ts:188`).
- [ ] `ActivityDetailsModal.tsx:206-210`: `handleDeleteActivity` → тот же `deleteActivityDeferred`; модалка закрывается немедленно (`onClose()` сохраняется), тост «Активность удалена» удалён (общий тост потока); needs-confirm от модалки — тот же pending-confirm механизм (диалог на уровне view).
- [ ] Юнит `ActivityCard.test.tsx:413-452` переписан под async-поток (150мс-анимация сохраняется как отклик клика до dry-run; асинхронное завершение).
- [ ] DoD-ассерт: оба call sites покрыты e2e (S1/S3 через карточку и через модалку).

## Task 6: DeleteDialog — entityType 'activity' + баннер

- [ ] Union `DeleteDialogEntityType` + `'activity'`; `TITLE_BY_TYPE` + «занятия» (completeness-BLOCKER wave 1).
- [ ] `RELATION_PLURAL`/`AUTO_ENTITIES`: activity_tags — auto (отсечение по полю `auto`, не по хардкоду — precondition #285 Task 7: `auto: bool` в `DependencyNode`); records-узел рендерится items-однострочниками («Записи — будут удалены:» + построчно, cap 10 + «и ещё N» — cosmetics; фронт держит полный список id для expected).
- [ ] Опциональный проп `refetchNote?: string` — баннер первой строкой «Карточка обновлена по данным сервера» (рендерится только при `refetched=true`; чистый путь без диалога нотиса не имеет).
- [ ] Для занятий: `onResolve` = enqueue (синхронный — busy/error-ветки диалога не задействуются), `onDone` = только закрытие **без инвалидации**; выбор резолюций для занятия недостижим (все каскад) — ветка Mode B не рендерится.
- [ ] Юниты: activity-вариант (items-рендер, баннер, confirm — сущностный, без choice-чекбоксов по записям).

## Task 7: e2e — обновляемые + новые S1–S6

- [ ] Обновить `schedule-saving-toast.spec.ts:242-283` (S5 #261): DELETE ждётся на commit +5с (после undo-тоста); `toast-loading` на удалении НЕ появляется; `toast-info` «удалено» приходит сразу (с кольцом — countdown-атрибут, если #94-паттерн ассертится).
- [ ] Обновить `server-push-invalidation.spec.ts`: хелпер `deleteActivityViaUI` (:50-72) под новый контракт; **ассерт — commit-DELETE с телом `{expected}` / отсутствие занятия в БД после окна**, не «204 в клике» (ложнозелёный на dry-run); С3 (:154-205) — конвергенция records-family после commit.
- [ ] Обновить общий cleanup-хелпер `fixtures/factories.ts:513-533` (радиус ~26 e2e-файлов с занятиями):
  - (а) activities-ветка под новый контракт: сначала `DELETE ?dry_run=true` → 204/409(+items) → DELETE с телом `{expected: {records: [...], visits: [...], payments: [...]}}` (ids из items всех узлов) (404/409 от повторного cleanup глушатся, остальные ошибки НЕ глушатся);
  - (б) счётчик голых DELETE: `git grep -n "activities" frontend/admin/e2e/fixtures/factories.ts` — не остаётся bare-DELETE вызовов по `/api/v1/activities`;
  - (в) DoD-команда: прогон одного шарда/смоук (`npm --prefix frontend/admin exec playwright test -- --grep cleanup`) зелёный; `test-all.sh` в T9 подтверждает отсутствие регресса по всем 26 файлам.
- [ ] Обновить `backend/tests/test_events_emit.py:118-125`: `DELETE {expected: {records: [...], visits: [...], payments: [...]}}` + тот же набор `mark_changed`.
- [ ] Новые тесты `activity-deferred-delete.spec.ts`: S1 (карточка; чистый путь), S2 (отмена — DELETE не уходил, `postData()===null`), S3 (диалог: однострочники + баннер при stale-прайме — паттерн `activity-details-modal.spec.ts:535`), S4 (отмена каскадного), S5 (setOffline — commit-фейл: карточка вернулась, красный тост), S6 (в окне через `page.request` создаётся ВИЗИТ в подтверждённой записи — вложенный уровень → 409 → тост «данные изменились» + клик «Обновить» → инвалидирует неделю; появление новой записи — юнит subset).
- [ ] Вариант S1/S3 через модалку (`btn-delete-activity`) — минимальный ассерт того же потока.

## Task 8: Доки + CHANGELOG

- [ ] `docs/domain-rules/activities.md`: §Delete — отложенное удаление по контракту (dry_run + expected subset + bare → 422); Activity-запись матрицы — preview-only; execution — рукописный сервис.
- [ ] `docs/domain-rules/_overview.md`: строка единого контракта дополняется — Activity подключена (expected = {records}); `Expected`-колонка матрицы.
- [ ] `docs/specs/2026-09-14-saving-toast-design.md`: S5 — занятие больше не идёт через mutation-key («Сохраняем…» на deferred-удалении отсутствует; тост → коммит тихий).
- [ ] `docs/specs/2026-09-16-deferred-record-deletion-design.md` (#285): NOTE в §3 (единый контракт) и §9 (пункт #286) — «актуализировано #286: серверные зависимости занятия (записи) подтверждены каскадом (`activity.py:229-274`), Activity проведена в матрицу, expected подключён».
- [ ] `CHANGELOG.md` — строка, черновик:
  ```markdown
  - Удаление занятия переведено на общую отложенную схему с отменой (единый контракт #285): окно отмены 5с с кольцом отсчёта, диалог зависимостей (какие записи будут удалены), защита от гонок (`expected`-сверка) и честные ошибки при изменении данных; удаление из модалки деталей — тот же поток; тост «Сохраняем…» на удалении больше не показывается (#286).
  ```

## Task 9: Финал — полный прогон

- [ ] `test-all.sh` (sequential) зелёный: pytest/lint/typecheck; **юнит-набор — поимённо зелёные**: `__tests__/ScheduleDataContext.test.tsx` (deleteActivityDeferred-ветки + staleAwareOnError-ветки (а)(б)(в)), юниты api-client (`dryRunDeleteActivity`/`deleteActivityWithExpected`/422-проброс), `ActivityCard.test.tsx`, `DeleteDialog` activity-вариант (items-рендер, баннер, сущностный confirm без choice-чекбоксов по записям), бэкенд `test_api_activities.py` (422×2, 404 probe, 204 empty, subset ×3: появление/исчезновение/auto-исключение, label fallback) и `test_events_emit.py`.
- [ ] Проверка «Closes #286» в PR-body (issue закрывается сам на мерже); правило design-phase §6: closing-слова в direct-to-main коммитах не писать.

---

## DoD (сводка спеки §8)

Оба call sites через общий пайплайн (проверка кэша → dry-run → окно 5с → commit с `expected`); recreate-undo удалён; Activity в FK_MATRIX preview-only; контракт DELETE: dry_run (204/409/404; +тело → 422), `{expected}` subset до исполнения, bare → 422; индикатор подавлен (S5 #261 пересмотрен); баннер только при реальном рефетче; S1–S6 e2e + обновлённые тесты зелёные; доки (activities.md, _overview.md, NOTE #285, CHANGELOG).
