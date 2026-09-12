# #266 Staff-реструктуризация — implementation notes

- **Дата:** 2026-09-12
- **Feature:** GH #266 — staff-реструктуризация (сотрудники, мастера, должности)
- **Branch:** `feat/staff-restructuring-266` (не смержена; база — `81d9006` / #247)
- **Spec:** `docs/specs/2026-09-10-staff-restructuring-design.md`
- **Plan:** `docs/plans/2026-09-10-staff-restructuring-266-plan.md`
- **Гейт:** миграция/код #266 не мержатся в main, пока PR #247 не смержен и CI main зелёный (T0). #247 смержен (`81d9006`).

## Итог

`masters`-таблица (люди) переименована в `staff` (карточка каждого сотрудника); мастера стали отдельной 1:0..1 таблицей-расширением `masters` (specialty, color, is_active); должности — словарь `positions` + M2M `staff_positions` (смысл — будущий расчёт зарплаты); `/api/v1/masters` свёрнут в read-only view для расписания и клиентского сайта, полный CRUD переехал на `/api/v1/staff`; в админке появились экран «Сотрудники» и справочник должностей. История записей не рвётся (id m1–m5, m7 сохранены; ключи `master_name`/`master_color` и строки UI «Мастер» не менялись).

## Задачи T0–T13 (план; все ✅)

| # | Задача | Классификация | Статус | Коммит(ы) |
|---|--------|---------------|--------|-----------|
| T0 | Гейт #247 и baseline | trivial | ✅ | — (PR #247 в main `81d9006`; baseline зафиксирован) |
| T1 | Модели и миграция (staff/masters/positions/staff_positions; users.staff_id; seed) | large | ✅ | `b98e991` |
| T2 | Перенос доменных механик (deletion matrix, record subqueries, admin, errors, auth snapshot) | standard | ✅ | `6772adf` |
| T3 | Схемы + композитный `StaffService` + `PositionService` | large | ✅ | `99a08f2`, `2edeb38` |
| T4 | Роуты staff/position; masters → read-only; backend зелёный | large | ✅ | `06b8a57` |
| T5 | SSE-сущности `staff`/`masters` + карта инвалидаций | small | ✅ | `5581492` |
| T6 | api-client: staff/position/master-view схемы, endpoints, fixtures, `column_order_staff`, `has_user` | standard | ✅ | `9634e62`, `7cbda05`, `472d393` |
| T7 | e2e-инфраструктура (фабрики, RESET_SQL под 4 таблицы, helpers) | standard | ✅ | `758a0dc` |
| T8 | Экран «Сотрудники» (StaffTable/StaffModal/ArchiveStaffDialog/hooks/menubar) + S2/S6/S7 | large | ✅ | `88fdf8b`, `00eecf1` |
| T9 | Справочник должностей + S5 | standard | ✅ | `fbaf108` |
| T10 | Интеграционные сценарии S1/S3/S4 (+ изоляция s7 probe) | standard | ✅ | `3fc392c`, `e3fb28d` |
| T11 | Полный прогон + CHANGELOG | standard | ✅ | (этот docs-коммит) |
| T12 | Правки документов-соседей + domain-rules | standard | ✅ | (этот docs-коммит) |
| T13 | Финал: смоук миграции, PR, G7 | small | ✅ | PR/G7 — за пользователем |

## Коммиты (15, `b98e991..e3fb28d`)

| Коммит | Содержание |
|--------|-----------|
| `b98e991` | T1 — миграция + ORM-модели (staff/masters/positions) |
| `6772adf` | T2 — доменные механики на staff (deletion, record, auth snapshot, admin) |
| `99a08f2` | T3 — staff/position схемы + композитный `StaffService` |
| `2edeb38` | T3 — quality fixes (dedupe position_ids, ассерты, lint) |
| `06b8a57` | T4 — staff/position роуты, masters read-only view; backend зелёный |
| `5581492` | T5 — SSE entities staff/masters + cascade-only join docs |
| `9634e62` | T6 — api-client staff/position/master-view схемы + endpoints |
| `7cbda05` | T6 — api-client quality round (position schema tests, archive no-body, dedupe) |
| `472d393` | T6/T8 — master-section archived flag + has_user + user_settings rename |
| `758a0dc` | T7 — e2e-инфра: staff factories, seed reset, helpers |
| `88fdf8b` | T8 — экран сотрудников (table/modal/archive dialog, hooks, menubar) + e2e S2/S6/S7 |
| `00eecf1` | T8 — StaffTable test — D6 dialog checkbox coverage |
| `fbaf108` | T9 — справочник должностей + e2e S5 |
| `3fc392c` | T10 — изоляция s7 login probe (admin-session rotation wedge) |
| `e3fb28d` | T10 — e2e S1/S3/S4 integration scenarios |

## Красные окна плана и их закрытие

- **T1–T3 — backend pytest КРАСНЫЙ** (объявленное окно): миграция переименовала таблицы, masters-тесты переписываются. Точечные прогоны непересекающихся зон допустимы. **Закрыто к T4** — `uv run --extra dev pytest -q` полностью зелёный и остаётся зелёным до конца.
- **T6–T8 — фронт type-check КРАСНЫЙ в зоне экрана мастеров** (api-client переименован, экран переписывается). Всё, кроме экрана сотрудников, зелёное. **Закрыто к T8** — `pnpm test && pnpm type-check` зелёные.
- **E2E** заявляется полностью зелёным только после T10 (инфра переписана в T7).

## Прогон T11 (полный)

- Backend pytest: **1871 passed / 0 failed / 8 skipped**.
- api-client: **349 passed / 0 failed**.
- admin vitest: **1790 passed / 0 failed**.
- `tsc`: **0 ошибок** (в зоне #266).
- e2e shards: **schedule 94/94**; **rest 269/279** — 9 ожидаемых visual font-drift снимков + 1 pre-existing server-push C3 flake. **CI авторитетен** (локальные font-метрики отличаются от раннера; baseline refresh — через `update-snapshots` workflow при необходимости).

## Known follow-ups (вне скоупа #266)

- **Server-push C3 flake** (pre-existing, e2e) — не связан с #266; CI авторитетен.
- **frontend/web: 28 pre-existing tsc-ошибок** — не блокируют CI (у `frontend/web` нет type-check скрипта); вне скоупа.
- **CI visual baseline refresh** — 9 font-drift снимков при необходимости обновляются `update-snapshots` workflow на раннере.
- **G7** — выбор merge / push+PR / keep / discard остаётся за пользователем.
