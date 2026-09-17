# План: #285 «Отложенное удаление записей с undo-тостом»

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Удаление записи (records) переезжает на общий отложенный пайплайн (визиты/оплаты, `PendingActionsContext`): клик → явный dry-run → окно отмены 5с → commit. Commit обоих путей (чистый и каскадный) несёт тело с `expected` (id-множества зависимостей) — сервер сверяет состояние перед исполнением; расхождение → 409 → строка возвращается. Провал commit больше не молчит (undo + error-тост, 404 = тихий успех) — для всех потребителей пайплайна.

**Architecture:** Три слоя. (1) Бэкенд: `?dry_run=true` на `DELETE /records/{id}` — чистый предпросмотр (204-без-удаления / 409 с деревом, где у зависимостей записи появляются `items: [{id, label}]`); тело DELETE расширяется до `{resolutions?, expected}` с порядком «существование → collect → сверка expected по id-множествам → валидация resolutions → исполнение». **No-body DELETE без флага → 422 `expected_state_required` (rev7, решение юзера — полурурушающая ветка у записей упразднена; у других сущностей контракт не трогается).** (2) Фронт: api-client (`dryRunDeleteRecord`, `resolveDeleteRecord` с обязательным `expected`; bare `deleteRecord` удаляется), снапшот/restore по-ключевой в `recordCacheSync`, хук `useDeleteRecord` переписан на deferred, `PendingActionsContext` получает обобщённый `onError`. (3) Call sites + `DeleteDialog` (однострочники зависимостей для записей) + e2e.

**Tech Stack:** FastAPI + SQLAlchemy (backend), TanStack Query v5 / React 18 (frontend/admin), vitest+jsdom (unit), Playwright (e2e), `uv run --extra dev pytest`.

**Спека:** `docs/specs/2026-09-16-deferred-record-deletion-design.md` (rev6).

**Хард-гейта нет.** Соседние дорожки: #94 (гейт `countdownMs` в `PendingActionsContext`/`UIContext`/`ToastContainer` — непересекающиеся строки, у этого плана в `PendingActionsContext` правится блок commit-таймера `:64-68`, у #94 — вызов тоста `:54-61`) и #286 (занятия — свой домен). Если к старту IMPL не смержены — брать актуальное состояние main; по смыслу конфликтов нет. Перед каждым коммитом — `git pull --rebase origin main`.

---

## Behavioral Delta

Как это поведёт себя для пользователя (маппинг на сценарии спеки §6):

