# План: #324 — остаток семьи удалений «навсегда» (этапы 2+3 трекера #346)

## Goal

Перевести шесть сущностей (визиты, оплаты, фото, настройки, посетители, должности) на единый семейный контракт удалений #318 (`?dry_run=true` превью / голый DELETE → 422 / тело `{resolutions?, expected}` с subset-сверкой / кольцо 5 с на фронте) и завести тест-страж «схема ↔ матрица» + «роуты ↔ матрица». Поведенческая дельта — в спеке §8, сценарии — §9; здесь не дублируются.

## Architecture

- **Домен** (`backend/src/domain/deletion.py`): новые ключи `FK_MATRIX` (Visit/Payment/UserSettings — пустые; Photo/Visitor/Position — зависимости) + полный комплект реестров на каждый новый субъект: счётчики `_COUNTERS`, item-коллекторы, id-сборщики `expected`, join-delete-хендлеры с ключами `(Модель, entity)`.
- **Сервисы**: блок «пачка визитов посетителя + пересчёт записей» в сервисе визитов (переиспользует `recompute_record_seats`/`recompute_record_status` из `backend/src/domain/record_visits.py`); `VisitorService._delete_cascade` делегирует блоку без смены сигнатуры.
- **Роуты** (`backend/src/api/v1/`): единый порядок проверок — форма → скоуп-проба (`*_scoped_or_404` / own-only 403, первой строкой в обеих ветках) → системный guard должностей → ветка dry_run/коммит.
- **Фронт** (`frontend/admin/`): конвейер `PendingActionsContext` + `DeleteDialog` (образец — `useTagsMutations.ts`); 409 `stale_dependencies` обрабатывается существующим общим обработчиком.
- **Спека**: `docs/specs/2026-09-21-delete-family-remaining-324-design.md` (rev3). Правки канона уже в main (`5fdeac5b`).

## Tech Stack

Python 3.12 / FastAPI / SQLAlchemy 2 (Core bulk для join-очистки), pytest (+pytest-asyncio); TypeScript / Next.js / TanStack Query, vitest + Playwright. Существующие механизмы: `GenericService.resolve_delete`, `PendingActionsContext`, кольцо #94.

---

## Task 1 — Домен: матрица и реестры шести субъектов

**Классификация:** standard. **Спека:** §3, §5. **Сценарии:** база для всех (§9.1–9.6).

Шаги:
1. `FK_MATRIX` (`backend/src/domain/deletion.py:165`): ключи `Visit: []`, `Payment: []`, `UserSettings: []`; `Photo: [photo_tags — cascade, non-auto, «Тег»]`; `Visitor: [visits — cascade, non-auto, «Посещение», nullable=True, allowed_actions=["cascade"], visitor_tags — cascade, auto, «Тег»]`; `Position: [staff_positions — cascade, non-auto, «Сотрудник»]`. Полные `FKDependency(...)`, стиль соседних строк; комментарии-обоснования перспективы (та же join-таблица в нескольких матрицах — легитимно, правило Tag).
2. Реестры на каждый новый dep: счётчики `_COUNTERS[(M, entity)]` (образцы `_count_t_photo_tags` `deletion.py:652`, `_count_m_staff_positions` `deletion.py:433`), item-коллекторы для узлов дерева, id-сборщики `expected` (visits → `visit.id` по `visitor_id`; join-таблицы → id-строки по колонке владельца), join-delete-хендлеры `(Photo,"photo_tags")`, `(Visitor,"visitor_tags")`, `(Position,"staff_positions")` (Core bulk, порядок join-строки → субъект, детерминированно при любом PRAGMA). Прецедент-предохранитель: хендлер `(Tag,"photo_tags")` уже существует — новая строка `(Photo,"photo_tags")` это другая сторона того же ребра (ключ включает модель), НЕ дубликат; «оптимизировать» слияние этих ключей нельзя.
3. Smoke: ручная проверка сборки дерева/expected для занятых и чистых строк каждого субъекта (скретч-база).

Приёмка: `collect_dependencies`/`collect_dependency_ids`/`stale_expected_entities` работают для шести новых субъектов; существующие ключи не затронуты; линт/тайпчек зелёные.

**Required Docs:** спека §3 (матрица), §5 (реестры, порядок исполнения); `docs/domain-rules/_overview.md` (семейное правило, таблица матрицы — уже обновлена).

## Task 2 — Сервис: пачка визитов посетителя + пересчёт записей

**Классификация:** standard. **Спека:** §5. **Сценарии:** §9.3, §9.4 (пересчёт после удаления посетителя).

Шаги:
1. Метод сервиса визитов «удалить визиты посетителя пачкой»: сбор затронутых `record_id` → bulk-удаление визитов по `visitor_id` → для каждой записи `recompute_record_seats` + `recompute_record_status` (`backend/src/domain/record_visits.py:25,51`; паттерн одиночного пути — `backend/src/services/visit.py:179-180`). SSE-маркеры `visits` + `records`.
2. `VisitorService._delete_cascade` (`backend/src/services/visitor.py:185`): внутренности делегируют блоку (visitor_tags-очистка + блок визитов + удаление строки), сигнатура и транзакционная семантика неизменны — тест атомарности клиент-каскада с `monkeypatch` (`backend/tests/test_api_clients.py:819+`) остаётся зелёным без правок.
3. Юнит-тесты: каскад посетителя (визиты+теги удалены, каждая затронутая запись пересчитана), клиент-каскад наследует пересчёт через общий путь, пустой посетитель — нет холостых пересчётов.

