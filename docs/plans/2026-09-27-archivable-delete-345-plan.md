# План: #345 — архивируемые сущности на общий флоу удалений «навсегда»

- **Issue:** #345
- **Спека:** `docs/specs/2026-09-27-archivable-delete-345-design.md` (ревизия 3). Behavioral Delta — в спеке §2, здесь не дублируется.

## Goal

Довести удаление «навсегда» у 5 архивируемых сущностей (staff, locations, services, materials, clients) до корневого контракта семьи: чистое превью `?dry_run`, обязательное тело `{resolutions?, expected}` с subset-сверкой, 422 на голый DELETE, кольцо отмены 5 с на фронте. «В архив»/«Восстановить» не меняются.

## Architecture

```
domain/deletion.py — реестры коллекторов (id/items) для non-auto зависимостей
        ↓
api/v1/{services,locations,materials}.py — контракт в роутере (зеркало тегов),
        сверка + исполнение в session-запросе через service.resolve_delete
api/v1/staff.py + usecases/staff.py — контракт-транспорт в роуте, сверка
        внутри транзакции сценария delete_staff (зеркало delete_record)
api/v1/clients.py + usecases/clients.py — то же, сценарий delete_client
        (@transactional, смержен из карточки 327) получает expected
        ↓
packages/api-client — dryRunDeleteX (новые) + resolveDeleteX с {resolutions?, expected}
        ↓
frontend/admin hooks useDeleteX ×5 — dry-run → диалог → optimistic + enqueue
        (PendingActions, кольцо 5 с) → commit; инвалидации только в commit
        ↓
e2e ×5 переписываются на новый поток; канон deletion.md — строка «фаза 3» закрывается
```

Ключевые факты формы (спека §1, §4.4): дерево 409 включает auto-узлы, сверка их пропускает; разрешимый commit с `resolutions` — только у клиента; staff/location/service с занятиями — только «архивировать вместо» (Mode B, без изменений); material — без non-auto зависимостей.

## Tech Stack

FastAPI + SQLAlchemy (async, aiosqlite) + Pydantic; React/Next.js админка; TypeScript api-client; pytest + contract-тесты; vitest; Playwright e2e.

Координация (не блокирует, заметки): страж ухода со страницы — отдельная карточка 397; если смержится до e2e-задач, их сценарии обрабатывают браузерный диалог ухода по его рецепту. Тест-страж матрицы удалений придёт с карточкой 324 (в IMPL) — матрицы 5 сущностей уже декларированы, задач по ним нет.

---

## Task 1 — Домен: id/item-коллекторы non-auto зависимостей 5 сущностей
- **Классификация:** standard
- **Файлы:** `backend/src/domain/deletion.py` (+ тесты)
- В `_ID_COLLECTORS` добавить ключи `(Staff,"activities")`, `(Location,"activities")`, `(Service,"activities")`, `(Client,"records")`, `(Client,"visitors")`; в `_ITEM_COLLECTORS` — только `(Client,"records")` и `(Client,"visitors")` (blocked-узлы занятий никогда не подтверждаются — items для них не вводим, спека §4.3).
- Билдеры меток зеркалируют готовые: записи — дата-однострочники (образец билдера `(Activity,"records")`), посетители — имя с fallback «Аноним» (образец `deletion.py:629-652`). PII-граница: без телефонов.
- **Решение плана: ручные пары** по образцу существующих коллекторов, без фабрики — join-пути неоднородны (занятия сотрудников идут через extension-строку `masters`, клиентские зависимости — прямые FK), фабрике понадобились бы метаданные путей, которых в матрице нет; при обнаружении естественной общей формы во время реализации фабрика допустима.
- **DoD:** юнит-тесты коллекторов (id-множества, метки, отсутствие телефонных подстрок в items).
- **Сценарии:** S1 (items диалога), S5 (гейс expected-сверки), S6.
- **Required Docs:** спека §4.3.

## Task 2 — Роуты services/locations/materials: корневой контракт
- **Классификация:** large
- **Файлы:** `backend/src/api/v1/services.py`, `locations.py`, `materials.py` + `backend/tests/test_api_services.py`, `test_api_locations.py`, `test_api_materials.py`
- Зеркало `tags.py:216-300`: `?dry_run=true` → 409 дерево (счётчики + items + cascade_preview) / 204 чистая / 404; голый DELETE и тело без `expected` → 422 `expected_state_required` (форма раньше probe — неизвестный id тоже 422); commit `{resolutions?, expected}` → probe → `collect_dependencies` → subset-сверка (`stale_expected_entities`, 409 `stale_dependencies` с живым деревом) → `validate_resolutions` → `service.resolve_delete` → 204 — сверка и исполнение в session-запросе.
- Комбинаторика: `dry_run` + тело с `resolutions` → 422 `dry_run_with_resolutions_forbidden` (до probe); `dry_run` + expected-only — молча игнорируется; неизвестные ключи игнорируются.
- У этих трёх успешный commit с `resolutions` недостижим по матрице (спека §4.4) — ветки всё равно полные: это контракт для API-потребителей и гонок.
- **DoD:** контрактные pytest ×3 сущности — набор S6 спеки (вкл. тело без expected, all-auto → commit `{expected:{}}` → 204, >10 items — expected несёт все id), subset-юниты (обмен ловится, исчезнувшая не блокирует), регресс «в архив» зелёный. **Строки generic-контракта:** в `backend/tests/generic_contract.py` у трёх сущностей `delete_body=None` → контрактное тело + правило голого 422; `test_generic_api_contract.py` зелёный.
- **Сценарии:** S2, S6.
- **Required Docs:** спека §4.1–4.4.