- **Сценарий S1 (запись без зависимостей):** нажимаю удалить — строка сразу исчезает из таблицы, появляется undo-тост «Удалено. Отменить» (с кольцом отсчёта, если #94 уже смержен); сервер ничего не удаляет до истечения окна. Через 5 секунд запись удаляется из БД и из всех списков.
- **Сценарий S2 (отмена чистого удаления):** нажимаю «Отменить» в окне — строка возвращается; на сервер за всё это время не уходит ни одного удаляющего запроса; после перезагрузки запись на месте.
- **Сценарий S3 (каскад через диалог):** нажимаю удалить запись с визитами/оплатами — диалог открывается сразу, строка на месте; зависимости показаны **однострочниками** («Посещения — будут удалены:» + по строке на каждый визит/платёж; больше 10 — «и ещё N»). Подтверждаю — строка исчезает, тост «Удалено. Отменить»; через окно каскад исполняется.
- **Сценарий S4 (отмена каскада):** после подтверждения диалога нажимаю «Отменить» — строка возвращается, БД не тронута.
- **Сценарий S5 (провал commit):** сеть пропала в окне — по истечении удаление не происходит, строка возвращается в таблицу, красный тост «Не удалось удалить. Изменение отменено».
- **Сценарий S6 (гонка середины окна):** пока тикает окно, коллега добавляет в запись визит/платёж — в момент commit сервер видит, что зависимостей больше, чем я подтверждал (сверка по id), отдаёт ошибку: строка возвращается, **новая зависимость не удаляется**.
- **Все отложенные удаления теперь честно сообщают о провале:** визиты/оплаты — тоже: если commit не удался, строка возвращается + error-тост (сегодня — молчаливая потеря); если запись уже удалена кем-то другим (404) — тихий успех, без ложной ошибки.
- **Без изменений:** текст/вид тоста у визитов/оплат, кнопка «×» (скрывает тост, commit продолжается), лимит стека 5, «Сохраняем…» #261, SSE-тост #239, семантика resolutions других сущностей, их диалоги, матрица удаления и их no-body DELETE контракт.
- **Изменение контракта API записей (rev7, решение юзера):** no-body DELETE без флага и тело без `expected` → 422 `{"detail": "expected_state_required"}` — каждое реальное удаление записи обязано нести заявленное состояние; предпросмотр — только `?dry_run=true`. У других сущностей no-body DELETE остаётся.

## Структура файлов

**Создаётся:** ничего (только тест-файлы по месту).
**Изменяется:** `backend/src/api/v1/records.py`; `backend/src/domain/deletion.py`; `backend/tests/test_api_records.py`; `packages/api-client/src/endpoints.ts`; `packages/api-client/src/client.ts` (тип `DependencyNode`); `frontend/admin/lib/cache/recordCacheSync.ts`; `frontend/admin/hooks/useDeleteRecord.ts`; `frontend/admin/contexts/PendingActionsContext.tsx`; `frontend/admin/app/(main)/records/components/RecordsTable.tsx`; `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx`; `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx`; `frontend/admin/app/components/DeleteDialog.tsx`; `frontend/admin/__tests__/useDeleteRecord.test.ts`; `frontend/admin/__tests__/PendingActionsContext.test.tsx`; `frontend/admin/__tests__/DeleteDialog.test.tsx` (если существует — греп); `frontend/admin/e2e/records.spec.ts`; `frontend/admin/e2e/activity-details-modal.spec.ts`; `docs/domain-rules/records.md`; `docs/domain-rules/_overview.md`; `CHANGELOG.md`.
**Удаляется:** ничего.

---

## Task 1: Бэкенд — флаг `dry_run` на DELETE /records/{id}

### Classification: standard

### Required Docs
- `docs/specs/2026-09-16-deferred-record-deletion-design.md` — §3 D1 (контракт флага, probe), §2 (бэкенд)
- `backend/src/api/v1/records.py:154-207` — текущий единый DELETE (no-body = execute-if-clean / 409; body = resolve)
- `backend/src/domain/deletion.py:473-507` — `collect_dependencies` (на отсутствующем id возвращает пусто — probe обязателен)
- `backend/tests/test_api_records.py:1034` — тест «unified dry-run (no body)» (переименование)

### Steps
- [ ] В DELETE-обработчик (`records.py:154`) добавить параметр `dry_run: Annotated[bool | None, Query(description="Non-destructive preview: returns 204 without deleting (no deps) or 409 with the dependency tree; never modifies rows")] = None`.
- [ ] Ветка `dry_run=True` (до любой записи в БД): если тело `resolutions` передано вместе с флагом → `422` с detail `"dry_run_with_resolutions_forbidden"`. Затем probe существования записи (тот же repository-get, что в execute-пути `records.py:202-210`) → нет записи → `404` (тот же формат ответа, что сегодня). Затем `collect_dependencies` → пусто → вернуть `204` **без вызова `service.delete`** (строки не тронуты, SSE-меток нет); непусто → `409` `{detail: "has_dependencies", dependencies: [...]}` — ровно сегодняшний формат.
- [ ] Голая ветка (без флага) — без изменений по поведению.
- [ ] Docstring роута переименовать: «dry-run (no body)» → «no body: execute-if-clean (204) / preview (409)»; флаг описать как pure preview.
- [ ] Тесты в `test_api_records.py`: (а) `?dry_run=true` на записи с зависимостями → 409 + дерево, запись жива (повторный GET → 200, счётчики неизменны); (б) `?dry_run=true` на записи без зависимостей → 204 И запись жива; (в) `?dry_run=true` на несуществующем id → 404; (г) `?dry_run=true` + тело resolutions → 422; (д) **no-body DELETE без флага → 422 `{"detail": "expected_state_required"}`** (ревизия rev7 — сегодня такой запрос удаляет чистую запись; существующие no-body-тесты переписываются на 422, ожидание исполнения переносится на body-ветку `{"expected": {}}`); (е) после dry-run нет SSE-событий по record/visits/payments (паттерн `backend/tests/test_events_emit.py:128-146`).
- [ ] Переименовать тест `:1034` — «unified dry-run (no body)» → «unified delete contract (dry-run preview / body with expected; no-body forbidden)».

### DoD
- `uv run --extra dev pytest backend/tests/test_api_records.py -x -q` зелёный; dry-run не изменяет строки и не эмитит SSE; 422-комбо, 422-no-body и 404 probe покрыты; контракт rev7 (no-body → 422) зафиксирован тестами.

---

## Task 2: Бэкенд — expected-сверка в DELETE с телом

### Classification: large

### Required Docs
- `docs/specs/2026-09-16-deferred-record-deletion-design.md` — §3 D1 (механизм гонки, порядок обработки), D9а (id-множества); §4 (гонка середины окна)
- `backend/src/api/v1/records.py:154-207` — текущий body-контракт (`resolutions: dict | None = Body(embed=True)`)
- `backend/src/services/record.py:401-451` — `resolve_delete` (порядок: existence → collect → has_blocking → validate_resolutions → delete)
- `backend/tests/test_api_records.py` — существующие resolve-тесты (регресс)

### Steps
- [ ] Тело DELETE записей заменить с `resolutions: dict | None = Body(embed=True)` на модель `RecordDeleteBody` (pydantic, `Body(embed=True)`): `resolutions: dict[str, str] | None = None; expected: dict[str, list[int]] | None = None`. **Ревизия rev7: на execute-пути (не dry_run) `expected` обязателен — в обработчике: тело отсутствует или `expected is None` → `422` `{"detail": "expected_state_required"}`** (схема остаётся опциональной — enforcement в ветке, чтобы не ломать dry-run без тела).
- [ ] В `deletion.py` — сбор зависимостей с id: для записей дополнительно к счётчикам собрать **id-списки** зависимостей (visits: id строк visits записи; payments: id строк payments; record_tags: id строк связи). Внутренняя функция `collect_dependency_ids(session, Record, id) -> dict[str, list[int]]` (per-entity). Авто-зависимости (record_tags) в expected-сверке **не участвуют** (резолвятся автоматически).
- [ ] Порядок обработки в ветке с телом (в обработчике, до `service.resolve_delete`): существование → collect → **expected-сверка**: для каждой собранной не-авто зависимости `set(now_ids) ⊆ set(expected.get(entity, []))`; нарушение → `409` `{"detail": "stale_dependencies", "dependencies": <текущее дерево>}` (формат `DependencyNode` — парсится в `ApiError.dependencies` без изменений). Только при совпадении → `resolve_delete` (валидация resolutions как сегодня) → 204. Пояснение семантики: **subset, не равенство** — зависимость, исчезнувшая за окно, не блокирует (удаляем меньше подтверждённого); появившаяся — блокирует.
- [ ] Границы: `expected` обрабатывается только на роуте записей; другие сущности тело не меняют (их `{"resolutions"}`-контракт нетронут).
- [ ] Тесты: (а) чистая запись + `{expected: {}}` → 204, удалена; (б) чистая + в окне добавлен платёж (в тесте — создать payment до запроса) + `{expected: {}}` → 409 `stale_dependencies`, запись и платёж живы; (в) каскад: 2 визита + `resolutions` + `expected {visits: [id1,id2]}` → 204, каскад исполнен; (г) каскад: 2 визита, `expected {visits: [id1]}` (один появился сверх) → 409, ничего не удалено; (д) обмен при равном счётчике: expected `visits: [a]`, в БД visit `b` → 409 (счётчики равны, id нет); (е) зависимость исчезла за окно: expected `visits: [a]`, в БД пусто → 204 (subset); (ж) expected для отсутствующего энтити-ключа в expected, но он появился → 409; (з) **тело `{resolutions: {...}}` без `expected` → 422 `expected_state_required`** (rev7); (и) **существующие resolve-тесты обновляются**: в каждый body добавляется `expected` (id-списки из setup теста) — без него они теперь 422; их ассерты 204/422 не меняются.

### DoD
- `uv run --extra dev pytest backend/tests/test_api_records.py -x -q` зелёный; expected-сверка по id работает на обеих ветках (чистая/каскад), порядок «сверка → валидация resolutions» подтверждён тестом (б/г дают 409, а не 422); контракт rev7 (expected обязателен, тело без него → 422) зафиксирован тестами; resolve-контракт других сущностей не тронут.

---

## Task 3: Бэкенд — `items` в 409-пейлоаде записей (id + однострочные метки)

### Classification: standard

### Required Docs
- `docs/specs/2026-09-16-deferred-record-deletion-design.md` — §3 D9б/в (items, метки, формат), границы (§5)
- `backend/src/domain/deletion.py:209-224,235-246` — FK_MATRIX для Record, модель `DependencyNode`
- `backend/src/models/visit.py:10-27`, `backend/src/models/payment.py:10-20` — поля для меток (visit: tariff→service.title + price; payment: amount + method)

### Steps
- [ ] `DependencyNode` (deletion.py:235-246) дополняется `items: list[DependencyItem] | None = None`, где `DependencyItem {id: int, label: str}`. Поля `count` и `cascade_preview` не удаляются.
- [ ] Заполнение: при сборе зависимостей **для записей** (entity visits/payments/record_tags) заполнять `items` — id + label. Для других сущностей `items` остаётся None (их потребители не меняются — §5).
- [ ] Билдеры меток (в `deletion.py`, рядом с матрицей; основа — `__str__` модели, если определён; точный формат):
  - Visit: `«{service.title}, {price}»`, где service = `visit.tariff.service` (через tariff_id); `tariff_id IS NULL` → `«Без тарифа, {price}»`; `service.title` недоступен (tariff без service — по FK матрице tariffs.service_id NOT NULL, случай не возникает; всё равно fallback `«Без тарифа»`).
  - Payment: `«{amount}, {method}»`, `method IS NULL` → `«{amount}, —»`.
  - record_tags (если узел присутствует в дереве): `items` = метка `{tag.title}` по строке связи.
- [ ] Тесты: (а) 409 (no-body, deps) на записи с 2 визитами/1 платежом → узлы visits/payments содержат `items` с id и метками в пиннутом формате; (б) `?dry_run=true` — тот же пейлоад с items; (в) 409 на записи без тегов — узел record_tags (если присутствует) имеет items из меток тегов; (г) 409 других сущностей (например client — существующий тест) — **без** `items` (None/отсутствует); (д) count/cascade_preview не изменились.

### DoD
- `uv run --extra dev pytest backend/tests/test_api_records.py -x -q` зелёный; items в дереве записей (id + метки в пиннутом формате), прочие сущности без items.

---

## Task 4: api-client — `dryRunDeleteRecord` + payload `resolveDeleteRecord`

### Classification: small

### Required Docs
- `docs/specs/2026-09-16-deferred-record-deletion-design.md` — §3 D1/D2/D3 (контракты), D9а (expected = id-множества)
- `packages/api-client/src/endpoints.ts:575-583` — `deleteRecord`, `resolveDeleteRecord`
- `packages/api-client/src/client.ts:21,91-94,112` — `ApiError.dependencies`

### Steps
- [ ] `endpoints.ts`: добавить `dryRunDeleteRecord(id: number): Promise<void>` — `DELETE /api/v1/records/${id}?dry_run=true` без тела; 204 → resolve; 409 → throw `ApiError` (dependencies уже парсится клиентом).
- [ ] `resolveDeleteRecord(id, payload)` — сигнатура меняется: вместо `resolutions` — `payload: { expected: Record<string, number[]>; resolutions?: Record<string, string> }` — **`expected` обязателен в типе (rev7: контракт «каждое удаление несёт состояние» проносится в TypeScript)**; тело = `{expected: ...}` + `resolutions` если передан (`{expected: {}}` у чистого пути — без ключа resolutions).
- [ ] Удалить `deleteRecord` (bare, no-body) из `endpoints.ts` — no-body контракт у записей упразднён (rev7); его единственный потребитель (`useDeleteRecord.ts:55`) переписывается в Task 5; тесты bare-вызова в пакете удаляются вместе с функцией.
- [ ] Тип `DependencyNode` в пакете (греп `grep -rn "DependencyNode" packages/api-client/src/`): добавить `items?: {id: number; label: string}[]`.
- [ ] Тесты пакета: в файл тестов эндпоинтов (греп `grep -rln "resolveDeleteRecord" packages/api-client/src/`) добавить: (а) `dryRunDeleteRecord` шлёт DELETE c `?dry_run=true` и без тела; (б) `resolveDeleteRecord(id, {expected: {}})` — тело `{"expected": {}}`; (в) `resolveDeleteRecord(id, {resolutions: {visits: "cascade"}, expected: {visits: [1,2]}})` — тело содержит оба ключа; (г) 409-ответ с деревом → `ApiError.dependencies` (включая узел с items); (д) тесты удалённого `deleteRecord` (bare) сняты вместе с функцией.

### DoD
- Vitest пакета зелёный (`npm --prefix packages/api-client test -- --run`; если в пакете другой раннер — по `docs/tests_workflow.md`); контракты URL/тела пиннуты тестами.

---

## Task 5: recordCacheSync — снапшот/restore по-ключам + rewrite useDeleteRecord

### Classification: large

### Required Docs
- `docs/specs/2026-09-16-deferred-record-deletion-design.md` — §3 D2 (deferred-флоу), D5 (снапшот по-ключам, без broadcast, канон не трогается), D4 (не-фатальные инвалидации); §4 (края)
- `frontend/admin/lib/cache/recordCacheSync.ts:11-12,30-37` — `mapRecordsListCache` (shape-agnostic), инвариант total
- `frontend/admin/hooks/useDeleteRecord.ts:34-79` — сегодняшний хук (removeRecordFromCaches, invalidateAfterDelete, resolveDelete)
- `frontend/admin/hooks/useRecordMutations.ts:409-483` — эталон deferred-схемы (deleteVisitDeferred/deletePaymentDeferred)
- `docs/domain-rules/records.md` — Delete flow (:135)

### Steps
- [ ] `recordCacheSync.ts` — новые экспорты:
  - `captureRecordSnapshots(queryClient, id): Array<{queryKey: readonly unknown[]; row: unknown}>` — по `queryClient.getQueriesData({queryKey: qk.records})`; для каждого кэша, где строка с id есть (поиск через `mapRecordsListCache`-совместимый обход: конверт `PaginatedResponse` и плоские массивы), захватить **сам объект строки** в его исходной форме (`RecordView` из конвертов, `RecordResponse` из списков клиента/активности).
  - `restoreRecordSnapshots(queryClient, snapshots): void` — для каждой пары: `queryClient.setQueryData(queryKey, insertRowById(current, row))`, где `insertRowById` через `mapRecordsListCache`: строка с id есть → replace; нет → append.
  - `removeRecordRow(queryClient, snapshots)` — optimistic-удаление: для каждой захваченной пары `setQueryData(queryKey, mapRecordsListCache(current, items => items.filter(r => r.id !== id)))`.
- [ ] `useDeleteRecord.ts` — rewrite (имя хука прежнее; мутации `deleteMutation`/`resolveDelete` удаляются):
  - `removeRecord(record: RecordView): Promise<void>`: `snapshots = captureRecordSnapshots(...)` → `await dryRunDeleteRecord(id)` (ошибки — throw наверх, НИКАКОГО перехвата в хуке) → `removeRecordRow(queryClient, snapshots)` → `enqueuePendingAction({ id: 'delete-record-${record.id}', kind: 'delete', message: 'Удалено. Отменить', delayMs: 5000, undo: () => restoreRecordSnapshots(queryClient, snapshots), commit: async () => { await resolveDeleteRecord(record.id, { expected: {} }); removeRecordRow(queryClient, snapshots); try { await invalidateAfterDelete(record.id); } catch { /* eventual consistency: SSE/следующая загрузка */ } } })`.
  - `removeRecordResolved(record: RecordView, resolutions: Record<string, string>, dependencies: DependencyNode[]): Promise<void>`: `snapshots = captureRecordSnapshots(...)` → optimistic `removeRecordRow` → `enqueuePendingAction({ id: 'delete-record-${record.id}', ..., commit: async () => { await resolveDeleteRecord(record.id, { resolutions, expected: expectedFromDependencies(dependencies) }); ... как выше } })`, где `expectedFromDependencies` = для каждого узла с `items` (не-авто) → `{[entity]: items.map(i => i.id)}`.
  - Хелперы `removeRecordFromCaches`/`invalidateAfterDelete` остаются (используются в commit); `invalidateAfterDelete` — переиспользуется как есть.
- [ ] Тесты `__tests__/useDeleteRecord.test.ts` — rewrite: (а) 409 → прокидывается наверх, enqueue НЕ вызван, кэш не тронут; (б) 204 → enqueue с id `'delete-record-${id}'`, message «Удалено. Отменить», delayMs 5000; (в) commit вызывает `resolveDeleteRecord` с `{expected: {}}`, потом remove + invalidate; (г) провал `resolveDeleteRecord` в commit → onError-путь (покрывается Task 6 — здесь только ассерт, что throw не пойман в хуке); (д) `removeRecordResolved` строит `expected` из `dependencies` (items → id-массивы; авто-узлы без items пропускаются); (е) undo возвращает строки в исходные кэши (2 кэша: конверт + плоский список — restore по-ключам, форма сохранена).

### DoD
- Vitest админки зелёный; хук не делает серверных вызовов до commit (кроме dry-run); undo чистый (восстановление по-ключам); `tsc --noEmit` чист.

---

## Task 6: PendingActionsContext — обобщённый onError

### Classification: small

### Required Docs
- `docs/specs/2026-09-16-deferred-record-deletion-design.md` — §3 D4 (дефолт: 404 = тихий успех; undo + error-тост; не-фатальные инвалидации)
- `frontend/admin/contexts/PendingActionsContext.tsx:8-20,42-71` — `PendingAction`, enqueue, таймер commit
- `frontend/admin/hooks/useRecordMutations.ts:409-483` — потребители без onError (наследуют дефолт)

### Steps
- [ ] `PendingAction` (`:8-20`): добавить `onError?: (err: unknown) => void`.
- [ ] Таймер commit (`:64-68`): тело обернуть — `try { await action.commit(); } catch (err) { if (action.onError) action.onError(err); else if (err instanceof ApiError && err.status === 404) { /* тихий успех: цель достигнута */ } else { action.undo(); showToast('Не удалось удалить. Изменение отменено', 'error'); } }`. Импорт `ApiError` — тот же, что в хуках (греп импорта в `useRecordMutations.ts`).
- [ ] Семантика не-фатальных инвалидаций — в коммитах ПОТРЕБИТЕЛЕЙ (Task 5): invalidate завёрнут в try/catch у вызывающего, в onError не попадает; в контексте менять нечего (проверить, что try/catch вокруг commit ловит только commit-фейлы — invalidation-исключения не долетают, т.к. глотаются в commit).
- [ ] Тесты `PendingActionsContext.test.tsx`: (а) commit resolves — ничего; (б) commit throw 404 (`ApiError`) — undo НЕ вызван, error-тоста нет; (в) commit throw прочее — `undo()` вызван, `showToast('Не удалось удалить. Изменение отменено', 'error')` вызван; (г) action с кастомным `onError` — вызван с ошибкой, дефолт (undo/тост) НЕ сработал; (д) commit визита/оплаты без onError — дефолтный путь (существующие таймерные тесты `:69-237` не меняются).

### DoD
- Vitest зелёный; дефолт onError: 404 — тихо, прочее — undo + error-тост; кастомный onError перекрывает; визиты/оплаты кода не требуют.

---

## Task 7: Call sites (3) + DeleteDialog — однострочники для записей

### Classification: large

### Required Docs
- `docs/specs/2026-09-16-deferred-record-deletion-design.md` — §3 D2/D3 (call sites, поверхность ошибок), D9в (рендер диалога, cap), D6 (навигация)
- `frontend/admin/app/(main)/records/components/RecordsTable.tsx:32,38-54,233-246`
- `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx:68,121-136,297-301,316-321`
- `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx:57,150-161,331-333`
- `frontend/admin/app/components/DeleteDialog.tsx:18-24,62,79,88-90,187-204,311` — presentational, AUTO_ENTITIES, relations, confirm
- `frontend/admin/e2e/activity-details-modal.spec.ts:144-155` — сегодняшние ассерты диалога (обновляются в Task 9)

### Steps
- [ ] `RecordsTable.tsx`: `handleDelete` → `try { await removeRecord(record) } catch (err) { if (err instanceof ApiError && err.status === 409 && err.dependencies) setDeleteTarget({ record, dependencies: err.dependencies }); else showToast(err.message, 'error'); }` (сегодняшняя структура catch сохранена — меняется только источник 409: сухой dry-run вместо разрушающего голого DELETE). Диалог: `onResolve={(record, resolutions, dependencies) => { void removeRecordResolved(record, resolutions, dependencies); }}` — enqueue синхронен, диалог закрывается сразу (D3).
- [ ] `ClientTab.tsx`: `handleDelete` — тот же паттерн; на deferred-ветке (после 204 dry-run) `onDeleteRecord(record.id)` вызывается в момент клика (D6). Confirm-путь — как в RecordsTable (enqueue + закрытие).
- [ ] `ClientRecordTab.tsx`: тот же паттерн, что RecordsTable.
- [ ] `DeleteDialog.tsx` (presentational): узел с `items` → вместо строки «{relation}: {count} (удалён)» рендерить группу: заголовок `«{relationPlural} — будут удалены:»` + по строке на каждый item (метка из `item.label`); больше 10 → первые 10 + строка «и ещё N»; `data-testid="dep-visits"`/`"dep-payments"` остаётся на группе. Узлы **без** items (другие сущности) — сегодняшний рендер без изменений. `cascade_preview`-строку («; визиты: N») для узлов с items не показывать (данные уже в списке); для узлов без items — как сегодня. Чекбоксы подтверждения — без изменений (per-entity).
- [ ] Тесты: (а) DeleteDialog-тесты: узел с 2 items → 2 однострочника + заголовок; 12 items → 10 + «и ещё 2»; узел без items → сегодняшний рендер (регресс); (б) существующие тесты call sites обновлены под новую поверхность хука (409 из dry-run), логика диалога не изменилась.

### DoD
- Vitest зелёный; `tsc --noEmit` чист; 3 call sites на deferred-флоу; DeleteDialog для записей — однострочники (cap 10 + «и ещё N»), для остальных — без изменений.

---

## Task 8: e2e records.spec — S1, S2, S5, S6

### Classification: large

### Required Docs
- `docs/specs/2026-09-16-deferred-record-deletion-design.md` — §6 (S1/S2/S5/S6), §4 (края)
- `docs/tests_workflow.md` — локальный прогон e2e (стек, workers=1)
- `frontend/admin/e2e/unified-rows.spec.ts:773-812` — паттерн deferred-удаления (waitForResponse на DELETE)
- `frontend/admin/e2e/server-push-offline.spec.ts:70,80` — паттерн `context.setOffline`
- `backend/tests/test_api_payments.py` — пример тела POST /payments (для симуляции гонки S6)

### Steps
- [ ] S1 (чистое отложенное удаление): создать запись без зависимостей через API (фабрика записей, `visits: []` — паттерн фабрик e2e) → открыть /records → удалить строку → строка исчезла, undo-тост «Удалено. Отменить» виден (`[role="status"]`) → `page.waitForResponse` на DELETE (с телом) → reload → записи нет (строка + `queryDBRow`).
- [ ] S2 (отмена): удалить → клик «Отменить» → строка вернулась → **ни одного DELETE** за окно (слушатель запросов: счётчик DELETE на `/records/` = 0 за окно) → reload → запись на месте; `queryDBRow` подтверждает.
- [ ] S5 (провал commit): удалить → `context.setOffline(true)` → окно истекает (commit падает) → строка вернулась + error-тост (`data-testid="toast-error"` / `[role="status"]` с текстом «Не удалось удалить. Изменение отменено») → `setOffline(false)` → reload → запись на месте.
- [ ] S6 (гонка): удалить чистую запись → в окне `page.request.post('/api/v1/payments', {data: {...}})` (тело — по образцу create из `test_api_payments.py`; ожидаемо 201) → `page.waitForResponse` на commit-DELETE → статус 409 → строка вернулась + error-тост → reload → запись и новый платёж живы (`queryDBRow` на обе таблицы).
- [ ] Регресс: существующий тест `records.spec.ts:915-967` переписывается под контракт rev7 — голый DELETE без тела → 422 `expected_state_required` (было 409-исполнение-если-чисто; ассерты `postData() === null` / 409 заменяются); 409-preview-поведение уже покрыто dry-run-тестами Task 1.

### DoD
- E2E test for scenario 1 passes (RED-GREEN-REFACTOR); E2E test for scenario 2 passes (RED-GREEN-REFACTOR); E2E test for scenario 5 passes (RED-GREEN-REFACTOR); E2E test for scenario 6 passes (RED-GREEN-REFACTOR). `records.spec.ts:915-967` переписан под контракт rev7 (голый DELETE → 422) и зелёный.

---

## Task 9: e2e activity-details-modal — S3 (обновление) + S4 (новый)

### Classification: standard

### Required Docs
- `docs/specs/2026-09-16-deferred-record-deletion-design.md` — §6 (S3/S4), §3 D9в (рендер диалога), D7
- `frontend/admin/e2e/activity-details-modal.spec.ts:141-163` — сегодняшний каскад-флоу (диалог `dep-visits`/`dep-payments`, confirm, тост, DB-полл)
- `docs/tests_workflow.md` — прогон

### Steps
- [ ] S3 (обновление существующего теста `:141-155`): диалог с зависимостями — те же testid `dep-visits`/`dep-payments`, содержимое — однострочники («Посещения — будут удалены:» + метки из seed: тариф/услуга + цена; «Платежи — будут удалены:» + «{amount}, {method}»); confirm → закрытие диалога мгновенное → undo-тост «Удалено. Отменить» (НЕ «Запись удалена» — `:154` обновляется сознательно) → DB-полл ждёт окно (существующий таймаут полла достаточен) → record + visits + payments удалены из БД.
- [ ] S4 (новый тест): тот же флоу до confirm → клик «Отменить» в окне → строка/детали вернулись, undo-тост исчез → DB-полл: record, visits, payments живы.
- [ ] Прогнать весь файл — существующие тесты (без удаления записей) зелёные.

### DoD
- E2E test for scenario 3 passes (RED-GREEN-REFACTOR); E2E test for scenario 4 passes (RED-GREEN-REFACTOR).

---

## Task 10: Финал — домен-правила, полный прогон, CHANGELOG

### Classification: small

### Required Docs
- `docs/specs/2026-09-16-deferred-record-deletion-design.md` — §3 D8 (документация), §5 (границы), §8 (DoD)
- `docs/domain-rules/records.md:125-126,135,146` — целевые строки
- `docs/domain-rules/_overview.md:108,141,160` — формулировки матрицы
- `CHANGELOG.md` — формат записей

### Steps
- [ ] `docs/domain-rules/records.md`: `:125` — §Delete дополнить флагом `?dry_run=true` (pure preview: 204-без-удаления / 409 / 404 / 422-комбо), телом `{resolutions?, expected}` (id-сверка, порядок «сверка → валидация resolutions»; 409 `stale_dependencies`) и упразднением no-body (rev7): без флага и тела → 422 `expected_state_required`, тело без `expected` → 422; **отклонение контракта записей от общего паттерна** (no-body DELETE остаётся только у 5 архивных сущностей) — зафиксировать явно; `:126` — «Delayed delete: REMOVED» ревизовать: отложенное удаление возвращено (#285, решение юзера 16.09) на общем PendingActions-пайплайне (окно 5с, undo, expected-сверка) — не старым bespoke-механизмом; `:135` — Delete flow: новая механика хука (dry-run → диалог/deferred; commit с expected; undo = снапшот-restore); `:146` — строка таблицы API: `DELETE /records/{id}?dry_run=true` — preview.
- [ ] `docs/domain-rules/_overview.md`: `:108` — «dry-run preview (409)» → «no-body preview (409)»; `:160` — «An empty body (or no body) is the dry-run per §5 — produces 204 or 409, never executes» → «An empty/no-body DELETE never carries resolutions: execute-if-clean (204) or preview (409)» (уточнение двусмысленности, поведение не меняется).
- [ ] Полный backend pytest — зелёный; полный vitest админки — зелёный; `tsc --noEmit` чист; lint чист.
- [ ] Полный e2e: shard с `records.spec` + `activity-details-modal.spec` + smoke — зелёные (workers=1, по `docs/tests_workflow.md`); visit/payment undo-спеки (`unified-rows`, `unify-caches`) — регресс зелёный; visual-набор зелёный без новых базлайнов (тосты под маской); если базлайн разошёлся — стоп и разбор.
- [ ] `CHANGELOG.md` — запись:
  ```markdown
  - Удаление записи теперь отложенное (окно 5 секунд с undo-тостом «Удалено. Отменить») —
    общий пайплайн с визитами/оплатами; оба пути (чистый и каскад через диалог) с подтверждением
    состояния при commit (expected по id зависимостей). Диалог зависимостей записи показывает
    однострочные представления (что именно будет удалено). Провал commit любого отложенного
    удаления больше не молчит: строка возвращается, красный тост; запись, уже удалённая
    другим пользователем, — тихий успех без ложной ошибки.
  ```
- [ ] Контроль чистоты: `git grep -n "Запись удалена" frontend/admin` — только в e2e-истории/CHANGELOG, в UI-коде тост не остался; `git grep -rn "dryRunDeleteRecord\|stale_dependencies" --include="*.ts"` — только заявленные файлы.

### DoD
- Все прогоны зелёные; домен-правила и CHANGELOG дополнены; ветка готова к PR (закрытие #285 — в описании IMPL PR).