Приёмка: после удаления посетителя (напрямую и через удаление клиента) статусы/места записей честные; готового блока-дубликата не появилось.

**Required Docs:** спека §5 (блок, наследование клиент-каскадом — решение юзера 21.09); `docs/domain-rules/visits.md` (пересчёт родителя).

## Task 3 — Роуты: единый контракт шести DELETE

**Классификация:** standard. **Спека:** §4. **Сценарии:** все (§9.1–9.6); системная должность — §9.6.

Шаги:
1. Общий порядок в каждом руте (`visits.py:232`, `payments.py:212`, `photos.py:234`, `user_settings.py:113`, `visitors.py:183`, `position.py:162`): (а) форма — `?dry_run=true`+`resolutions` → 422 `dry_run_with_resolutions_forbidden`, без флага и тела → 422 `expected_state_required`, `resolutions`-без-`expected` → 422; (б) скоуп-проба существующими хелперами (`*_scoped_or_404`; user_settings — probe + own-only 403) — первой строкой обеих веток, probe возвращает строку; (в) positions: `is_system` → 422 `POSITION_IS_SYSTEM` до развилки; (г) dry_run → 204/409-дерево (форма 409 — зеркало `tags.py:196-215`); (д) коммит `{resolutions?, expected}` → сверка → `resolve_delete` → 204.
2. Тело: переиспользовать схему `DeleteBody` тегов/записей (или общую фабрику, если она уже выделена); dry_run+expected-only — молча игнорируется.
3. Трансляция ошибок исполнителя: `StaleDependenciesError` → 409 `stale_dependencies` + живое дерево (зеркало тегов).

Приёмка: все шесть рутов проходят контрактную форму из Task 5; скоуп-модель не изменилась (чужой id → 404 в обеих ветках, до дерева).

**Required Docs:** спека §4 (порядок проверок — блокер безопасности панели rev1, обязателен); `docs/domain-rules/tags.md` (контракт-референс), `_overview.md`.

## Task 4 — Тест-страж «схема ↔ матрица»

**Классификация:** small. **Спека:** §7.

Шаги:
1. `backend/tests/test_delete_matrix_guard.py`: (а) схема → матрица: для каждого ключа `FK_MATRIX[M]` каждое входящее FK-ребро `Base.metadata` (другие таблицы → M, включая join-таблицы) объявлено строкой зависимости; исходящие рёбра субъекта в его матрице не проверяются; (б) роуты → матрица: обход `app.routes` через существующую тестовую обёртку (прецедент `test_auth_contract.py` — найти в нём хелпер обхода роутов и обработку `_IncludedRouter`, НЕ писать новый обходчик), нормализация префиксов (в т.ч. `/my/settings/...` → UserSettings) — каждый DELETE-рут отображён на ключ матрицы.
2. Докстринг: известная граница — рёбра мимо `Base.metadata` (raw SQL) не ловятся.

Приёмка: страж зелёный на текущем дереве после Task 1; экспериментально краснеет при (а) добавлении FK-колонки без декларации, (б) добавлении DELETE-рута без ключа матрицы (проверяется временной правкой в ветке).

**Required Docs:** спека §7; `_overview.md` (матрица).

## Task 5 — Контрактные и исполнительские тесты

**Классификация:** large. **Спека:** §4, §10.

Шаги:
1. Параметризованный контрактный api-тест полной формы (зависимые: photos/visitors/positions): dry_run 204/409-дерево, голый 422, `resolutions`-без-`expected` 422, dry_run+resolutions 422, dry_run+expected-only игнор, коммит с expected, stale 409 (появление зависимости за окно), dry_run на неизвестном/чужом id → 404, `allowed_actions: ["cascade"]` в узлах.
2. Сокращённый набор для листьев (visits/payments/user_settings): голый 422, dry_run 204, коммит `{expected:{}}`, 404 обоих видов (чужой id по скоуп-хелперу и несуществующий — оба 404, различать не нужно, но проверить оба); user_settings — own-only 403 на чужую строку; visits — пересчёт родителя на коммите.
3. По-сущностные отличия: системная должность 422 до развилки (dry_run и коммит), скоуп-404 четырёх охраняемых рутов.
4. Размещение: `test_api_visits.py`, `test_api_payments.py`, `test_api_photos.py`, `test_api_my.py`, `test_api_visitors.py`, `test_api_positions.py`, форма 422 — `test_errors.py`; переиспользовать фабрики/фикстуры теговых тестов (`test_api_tags.py:178+`).

Приёмка: контракт из §4 покрыт целиком; существующие тесты удалений (включая monkeypatch-атомность) зелёные.

