# План: #318 — удаление занятого тега (единый контракт удалений)

- **Issue:** #318
- **Спека:** docs/specs/2026-09-19-tags-busy-delete-318-design.md (rev9)
- **Дата:** 2026-09-20
- **Контекст роадмапа:** этап 1 из #346 (единый флоу удалений)

## Goal

Подключить тег к единому контракту удалений один-в-один с записями (#285): сухой прогон с поимённым превью, блокировка молчаливого снятия (голый DELETE → 422), отложенное удаление с кольцом 5 с и сверкой ожидаемого состояния, диалог удалений с подписями тег-стороны. Поведение — по спеке rev9 (Behavioral Delta §5, сценарии S1–S10).

## Architecture

```
домен (deletion.py): матрица + 4 реестра на тег (счётчики/id/item-коллекторы, хендлеры)
   ↓
роут (api/v1/tags.py): dry_run / 422 на голый / тело {resolutions?, expected} + subset-сверка
   ↓
api-client: dryRunDeleteTag + resolveDeleteTag
   ↓
фронт: useDeleteRecord-образец — useDeleteTag → TagsTable + DeleteDialog (подписи тег-стороны)
   ↓
PendingActions (существующий): кольцо 5 с, undo из кэша ['tags'], commit-обработка ошибок D4-семьи
```

Слои не пересекаются с идущими работами (#324 — другие сущности; #345 — архивные, после этого плана).

## Tech Stack

Backend: FastAPI + SQLAlchemy 2.0 async (доменные реестры — по образцам records/materials). Frontend: React + TanStack Query (хук-мутации), PendingActionsContext. Тесты: pytest (контракт + subset-юниты), vitest (хук/диалог), Playwright (e2e, DB-полл-паттерн deferred DELETE).

---

## Task 1 — Домен: матрица и четыре реестра тега

**Классификация:** standard. **Сценарии:** S4, S5.

- `FK_MATRIX[Tag]`: 8 зависимостей-join (`service_tags`, `activity_tags`, `master_tags`, `location_tags`, `client_tags`, `visitor_tags`, `record_tags`, `photo_tags`), все `action="cascade"`, `allowed_actions=["cascade"]`, `auto=False`, relation-метки «Услуга/Занятие/Мастер/Локация/Клиент/Посетитель/Запись/Фото» (спека D1).
- 8 счётчиков в `_COUNTERS` — подсчёт по `tag_id` (образец `_count_m_master_tags`, `deletion.py:367`).
- 8 id-коллекторов в `_ID_COLLECTORS` — parent-id по `tag_id` (образец `_ids_r_record_tags`, `deletion.py:839`; потребляет роутная сверка). Без них expected-сверка молча пуста (панель wave 2, блокер).
- 8 item-коллекторов в `_ITEM_COLLECTORS` — `{id, label}`; `items.id` = id родителя. Метки: Service/Location → `title`; Client/Visitor → `name` (Client.name nullable → fallback «Аноним», образец `deletion.py:644-647`); Staff → имя через `masters.staff_id → staff` (двухтабличный билд, id узла = staff_id); Record/Activity → дата-однострочники по образцу записей; Photo → `filename`. PII-граница: без телефонов (спека D6).
- 8 каскад-хендлеров в `CASCADE_HANDLERS` — join-delete по `tag_id` (образец `_h_cascade_service_tags`, `deletion.py:1211`). ORM-альтернатива отклонена (семейный принцип детерминированного исполнителя + страж #324).
- Подъём `resolve_delete` с `ArchiveService` на `GenericService` (`generic.py:212/313`); типы хендлеров расширить до базового класса.
- Docstring-обновления `deletion.py`: модульный и `validate_resolutions` — «`*_tags` с родительской стороны» (правило перспективы).

**Required Docs:** спека D1, D6, D8; deletion.py (реестры, комментарии «матрица + хендлер»); tags.md (контракт уже в каноне).

## Task 2 — Роут tags.py: полный контракт DELETE

**Классификация:** standard. **Сценарии:** S4, S6, S8, S10.

Зеркало `records.py:322-364` (контрактные ветки живут в роутере; `resolve_delete` — только исполнение):

- `?dry_run=true`: занятый → 409 `has_dependencies` (дерево: счётчики + items); чистый → 204 без удаления; несуществующий → 404 (probe существования). Никогда не меняет строки.
- Голый DELETE (без флага и тела) → 422 `expected_state_required`; на неизвестном id — 422 раньше 404 (проверка формы предшествует probe).
- Тело `{resolutions?, expected}`: существование → `collect_dependencies` → subset-сверка (`collect_dependency_ids` + `stale_expected_entities`; появление сверх подтверждённого и обмен → 409 `stale_dependencies` с живым деревом; исчезнувшая не блокирует) → валидация `resolutions` (семейная семантика: занятая без действия/недопустимое действие → 422; неизвестные ключи игнорируются) → `resolve_delete` → 204. Сверка и исполнение — одна транзакция.
- Комбинаторика: `dry_run` + тело с `resolutions` → 422 `dry_run_with_resolutions_forbidden` (до probe); `dry_run` + expected-only тело — игнор молча.
- Все 8 зависимостей не-auto → в `expected` попадают все подтверждённые id-множества (исключений нет).

**Required Docs:** спека D2; records.py (образец веток и порядка); _overview.md (409/422-контракт).

## Task 3 — api-client: dryRunDeleteTag + resolveDeleteTag

**Классификация:** small. **Сценарии:** S1, S2, S5.

- `dryRunDeleteTag(id)`: DELETE `?dry_run=true`, без тела; 409-пейлоад парсится в `ApiError.dependencies` (существующий механизм).
- `resolveDeleteTag(id, {expected, resolutions?})`: DELETE с телом (образец `resolveDeleteRecord`, `endpoints.ts:628`).
- Типы тела при необходимости — по образцу записей.

**Required Docs:** спека D5; endpoints.ts (resolveDeleteRecord).

## Task 4 — Фронт: useDeleteTag + TagsTable + подписи DeleteDialog

**Классификация:** standard. **Сценарии:** S1, S2, S3, S7, S9.

- `useDeleteTag` перестроить по образцу `useDeleteRecord` (отложенная схема) — на месте его нынешнего дома: `frontend/admin/hooks/useTagsMutations.ts:24` (перестройка в этом модуле, без выделения в отдельный файл). Первый вызов всегда `dryRunDeleteTag`; 204 → optimistic-удаление из кэшей `['tags']` + enqueue, commit = `resolveDeleteTag(id, {expected: {}})`; 409 → состояние `dependencies` → рендер `DeleteDialog` в TagsTable; confirm → optimistic-удаление + enqueue, commit = `resolveDeleteTag(id, {resolutions, expected: id-множества из items})`. Undo — item-level снапшот кэша `['tags']`, без серверных вызовов; инвалидации только в commit.
- `onError` (D4-семья): 404 = тихий успех; 409-stale → undo + «Не удалось удалить: данные изменились» + «Обновить» (инвалидация `['tags']`); прочее → undo + error-тост.
- `TagsTable`: убрать `window.confirm('Удалить тег?')` и мёртвый комментарий «§6.9 locked window.confirm flow»; подключить диалог; тосты — pending-стек («Удалено. Отменить» с кольцом).
- `DeleteDialog` (спека D9): убрать пять `*_tags` из `AUTO_ENTITY_LABEL` (родительская сторона падает в fallback `RELATION_PLURAL['Тег'] = 'Теги'` — рендер родителей не меняется); дополнить `RELATION_PLURAL` (Занятие→Занятия, Мастер→Мастера, Локация→Локации, Клиент→Клиенты, Фото→Фото); суффикс «снят/сняты» для `entityType='tag'` (per-type паттерн `AUTO_LINES_HIDDEN`); `'tag'` в `DeleteDialogEntityType` + `TITLE_BY_TYPE`.

**Required Docs:** спека D4, D5, D9; useDeleteRecord.ts; DeleteDialog.tsx (карты подписей).

## Task 5 — Бэкенд-тесты (pytest)

**Классификация:** standard. **Сценарии:** S4, S5, S6, S8, S10.

- Контракт: голый → 422 (в т.ч. на неизвестном id — раньше 404); dry_run занятого → 409 с деревом+items, чистого → 204 без удаления, неизвестного → 404; тело на неизвестном id → 404 `TAG_NOT_FOUND` (существующий путь `tags.py:175`); тело `{resolutions, expected}` → 204 (фикстура: тег, привязанный ко всем 8 видам; отдельные ассерты `master_tags` (id = staff_id) и `photo_tags`); недопустимое/отсутствующее действие → 422; неизвестный ключ → 204; `dry_run`+`resolutions` → 422.
- Subset-юниты (зеркало D7 #285): mismatch по id → 409 `stale_dependencies`; обмен при равном счётчике ловится; исчезнувшая зависимость не блокирует; сверка до валидации resolutions.
- items-билдеры: PII — телефоны не попадают в метки; Client с NULL name → «Аноним».
- Регресс: родительские 409-потоки (staff/location/service/client) не изменились.

**Required Docs:** спека §6; test_api_records.py (образцы dry_run/expected-тестов).

## Task 6 — Фронт-тесты (vitest)

**Классификация:** small. **Сценарии:** S1, S2, S3, S7, S9, S10.

- `useDeleteTag`: ветки dry-run (204 → enqueue с `{expected: {}}`; 409 → dependencies), confirm → enqueue с `{resolutions, expected}` (id-множества из items), undo → строка вернулась / DELETE не уходил, commit-фейлы (404 тихо; 409-stale → «данные изменились» + «Обновить»; сеть → undo + тост).
- `TagsTable.test.tsx`: поток целиком (клик → диалог/сразу → тост с кольцом).
- Подписи диалога: тег-сторона «Услуги: 2 (сняты)» + однострочники; родительская сторона — рендер без изменений.

**Required Docs:** спека D9, §6; useDeleteRecord.test.ts (образец).

## Task 7 — e2e tags-delete-contract.spec.ts

**Классификация:** standard. **Сценарии:** S1, S2, S3, S9.

- S1: занятый тег → диалог с поимёнными строками → подтверждение → строка исчезла + тост с кольцом → после окна коммита — тега и связей нет в БД (DB-полл-паттерн `unified-rows.spec.ts:773-812`).
- S2: чистый тег → без диалога, кольцо-тост → после окна нет в БД.
- S3: отмена в диалоге — ничего не изменилось.
- S9: «Отменить» в окне → строка вернулась, DELETE не уходил (БД не тронута).
- Аудит: grep существующих e2e на голый DELETE `/tags` (по данным панели таких нет; при появлении — переписать под 422).

**Required Docs:** спека §6; unified-rows.spec.ts (DB-полл), clients-delete-cascade.spec.ts (локаторы диалога).

---

## Порядок и зависимости

Task 1 → Task 2 → (Task 3) → Task 4 → Task 5/6 → Task 7. Task 3 мала и может ехать с Task 2. Task 5 и 6 параллельны. DoD: pytest/vitest/e2e зелёные, `tsc`/линт чистые, сценарии S1–S10 покрыты по маппингу задач.
