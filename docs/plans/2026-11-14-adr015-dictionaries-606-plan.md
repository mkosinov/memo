# План #606 — волна ADR-015 (словари): витринные справочники, гарды, флаг видимости услуг, миграция веб-формы

## Goal

Реализовать спеку `docs/specs/2026-11-13-adr015-dictionaries-606-design.md` (рев.4, main 9bfe9793): витринные `GET /public/masters` и `GET /public/services`, гарды на 5 bare GET словарей с уборкой из `PUBLIC_ROUTES`, флаг видимости услуг `is_public` (зеркало #601), миграция веб-формы записи и api-client. Поведенческая дельта — в спеке §5; план её не повторяет.

## Architecture

- Backend: FastAPI + SQLAlchemy async; публичный неймспейс `backend/src/api/v1/public.py` (прецеденты #493/#600/#601); гарды — фабрика `require_permission`; allowlist `PUBLIC_ROUTES` в `backend/src/auth/public.py` с двумя пин-тестами и скоуп-контрактом.
- Флаг видимости: колонка `services.is_public` (миграция — зеркало `c1d3e5f7a9b1`), staff-контракт через `ServiceBase`/`ServicePatch`, аудит через `_SERVICE_MARK_FIELDS`, серверные предикаты витрин (справочник, занятия, фото) и предикат брони (`src/usecases/my_booking.py`).
- Frontend: `packages/api-client` (новые `getPublic*`-методы и схемы), `frontend/web` (useSchedule/buildSchedule миграция), `frontend/admin` (field-config переключатель + бейдж, зеркало локаций).
- Порядок задач: модель/флаг (1) → витринные эндпоинты (2) → гарды (3) → предикаты видимости (4) → api-client (5) → web (6) → admin UI (7) → e2e (8). Задачи 2–4 опираются на колонку из задачи 1; web-миграция (6) после api-client (5); e2e (8) замыкает.

## Tech Stack

Python/FastAPI/SQLAlchemy/alembic/pytest; TypeScript/zod (api-client), React/TanStack Query (web), Next.js admin, vitest, Playwright (admin-e2e, web-e2e).

## Task 1: Миграция, модель и staff-контракт флага `is_public` услуги

### Classification: standard

### Required Docs
- `docs/domain-rules/services.md` — правило видимости (Invariants) и поле `is_public` (спека §3.6)
- `docs/specs/2026-11-13-adr015-dictionaries-606-design.md` §3.6 (канон записи: Base-дефолт, PUT несёт значение, PATCH строкой), §9
- Прецедент: `docs/specs/2026-11-12-locations-web-visibility-601-design.md` §2.1, `backend/tests/test_location_is_public.py`

### Шаги
1. Alembic-ревизия: `services.is_public` boolean NOT NULL server_default `true` (зеркало `c1d3e5f7a9b1`); родитель — текущая голова (перекидывание при конфликте с #599 — §3.5 спеки).
2. `backend/src/models/service.py`: колонка `is_public: Mapped[bool]` (default true).
3. Схемы (`backend/src/schemas/service.py`): `ServiceBase.is_public: bool = True` (наследуется `ServiceResponse`/`ServiceCreate`/`ServiceUpdate`); `ServicePatch.is_public: bool | None = None` — отдельной строкой; `is_public` в `NOT_NULL_FIELDS` сервиса (`backend/src/services/service.py`, зеркало `location.py`).
4. Аудит: `is_public` в `_SERVICE_MARK_FIELDS` (переключение пишет строку; PUT только с флагом — не пустой диф).
5. Сид: `is_public` в YAML-модель услуг (`backend/src/seed/reference.py` + `seed.py`), маппинг «да/нет/пусто», обе полярности в фикстурах, `--check`.
6. Тесты: `backend/tests/test_service_is_public.py` — зеркало `test_location_is_public.py`: дефолт `true`, create с `false`, PUT без флага → `true` (full-replace), PATCH без флага/null → сохранить, PATCH с значением → применить; тест аудита (переключение пишет строку); сид-тесты обеих полярностей + `--check`.

### DoD
- Миграция применяет/откатывает колонку; все тесты задачи зелёные.
- Тест сценария 10 спеки (сид-полярности) проходит (RED-GREEN-REFACTOR).

## Task 2: Витринные справочники `GET /public/masters` и `GET /public/services`

### Classification: standard

### Required Docs
- `docs/specs/2026-11-13-adr015-dictionaries-606-design.md` §3.1 (мастера: 5 полей, фильтр действующих, порядок `sort_order, first_name, id`), §3.2 (услуги: 10 полей, фильтр `is_active AND is_public`, жадная загрузка, теги строками по алфавиту явным маппером, порядок `title, id`, потолок)
- `docs/domain-rules/auth.md` — Public Access (новые витринные записи)
- Прецеденты: `backend/src/api/v1/public.py` (docstring-канон), `backend/tests/test_public_locations_api.py` (парный посев, порядок-тест)

### Шаги
1. Схемы: `MasterPublicResponse` (id, first_name, last_name, specialty: str, avatar_url: str | None), `ServicePublicResponse` (id, title, description: str, image_url: str, specialty: str, min_age: int, max_age: int | None, tariffs, materials, tags: list[str]) + вложенные `ServicePublicTariff {id,title,price}`, `ServicePublicMaterial {title,description,note}` (`backend/src/schemas/`).
2. View-функции (`backend/src/services/`): мастера — `is_active = true`, порядок `sort_order, first_name, id`, LIMIT+1→422; услуги — `is_active AND is_public`, жадная загрузка (`selectinload` тарифов/тегов/материалов, прецедент `list_all`), сборка тегов явным маппером `sorted(tag.title)`, материалы `title ASC, id ASC`, порядок `title, id`, тот же потолок.
3. Маршруты в `backend/src/api/v1/public.py`: `GET /masters`, `GET /services` — голые массивы, docstring по канону модуля.
4. `PUBLIC_ROUTES`: +2 записи; docstring-история файла пополняется строкой про #606; пин-тест `test_equals_spec_allowlist_exactly` синхронно получает +2 записи (сьют зелёный на закрытие задачи — «−5» за задачей 3).
5. Тесты: контракт обоих маршрутов — точный набор ключей (5/10), парный посев (мастера: активный близнец есть/архивного нет; услуги: тройка — богатая контрольная видимая [≥2 материала с разными названиями, ≥1 тариф, ≥1 тег, возрасты], архивная нет, скрытая нет), теги — отсортированные строки, вложенные ключи и порядок материалов `title ASC`; отдельные порядок-тесты (2+ видимых ряда, равный `sort_order`/одинаковые первые буквы title); граничный тест потолка на каждый маршрут (сверх → 422, ровно → 200, прецедент `test_generic_api_contract.py`).

### DoD
- Тесты сценариев 4 и 5 спеки проходят (RED-GREEN-REFACTOR).

## Task 3: Гарды 5 bare GET и зеркала контрактов

### Classification: standard

### Required Docs
- `docs/specs/2026-11-13-adr015-dictionaries-606-design.md` §3.3 (таблица прав, зеркала: docstring, auth.md уже в main, `_PUBLIC_GETS`, `ALLOWED_UNSCOPED` + чистка 2 локационных обоснований)
- `docs/domain-rules/auth.md` — Public Access
- Прецедент: `backend/tests/test_locations_guard.py` (4 ветки), `backend/tests/test_auth_guards.py` (`_PUBLIC_GETS`)

### Шаги
1. Гарды-депенденси на 5 маршрутов: `GET /masters` → `masters:read`; `GET /services`, `GET /services/{service_id}` → `services:read`; `GET /tags`, `GET /tags/{tag_id}` → `tags:read` (фабрика `require_permission`, как `/all`-варианты).
2. `PUBLIC_ROUTES`: −5 записей.
3. Пин-тест `test_equals_spec_allowlist_exactly` — −5 словарных записей (+2 витринных уже внесены задачей 2).
4. `_PUBLIC_GETS` (`test_auth_guards.py`): −3 словарных, +2 витринных.
5. `ALLOWED_UNSCOPED` (`test_master_scope_contract.py`): +2 витринных записи с обоснованием по образцу `/public/locations`; обоснования 5 словарных теряют слово `public`; попутно чистятся 2 протухших обоснования локаций (`GET /locations`, `GET /locations/{id}` — «public + locations:read» с #601).
6. Тесты permissions — 4 ветки по шаблону `test_locations_guard.py`: аноним/клиентская сессия × список/by-id → 401; сессия мастера → 200; default-deny walk зелёный без правок.

### DoD
- Тесты сценариев 2, 3 и 6 спеки проходят (RED-GREEN-REFACTOR).

## Task 4: Предикаты видимости услуги — витрина занятий, фотогалерея, бронь

### Classification: standard

### Required Docs
- `docs/specs/2026-11-13-adr015-dictionaries-606-design.md` §3.6 (join-термины `Service.is_active + is_public` в трёх предикатах; 404 с паритетом тела; копирование недели НЕ трогать)
- `docs/domain-rules/services.md` — Invariants
- Прецеденты: `backend/src/services/activity.py` (`list_public_activities_view` — термины локаций #601), `backend/src/usecases/my_booking.py` (предикат брони), `backend/tests/test_public_activities_api.py`, `test_my_records_api.py`

### Шаги
1. `list_public_activities_view`: join к `Service` + термины `Service.is_active = true AND Service.is_public = true` (1:1 по PK, рядом с существующими location-терминами).
2. `list_public_photos_view` (`backend/src/services/photo.py`): термины видимости услуги-владельца — общий фид и `?service_id=`-сужение (прямые фото услуги и фото её занятий скрытой/архивной услуги отсутствуют; зонд скрытого id → пустой ответ).
3. Предикат брони (`src/usecases/my_booking.py`): те же термины услуги — бронь занятия скрытой/архивной услуги → 404, тело неотличимо от несуществующего id.
4. Тесты: join-фильтр витрины занятий (скрытая и архивная услуги — занятия отсутствуют, контрольная присутствует); галерея — фид и `?service_id=`-зонд (пуст для скрытой, контрольная присутствует); бронь-404 с паритетом тела + SQL-проверка отсутствия записи.

### DoD
- Backend-части сценариев 8 и 9 спеки проходят (RED-GREEN-REFACTOR).
- Копирование недели не менялось (гарантия — регресс-тесты `copy_week` остаются зелёными).

## Task 5: api-client — новые витринные методы, удаление `getMasters`

### Classification: small

### Required Docs
- `docs/specs/2026-11-13-adr015-dictionaries-606-design.md` §3.4 (нейминг по `getPublicPhotos`, схемы-зеркала, опись потребителей `getMasters`)
- Прецедент: `packages/api-client/src/endpoints.ts` (`getPublicLocations`, `getPublicPhotos`), `endpoints.test.ts`

### Шаги
1. Схемы `packages/api-client/src/schemas.ts`: `MasterPublicResponse`, `ServicePublicResponse` (+ `ServicePublicTariff`, `ServicePublicMaterial`) — зеркала §3.1/§3.2.
2. `endpoints.ts`: `getPublicMasters()`, `getPublicServices()` — голые массивы; юнит-тесты URL+схема по прецеденту.
3. Удаление `getMasters`: `endpoints.ts` − метод; `endpoints.test.ts` − describe-блок с матрицей вызовов; три файла с прямым импортом — `frontend/admin/__tests__/useReactQueryHooks.test.tsx`, `useRecordData.test.tsx`, `__tests__/schedule/ScheduleDataContext.test.tsx` — импорты/моки/ассерты переводятся на `getAllMasters`.

### DoD
- typecheck/lint/vitest api-client и admin зелёные; метода `getMasters` нет в `packages/api-client`, прямых импортёров в репо нет (мок-ключи `getMasters: vi.fn()` внутри `vi.mock`-фабрик остальных тестов допустимы — модуль подменяется целиком; чистка опциональна).

## Task 6: Web-форма записи на витринных справочниках

### Classification: standard

### Required Docs
- `docs/specs/2026-11-13-adr015-dictionaries-606-design.md` §3.4 (смена конверта, типы маппера, `buildTagSet` string[])
- `docs/domain-rules/` — без изменений (web-слой читает витринные контракты)

### Шаги
1. `frontend/web/app/hooks/useSchedule.ts`: `getMasters` → `getPublicMasters`, `getServices` → `getPublicServices`; распаковка — прямое значение вместо `(rawData[i] as PaginatedResponse<...>)?.items ?? []`.
2. `frontend/web/app/lib/mappers/buildSchedule.ts`: сигнатуры `buildWebSchedule` — витринные типы; `buildTagSet(tags: string[])`.
3. Юнит-тесты: `frontend/web/app/hooks/__tests__/useSchedule.test.tsx`, `frontend/web/app/hooks/__tests__/useLocations.test.tsx` — мок-фабрика дополняется новыми методами (голые массивы); `frontend/web/app/lib/mappers/__tests__/buildSchedule.test.ts` — фикстуры на витринных схемах, теги строками.

### DoD
- Тест сценария 1 спеки (юнит-часть: поимённая проверка полей карточки) проходит (RED-GREEN-REFACTOR).
- Существующие web-e2e (`activity-visibility`, booking-спеки) зелёные — регрессия миграции.

## Task 7: Админка — переключатель «Видно клиентам» и бейдж «Не в web» у услуг

### Classification: small

### Required Docs
- `docs/specs/2026-11-13-adr015-dictionaries-606-design.md` §3.6 (Админ-UI: PUT-полезная нагрузка модалки НЕСЁТ флаг — канон #601), §7 (VC-проверки)
- Зеркало: `frontend/admin/app/(main)/locations/components/locationFields.tsx`, `locationColumns.tsx`
- design-system (переключатель/бейдж — существующие компоненты локаций)

### Шаги
1. Field-config услуги (`serviceFields.tsx`): переключатель «Видно клиентам» по образцу локаций.
2. Таблица услуг (`serviceColumns.tsx`/`ServicesTable.tsx`): бейдж «Не в web» у скрытых; PUT-полезная нагрузка модалки дополняется `is_public` (явный перечень полей).
3. Ручная VC-проверка по §7 спеки (машинная — бейдж на `/services`; модалка — вручную, автоматизация в задаче 8).

### DoD
- Переключатель сохраняется (создание и редактирование), бейдж появляется/исчезает; vc-check exit 0 по спеке.

## Task 8: e2e — скрытие услуги в админке и на сайте

### Classification: standard

### Required Docs
- `docs/specs/2026-11-13-adr015-dictionaries-606-design.md` §4 (сценарии 7–9), §6 п.11–13
- Зеркала: `frontend/admin/e2e/locations-web-hidden.spec.ts`, `frontend/web/e2e/locations-web-visibility.spec.ts`, `activity-visibility.spec.ts` (регресс-сеть)

### Шаги
1. admin-e2e `services-web-hidden.spec.ts`: переключатель при создании/редактировании, бейдж, занятие скрытой услуги остаётся в сетке админки, API-проба публичного справочника (скрытой нет, контрольная есть), возврат флага.
2. web-e2e `services-web-visibility.spec.ts`: UI-сетка и фильтр без скрытой услуги и её занятий (позитивный контроль видимой); бронь по прямому id под клиентской сессией → 404, запись не создана (SQL-контроль); возврат флага возвращает занятие.
3. Прогон существующих спеков расписания/брони анонимом — зелёные (сценарий 1, регресс-сеть).

### DoD
- E2E тесты сценариев 7, 8, 9 спеки проходят (RED-GREEN-REFACTOR).
- Полный CI зелёный (все шарды).

## Замечания исполнения

- **#599-пересечение** (спека §3.5): если #599 смержился раньше — адаптация витринных view задачи 2 (жадный груз связи направлений, пересборка `specialty`) выполняется в этой задаче; перекинуть `down_revision` задачи 1. Если #606 идёт первым — права адаптации у IMPL #599 (закреплено спеками обеих сторон).
- **#584-пересечение**: общий пин-тест и `public.py` — второй мерджер ребейзит (§3.5 спеки).
- Коммит PR: `Closes #606` — только в описании IMPL PR.
