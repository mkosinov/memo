# GH #345 — Архивируемые сущности на общий флоу удалений «навсегда» (этап 4 трекера #346)

- **Date**: 2026-09-27
- **Branch**: `345-archivable-delete`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `e6196ff6` — 12 commits (`5255c125..2bbfa16b`), 76 files, +9111/−1952
- **Issue**: #345 — архивируемые сущности (staff, locations, services, materials, clients) на общий флоу удалений «навсегда»
- **Spec**: `docs/specs/2026-09-27-archivable-delete-345-design.md` (rev3 — факт-синк после мержа #327)
- **Plan**: `docs/plans/2026-09-27-archivable-delete-345-plan.md` (10 задач T1–T10)
- **Canon**: `docs/domain-rules/deletion.md` (строка фазы 3 закрыта — «готово — #345», `2bbfa16b`); `docs/domain-rules/_overview.md` (матрица — 5 сущностей на отложенном конвейере); `staff.md`/`clients.md` — код-коммитами T3/T4
- **Трекер**: #346 — этап 4; этапы 1–3 (теги #318, листья+зависимые+страж #324) вне скоупа

## Goal

Пять архивируемых сущностей были последними держателями легаси-контракта #207: голый DELETE
исполнял чистую строку сразу (тихо-разрушительный путь) и не имел ни превью, ни сверки
ожидаемого состояния. Цель — полный семейный флейвор #318/#285: `?dry_run=true` →
204/409-дерево, голый DELETE и тело без `expected` → 422 `expected_state_required`, commit
`{resolutions?, expected}` с subset-сверкой; фронт — оба пути (чистая строка и диалог) на
конвейер PendingActions (optimistic + кольцо 5 с + undo). «В архив»/«Восстановить» — вне
контракта удалений, не менялись вовсе.

## Summary of Changes (per task)

- **T1 — коллекторы (standard, `5255c125`):** фабрика коллекторов в `domain/deletion.py` —
  id/items для `(Client, "records")` (дата-однострочники, образец билдера
  `(Activity, "records")`) и `(Client, "visitors")` (имя, nullable → «Аноним»; PII-граница
  #285 D9 — без телефонов), id-only для blocked-зависимостей
  `(Staff/Location/Service, "activities")` — гейс expected-сверки: без коллектора гонка
  «занятие появилось за окно» ловилась бы 422 blocked вместо 409 stale; Material — без
  новых ключей (`service_materials` — auto). Баннеры docstring реестров под новый состав
  (`b38b619c`).
- **T2 — корневой контракт services/locations/materials (large, `829e815f` + правки ревью
  `017b4b7b`):** контрактные ветки в роутере (зеркало `tags.py`), исполнение через
  `GenericService._resolve_delete_core` — форма → probe → guard → развилка; голый DELETE →
  422 `expected_state_required` (форма раньше probe), превью — только `?dry_run=true`,
  `dry_run`+`resolutions` → 422 `dry_run_with_resolutions_forbidden`, commit — subset-сверка
  `expected` по non-auto узлам (409 `stale_dependencies`; исчезнувшая за окно не блокирует,
  auto-узлы вне сверки) → валидация `resolutions` (blocked при любом теле → 422) → 204.
- **T3 — staff на сценарий + роут (standard, `a018014c`):** сценарий `delete_staff`
  (`usecases/staff.py`) принимает параметр `expected` и выполняет сверку внутри своей
  `@transactional` — зеркало `delete_record`; роут сохраняет транспорт (формы, 404/422-маппинг,
  превью-ветка).
- **T4 — clients на сценарий + роут (standard, `2c48eb01`):** тот же шаблон — `delete_client`
  (`usecases/clients.py`, #327) получает `expected`, сверка внутри транзакции сценария;
  единственная сущность с разрешимым commit `{resolutions, expected}` (записи — nullify,
  посетители — cascade).
- **T5 — api-client dryRun + payload (small, `2e50b414`):** `dryRunDeleteX` ×5 (зеркало
  `dryRunDeleteRecord`); `resolveDeleteX` — payload `{resolutions?, expected}` с обязательным
  `expected`; `endpoints.test.ts` синхронизирован.
- **T6 — хуки staff/clients (standard, `10931423`):** `useDeleteStaff`/`useDeleteClient` на
  deferred-конвейер по образцу `useDeleteTag`/`useDeleteRecord`; общий модуль
  `expectedFromDependencies` (дубли из `useDeleteRecord`/`useDeleteTag` свёрнуты) — expected
  строится из **полного** дерева ответа, а не отрисованных строк (лимит 10 + «и ещё N» —
  только рендер).
- **T7 — хуки locations/services/materials (standard, `4ff3ff0b`):** те же три хука на
  deferred-conveyor.
- **T8 — голые deleteX снесены (trivial, `2ade9787`):** `deleteStaff/Client/Service/Location/Material`
  удалены из api-client вместе с describe-блоками (последний потребитель — зонд превью в
  мутациях — ушёл в T6/T7); grep-аудит оставшихся вызовов чист.
- **T9 — e2e ×5 (large, `0819fdcd`):** `materials-delete`, `clients-delete-cascade`,
  `clients-delete-invalid-resolution`, `staff-delete-blocked` (Mode B «Архивировать вместо»
  сохранён), `staff-delete-auto-cascade` — переписаны на поток dry_run → диалог → кольцо →
  commit; factories cleanup routing под 422-контракт (голый DELETE в `cleanup()` утекал бы).
- **T10 — канон (trivial, `2bbfa16b`):** `deletion.md` — строка фазы 3 архивируемых закрыта;
  `_overview.md` — матрица потоков под конвейер.

## Rebase Note

Перебазирован на main `e6196ff6` — впитал #324 (листья семьи + страж матрицы) и #367
(SortParams). Три конфликт-файла разрешены **аддитивными объединениями**: реестры
`deletion.py` (коллекторы #324 + #345 рядом), импорт `endpoints.test.ts`, cleanup-routing
e2e-factories. Интеграционный прогон после rebase — зелёный (см. Tests).

## Test Results (post-rebase integration run)

- **backend `-m api`:** **1168 passed / 0 failed**.
- **backend domain+usecases:** **320 / 0**.
- **admin vitest (TZ=UTC):** **2662 / 0** + `tsc --noEmit` clean.
- **api-client vitest:** **449 / 0**.
- **e2e:** **21 / 0** — 5 переписанных delete-спеков + archive-паритет 14 (`archive-restore-parity` — S7, зелёный без правок) + schedule-sanity 7.
- **generic-контракт:** зелёный (`generic_contract.py` / `test_generic_api_contract.py`).

## Acceptance Criteria (spec §7)

| Criterion | Status |
|---|---|
| S1 занятый клиент: dry_run → 409 → диалог (items, cascade_preview) → кольцо → commit `{resolutions, expected}` | ✅ pytest + e2e `clients-delete-cascade` |
| S2 строка без решений: чистая → 204 → кольцо → `{expected:{}}`; all-auto материал → 409 (auto-узел) → диалог → `{expected:{}}` | ✅ pytest + e2e `materials-delete` |
| S3 undo в окне — строка вернулась, серверных DELETE не было | ✅ vitest хуков + e2e |
| S4 blocked (staff/location/service с занятиями) — только Mode B «Архивировать вместо» | ✅ e2e `staff-delete-blocked` |
| S5 гонка окна: появившаяся зависимость → 409 `stale_dependencies` (в т.ч. у ведущего — 409, не 422); исчезнувшая не блокирует | ✅ pytest subset-юниты |
| S6 прямой API: голый DELETE → 422; `{resolutions}` без expected → 422; форма раньше probe (неизвестный id → 422); `dry_run`+resolutions → 422; blocked-тело → 422; неизвестный ключ игнорируется | ✅ pytest-контракты ×5 сущностей |
| S7 «В архив»/«Восстановить» без изменений | ✅ e2e `archive-restore-parity` 14/14 без правок |

## Family State After #345

Семья удалений «навсегда» #346 — этап 4 закрыт: теги #318 (этап 1), листья+зависимые+страж
#324 (этапы 2+3), архивируемые #345 (этап 4). Голая форма DELETE в семье не осталась;
канон `deletion.md` закрыт. Из трекера остаются карточки #395/#396/#397 (семейные
компромиссы, Hold — вне скоупа #345).

## Key Files Changed

- `backend/src/domain/deletion.py` — фабрика коллекторов (T1)
- `backend/src/api/v1/{services,locations,materials,staff,clients}.py` — корневой контракт ×5 (T2–T4)
- `backend/src/usecases/{staff,clients}.py` — параметр `expected` в сценариях (T3/T4)
- `packages/api-client/src/endpoints.ts` (+`.test.ts`) — `dryRunDeleteX` ×5, `resolveDeleteX` payload, голые `deleteX` снесены (T5/T8)
- `frontend/admin/hooks/use{Staff,Client,Service,Location,Material}Mutations.ts` — конвейер ×5 (T6/T7)
- `frontend/admin/lib/expectedFromDependencies.ts` — общий модуль (T6)
- `frontend/admin/e2e/{materials-delete,clients-delete-cascade,clients-delete-invalid-resolution,staff-delete-blocked,staff-delete-auto-cascade}.spec.ts` + `fixtures/{factories,helpers}.ts` (T9)
- `docs/domain-rules/{deletion,_overview,staff,clients}.md` — канон (T3/T4/T10)
