# План #600: публичная витрина занятий — приватные не видны клиентам в web

- **Issue:** #600
- **Спека:** `docs/specs/2026-11-12-activity-private-visibility-600-design.md` (рев.4, main 26a6b830)
- **Дата:** 2026-11-12

## Goal

Аноним и клиент не получают приватные занятия ни на одной поверхности: сайт переезжает на анонимный список `GET /api/v1/public/activities` с минимальной 8-полевой схемой и серверным исключением приватных строк; старые GET-маршруты занятий закрываются охраной персонала (401); бронирование приватного id → 404 с паритетом несуществующего. Персонал (админ, мастер) — без изменений.

## Architecture

- Backend (FastAPI): новый маршрут в ADR-015 неймспейсе `/api/v1/public` по образцу публичных фото — отдельный view-метод сервиса, минимальная схема, allowlist-запись; охрана чтения `activities:read` на двух старых GET; предикат приватности в пробе существования брони. Общий `ActivityService.list` НЕ трогается (админ-сетка и скоуп мастера на нём).
- api-client (`@memo/api-client`): `getPublicActivities` + zod-схемы по образцу `getPublicPhotos`.
- Web (Next.js): хук расписания переключается на публичную функцию; ключ кэша сохраняет сегменты дат; явный `per_page=100`.
- Admin (Next.js): только стабильный селектор ромба для e2e.

## Tech Stack

Python/FastAPI/SQLAlchemy (backend), TypeScript/zod (`packages/api-client`), Next.js + TanStack Query (web/admin), Playwright (e2e), pytest/FastAPI TestClient (backend unit).

---

## Task 1: Backend — публичный список занятий (схема + view + маршрут + allowlist)

### Classification: standard

### Required Docs

- `docs/domain-rules/activities.md` — инвариант «Public activity reads live in the /public namespace» + строка таблицы API Endpoints
- `docs/domain-rules/auth.md` — раздел Public Access

### Steps

1. Схема `ActivityPublicResponse` в `backend/src/schemas/activity.py`: ровно `id`, `service_id`, `master_id`, `location_id`, `start`, `duration`, `capacity`, `occupied`; отдельный класс аудитории по образцу `PhotoPublicResponse` (докстринга: «only what the web schedule consumes»).
2. View-метод в `backend/src/services/activity.py` по образцу `list_public_photos_view` (`src/services/photo.py`): параметры только `date_from`/`date_to` + пагинационный кирпич; при отсутствии `date_from` окно от текущей даты (канон целых дней `day_range` из `src/domain/dates.py`); предикат `is_private IS NOT TRUE`; сортировка `start ASC, id ASC`; конверт `PaginatedResponse[ActivityPublicResponse]`; `occupied` — тот же bulk-расчёт, что в общем списке.
3. Маршрут `GET /api/v1/public/activities` в `backend/src/api/v1/public.py` (делегирует view; без охраны сессии).
4. Запись `("GET", "/api/v1/public/activities")` в `PUBLIC_ROUTES` (`backend/src/auth/public.py`) — allowlist точный, без масок.
5. Unit-тесты (FastAPI TestClient, посев ПАРЫ «приватное + обычное» на одной неделе): анониму 200; обычное присутствует, приватное отсутствует (позитивный контроль); `date_from`/`date_to` работают; окно по умолчанию от сегодня; конверт пагинации (`items`/`total`); `occupied` посчитан; порядок `start`+`id`; поля ответа — ровно 8, лишних нет.

### DoD

Unit-суит публичного списка зелёный (парный посев + позитивный контроль); серверная половина US-1 готова — e2e доезжает в Task 6.

---

## Task 2: Backend — охрана старых GET-маршрутов + вычистка allowlist

### Classification: small

### Required Docs

- `docs/domain-rules/auth.md` — Public Access (занятия покидают перечень анонимных словарей)
- `docs/domain-rules/activities.md` — инвариант staff-only старых GET

### Steps