## Task 3 — Staff: сценарий + роут
- **Классификация:** standard
- **Файлы:** `backend/src/usecases/staff.py`, `backend/src/api/v1/staff.py` + `backend/tests/test_api_staff.py`
- Сценарий `delete_staff` получает параметр `expected` и выполняет subset-сверку внутри своей транзакции — зеркало `delete_record` (`usecases/records.py:419`). Роут — транспорт: формы §4.1, превью-ветка, 404/422-маппинг; устаревший docstring («no dry_run / expected — those belong to records») переписывается.
- **DoD:** pytest — набор S6 + all-auto + гонка «занятие появилось за окно у чистого на момент диалога» → 409 `stale_dependencies` (не 422); блокированный commit при любом теле → 422. **Строка generic-контракта** `staff` обновлена (`delete_body` + голый 422), `test_generic_api_contract.py` зелёный.
- **Сценарии:** S2, S4, S5, S6.
- **Required Docs:** спека §4.1, §4.4, §4.5.

## Task 4 — Clients: сценарий + роут
- **Классификация:** standard
- **Файлы:** `backend/src/usecases/clients.py`, `backend/src/api/v1/clients.py` + `backend/tests/test_api_clients.py`
- Сценарий `delete_client` (в main после мержа 265f5c56, `@transactional`) получает `expected` и сверяет внутри транзакции — тот же шаблон, что у staff; роут — транспорт. Единственная сущность с разрешимым commit: записи (nullify) + посетители (cascade); узел посетителей несёт `cascade_preview` счётчик визитов.
- **DoD:** pytest — S1 (commit `{resolutions, expected}` → 204; записи отвязаны, посетители удалены), S5 (гонка записи за окно → 409; исчезнувшая не блокирует), S6. **Строка generic-контракта** `client` обновлена, `test_generic_api_contract.py` зелёный.
- **Сценарии:** S1, S5, S6.
- **Required Docs:** спека §4.1, §4.4, §4.5.

## Task 5 — api-client: dryRun-методы + payload resolveDelete
- **Классификация:** small
- **Файлы:** `packages/api-client/src/endpoints.ts`, `packages/api-client/src/endpoints.test.ts` (+ типы)
- Добавить `dryRunDeleteStaff/Client/Service/Location/Material` (зеркало `dryRunDeleteRecord`); payload `resolveDeleteX` расширить до `{resolutions?, expected}` (зеркало `resolveDeleteTag`). Добавки аддитивны — текущих потребителей не ломают.
- **DoD:** юнит-тесты api-client в `endpoints.test.ts` (URL/метод/тело).
- **Сценарии:** инфраструктура S1–S3.
- **Required Docs:** спека §5.1.

