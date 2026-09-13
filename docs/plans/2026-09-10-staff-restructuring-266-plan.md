# Staff Restructuring (#266) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Таблица мастеров становится справочником сотрудников (`staff`), мастера — отдельной таблицей-расширением (`masters`: специальность, цвет, распределение), должности — словарём с множественным выбором (`positions` + M2M, смысл — зарплата). История записей не рвётся; фильтры «Мастер» в расписании не меняются; управление — из карточки сотрудника сценарными чекбоксами.

**Architecture:** Одна миграционная цепочка (rename `masters`→`staff` с сохранением id; новая `masters` со staff_id PK FK ON DELETE CASCADE; `positions`/`staff_positions`; `users.master_id`→`staff_id` через batch_alter; FK-retarget `activities`/`master_tags`; rename `user_settings.column_order_*`). Композитный `StaffService` поверх generic-паттернов проекта (POST/PUT карточки = одна транзакция на staff + masters-строку + staff_positions + учётку). `/api/v1/masters` превращается в read-only view (GH #205 list-контракт на чтение), полный CRUD переезжает на `/api/v1/staff`. Фронт: экран «Сотрудники» (StaffTable + модалка с чекбоксами должностей и мастер-секцией + диалог увольнения с чекбоксами), справочник должностей среди справочников; потребители мастеров (фильтры, MasterPicker, расписание) продолжают читать `/masters`.

**Tech Stack:** FastAPI (текущая версия из `uv.lock`), SQLAlchemy 2 + alembic (batch_alter для SQLite), Next.js 14 App Router, TanStack Query, Playwright, vitest/pytest.

**Spec (binding):** `docs/specs/2026-09-10-staff-restructuring-design.md` — решения D1–D11, «Модель данных», «Миграция» (шаги 0–8, гейт #247 в шапке), «API», «Контракты ошибок», «Инвентарь переименования», «UI», «Валидация и правила», «User Scenarios» S1–S7, «Границы», «Тестирование».

**Worktree:** create after G2 via `./.opencode/scripts/create-worktree.sh feat/staff-266`.

**Test commands:**
- Backend: `cd backend && uv run --extra dev pytest -q`.
- Frontend unit: `cd frontend/admin && pnpm test`.
- Type-check: `cd frontend/admin && pnpm type-check`.
- api-client unit: `cd packages/api-client && pnpm test`.
- E2E: `cd frontend/admin && pnpm test:e2e -- e2e/<file>.spec.ts` (стек через `scripts/e2e-shard-start.sh`, см. `scripts/test-all.sh`).

**Commits:** per-task, prefix `feat(#266):` (миграция — `feat(#266): migration …`).

**Suite-greenness policy (per-task DoD):** заявленные красные окна — иначе план невыполним честно:
- **T1–T3: backend pytest КРАСНЫЙ** (объявленный список: всё, что касается masters — миграция переименовала таблицы, тесты переписываются к T4). Юнит-прогоны непересекающихся зон допустимы точечно.
- **T4: backend pytest полностью ЗЕЛЁНЫЙ** и остаётся зелёным до конца плана.
- **T6–T8: фронт type-check КРАСНЫЙ в зоне экрана мастеров** (api-client переименован, экран переписывается); всё, кроме экрана сотрудников, — зелёное.
- **E2E: полностью зелёный после T10** (инфра переписывается в T7; до того e2e не заявляется).
- Гейт #247: **T0 не пройден — план не стартует**; миграция не мержится в main, пока PR #247 не смержен и CI main зелёный.

---

## Behavioral Delta

Как это выглядит для пользователя, по User Scenarios спеки:

- **Вход и экран (S1, S7)** — в «Справочниках» сайдбара появляется строка «Сотрудники» (решение юзера 10.09; сегодня у экрана мастеров входа из меню нет вообще — «Мастера» в сайдбаре это легенда расписания, она не меняется); на экране — все люди студии, в карточке — чекбоксы должностей, секция «Мастер» (специальность + цвет) и чекбокс создания учётки; один сценарий заводит человека сразу с логином и мастером.
- **Сотрудник без мастер-секции невидим в расписании (S1)** — СММ не появляется в фильтре мастеров и в `/api/v1/masters`.
- **Мастера приходят и уходят (S2)** — добавил секцию «Мастер» → человек в фильтрах и `/masters`; заархивировал мастера → исчез из списков, но все его прежние записи показывают его имя и цвет.
- **Миграция ничего не ломает (S3)** — после обновления все прежние мастера, занятия и записи на месте: имена, цвета, ID; у сид-мастеров — должность «мастер».
- **Выбор мастера в занятии (S4)** — только действующие (`masters.is_active = true`), как и сегодня.
- **Должности — про зарплату (S5)** — новую должность можно создать и удалить; встроенную «мастер» удалить нельзя (с объяснением), переименовать можно; должности не влияют на расписания и фильтры.
- **Увольнение с чекбоксами (S6)** — оба предвыбраны («Архивировать мастера», «Архивировать учётку»); снял галку мастера — уволенный остался в расписании (штатное состояние); снял галку учётки — вход остался разрешён.
- **Не меняется вообще:** фильтр «Мастер» расписания, выбор мастера в записи, плашки, цвета колонок расписания, ключи `master_name`/`master_color`, роли входа (admin/master).

---

## File Structure (decisions locked)

| File | Action | Responsibility |
|---|---|---|
| `backend/src/models/staff.py` | CREATE (T1) | `Staff` (бывш. Master; `__tablename__ = "staff"`) |
| `backend/src/models/master.py` | REWRITE (T1) | `Master` — новая модель расширения (`__tablename__ = "masters"`: staff_id PK+FK CASCADE, specialty Text, color, is_active) |
| `backend/src/models/position.py` | CREATE (T1) | `Position` (id: fixed «master»/«admin» \| uuid, title, is_system) + `staff_positions` Table |
| `backend/src/models/user.py` | MODIFY (T1) | `master_id` → `staff_id` FK staff |
| `backend/src/models/activity.py`, `tag.py`, `__init__.py`, `enums.py` | MODIFY (T1) | FK на новую masters; export; удалить мёртвые `Position`/`Specialty` enum |
| `backend/alembic/versions/*_staff_restructuring*.py` | CREATE (T1) | цепочка шагов 0–8 спеки (допустимо 2 ревизии) |
| `backend/src/seed/seed.py` | MODIFY (T1) | staff/positions/masters-строки сида (m1–m5, m7; должность «мастер» всем сид-мастерам) |
| `backend/src/domain/deletion.py` | MODIFY (T2) | FK_MATRIX/cascade-хендлеры на Staff + masters/staff_positions auto-cascade |
| `backend/src/services/record.py` | MODIFY (T2) | scalar-subqueries: источник — join новой masters; ключи `master_name`/`master_color` НЕ менять |
| `backend/src/admin/setup.py` | MODIFY (T2) | `StaffAdmin` (+ мастер-секция), `PositionAdmin`; ActivityAdmin.master_id жив |
| `backend/src/errors.py`, `domain/errors.py` | MODIFY (T2) | `STAFF_NOT_FOUND`, `MASTER_NOT_ACTIVE`, `POSITION_NOT_FOUND`, `POSITION_IS_SYSTEM`, `SPECIALTY_REQUIRED`, `COLOR_REQUIRED` |
| `backend/src/auth/*` | MODIFY (T2) | механический перенос на новый словарь (после гейта T0, #247 в main): `AuthedUser.master_id` → `staff_id`, снапшот `/auth/me` — из карточки сотрудника + мастер-полей, форма ответа не меняется |
| `backend/src/schemas/staff.py`, `position.py` | CREATE (T3) | Staff CRUD (master-блок `master: {specialty, color} \| null`, position_ids, create_user-флаг), Position schemas; `master.py` — read-only view |
| `backend/src/services/staff.py` | CREATE (T3) | `StaffService`: композитные create/update (одна транзакция: staff + masters + staff_positions + user), archive(body-чекбоксы)/restore, deletion-resolutions |
| `backend/src/services/position.py` | CREATE (T3) | CRUD + блок удаления is_system |
| `backend/src/api/v1/staff.py`, `position.py` | CREATE (T4) | роуты (GH #205 list-контракт, `?q=` GH #212, sort без `position`) |
| `backend/src/api/v1/masters.py` | REWRITE (T4) | read-only: GET + GET /all (`masters.is_active = true`) |
| `backend/src/services/master.py`, `schemas/master.py` | REWRITE (T3–T4) | сворачиваются в тонкий read-only запросный модуль view (join staff+masters) — отдельного CRUD-сервиса мастеров больше нет |
| `backend/src/main.py` | MODIFY (T4) | регистрация роутов |
| `backend/tests/*` | MODIFY (T1–T4) | conftest-фикстуры (`_user` INSERT staff_id), `test_api_masters.py` → `test_api_staff.py`, contract-тесты |
| `backend/src/events/*` | MODIFY (T5) | walk сервисов подберёт `staff`; cascade-only записи join-таблиц |
| `frontend/admin/lib/invalidate.ts`, `queryKeys.ts`, `types.ts` | MODIFY (T5–T6) | SSE-карта: `staff` + `masters`; ключи/типы |
| `packages/api-client/src/endpoints.ts`, `schemas.ts` | MODIFY (T6) | staff CRUD + archive-body + create_user; masters read-only (getMaster/{id}, мутации, reorder — удалить); fixtures regen (`packages/api-client/scripts/gen_backend_fixtures.py`) |
| `frontend/admin/app/(main)/masters/` → `staff/` | MOVE+REWRITE (T8) | page, StaffTable, StaffModal (должности-чекбоксы, мастер-секция, create_user), ArchiveStaffDialog (чекбоксы D6) |
| `frontend/admin/hooks/`, `contexts/` | MODIFY (T8) | `useStaff`/`useStaffMutations`/`StaffContext`; `MastersContext` остаётся read-only потребителем `/masters` |
| `frontend/admin/app/(main)/positions/` | CREATE (T9) | справочник должностей — новая плоская страница по образцу tags/locations (каталога dictionaries в проекте нет) |
| `frontend/admin/components/Menubar.tsx` | MODIFY (T8–T9) | строка «Сотрудники» в DIRECTORY_ITEMS (легенда «Мастера»-точки не меняется); строка «Должности» (T9) |
| `frontend/admin/e2e/fixtures/factories.ts`, `seed-reset.ts`, `helpers.ts` | MODIFY (T7) | createTestStaff(+мастер-секция); RESET_SQL под 4 таблицы; waitForStaffReady; data-testid `master-row-*` сохранить где про мастеров |
| `frontend/admin/e2e/staff-*.spec.ts` | CREATE (T8–T10) | S1–S7 |
| `docs/specs/2026-09-08-auth-design.md`, `docs/plans/2026-09-08-auth-247-plan.md`, `docs/specs/2026-09-09-user-cabinet-design.md` | MODIFY (T12) | master-словарь → staff (после мержа #247); перепись #262 под staff |
| `CHANGELOG.md` | MODIFY (T11) | строка #266 |

---

## Task 0: Гейт #247 и baseline

### Classification: trivial
### Required Docs
- Спека #266 — шапка («Гейт #247»).

- [ ] Убедиться: PR #247 смержен в main, CI main зелёный (`gh pr view 247`, `gh run list --branch main`).
- [ ] `git checkout main && git pull --ff-only`; зафиксировать baseline: `cd backend && uv run --extra dev pytest -q` зелёный; `cd frontend/admin && pnpm test && pnpm type-check` зелёные.
- [ ] Если #247 ещё не смержен — СТОП, план не стартует (сессия закрывается, карточка ждёт).

**DoD:** #247 в main; baseline зафиксирован (вывод прогонов в отчёт задачи).

---

## Task 1: Модели и миграция

### Classification: large
### Required Docs
- `docs/domain-rules/staff.md` (Naming Convention, Fields, Archive & delete semantics).
- Спека #266 — «Модель данных», «Миграция» (шаги 0–8), D1, D3, D9.

- [ ] Аудит данных (шаг 0): `sqlite3 memo.db "SELECT DISTINCT position FROM masters WHERE is_active=1 OR 1=1"` — ожидаемо только «мастер»/«администратор». Иное значение — СТОП, решение с пользователем.
- [ ] ORM: `models/staff.py` (Staff), rewrite `models/master.py` (Master — расширение), `models/position.py` (Position + staff_positions), `user.py` staff_id, `activity.py`/`tag.py` FK-цели, `__init__.py` export, удалить `Position`/`Specialty` из `enums.py`.
- [ ] Миграция (шаги 1–8): rename masters→staff → create masters/positions/staff_positions → перенос specialty/color/is_active → batch_alter users (снять безымянный unique master_id, rename → staff_id, FK staff, именованный unique) → FK-retarget activities/master_tags → rename user_settings колонки → seed update. Допустимо 2 ревизии в одном PR; downgrade не пишем.
- [ ] Смоук: file-копия dev-БД → `alembic upgrade head` → `python -m src.seed.seed` idempotent → руками: расписание-запросы живы, id сохранены.

**DoD:** per-test alembic-контур поднимает схему без FK-ошибок (conftest session); смоук-отчёт приложен. Backend pytest КРАСНЫЙ — объявленное окно T1–T3 (список падающих: masters-роуты/сервисы/тесты).

---

## Task 2: Перенос доменных механик

### Classification: standard
### Required Docs
- `docs/domain-rules/_overview.md` — «Hard-delete FK dependency matrix» (строки Staff), «Archive terminology boundary».
- `docs/domain-rules/staff.md` — матрица удалений.

- [ ] `domain/deletion.py`: FK_MATRIX/counter-функции/каскад-хендлеры → Staff (User.staff_id; activities через masters — block; masters/users/master_tags/staff_positions — auto-cascade).
- [ ] `services/record.py`: scalar-subqueries через join новой masters; выходные ключи `master_name`/`master_color` без изменений.
- [ ] `admin/setup.py`: StaffAdmin (карточка + мастер-поля), PositionAdmin; UserAdmin колонка staff_id.
- [ ] `errors.py`/`domain/errors.py`: 6 новых кодов (таблица «Контракты ошибок» спеки).
- [ ] `backend/src/auth/*` (гейт T0 пройден — #247 в main): механический перенос на новый словарь — `AuthedUser.master_id` → `staff_id`, снапшот `/auth/me` собирается из карточки сотрудника + мастер-полей, **форма ответа не меняется** (D10).

**DoD:** точечные pytest в зоне deletion/record/auth-механик зелёные; остальной backend — всё ещё в красном окне (закрывается в T4).

---

## Task 3: Схемы и композитный StaffService

### Classification: large
### Required Docs
- Спека #266 — D5, D6, D8 (archive-body `{archive_master, archive_user}` = true), «Контракты ошибок».
- `docs/domain-rules/staff.md` — Сценарные операции.

- [ ] `schemas/staff.py`: StaffCreate/Update (master-блок `master: {specialty, color} | null`, `position_ids: []`, `create_user: {phone, password} | false`), StaffResponse (archived-инверсия, как у всех archive-aware).
- [ ] `services/staff.py`: `create`/`update` — ОДНА транзакция (staff + masters-строка upsert/remove + staff_positions replace + user create); `archive(id, {archive_master, archive_user})` — применяет чекбоксы только к существующим активным связям; `restore`; deletion-resolutions по матрице.
- [ ] `services/position.py`: CRUD; удаление is_system → `POSITION_IS_SYSTEM` 422.
- [ ] Валидации: специальность+цвет обязательны при наличии master-блока; `MASTER_NOT_ACTIVE` на activity-создание (сюда же защитная проверка в activity-сервисе, если не в T2).

**DoD:** сервисные pytest (создание с/без master-блока, чекбоксы архива, блокировки) зелёные. Полный suite — красное окно закрывается в T4.

---

## Task 4: Роуты — backend зелёный

### Classification: large
### Required Docs
- `docs/domain-rules/staff.md` — API Endpoints, List contract.
- `docs/domain-rules/auth.md` — Public Access (allowlist GET /masters).
- Спека #266 — «API», D8.

- [ ] `api/v1/staff.py`: GET (пагинация/status/q=GH#212; sort_by: name, specialty, color, avatar, status — БЕЗ position; specialty/color LEFT JOIN, NULLs last), GET /all, GET /{id}, POST, PUT/PATCH /{id}, POST /{id}/archive (body-чекбоксы), POST /{id}/restore. Без PUT /reorder.
- [ ] `api/v1/masters.py` → read-only: GET, GET /all (`masters.is_active = true`; id=staff_id, имена, specialty, color, avatar_url, sort_order). Мутации и /{id} удалить.
- [ ] `api/v1/position.py`: CRUD + защита is_system.
- [ ] `main.py`: регистрация; публичный allowlist #247 — GET /masters остаётся.
- [ ] Переименовать/переписать backend-тесты: `test_api_masters.py` → `test_api_staff.py` (+read-only /masters), фикстуры conftest, generic/contract-тесты.

**DoD:** `uv run --extra dev pytest -q` — ПОЛНОСТЬЮ ЗЕЛЁНЫЙ. Контракт #247 (auth-депенденси на всех роутах) зелёный.

---

## Task 5: SSE-сущности

### Classification: small
### Required Docs
- Спека #266 — «SSE-сущности».
- План #239 (паттерн карты инвалидаций): `docs/plans/2026-09-08-server-push-invalidation-239-plan.md`.

- [ ] `events/entities.py`: walk сервисов отдаёт `staff` + `masters`; cascade-only записи для join-таблиц (staff_positions/master_tags) по образцу User.
- [ ] `frontend/admin/lib/invalidate.ts`: EntityName + `staff`, `masters`; positions/staff_positions НЕ добавляем (задача справочника должностей — будущая, события были бы no-op).

**DoD:** pytest SSE-тест (имена сущностей) зелёный; type-check зелёный (invalidate-карта).

---

## Task 6: api-client

### Classification: standard
### Required Docs
- Спека #266 — «API», D9 (что НЕ переименовываем).
- `packages/api-client/` — существующие конвенции (endpoints.ts, schemas.ts, fixtures).

- [ ] `endpoints.ts`: getStaff/getAllStaff/createStaff (master-блок, position_ids, create_user)/updateStaff/archiveStaff(body-чекбоксы)/restoreStaff; masters — только getMasters/getAllMasters (getMaster/{id}, мутации, reorderMasters — удалить).
- [ ] `schemas.ts`: zod-схемы Staff/Position/MasterView; паритет Pydantic↔Zod.
- [ ] Regen fixtures: `packages/api-client/scripts/gen_backend_fixtures.py` → `__fixtures__/backend-responses.json`.

**DoD:** `packages/api-client && pnpm test` зелёный. Фронт type-check — объявленное красное окно в зоне экрана мастеров (закрывается в T8).

---

## Task 7: e2e-инфраструктура

### Classification: standard
### Required Docs
- Спека #266 — «Тестирование» (RESET_SQL — полный rewrite под 4 таблицы; id m1–m5, m7).
- `frontend/admin/e2e/fixtures/` — текущие factories/seed-reset/helpers.

- [ ] `factories.ts`: `createTestStaff({positions, master?, user?})` через POST /api/v1/staff; `createTestMaster` → обёртка над createTestStaff(master-блок); linkUserToStaff (UPDATE users SET staff_id); seedUser role без изменений.
- [ ] `seed-reset.ts`: RESET_SQL rewrite — staff/masters/positions/staff_positions к сиду (DELETE несидовых, восстановление sort_order m1–m5+m7, восстановление позиций сида).
- [ ] `helpers.ts`: waitForStaffReady (экран /staff); мастер-ожидания на /masters read-only; data-testid `master-row-*` в расписании сохранить.

**DoD:** один e2e-смоук (создание сотрудника через фабрику + reset между тестами) проходит на текущем фронтовом экране (старом) или напрямую через API-ассерты.

---

## Task 8: Экран «Сотрудники»

### Classification: large
### Required Docs
- `docs/design-system.md` — модалки, чекбоксы, тосты.
- `docs/domain-rules/staff.md` — Сценарные операции (D6), Fields.

- [ ] Перенос `app/(main)/masters/` → `staff/`: page, StaffTable (колонки: имя, должности, специальность, цвет, архив; сортировка всех колонок кроме должностей), StaffModal (основные данные + чекбоксы должностей + мастер-секция «Добавить/архивировать» + чекбокс учётки с телефоном/паролем), StaffFilters.
- [ ] ArchiveStaffDialog: чекбоксы «Архивировать мастера (расписание)» (виден при активной masters-строке) и «Архивировать учётку (вход)» (при наличии учётки), оба предвыбраны.
- [ ] Hooks/контексты: `useStaff`, `useStaffMutations`, `StaffContext`; `MastersContext` остаётся (читает /masters — фильтры расписания не трогаем).
- [ ] Menubar: строка «Сотрудники» в DIRECTORY_ITEMS (collapsible «Справочники» — решение юзера 10.09; легенда «Мастера» не меняется); терминология «Архивировать/Вернуть из архива».
- [ ] Re-capture визуальных базлайнов: `masters-table-*` (7 шт.) + `menubar-*` (меню меняется) — обновить снапшоты visual-regression (иначе полный прогон T11 упадёт).
- [ ] Vitest: переименовать/переписать тесты экрана (MastersTable.test → StaffTable.test и пр.).

**DoD:** `pnpm test && pnpm type-check` зелёные. **E2E test for scenario S2 passes (RED-GREEN-REFACTOR)** (мастер пришёл/ушёл, история жива); **E2E test for scenario S6 passes (RED-GREEN-REFACTOR)** (чекбоксы увольнения); **E2E test for scenario S7 passes (RED-GREEN-REFACTOR)** (создание с учёткой и мастером одним сценарием).

---

## Task 9: Справочник должностей

### Classification: standard
### Required Docs
- `docs/design-system.md`; паттерн справочников (теги).
- Спека #266 — D4 (встроенные master/admin: удаление запрещено, title свободен).

- [ ] Новая плоская страница `app/(main)/positions/` (по образцу `tags/`, `locations/` — каталога dictionaries в проекте нет): позиции — создать/переименовать/удалить; встроенные — без удаления, с объяснением блокировки (тост из `POSITION_IS_SYSTEM`). Строка «Должности» в DIRECTORY_ITEMS.
- [ ] Vitest справочника.

**DoD:** юнит зелёный. **E2E test for scenario S5 passes (RED-GREEN-REFACTOR)** (новая создаётся/удаляется; «мастер» не удаляется, переименовывается; должности не влияют на фильтры).

---

## Task 10: Интеграционные сценарии чтения и миграции

### Classification: standard
### Required Docs
- Спека #266 — S1, S3, S4; «Миграция».

- [ ] e2e S1: сотрудник-СММ (без мастер-секции) не появляется в фильтре мастеров расписания и /api/v1/masters.
- [ ] e2e S4: создание занятия — список мастеров только действующие.
- [ ] e2e S3 (миграция-смоук): на свежем стеке с применённой миграцией — сид-мастера/занятия/записи на месте, имена/цвета/ID прежние, у сид-мастеров должность «мастер».

**DoD:** **E2E tests for scenarios S1, S3, S4 pass (RED-GREEN-REFACTOR)**. Весь e2e-стек зелёный (`scripts/test-all.sh`).

---

## Task 11: Полный прогон и CHANGELOG

### Classification: standard
### Required Docs
- CLAUDE.md — engineering rules (UI diffs → test:all).

- [x] Полный прогон: backend pytest, vitest, type-check, весь e2e (`scripts/test-all.sh`) — зелёные.
- [x] CHANGELOG.md: строка #266.

**DoD:** выводы прогонов в отчёт; никаких красных.

---

## Task 12: Правки документов-соседей

### Classification: standard
### Required Docs
- Спеки `2026-09-08-auth-design.md`, план `2026-09-08-auth-247-plan.md`, спека `2026-09-09-user-cabinet-design.md`.

- [x] #247 спека+план: master-словарь → staff (снапшот /auth/me — «master snapshot» становится снапшом карточки сотрудника + мастер-полей; `AuthedUser.master_id` → staff_id) — только тексты; сам код перенесён раньше (auth — T2).
- [x] Спека #262: полная перепись под staff-словарь (ссылки на Master-модель, specialty, /my, инвалидации, сценарии) — согласно «Границы» спеки #266.
- [x] `docs/domain-rules/_overview.md`/`staff.md`: сверка с реализацией (остаточные мастера-упоминания, naming-таблица).

**DoD:** grep по docs/ не находит устаревших мастеровых ссылок вне исторических (спеки закрытых задач не переписываем).

---

## Task 13: Финал

### Classification: small
### Required Docs
- CLAUDE.md — G7 (merge choice за пользователем).

- [ ] Смоук миграции на dev-копии повторно (после всех задач).
- [ ] PR: тело со ссылкой на спеку/план, `Closes #266`, список красных окон и их закрытия.
- [ ] Выбор юзера: merge / push+PR / keep / discard.

**DoD:** PR открыт, CI зелёный, юзер принял решение по G7.
