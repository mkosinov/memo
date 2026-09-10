# Master Role v1 (#263) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Роль `master` получает серверный скоуп «только своё» (всё через записи: активность → записи → визиты/посетители/оплаты/клиенты; фото — своей активности), маску телефона (последние 4 цифры) и вырезание email в клиент-содержащих ответах, полный CUD оплат своих записей и фото своих активностей, создание клиентов без правки чужих, урезанное меню с экраном «Нет доступа», шаблонную подстановку роли от должности. Скоуп и маска живут на сервере; фронт — косметика.

**Architecture:** Новый `backend/src/auth/scope.py` (`ScopeContext {user_id, role, master_key}`, зависимость из сессии #247 одним join `users → staff → masters`; пустой скоуп для мастера без masters-строки — заведомо пустое множество). Скоуп применяется только в штатных точках расширения generic-механизма (kwargs-фильтры, сервисный stmt-билдер + repo-кор — паттерн #213): конъюнктивный where в `RecordService._build_list_stmt` (покрывает `list` и `list_view`), kwargs в `ActivityService.list`, EXISTS-ветка в фото-билдере, новый stmt-путь оплат через join на запись, скоуп клиентов через EXISTS записи + phone-поиск без скоупа. Маска — при сборке клиент-содержащих ответов для роли master. Дельта матрицы `ROLE_PERMISSIONS`: мастеру добавляются `payments:write`, `photos:write`, `clients:write` (скоуп режет до своих; мутации существующих клиентов — 403). Фронт: константа admin-only разделов (фильтр меню + guard прямых URL), `can()` становится потребляемым, роль в карточке сотрудника подставляется должностью. Нулевая миграция БД.

**Tech Stack:** FastAPI (версия из `uv.lock`), SQLAlchemy 2, Next.js 14 App Router, TanStack Query, Playwright, vitest/pytest. Сессии/гварды — готовый код #247, не трогаем.

**Spec (binding):** `docs/specs/2026-09-10-master-role-design.md` — решения D1–D10, «Backend», «Frontend», «Пограничные случаи», «User Scenarios» S1–S8, «Границы», «Тестирование».

**Worktree:** create after G2 via `./.opencode/scripts/create-worktree.sh feat/master-role-263`.

**Test commands:**
- Backend: `cd backend && uv run --extra dev pytest -q`.
- Frontend unit: `cd frontend/admin && pnpm test`.
- Type-check: `cd frontend/admin && pnpm type-check`.
- E2E: `cd frontend/admin && pnpm test:e2e -- e2e/<file>.spec.ts` (стек через `scripts/e2e-shard-start.sh`, см. `scripts/test-all.sh`).

**Commits:** per-task, prefix `feat(#263):`.

**Suite-greenness policy (per-task DoD):** объявленных красных окон НЕТ — скоуп/маска действуют только на роль master, все существующие тесты ходят под админом (скоупа нет, маски нет). Требование к каждой задаче: заявленные прогоны зелёные; полный стек зелёный после T10. Гейт трёх мержей: **T0 не пройден — план не стартует**.

---

## Behavioral Delta

Как это выглядит для пользователя, по User Scenarios спеки:

- **Своё расписание (S1)** — мастер видит в сетке только свои занятия; чужие дни пусты.
- **Запись с поиском клиента (S2)** — селектор активностей только свои; typeahead по полному номеру ищет по всей студии, телефон в выдаче замаскирован (`+7 909 •••-••-1234`), email не отдаётся; нового клиента можно создать с полным номером.
- **Оплаты на месте (S3)** — мастер создаёт, правит и удаляет оплаты своих записей; статусы оплаты записей пересчитываются.
- **Урезанный интерфейс (S4)** — у мастера в меню только Расписание / Записи / Услуги (просмотр) / Фото; скрыты Клиенты, Локации, Теги, Сотрудники, Должности, легенда «Мастера», блок материалов; прямой URL скрытого раздела → экран «Нет доступа».
- **Свои фото (S5)** — в списке фото только фото своих активностей; создать/править/удалить можно только свои (filename строкой, загрузки файлов нет).
- **Герметичный API (S6)** — под сессией мастера API не отдаёт: телефон без маски, email клиента, чужие записи/оплаты/фото/клиентов (404), правку чужих клиентов (403), суммы totals по чужим записям.
- **Админ без регрессий (S7)** — под админом всё как до #263: все разделы, полные телефоны, все данные.
- **Шаблон роли (S8)** — должность «мастер» в карточке сотрудника автоматически подставляет роль доступа master при создании учётки, «админ» — admin; несколько должностей — старшая; ручная правка остаётся.

**Не меняется вообще:** логин/сессии/локдаун #247, кабинет #262, PUBLIC_ROUTES, SSE-карта, фильтр «Мастер» у админа, поведение публичного сайта и `/photos/web`.

---

## File Structure (decisions locked)

| File | Action | Responsibility |
|---|---|---|
| `backend/src/auth/scope.py` | CREATE (T1) | `ScopeContext`, зависимость `get_scope` (join users→staff→masters), sentinel пустого скоупа, `mask_phone()` |
| `backend/src/auth/permissions.py` | MODIFY (T1) | дельта `ROLE_PERMISSIONS`: master += `payments:write`, `photos:write`, `clients:write` |
| `backend/src/services/activity.py` | MODIFY (T2) | list: kwargs `master_id = master_key`; get чужой → 404 |
| `backend/src/services/record.py` | MODIFY (T2) | `_build_list_stmt`: конъюнктивный серверный where `Activity.master_id` (покрывает `list` + `list_view`); точечные owner-проверки → 404 |
| `backend/src/services/visit.py`, `visitor.py` | MODIFY (T2) | скоуп через запись (визиты; посетители — через визиты) |
| `backend/src/services/client.py` | MODIFY (T3) | скоуп списка (EXISTS записи к своей активности), phone-поиск без скоупа, маска phone/email-null при role=master, POST-остальные мутации — разделение |
| `backend/src/schemas/client.py` | MODIFY (T3) | маска применяется в сервис-сборке — схемы не дублируют маску; `ClientResponse` без изменений формы |
| `backend/src/api/v1/clients.py` | MODIFY (T3) | PUT/PATCH/DELETE/archive/restore под master → 403 `AUTH_FORBIDDEN`; POST — 201 |
| `backend/src/services/payment.py` | MODIFY (T4) | сервисный stmt-билдер (join payment→record→activity) через штатную точку расширения; owner-проверки; `get_payment_totals` фильтрует `record_ids` по своим |
| `backend/src/services/photo.py` | MODIFY (T5) | EXISTS-ветка в существующем билдере (`photo.activity_id → activity.master_id = master_key`); owner-проверки; `/photos/web` не трогаем |
| `backend/src/services/staff.py` | MODIFY (T6) | подстановка роли от должности (D10): при `create_user` и смене должностей; старшая роль при нескольких |
| `backend/tests/test_scope_*.py`, `test_api_*` | CREATE/MODIFY (T1–T6) | мастер-клиенты в conftest; скоуп-контракт; маска; контракт скоуп-покрытия |
| `frontend/admin/app/components/layout/Menubar.tsx` | MODIFY (T7) | ADMIN_ONLY_SECTIONS-фильтр пунктов; легенда «Мастера» скрыта; блок материалов на «Услугах» — по `can()` |
| `frontend/admin/app/(main)/layout.tsx` | MODIFY (T7) | guard прямых URL скрытых разделов → `NoAccessScreen` |
| `frontend/admin/app/components/error/NoAccessScreen.tsx` | CREATE (T7) | экран «Нет доступа» на базе `ErrorState`, `data-testid="no-access"` |
| `frontend/admin/app/(main)/services/` | MODIFY (T7) | read-only для мастера: кнопки create/edit скрыты без `services:write`; материалы — без `materials:read` |
| `frontend/admin/app/(main)/staff/components/StaffModal.tsx` | MODIFY (T6) | поле роли: авто-подстановка от должности, видимо и правится |
| `frontend/admin/e2e/globalSetup.ts`, `playwright.config.ts` | MODIFY (T8) | второй логин (демо-мастер сида #247) → `master` storageState |
| `frontend/admin/e2e/master-role-*.spec.ts` | CREATE (T8–T10) | S1–S8 |

---

## Task 0: Гейт трёх мержей и baseline

### Classification: trivial
### Required Docs
- Спека #263 — шапка («Гейт»).

- [ ] Убедиться: PR #247, PR #266 и PR #262 смержены в main, CI main зелёный (`gh pr view <N>`, `gh run list --branch main`). Любой не смержен — СТОП, план не стартует (карточка ждёт).
- [ ] `git checkout main && git pull --ff-only`; baseline: `cd backend && uv run --extra dev pytest -q` зелёный; `cd frontend/admin && pnpm test && pnpm type-check` зелёные; e2e-стек поднимается (`scripts/e2e-shard-start.sh`).
- [ ] Сверить, что ожидания спеки живы: `users.staff_id` и `masters.staff_id` в моделях, `AuthContext.can()` во фронте, демо-мастер в сиде (#247 §3.11), экран «Сотрудники» с `StaffModal` существует (#266), админ-storageState в e2e-инре (#247 §4.8). Расхождение — СТОП и комментарий в issue.

**DoD:** три мержа в main; baseline зафиксирован (вывод прогонов в отчёт задачи).

---

## Task 1: Scope-модуль и дельта матрицы прав

### Classification: standard
### Required Docs
- `docs/domain-rules/auth.md` — «Roles & Permissions», «Per-master data scoping (#263)» (D1, D2, пустой скоуп).
- Спека #263 — D1, D3 (маска), «Backend» (Scope-слой).

- [ ] `auth/scope.py`: `ScopeContext {user_id, role, master_key: str | None}`; зависимость `get_scope` — из сессии #247 одним join `users → staff → masters` (master_key = `masters.staff_id`, только при `role=master` И существующей masters-строке); для `role=master` без masters-строки — sentinel пустого скоупа (никогда «без фильтра»); admin — контекст без скоупа.
- [ ] `mask_phone(phone)` здесь же: последние 4 цифры (`+7 909 •••-••-1234`; нецифровые разделители сохраняются, прочие цифры → `•`; короче 4 — маскируется целиком; `null` → `null`).
- [ ] `auth/permissions.py`: master += `payments:write`, `photos:write`, `clients:write` (семантика — скоуп D5/D6/D7 режет до своих; `clients:write` = только создание).
- [ ] pytest: unit `get_scope` (admin / мастер со строкой / мастер без строки / архивная masters-строка — ключ жив), `mask_phone` таблица (формат, короткие, null), матрица-дельта.

**DoD:** новые pytest зелёные; весь backend pytest зелёный (скоуп ещё никем не потребляется). E2E не затронут.

---

## Task 2: Скоуп чтения — активности, записи, визиты, посетители

### Classification: large
### Required Docs
- `docs/domain-rules/auth.md` — правило «своё» (D2), 404-семантика.
- Спека #263 — D2, «Backend» (records: конъюнктивно; list_view тем же билдером).

- [ ] `ActivityService.list`: kwargs `master_id = master_key` (существующий паттерн); `GET /activities/{id}` чужой → 404.
- [ ] `RecordService._build_list_stmt`: серверный where `Activity.master_id = master_key` добавляется **конъюнктивно (AND)** к клиентским фильтрам (клиентский `master_id` ≠ свой → пустой результат); `list_view` покрыт тем же билдером. Точечные get/update/delete + каскады визитов/посетителей — owner-проверка через активность записи, чужое → 404 (существующий код сущности).
- [ ] `VisitService` / `VisitorService`: скоуп через запись (визит); посетители — через визиты (посетитель без визитов мастера невидим; мутации посетителей — только в контексте своих записей).
- [ ] pytest API: мастер-клиент (фабрика в conftest: логин мастера сида/спец-созданного) — свои записи видны, чужие отсутствуют в list/list_view, чужая по id → 404, update/delete чужой → 404; админ-регресс: без изменений.

**DoD:** заявленные pytest зелёные; полный backend зелёный. **E2E test for scenario S1 passes (RED-GREEN-REFACTOR)** — расписание мастера: свои занятия в сетке, чужих нет (e2e-инра — T8; если T8 ещё не смержена в ветку, сценарий пишется в T8).

---

## Task 3: Клиенты — скоуп, маска, создание без правки

### Classification: large
### Required Docs
- `docs/domain-rules/clients.md` — «Master role (#263)», List `?phone=` (#221).
- Спека #263 — D3 (маска/email), D4 (phone-поиск по всем), D7 (POST 201 / мутации 403).

- [ ] `ClientService`: список без `phone`-параметра под master — EXISTS-скоуп «есть неархивная запись клиента к своей активности»; `?phone=` (digits-mode) и `GET /clients/get?phone=` — без скоупа (все неархивные); `GET /clients/{id}` — свой → 200, чужой → 404.
- [ ] Маска при role=master во всех клиент-содержащих ответах: `ClientResponse`, `ClientWithStats` (обе точки сборки — generic-путь и ручной билдер `list_clients_with_stats`), выдача typeahead: `phone` → `mask_phone`, `email` → `null`. Имя/`channel` — как есть. Мутации не маскируются (мастер создаёт клиента с полным номером).
- [ ] `api/v1/clients.py`: под master `PUT/PATCH/DELETE/{id}/archive/{id}/restore` → 403 `AUTH_FORBIDDEN`; `POST` → 201.
- [ ] pytest API: скоуп списка vs phone-поиск; маска во всех трёх ответах (включая stats-путь); email null; POST 201 / PATCH 403; чужой get → 404.

**DoD:** заявленные pytest зелёные; полный backend зелёный. **E2E test for scenario S2 passes (RED-GREEN-REFACTOR)** — форма записи мастера: селектор свои активности, typeahead по номеру находит по всей студии с маской, новый клиент создаётся (e2e — T8/T9 по готовности инры).

---

## Task 4: Оплаты — stmt-билдер скоупа

### Classification: standard
### Required Docs
- `docs/domain-rules/payments.md` — «Master role (#263)», Batch Aggregate.
- Спека #263 — D5, «Backend» (payments: штатная точка расширения).

- [ ] `PaymentService`: сервисный stmt-билдер через штатную точку расширения generic-механизма (образец — записи/фото, паттерн #213): stmt с `join payment → record → activity`, where `activity.master_id = master_key`; repo-кор делает счёт/сортировку/пагинацию. У оплаты нет колонки мастера — владелец только через запись.
- [ ] Точечные операции: create/update(PUT/PATCH)/delete — owner-проверка родительской записи (чужая → 404).
- [ ] `get_payment_totals`: фильтрация `record_ids` по своим перед агрегацией (чужие молча исключены; все чужие → `200 {"totals": {}}`).
- [ ] pytest API: list только свои; create/update/delete свои ок / чужие 404; totals исключает чужие.

**DoD:** заявленные pytest зелёные; полный backend зелёный. **E2E test for scenario S3 passes (RED-GREEN-REFACTOR)** — оплата своей записи: создал, изменил сумму, удалил; статус записи пересчитался (e2e — T9/T10).

---

## Task 5: Фото — EXISTS-ветка и owner-проверки

### Classification: small
### Required Docs
- `docs/domain-rules/photos.md` — «Master role (#263)», Cross-field Rules.
- Спека #263 — D6, «Backend» (photos).

- [ ] `PhotoService`: в существующем билдере списка — EXISTS-ветка `photo.activity_id → activity.master_id = master_key` (LEFT JOIN-путь `service_id`-фильтра не трогаем); фото клиентов/услуг/локаций и без владельца под master не видны.
- [ ] Точечные get/PUT/PATCH/DELETE/POST — только для/к своей активности (create с чужим `activity_id` → 404; чужое get → 404).
- [ ] `/photos/web` — без изменений (публичный).
- [ ] pytest API: список только свои; CUD свои ок / чужие 404; чужой activity_id в create → 404.

**DoD:** заявленные pytest зелёные; полный backend зелёный. **E2E test for scenario S5 passes (RED-GREEN-REFACTOR)** — в списке фото мастера только свои; создание к своей активности ок (e2e — T9/T10).

---

## Task 6: Шаблон роли от должности (D10)

### Classification: standard
### Required Docs
- `docs/domain-rules/auth.md` — User lifecycle (шаблоны #263).
- Спека #263 — D10; `docs/domain-rules/staff.md` — Сценарные операции.

- [ ] `StaffService`: при создании учётки из карточки и при изменении набора должностей — авто-подстановка `users.role`: должность «мастер» (id-якорь `master`) → `role=master`, «админ» (id `admin`) → `role=admin`; несколько должностей — старшая (admin > master); прочие должности роль не трогают. Якорь по фиксированному id должности, не по title (D4 #266).
- [ ] Ручная правка роли остаётся возможной (поле в теле запроса бьёт шаблон, если передано явно).
- [ ] Фронт `StaffModal`: поле роли авто-заполняется при выборе должностей, видимо и правится.
- [ ] pytest: подстановка при создании с должностью «мастер» + чекбоксом учётки; смена набора должностей меняет роль; «СММ» не трогает; явная роль в теле приоритетна. vitest модалки (если тестируется) или ручной смоук.

**DoD:** заявленные прогоны зелёные. **E2E test for scenario S8 passes (RED-GREEN-REFACTOR)** — карточка с должностью «мастер» и учёткой → вход показывает урезанное меню (e2e — T9/T10).

---

## Task 7: Контракт скоуп-покрытия (backend зелёный закреплён)

### Classification: standard
### Required Docs
- Спека #263 — «Тестирование» (контракт скоуп-покрытия, 404-fast-path).
- `docs/domain-rules/auth.md` — Public Access (паттерн контракт-теста #247).

- [ ] Контракт-тест: каждый master-доступный эндпоинт `/api/v1` либо проходит через скоуп-слой (в списке скоуп-точек), либо явно числится в списке исключений (словари services/locations/tags — read без скоупа) — по образцу `PUBLIC_ROUTES`-контракта #247; новые роуты без скоупа падают тестом.
- [ ] 404-fast-path: точечные проверки чужого идут одним скоуп-запросом (без отдельного owner-раунд-трипа — тайминг «чужое» ≈ «не существует»); законтрактовано ассертами в скоуп-тестах T2–T5.
- [ ] Смоук e2e-существующих спек под админом не тронут (скоуп не влияет на admin).

**DoD:** контракт-тест зелёный; полный backend pytest зелёный и остаётся зелёным до конца плана. **E2E test for scenario S6 passes (RED-GREEN-REFACTOR)** — API-герметичность под сессией мастера (маска, email null, 404 чужих, 403 правки клиента, totals) — API-e2e или playwright-API-ассерты (e2e — T8–T10 по готовности).

---

## Task 8: e2e-инфраструктура — мастер-сессия

### Classification: standard
### Required Docs
- Спека #263 — «Тестирование» (механизм мастер-сессии).
- `frontend/admin/e2e/globalSetup.ts`, `playwright.config.ts` — текущее состояние (#247 добавил админ-storageState).

- [ ] `globalSetup.ts`: после админ-логина — второй логин демо-мастером сида (#247 §3.11: `+79990000002`) → `e2e/.auth/master.json` (storageState).
- [ ] Конфиг/спеки: мастер-спеки через `test.use({ storageState: ... })`; админ-проекты и логин-флоу-спеки #247 не меняются.
- [ ] Хелпер `useMasterSession()` для спек S1–S6, S8; `e2e/.auth/` (файлы сессий) — в `.gitignore` или проверить, что шаблон `.auth/` уже покрывает.
- [ ] Смоук: мастер-спека логинится и видит `/auth/me` c role=master.

**DoD:** смоук зелёный; существующие e2e-спеки не падают (прогон ближайших шардовых спек).

---

## Task 9: Фронт — меню по роли, экран «Нет доступа», read-only словари

### Classification: large
### Required Docs
- `docs/design-system.md` — пустые состояния, тосты, error-экраны.
- Спека #263 — D8, «Frontend».

- [ ] `Menubar.tsx`: константа `ADMIN_ONLY_SECTIONS = ['/clients', '/locations', '/tags', '/staff', '/positions']`; фильтрация `NAV_ITEMS`/`DIRECTORY_ITEMS`/«Сотрудники»/«Должности» для role=master; легенда «Мастера» не рендерится; боттом-блок — #262 без изменений.
- [ ] `(main)/layout.tsx`: guard — pathname в admin-only списке и role=master → `NoAccessScreen` (CREATE, на базе `ErrorState`, `data-testid="no-access"`, текст «Нет доступа к разделу»).
- [ ] `can()` — потребление: страница «Услуги» — кнопки create/edit скрыты без `services:write`; блок материалов скрыт без `materials:read`; модалки справочников — read-only рендер (существующий проп `isReadOnly`, источник — `can()`). Экран записей/оплат/фото мастеру разрешены — без изменений (сервер режет своё).
- [ ] Typeahead/маска: без правок — маска приезжает с сервера, отображается как есть.
- [ ] vitest: фильтрация меню по роли, guard-редирект, скрытие кнопок; re-capture визуальных базлайнов menubar ТОЛЬКО если админ-вид изменился (не должен).

**DoD:** `pnpm test && pnpm type-check` зелёные. **E2E test for scenario S4 passes (RED-GREEN-REFACTOR)** — прямые URL /clients, /locations, /tags, /staff, /positions → «Нет доступа»; в меню пунктов нет; материалы на «Услугах» скрыты.

---

## Task 10: Сценарные e2e S1–S3, S5–S6 и админ-регресс S7

### Classification: large
### Required Docs
- Спека #263 — «User Scenarios» S1–S7.
- `frontend/admin/e2e/` — конвенции (factories, helpers, RESET_SQL #252).

- [ ] S1: расписание мастера — свои занятия в сетке, чужие отсутствуют (мастер-фабрика: два мастера, активности обоих).
- [ ] S2: создание записи мастером — селектор только свои активности; typeahead по полному номеру — найден клиент всей студии, телефон замаскирован; несуществующий — клиент создан с введённым номером, запись создана.
- [ ] S3: оплаты — создал/изменил/удалил оплату своей записи, статус оплаты записи пересчитался.
- [ ] S5: фото — в списке только своей активности; создание filename-строкой к своей активности ок.
- [ ] S6: API-герметичность (playwright API-контекст или request-ассерты в спеке): маска phone/email-null во всех клиент-ответах, чужие record/payment/photo/client → 404, PATCH клиента → 403, totals без чужих сумм.
- [ ] S7 (регресс): админ-сессия — все разделы, полные телефоны (`/clients` показывает `+7…` без маски), все записи/оплаты/фото.

**DoD:** **E2E tests for scenarios S1, S2, S3, S5, S6, S7 pass (RED-GREEN-REFACTOR)**; полный e2e-стек зелёный (`scripts/test-all.sh`).

---

## Task 11: Полный прогон, CHANGELOG, правки доков #247, PR

### Classification: standard
### Required Docs
- CLAUDE.md — engineering rules (UI diffs → test:all), G7.
- Спека #263 — «Правки текста спеки #247».

- [ ] Полный прогон: backend pytest, vitest, type-check, весь e2e (`scripts/test-all.sh`) — зелёные.
- [ ] CHANGELOG.md: строка #263.
- [ ] Правки текста спеки #247 (паттерн T12 #266): код-блок матрицы §3.5 и таблица гвардов §3.7 — дополнить #263-дельтой (payments/photos/clients write у master + ссылка на скоуп-модель); исторические разделы не переписывать.
- [ ] PR: тело со ссылкой на спеку/план, `Closes #263`, перечень сценариев S1–S8 и их тестов.
- [ ] Выбор юзера: merge / push+PR / keep / discard.

**DoD:** PR открыт, CI зелёный, юзер принял решение по G7.