1. На `GET /api/v1/activities` и `GET /api/v1/activities/{id}` (`backend/src/api/v1/activities.py`) — охрана чтения `require_permission("activities:read")` по образцу существующей охраны записи рядом с маршрутом (токен существует, им владеют admin и master — `ROLE_PERMISSIONS` в `src/auth/permissions.py`).
2. Удалить записи `("GET", "/api/v1/activities")` и `("GET", "/api/v1/activities/{id}")` из `PUBLIC_ROUTES` + упоминание занятий из докстринги модуля (`src/auth/public.py`). Перечень живут в трёх носителях — обновить все: (а) константа, (б) докстринга, (в) тест точного равенства множества `backend/tests/test_auth_permissions.py` (убрать обе строки из pinned-множества, комментарий по образцу #493). Контракт-тест не ловит «охранён, но всё ещё в allowlist» — отдельный ассерт: для каждого guard-маршрута нет записи в PUBLIC_ROUTES.
3. Readiness-проба admin-e2e (`frontend/admin/e2e/globalSetup.ts`, голый анонимный fetch в старый список, до логина сида-админа) — перевести на `GET /api/v1/public/activities`: после охраны она получает 401 и валит globalSetup, без этой правки не стартует ни один admin-спек. Лендится тем же коммитом, что и охрана, — красного окна между задачами нет.
4. Аннотации скоуп-карты `backend/tests/test_master_scope_contract.py` (записи `activities` «public list/get…») — переформулировать: маршруты staff-only, `get_optional_scope` остаётся для скоупа мастера.
5. Unit-тесты: аноним → 401 (список и точечное); клиентская сессия через куку `memo_client_session` (как выдана, паттерн cookie из `backend/tests/test_my_records_api.py`) → 401; админ → 200 со всеми занятиями; мастер → 200, свои приватные видны в списке и точечно (регрессия скоупа).

### DoD

Unit-тесты зелёные = US-3 (backend unit); auth-суит (равенство множества PUBLIC_ROUTES) зелёный; globalSetup admin-e2e стартует (проба на публичном маршруте); существующий суит занятий (`api_client` = сессия сида-админа) остаётся зелёным без правок; тест охраны POST copy-week (голый TestClient) остаётся валидным.

---

## Task 3: Backend — бронирование приватного id → 404

### Classification: small

### Required Docs

- `docs/domain-rules/activities.md` — инвариант (предикат в пробе существования, до валидации тарифа)

### Steps

1. В пробу существования занятия (`backend/src/usecases/my_booking.py`, запрос `select(Activity).where(Activity.id == ...)`) добавить предикат `is_private IS NOT TRUE` — тем же запросом, до валидации тарифа (боковой канал 422-vs-404 исключён).
2. Unit-тесты: приватный `activity_id` → 404, тело побайтово совпадает с ответом на заведомо несуществующий id; прямым SQL (`query_db`) — записи не создано; обычное занятие бронируется по контракту.

### DoD

Unit-тесты зелёные — серверная половина US-2; e2e доезжает в Task 6.

---

## Task 4: api-client — `getPublicActivities`

### Classification: small

### Required Docs

- `docs/domain-rules/activities.md` — публичный контракт (8 полей, конверт пагинации)

### Steps

1. `packages/api-client/src/schemas.ts`: `ActivityPublicResponseSchema` (8 полей) + `ActivityPublicListResponseSchema = paginatedSchema(ActivityPublicResponseSchema)` — по образцу фото (`PhotoPublicListResponseSchema`).
2. `packages/api-client/src/endpoints.ts`: `getPublicActivities(params)` — тонкая функция по образцу `getPublicPhotos` (`/api/v1/public/activities?...`).
3. Request-shape тесты в `packages/api-client/src/endpoints.test.ts` по прецеденту `getPublicPhotos` (URL, query-строка, схема ответа).

### DoD

Тесты api-client зелёные; экспорт `@memo/api-client` расширен, существующие не тронуты.

---

## Task 5: Web — хук расписания на публичный маршрут

### Classification: small

### Required Docs

- `docs/domain-rules/activities.md` — публичный контракт

### Steps

1. `frontend/web/app/hooks/useSchedule.ts`: `getActivities` → `getPublicActivities`; ключ кэша `['activities', 'public', date_from, date_to]` (сегменты дат сохраняются); в вызов добавить `per_page: 100`.
2. Обновить юнит-тесты хука/маппера (`frontend/web/app/hooks/__tests__/`): мок на публичную функцию; ассерт `per_page: 100` в запросе; маппер не меняется (те же 8 полей).

### DoD

Web-юниты зелёные; расписание рендерится из публичного списка (проверка на dev-стенде); US-1 завершается e2e в Task 6.

---

## Task 6: Web e2e — сетка без приватного + бронь приватного id

### Classification: standard

### Required Docs

- `docs/domain-rules/activities.md` — публичный контракт
- Спека #600: раздел «Тесты» (парный посев, позитивный контроль)

### Steps

1. Фикстура посева пары «приватное + обычное» на текущую неделю через `sqlite-exec`/`db-query` (НЕ фиксированная визуальная неделя 06-15 — приватной строки в ней нет, добавление ломает визуальные базлайны админа).
2. Спека US-1 (аноним, без storageState): карточка обычного занятия присутствует в сетке; заголовок приватного — `toHaveCount(0)`.
3. Спека US-2 (клиентская сессия через storageState): прямой `POST /api/v1/my/records` с приватным `activity_id` → 404; на странице ошибки нет успешной записи.
4. Прогон обоих спеков RED-GREEN-REFACTOR: RED достигается откатом предиката/переезда (проверяется один раз на ветке), затем GREEN на финальном коде.

### DoD

E2E tests for scenarios US-1 and US-2 pass (RED-GREEN-REFACTOR).

---

## Task 7: Admin — селектор ромба + e2e страж мастера (US-4), копирование недели зелёное (US-5)

### Classification: small

### Required Docs

- `docs/domain-rules/activities.md` — недели копирования и ромб не меняются; селектор добавляется по конвенции соседних testid в `ActivityCard`

### Steps

1. `frontend/admin/app/components/schedule/ActivityCard.tsx`: обёртке ромба приватного занятия — стабильный селектор (`data-testid="activity-private-badge"` или `aria-label` по конвенции дизайн-системы).
2. Спека US-4: фикстура `master-session`; приватное занятие СВОЕГО мастера на открытой неделе (посев через db-фикстуру); ассерт ромба на карточке. Под админ-сессией страж не проходит проверку «свои» — сессия именно мастерская.
3. Прогон существующего `copy-last-week.spec.ts` — зелёный без правок (US-5).

### DoD

E2E test for scenario US-4 passes (RED-GREEN-REFACTOR); `copy-last-week` зелёный (US-5).

---

## Порядок и зависимости

Task 1 → 2 → 3 (backend), Task 4 → 5 (после 1 — контракт зафиксирован), Task 6 (после 1+5), Task 7 (после 2). Все задачи — один PR; `Closes #600` — только в описании PR.