## Task 6 — Фронт: хуки клиентов и сотрудников
- **Классификация:** standard
- **Файлы:** `frontend/admin/hooks/useStaffMutations.ts`, `frontend/admin/hooks/useClientsMutations.ts`, `frontend/admin/app/(main)/clients/components/ClientCardModal.tsx` (точечный ключ инвалидации), новый общий модуль `frontend/admin/lib/expectedFromDependencies.ts`, их тесты
- **DeleteDialog не меняется вовсе** (компонент шарится с masters — вне скоупа): сигнатура `onResolve(id, resolutions)` сохраняется; `expected` строит родитель-хук из захваченного в состоянии дерева через общий модуль `lib/expectedFromDependencies.ts` (сегодня функция дублируется в useDeleteRecord/useTagsMutations — туда сворачивается).
- `useDeleteX` по образцу `useDeleteTag`/`useDeleteRecord`: всегда `dryRunDeleteX(id)`; 204 → optimistic-удаление + enqueue с commit `{expected:{}}`; 409 + дерево → `DeleteDialog` → confirm → optimistic + enqueue с commit `{resolutions, expected}` из **полного** дерева (рендер урезает до 10 + «и ещё N» — payload несёт все id); `delayMs: 5000`; инвалидации только в commit (семья сущности + точечный ключ модалки клиента); undo без серверных вызовов.
- Фаза превью: кнопка disabled/spinner на время dry_run (двойной клик — один запрос); 404 → тихая инвалидация семьи, диалог не открывается; сеть/5xx → error-тост «Не удалось проверить зависимости», состояние не меняется.
- Ошибки commit: 404 тихий успех; 409 stale → undo + «Не удалось удалить: данные изменились» + «Обновить» (инвалидация семьи); 422 → undo + error-тост; сеть → undo + error-тост.
- `expectedFromDependencies` (сегодня дублируется в useDeleteRecord/useTagsMutations) сворачивается в общий модуль `lib/expectedFromDependencies.ts`.
- **DoD:** vitest хуков ×2 — матрица веток §7: dry-run (204 → enqueue `{expected:{}}`; 409 → диалог), фаза превью (404 тихая инвалидация; сеть/5xx error-тост; двойной клик — один запрос), confirm → enqueue `{resolutions, expected}` из полного дерева, undo, commit-фейлы (404 тихо; 409 stale → «данные изменились» + «Обновить»; 422 → undo + error-тост; сеть → undo + тост).
- **Сценарии:** S1, S2, S3, S5.
- **Required Docs:** спека §5.2–5.4; design-system (тосты конвейера).

## Task 7 — Фронт: хуки локаций, услуг, материалов
- **Классификация:** standard
- **Файлы:** `frontend/admin/hooks/useLocationsMutations.ts`, `frontend/admin/hooks/useServicesMutations.ts`, `frontend/admin/hooks/useMaterialsMutations.ts` (+ их тесты)
- Те же зеркала: чистая ветка и all-auto диалог (информационные auto-строки + confirm → commit `{expected:{}}`); blocked-состояние (занятия) → Mode B «Архивировать вместо» без изменений, delete-ветка из UI недостижима. DeleteDialog и контракт `onResolve` — как в Task 6 (родитель строит expected из захваченного дерева).
- **DoD:** vitest хуков ×3 — та же матрица веток, что в Task 6 (dry-run 204/409; фаза превью 404/сеть/двойной клик; undo; commit 404 тихо / 409 stale + «Обновить» / 422 / сеть).
- **Сценарии:** S2, S4.
- **Required Docs:** спека §5.2–5.4.

## Task 8 — Cleanup: голые deleteX удалить
- **Классификация:** trivial
- **Файлы:** `packages/api-client/src/endpoints.ts`, `packages/api-client/src/endpoints.test.ts`
- Удалить `deleteStaff/deleteClient/deleteService/deleteLocation/deleteMaterial` (последний потребитель — зонд превью в старых хуках — исчез в Task 6–7) вместе с их describe-блоками в `endpoints.test.ts`; grep-аудит оставшихся вызовов голого DELETE по 5 сущностям (скрипты, тесты) — прямых быть не должно, сервер отвечает 422.
- **DoD:** линт ноль, grep-аудит в отчёте задачи.
- **Сценарии:** S6 (упразднение execute-if-clean).
- **Required Docs:** спека §5.1.

## Task 9 — e2e: переписать поток удаления 5 сущностей
- **Классификация:** large
- **Файлы:** `frontend/admin/e2e/materials-delete.spec.ts`, `clients-delete-cascade.spec.ts`, `clients-delete-invalid-resolution.spec.ts`, `staff-delete-blocked.spec.ts`, `staff-delete-auto-cascade.spec.ts`
- Поток: dry_run → диалог → optimistic + кольцо → commit; ожидание deferred DELETE — DB-полл-паттерн (`unified-rows.spec.ts:773-812`). В `materials-delete.spec.ts` добавить кейс чистого материала (dry_run 204 → кольцо → commit `{expected:{}}`) — e2e-покрытие S2.
- **Осознанный пробел покрытия:** закрытие вкладки в окне отмены e2e не проверяется — поведение стража ухода и его рецептура диалога принадлежат карточке 397, а не этому набору.
- **DoD:** e2e зелёные локально и в CI; архивная parity-спека остаётся зелёной без правок.
- **Сценарии:** S1–S4, S7.
- **Required Docs:** спека §5.6, §7.

## Task 10 — Канон: deletion.md — строка фазы 3 закрывается
- **Классификация:** trivial
- **Файлы:** `docs/domain-rules/deletion.md` (+ `docs/domain-rules/_overview.md` при расхождении)
- Строка таблицы Staff/Location/Service/Material/Client: «отложенный контракт; фаза 3 (follow-up)» → контракт введён (карточка 345); сверить смежные строки (контрактные, no-body двустиье).
- **DoD:** канон согласован с реализацией; рассогласований grep'ом нет.
- **Сценарии:** канонизация дельты §2 спеки.
- **Required Docs:** спека §1, §2.
