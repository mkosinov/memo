# План: флаг «не показывать в web» для локаций (#601)

- Спека: `docs/specs/2026-11-12-locations-web-visibility-601-design.md` (рев.4). Поведенческая дельта — там же, §3; план поведение не повторяет.
- Зависимость: `depends-on: #600` — вся имплементация после закрытия #600 (публичный маршрут занятий и предикат брони создаются там; Task 3 расширяет их).
- Свежий контекст: в main уже влит #595 (мультивыбор локаций при создании занятия) — ассерты дропдауна создания в Task 4 пишутся по живому UI, не по старому одиночному селекту.

## Goal

Флаг `is_public` на локации («Видно клиентам», прямая связка): скрытая локация исчезает из web (анонимный словарь `GET /api/v1/public/locations`, серверное исключение её занятий из публичной витрины, 404 брони по прямому id) и остаётся полностью рабочей в админе (переключатель + бейдж). Bare-GET локаций закрываются правом `locations:read`. Сид-предзагрузка получает колонку.

## Architecture

- Backend: FastAPI-роутеры (`locations`, `public`), Pydantic-схемы, SQLAlchemy-модель + Alembic-миграция, allowlist `PUBLIC_ROUTES` (default-deny контракт T7), предикат брони в usecase.
- Admin (Next.js): декларативный конфиг полей модалки + колонки таблицы.
- Web (Next.js): хуки `useLocations`/`useSchedule`, мапперы; api-client (zod) — новый публичный эндпоинт.
- Тесты: pytest (unit/контрактные), Playwright admin-e2e и web-e2e.

## Tech Stack

Python 3 / FastAPI / Pydantic / SQLAlchemy / Alembic; TypeScript / Next.js / zod / api-client; Playwright.

---

## Task 1: Колонка `is_public` — модель, миграция, схемы, zod

### Classification: small

### Required Docs

- `docs/domain-rules/locations.md` — Fields (`is_public`), Invariants (семантика и отличие от архива)
- Спека §2.1

### Steps

1. Alembic-миграция: колонка `is_public` boolean NOT NULL `server_default true` в таблице локаций (существующие строки — `true`, поведение не меняется).
2. Модель `Location`: поле `is_public`.
3. Pydantic: `is_public` в `LocationBase` (наследуют `LocationCreate` и `LocationUpdate` — PUT-редактирование модалки требует поле в полном update-контракте, `extra="forbid"`); отдельно в `LocationPatch`. Response-схемы отдают поле.
4. zod в api-client: `is_public` в create/update/response-схемы локации (зеркало Pydantic).

### DoD

- Миграция накатывается вперёд и назад без потери данных.
- Unit: create/update/patch принимают `is_public`; response отдаёт; схема принимает payload и с флагом, и без (дефолт `true`). Скрытая локация не сбрасывается молча: модалка всегда несёт текущее значение флага (закреплено в Task 4).

## Task 2: Публичный словарь `GET /api/v1/public/locations` + охрана bare-GET

### Classification: standard

### Required Docs

- `docs/domain-rules/auth.md` — Public Access (перечень словарей, tombstone-паттерн)
- `docs/domain-rules/locations.md` — List contract (публичный словарь, consumers)
- Спека §2.2–2.3

### Steps

1. Схема `LocationPublicResponse` — ровно 4 поля: `id, title, address, location_hint` (`address`, `location_hint` nullable).
2. Маршрут `GET /api/v1/public/locations` в публичном роутере: голый массив, без параметров; фильтр `archived = false` И `is_public = true`; порядок `sort_order ASC, title ASC, id ASC`; потолок `BARE_LIST_MAX_ROWS`.
3. `PUBLIC_ROUTES`: добавить `("GET", "/api/v1/public/locations")`; снять `("GET", "/api/v1/locations")` и `("GET", "/api/v1/locations/{id}")` с надгробными комментариями по образцу photos/masters; докстрингу модуля — зеркальная правка.
4. Bare list и bare get получают `locations:read` (`_READ_GUARD`); `/all` уже под ним — не трогать.
5. Контрактный тест T7: сверить ожидания (новая запись, две снятые) — править тест-данные, если список захардкожен.

### DoD

- Unit (позитивный контроль — в фикстуре пара «скрытая + видимая», у каждой занятие в окне): анониму 200; в выдаче видима контрольная, скрытой и архивной нет; ключи каждого элемента — ровно 4, лишних нет; порядок детерминированный.
- Unit охраны: аноним/клиент → 401 на bare list и bare get; персонал (`locations:read`) → 200; T7 зелёный.

## Task 3: Серверное исключение занятий скрытых/архивных локаций + предикат брони 404

### Classification: standard

### Required Docs

- Спека #600: `docs/specs/2026-11-12-activity-private-visibility-600-design.md` (маршрут витрины и предикат — создаются её IMPL; этот task расширяет)
- Спека §2.5
- `docs/domain-rules/auth.md` — Public Access

### Steps