**Required Docs:** спека §4, §10; `test_api_tags.py` (шаблоны).

## Task 6 — api-client и коммиты визитов/платежей

**Классификация:** small. **Спека:** §6. **Сценарии:** фон §9 (визит/платёж — видимо без изменений).

Шаги:
1. `packages/api-client/src/endpoints.ts`: `deleteVisit` (`:749`) и `deletePayment` (`:668`) получают **optional**-параметр тела с дефолтом `{expected: {}}` (тело уходит при вызове из deferred-хуков; обратная совместимость сигнатур внутри репо сохраняется); при необходимости — обёртки `resolveDeleteVisit`/`resolveDeletePayment`.
2. `frontend/admin/hooks/useRecordMutations.ts`: `deleteVisitDeferred` (`:473`) и `deletePaymentDeferred` (`:523`) отправляют тело `{expected: {}}` в commit.
3. Правка мок-обвязки: `ClientRecordTab.api.test.tsx` (сигнатуры с телом) + вит-проверка «тело уходит в DELETE».

Приёмка: удаления визитов/платежей через UI работают без 422; вит зелёные; типы api-client обратно совместимы внутри репо.

**Required Docs:** спека §6; `useTagsMutations.ts` (образец коммита).

## Task 7 — Фронт: фото и должности на конвейер

**Классификация:** standard. **Спека:** §6. **Сценарии:** §9.1, §9.2, §9.5, §9.6.

Шаги:
1. Хук фото (создать `frontend/admin/hooks/usePhotosMutations.ts` по образцу `useTagsMutations.ts`, если не существует): чистый путь — dry_run → 204 → enqueue, commit `{expected:{}}`; тегированный — dry_run → 409 → `DeleteDialog` (узел «Тег») → commit `{expected: {photo_tags}}`; undo — item-level снапшот; инвалидация `['photos']`; 409 stale — общий обработчик конвейера.
2. Должности: хук `frontend/admin/hooks/usePositionsMutations.ts` (создать, тот же образец); замена `window.confirm`+тост (`frontend/admin/app/(main)/positions/components/positionColumns.tsx:53`) на конвейер; занятая — диалог «Сотрудники: N потеряют должность»; инвалидация `['positions']`; системная — 422-тост понятным текстом.
3. Вит-тесты хуков: кольцо, диалог, undo, инвалидация, оба пути каждой сущности.

Приёмка: сценарии §9.1/§9.2/§9.5/§9.6 проходят вручную и в вит; мгновенных путей удаления не осталось.

**Required Docs:** спека §6; `docs/domain-rules/deletion.md` (конвейер/кольцо), `photos.md`, `staff.md`.

## Task 8 — Фронт: посетители на конвейер

**Классификация:** standard. **Спека:** §6. **Сценарии:** §9.3, §9.4.

Шаги:
1. `deleteVisitor` в `useRecordMutations.ts` (`:260`) переводится на конвейер: с визитами — dry_run → 409 → `DeleteDialog` «Посещения: N будут удалены» → commit `{expected: {visits, visitor_tags}}`; чистый — сразу кольцо с `{expected:{}}`; undo — item-level снапшот; инвалидация `['records','clients']`.
2. Оба вызова переводятся: `ClientRecordTab` и `ClientInfoTab`. Перед стартом задачи — инвентаризация вызовов `deleteVisitor` grep'ом по `frontend/admin` (включая тесты): ни одного мгновенного вызова остаться не должно, иначе он словит 422.
3. Вит-тесты: оба вызова, оба пути, undo, 409 stale → возврат строки + честная ошибка.

Приёмка: сценарии §9.3/§9.4 вручную и в вит.

**Required Docs:** спека §6; `docs/domain-rules/visitors.md`.

## Task 9 — E2E по сценариям

**Классификация:** large. **Спека:** §9.

Шаги:
1. `frontend/admin/e2e/`: photos — удаление с undo (§9.1) и с превью зависимостей (§9.2); clients — удаление посетителя с зависимостями и пересчётом (§9.3); зеркало тегового stale-сценария #318 для посетителя (§9.4); positions — удаление с превью (§9.5) и системная охрана — api-тест + дым (§9.6).
2. Переиспользовать хелперы теговых/записных e2e (#318/#285); сид-данные для занятых сущностей.

Приёмка: 6 сценариев зелёные в CI-наборе; флейк-политика обычная (повторный прогон при случайном красном).

**Required Docs:** спека §9; e2e-хелперы #318.

---

## Порядок и зависимости

Task 1 → Task 2 → Task 3 (домен и сервисы раньше рутов); Task 4 и Task 5 после Task 3 (страж формально после Task 1); Task 6 независимо от Task 3 (тело `{expected:{}}` — после Task 3 в CI, локально параллельно); Task 7/8 после Task 6; Task 9 последним. Веток-пересечений с идущими IMPL (#328 теги-услуг, #341 фото-e2e, #344 аудит) нет: правки в разных слоях/файлах, кроме e2e-фото (#341 трогает сид-даты — координировать порядок слияния в менеджере).
