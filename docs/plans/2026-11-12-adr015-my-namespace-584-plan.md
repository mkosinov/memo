# План: /my-реструктуризация — волна ADR-015 (#584)

**Goal:** выполнить clause 3 ADR-15 по спеке рев.5 (`docs/specs/2026-11-12-adr015-my-namespace-584-design.md`, main `5513ae64`): универсальный `GET /my` (данные учётки + `roles`), ветки `/my/client|master|admin`, настройки под ветками, кука `memo_staff_session`, `/portrait` → `/avatar`, удаление `/auth/me`, миграция api-client и обоих фронтов.

**Architecture:** бэкенд FastAPI — стражи в `src/auth/permissions.py`, роутеры `src/api/v1/`; api-client Zod-типизированный; админ Next.js (`AuthContext`), веб Next.js (кабинет через api-client). Поведенческая дельта — в спеке §8; план задач её не пересказывает.

**Tech Stack:** Python/FastAPI/SQLAlchemy/pytest; TypeScript/Zod (packages/api-client, vitest); Next.js/Playwright (e2e admin + web).

Спека — единственный источник контрактов; ниже только порядок и границы задач.

## Task 1: Чистый резолв, комбинированный страж, `GET /api/v1/my`

### Classification: standard

Новая чистая функция резолва в `src/auth/permissions.py` (без `set_actor`; существующий `resolve_authed` НЕ меняется — третий потребитель `get_optional_scope` нетронут). Комбинированный страж только для whoami: два чистых резолва → пустой список ролей → 401; актёр — одна запись (первичная учётка, staff-first) со **всем списком резолвнутых ролей** (формат актёра расширяется: role → roles). `MyWhoamiResponse {id, phone, email, roles}` (`schemas/my.py`); состав ролей по спеке §4.1 (симметричные фильтры аудитории). Контракт-тесты: комбинации кук (включая невалидные — роли нет, но не 401), пустой список → 401, шпион `set_actor` — ровно один вызов с полным списком ролей.

### Required Docs

- `docs/domain-rules/auth.md`
- `docs/decisions/015-api-url-audience-namespaces.md` (clause 3 + поправки; только чтение — поправки уже в main `5513ae64`, писать нечего)

### DoD

- Контракт-тесты whoami зелёные; аноним → 401 (часть сценария 6 спеки §7).
- Существующие тесты резолва/стражей не изменены по смыслу (радиус разрыва нулевой).

## Task 2: Кабинет клиента под `/api/v1/my/client/*`

### Classification: small