1. Join-фильтр публичной витрины занятий `/api/v1/public/activities`: исключить занятия, чья локация архивирована ИЛИ `is_public = false` (одно условие join к уже существующему фильтру приватных #600).
2. Предикат пробы существования в брони (`POST /api/v1/my/records`): занятие локации архивированной или скрытой → 404; тело ответа неотличимо от 404 на несуществующий id (паритет, без бокового канала).

### DoD

- Unit: занятия скрытой и архивной локаций отсутствуют в публичной выдаче, контрольная видима (позитивный контроль).
- Unit брони (клиентская сессия): 404 на скрытый id и на несуществующий id — тела идентичны; SQL-проверка — запись не создана.

## Task 4: Админ — переключатель «Видно клиентам», бейдж «Не в web», admin-e2e (US-1, US-4)

### Classification: standard

### Required Docs

- `docs/domain-rules/locations.md` — Invariants (semantics), Frontend
- Design-system: тумблер и бейдж — по живым образцам (`toggle-private` занятия, бейдж «Архив»)
- Спека §2.6, §6

### Steps

1. Тип `boolean` в декларативном конфиге `locationFields`: boolean-ветка инициализации модалки (дефолт `true`, не пустая строка) и сборки payload (передаётся как boolean).
2. Рендер: переключатель-кнопка `role="switch"` + `aria-checked` + `data-testid="toggle-is-public"`; прямая связка `checked = is_public`; метка «Видно клиентам»; доступно при создании и редактировании.
3. Таблица: у локации с `is_public = false` — бейдж «Не в web» рядом с названием (образец — бейдж «Архив»).
4. admin-e2e `locations-web-hidden.spec.ts` (фикстура: пара «скрытая + видимая», у каждой занятие в отображаемом окне):
   - US-1: выключить «Видно клиентам» при создании и при редактировании; бейдж на странице «Локации»; карточка занятия скрытой локации видна в сетке; локация присутствует в опциях выбора локаций создания занятия (живой UI после #595 — мультивыбор);
   - US-4: включить обратно — бейджа нет;
   - проба публичного словаря: анонимный fetch без куки на `GET /api/v1/public/locations` после сокрытия — скрытой нет, контрольная есть.

### DoD

- E2E test for scenarios US-1 and US-4 passes (RED-GREEN-REFACTOR).
- tsc-сборка админки чистая; PUT-полезная нагрузка модалки несёт `is_public` (канон `is_private`).

## Task 5: Web — переезд на публичный словарь, web-e2e (US-2, US-3, US-4-фаза)

### Classification: standard

### Required Docs

- `docs/domain-rules/locations.md` — List contract (consumers: web — только публичный словарь)
- Спека §2.4, §6

### Steps

1. api-client: `getPublicLocations()` + zod `LocationPublicResponseSchema` (ровно 4 поля; именование по `PhotoPublicResponseSchema`).
2. Миграция: `useLocations` и `useSchedule` берут локации только из публичного словаря; вход `to-location-vm` перетипизировать на публичный тип (его единственный потребитель — `useLocations`); типизация карты локаций в `buildSchedule` — публичный тип; разворачивание конверта (голый массив, не `PaginatedResponse`); старый вызов списка из web удалить.
3. web-e2e (фикстура: та же пара «скрытая + видимая» с занятиями; клиентская сессия — storageState):
   - US-2: фильтр и расписание без скрытой площадки и её занятий; контрольная видимая и её занятия присутствуют (позитивный контроль);
   - US-3: бронь по прямому id занятия скрытой площадки → 404, запись не создана;
   - US-4-фаза: после включения «Видно клиентам» (фаза админ-цикла Task 4) локация и её занятия присутствуют в фильтре и расписании.

### DoD

- E2E test for scenarios US-2 and US-3 passes (RED-GREEN-REFACTOR); US-4-фаза зелёная в общем цикле.
- tsc-сборка web чистая; вызов старого списка локаций из кода web удалён (поиск по импортам пуст).

## Task 6: Сид-предзагрузка

### Classification: small

### Required Docs

- `backend/seed-data/README.md` — правила заполнения YAML (natural keys)
- Спека §2.7

### Steps

1. `backend/seed-data/locations.yaml`: `is_public: true` во всех 3 записях.
2. `src/seed/reference.py`: приём и применение поля в whitelist применения локаций.
3. Тест предзагрузки: фикстура YAML с обеими полярностями (минимум одна `is_public: false` — иначе молчаливый пропуск колонки зелёный); контрольный `--check` сходится.
4. Правило конвертации CSV (для будущего конвертера, канон — спека §2.7): колонка «видно клиентам»; пусто/«да» = `is_public: true`, «нет» = `is_public: false` — зафиксировать строкой в тесте-или-комментарии конвертера, когда он появится.

### DoD

- Seed-тест зелёный на обеих полярностях; `--check` сходится на эталонном YAML.

---

## Порядок и зависимости

- Task 1 → Task 2 → Task 4, Task 5 (фронты требуют маршрут и схемы); Task 3 и Task 6 независимы от фронтов, но после Task 1.
- Вся имплементация после закрытия #600 (`depends-on` в теле issue).
