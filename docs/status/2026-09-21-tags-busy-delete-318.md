# GH #318 — Tags: удаление занятого тега — единый контракт удалений (этап 1 из #346)

- **Date**: 2026-09-21
- **Branch**: `318-tags-busy-delete`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `c7ce190f` (main) — 7 commits (`086adb67..cca86cef`), 21 file, +3687 / −162
- **Issue**: #318 — Tags: удаление занятого тега — безликий 422 вместо общего контракта удалений
- **Spec**: `docs/specs/2026-09-19-tags-busy-delete-318-design.md` (rev9, on main, unchanged by IMPL)
- **Plan**: `docs/plans/2026-09-20-tags-busy-delete-318-plan.md` (7 tasks, on main, unchanged by IMPL)
- **Roadmap**: этап 1 из #346 (единый флоу удалений)
- **Canon**: `docs/domain-rules/_overview.md` + `docs/domain-rules/tags.md` (уже на main: Tag-строки матрицы, perspective-auto правило, #318-ссылки)

## Goal

Подключить тег к семейному контракту честного удаления (эталон — записи #285):
превью зависимостей до удаления, запрет молчаливого снятия тега со всех объектов,
отложенное удаление с окном отмены 5 с и кольцом отсчёта, сверка подтверждённого
состояния при коммите. Живая проверка (спека §1) опровергла премиссу issue: FK не
нарушается, реальный пробел — молчаливый массовый снос связей до 8 видов объектов.

## Summary of Changes (per task)

- **T1 — домен: матрица + реестры (S4/S5):** `FK_MATRIX[Tag]` — 8 join-зависимостей
  (`service_tags`, `activity_tags`, `master_tags`, `location_tags`, `client_tags`,
  `visitor_tags`, `record_tags`, `photo_tags`), все `action="cascade"`,
  `allowed_actions=["cascade"]`, `auto=False` (perspective-auto правило: та же
  join-таблица остаётся auto на стороне родителя и видима на стороне тега); 8 счётчиков
  в `_COUNTERS`, 8 id-коллекторов в `_ID_COLLECTORS`, 8 item-коллекторов в
  `_ITEM_COLLECTORS` (`{id, label}`, id = id родителя; master → двухтабличный билд через
  `staff_id`; PII-граница — без телефонов; Client с NULL name → «Аноним»), 8
  каскад-хендлеров в `CASCADE_HANDLERS` (Core bulk join-delete по `tag_id`, мимо
  ORM-каскада); docstring-правки `deletion.py` (правило перспективы) (`086adb67`).
- **T2 — роут `tags.py`: полный DELETE-контракт (S4–S6, S8, S10):**
  `?dry_run=true` — чистое превью: существование → 404, пусто → 204 без удаления,
  занят → 409 `has_dependencies` с деревом+items; голый DELETE (и тело без `expected`)
  → 422 `expected_state_required` (проверка формы раньше probe — неизвестный id тоже
  422); `?dry_run`+`resolutions` → 422 `dry_run_with_resolutions_forbidden`;
  тело `{resolutions?, expected}` — probe → `collect_dependencies` → subset-сверка
  `expected` (409 `stale_dependencies` при появлении сверх подтверждённого; исчезнувшая
  не блокирует) → валидация `resolutions` → `resolve_delete` → 204; несуществующий id
  с телом → 404 `TAG_NOT_FOUND` (`2586b9d7`).
- **T3 — api-client: `dryRunDeleteTag` + `resolveDeleteTag` (малое):** зеркало records —
  `dryRunDeleteTag(id)` (DELETE `?dry_run=true`, без тела) и типизированный
  `resolveDeleteTag(id, {expected, resolutions?})` (обязательный `expected`) (`95a1ea18`).
- **T4 — фронт: `useDeleteTag` + `TagsTable` + подписи `DeleteDialog` (S1–S3, S9):**
  хук-мутация по образцу `useDeleteRecord` (dry-run по клику, enqueue на 204 с
  `expected: {}`, диалог на 409 с деревом, confirm → enqueue с `{resolutions, expected}`
  из items, undo из item-level снапшота кэша `['tags']`, commit с обработкой ошибок
  D4-семьи); `TagsTable` — проводка потока; `DeleteDialog` получил тег-сторонние
  подписи («Услуги: 2 (сняты)» + однострочники), родительская сторона без изменений
  (`2bed6e56`).
- **T5 — бэкенд-тесты (standard):** `test_deletion_tags.py` (матрица/реестры/PII/items,
  8 видов зависимостей, master id = `staff_id`) + `test_api_tags.py` (полный контракт:
  голая форма, dry-run, subset-юниты D7-зеркало #285, обмен при равном счётчике,
  исчезнувшая зависимость, `dry_run`+`resolutions`); регрессы родительских 409-деревьев
  staff/location (`39e2a9ed`).
- **T6 — фронт-тесты (small):** `useDeleteTag.test.ts` (ветки dry-run/confirm/undo/commit-
  фейлы — 404 тихо, 409-stale «данные изменились»+«Обновить», сеть → undo) +
  `TagsTableDeleteFlow.test.tsx` (поток целиком до кольца-тоста) + подписи `DeleteDialog`
  (`21135f50`).
- **T7 — e2e `tags-delete-contract.spec.ts` (standard):** S1 (занятый → диалог с
  поимёнными строками → подтверждение → строка исчезла + кольцо → после окна тега и
  связей нет в БД), S2 (чистый → без диалога, после окна нет в БД), S3 (отмена в
  диалоге — ничего не изменилось), S9 («Отменить» в окне → строка вернулась, DELETE не
  уходил, БД не тронута); DB-полл-паттерн `unified-rows` (`cca86cef`).

## Notable Extras Folded In

- **`cleanupTag` для e2e-фикстур:** голый `DELETE /tags` в `cleanup()` молча утекал бы под
  новым 422-контрактом — 4 call-site исправлены на `resolveDeleteTag`/dry-run-совместимую
  очистку, плюс аудит существующих e2e на голый DELETE `/tags` (продуктовых нет)
  (`cca86cef`).
- **`resolve_delete` поднят на `GenericService`:** `ArchiveService`-метод переехал в базовый
  класс, тег-роут получил исполнителя; подклассы `ArchiveService` наследуют без изменений;
  типы хендлеров расширены до базового класса (`086adb67`).

## Test Results

- **pytest (полный):** **2376 passed / 0 failed** (15 skipped — pre-existing).
- **vitest (полный):** **2300 passed / 0 failed**.
- **e2e (standalone):** новый `tags-delete-contract` **4/4** + затронутые аудитом спеки
  **10/10**; полный e2e-гейт — CI (PR).
- **Визуальный гейт:** визуальная комплаенс-проверка **13/13 PASS** (скриншоты
  `/tmp/opencode/visual-318/`).

## Acceptance Criteria (spec §4 scenarios)

| Сценарий | Статус |
|---|---|
| S1 — занятый тег: диалог с поимённым превью, подтверждение, кольцо, коммит | ✅ e2e (`cca86cef`) |
| S2 — чистый тег: без диалога, кольцо-тост, коммит | ✅ e2e (`cca86cef`) |
| S3 — отмена в диалоге — ничего не изменилось | ✅ e2e (`cca86cef`) |
| S4 — домен: матрица + реестры (счётчики/id/item/хендлеры) | ✅ pytest (`086adb67`) |
| S5 — dry-run занятого → 409-дерево, чистого → 204 без удаления | ✅ pytest, фикстура full-8 |
| S6 — контракт тела/формы: голый → 422, `dry_run`+`resolutions` → 422, `TAG_NOT_FOUND` → 404 | ✅ pytest (`2586b9d7`) |
| S7 — commit-фейлы: 404 тихо, 409-stale, сеть → undo | ✅ vitest (`21135f50`, 404-quiet добавлен в T6) |
| S8 — subset-сверка `expected` (появление сверх подтверждённого, исчезнувшая не блокирует) | ✅ pytest (`39e2a9ed`) |
| S9 — «Отменить» в окне: строка вернулась, DELETE не уходил | ✅ e2e + vitest |
| S10 — items/подписи, PII-граница, регресс родительских 409-деревьев | ✅ pytest subset-юниты + регрессы staff/location |

## Key Files Changed

- `backend/src/domain/deletion.py` — Tag-матрица, 8 счётчиков/id/item-реестров, 8 хендлеров, docstring (T1)
- `backend/src/api/v1/tags.py` — полный DELETE-контракт dry_run/422/expected/subset (T2)
- `backend/src/schemas/tag.py` — `TagDeleteBody {resolutions?, expected}` (T2)
- `backend/src/services/generic.py` — `resolve_delete` поднят на `GenericService` (T1)
- `packages/api-client/src/endpoints.ts` — `dryRunDeleteTag` + `resolveDeleteTag` (T3)
- `frontend/admin/hooks/useTagsMutations.ts` — `useDeleteTag` deferred-пайплайн (T4)
- `frontend/admin/app/(main)/tags/components/TagsTable.tsx`, `tagColumns.tsx` — проводка (T4)
- `frontend/admin/app/components/DeleteDialog.tsx` — тег-сторонние подписи (T4)
- Тесты: `test_deletion_tags.py`, `test_api_tags.py`, `test_api_staff.py`, `test_api_locations.py`, `generic_contract.py`; `useDeleteTag.test.ts`, `TagsTableDeleteFlow.test.tsx`, `TagsTable.test.tsx`, `DeleteDialog.test.tsx`; e2e `tags-delete-contract.spec.ts` + `fixtures/factories.ts`.

## Docs Impact

- Спека rev9 + план (7 задач) + domain-rules Tag-строки (`_overview.md`, `tags.md`) уже на main, веткой не менялись.
- `CHANGELOG.md` — новый `[Unreleased] — 2026-09-21` раздел (этот docs-коммит).
- `PLAN.md` — completion-blockquote в шапке.

## Known Non-Blocking Observations

- Полный e2e-гейт — CI (PR); локально прогнаны новый спек и затронутые аудитом.
- #324 (остаток неархивной семьи + тест-страж) и #345 (архивные) — вне рамок этой ветки; #324 наследует шаблон контракта один-в-один.
- Фронтовые подписи тег-стороны сознательно вынесены в `DeleteDialog` (общий компонент), родительские карты подписей не тронуты.

## References

- **GitHub Issue**: #318
- **Design Spec**: `docs/specs/2026-09-19-tags-busy-delete-318-design.md` (rev9, on main)
- **Plan**: `docs/plans/2026-09-20-tags-busy-delete-318-plan.md` (on main)
- **Canon**: `docs/domain-rules/_overview.md`, `docs/domain-rules/tags.md` (on main)
- **Reference contract**: #285 (records), #286 (activities)
- **PR**: _(to be added after PR creation)_