`my_client.py` + `my_reads.py` объединяются в один роутер ветки: `GET /my/client` (без изменений), `GET|POST /my/client/records`, `GET /my/client/photos`, `GET /my/client/payments`. Гард прежний (`require_client_session`); CSRF-набор POST-бронирования (`verify_fetch_metadata` + `verify_origin`) сохранён. Схемы/сортировки/пагинация — без изменений (контракты #513/#499).

### Required Docs

- `docs/domain-rules/auth.md` (раздел клиентской аутентификации)

### DoD

- Тесты кабинета зелёные на новых путях; CSRF-тест POST `/my/client/records` на месте.
- Старые плоские пути отвечают 404 (контракт-тест).

## Task 3: Стафф-ветки `/api/v1/my/master` и `/api/v1/my/admin`

### Classification: standard

Сегодняшний `my.py` становится роутером ветки, монтируется на ДВУХ статических префиксах (path-параметр запрещён — блокер панели, спека §4.3). Допуск: `/my/admin` — роль admin; `/my/master` — роль master ИЛИ мастер-секция; без стафф-куки → 401 единым конвертом; чужая ветка → 403. `MyStaffProfileResponse` = `MyProfileResponse` + `{user_id, phone, email, permissions}` (+ мастер-секция и снапшот только в master-ветке); сборка переиспользует `_build_me_response` (логин не меняется). `/portrait` → `/avatar` (`AvatarResponse`, контракт загрузки без изменений).

### Required Docs

- `docs/domain-rules/profile.md`
- `docs/domain-rules/staff.md`

### DoD

- Контракт-тесты допуска: все комбинации спеки §9, включая `role=master` без секции → 200 на `/my/master` и совмещённого админ+мастера на обеих ветках (сценарий 5a).
- `/my/portrait` → 404; `/my/master/avatar` и `/my/admin/avatar` принимают multipart как раньше.
- CSRF-тесты PUT профиля и POST аватара — явно на каждый маршрут (спека §9).

## Task 4: Настройки под ветками

### Classification: small

Роутер `/user-settings` переезжает: стафф-экземпляр под `/my/master/settings` и `/my/admin/settings` (та же учётка, те же строки), клиентский экземпляр под `/my/client/settings` (guard `require_client_session`; строки клиентских учёток уже создаются при рождении учётки; api-client-методов для клиентской ветки НЕ добавляем — потребителя нет). Комментарий в `test_delete_matrix_guard.py` — на реальные пути.

### Required Docs

- `docs/domain-rules/user_settings.md`

### DoD

- Обе стафф-ветки 200 на одних строках; клиентская кука на стафф-ветках → 401, стафф-кука на `/my/client/settings` → 401; `/api/v1/user-settings*` → 404.
- CSRF-тесты мутаций настроек (POST/PUT/PATCH/DELETE) — явно на каждый маршрут (спека §9).

## Task 5: Удаление `/auth/me` + пин-тесты allowlist

### Classification: small

Эндпоинт удаляется; запись `("GET", "/api/v1/auth/me")` уходит из `PUBLIC_ROUTES`; пин-тест точного равенства обновлён; default-deny walk закрывает новые пути автоматически. Тесты, читавшие `/auth/me` (`test_auth_guards`, `test_client_session_api`, `test_session_fixtures`, `test_master_scope_contract`), переводятся на whoami/ветки.

### Required Docs

- `docs/domain-rules/auth.md`

### DoD

- `GET /api/v1/auth/me` → 404; walk и пин-тесты зелёные; `login`/`logout` нетронуты.

## Task 6: Кука `memo_staff_session`

### Classification: small

Константа `SESSION_COOKIE` → значение `memo_staff_session`: выдача в логине, чтение стражами, очистка в logout (обе куки чистятся как сегодня). Бэкенд-тесты сессий — на новое имя; старое имя нигде не принимается.

### Required Docs

- `docs/domain-rules/auth.md`

### DoD

- Логин выдаёт `memo_staff_session`; запрос со старым именем = аноним (401 на защищённых).

## Task 7: api-client

### Classification: standard

`getMe()` удаляется (блок «removed methods» пополняется). Новое: `getMyWhoami(): MyWhoami | null` (401 → null), `getMyStaffProfile(branch)`, загрузка аватара → `/avatar`, настройки принимают ветку (`/api/v1/my/{master|admin}/settings`), кабинетные пути → `/api/v1/my/client/*` (списки, бронирование, `GET /my/client`). Zod: `MyWhoamiSchema`, `MyStaffProfileSchema`; `AuthMeSchema` — только для логина. **Исключение 401-редиректа в `client.ts` — точечное**: метод GET + точный путь `/api/v1/my` (не префикс!); юнит-тест обеих сторон (401 `GET /my` → без редиректа; 401 `/my/master` → с редиректом).

### Required Docs

- `docs/domain-rules/auth.md`

### DoD

- `endpoints.test.ts` зелёный: whoami, профиль ветки, аватар, настройки с веткой, кабинетные пути, исключение редиректа.

## Task 8: Админ-SPA — цепочка бутстрапа

### Classification: standard

`AuthContext`: бутстрап и `refresh()` — `getMyWhoami()` → `getMyStaffProfile(branch)`, ветка = `"master" ∈ roles ? "master" : "admin"`; матрица отказа по шагам спеки §5 (whoami 401 → гость; без стафф-роли → гость; parse → сброс+переброс; профиль 401 → гость со сбросом; сетевая — бутстрап гость / refresh сохранить). `login`/`logout` не меняются; настройки (Topbar) — в вычисленную ветку; модалка «Мои данные» — аватар на новый путь. Unit: `AuthContext.test.tsx` — успех и обе ступени отказа.

### Required Docs

- `docs/domain-rules/profile.md`

### DoD

- Unit-тесты цепочки зелёные (сценарий 1 — на unit-уровне; e2e — Task 9).

## Task 9: E2E — адаптация и сценарий двух кук

### Classification: large

`storageState`/фикстуры admin+web — кука `memo_staff_session`. Адаптация: `auth-session` (включая анонима: гость без редиректа), `master-role-smoke`, `auth-roles`, `password-setup-link` (прямые запросы `/auth/me`), `user-settings-guarantee`, `schedule-archived-visibility`, `schedule-column-visibility`, `dayview-column-reorder`, кабинетные спеки web. Новый сценарий 5: две сессии в одном контексте (два логина на разных телефонах либо сидирование кук по образцу #513) — `/my` отдаёт обе роли, админка работает по стафф-роли, кабинет — по клиентской.

### Required Docs

- `docs/domain-rules/auth.md`

### DoD

- E2E тест для сценариев 1–7 спеки §7 проходит (RED-GREEN-REFACTOR); CI-шарды зелёные.

## Task 10: Дом-правила

### Classification: trivial

`profile.md`, `staff.md`, `user_settings.md`, `auth.md`: таблицы маршрутов, имя куки, `/avatar`; правка тем же PR-хвостом волны.

### Required Docs

- `docs/domain-rules/audit_log.md` (формат актёра с ролями — Task 1)

### DoD

- Таблицы маршрутов в дом-правилах совпадают со спекой §4; упоминаний `memo_session` и `/auth/me` как живых нет.
