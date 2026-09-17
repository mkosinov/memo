# Спека: канон label-полей «вещи = title» — переименование Location.name и Tag.tag

- **Issue:** #172 (на G1a расширен: Location + Tag одним изменением)
- **Дата:** 2026-09-17, ревизия 3 — rev2 по панели G1b 6/6 (состав принят юзером); дельта-ре-проверка completeness + feasibility: обе PASSED_WITH_CONCERNS, все ревизионные файндинги PASS, их уточнения вплетены
- **История ревизий:** см. §7

## 0. Сводка

Канон label-полей: **словарные сущности («вещи») носят поле `title`, персоны — `name`.** Сейчас `title` у material/service/position/tariff, а выбиваются двое: Location (`name`, `backend/src/models/location.py:19`) и Tag (`tag`, `backend/src/models/tag.py:72`). Оба переименовываются **чистым ренеймом** во всех слоях: ORM → схемы (включая sort-ключи) → сервисы и SQLAdmin → API → alembic → seed → бэкенд-тесты и фикстуры → api-client → admin → web. Поведение не меняется: те же данные, те же эндпоинты, меняются имена полей и значения sort-ключей. Видимые подписи интерфейса («Тег», «Название») не меняются — переименовываются поля, а не словарь UI.

## 1. Контекст и решения

Инвентарь label-полей всех моделей (проверено скаутом): `title` — material (`models/material.py:12`), service (`service.py:19`), position (`position.py:42`), tariff (`tariff.py:18`); `name` — location (`location.py:19`, рядом `short_title` :20), client (`client.py:19`, nullable), visitor (`visitor.py:20`); `tag` — tag (`tag.py:72`); staff — `first_name`/`last_name` (`staff.py:32-33`).

Решения юзера на G1a (17.09):
1. Скоуп = **Location + Tag вместе** (идейная заявка тега отдельной карточкой #302 была отозвана — юзер выбрал fold в #172; #302 закрыта not planned).
2. **Чистое переименование** с переводом **обоих** sort-ключей (`LocationSortBy` name→title, `TagSortBy` tag→title); dual-ключей и алиасов не делаем.
3. Канон «вещи = title, персоны = name» фиксируется в `docs/domain-rules/`.

Почему сейчас: потребители API — только admin и web, обе стороны обновляются в одном PR; web-бронирование не в проде (#48 Hold), окно для breaking-ренейма открыто. Алиас-вариант отвергнут на G1a (вечный dual-naming, против культуры «снимать workaround» — прецедент #178).

Область действия канона: канон — глобальное правило именования; **в этой сдаче двигаются только поля и sort-ключи Location и Tag.** Остальные сущности уже соответствуют канону (инвентарь выше) — их sort-ключи и поля не трогаются.

Решения по панели G1b (6/6, 17.09): правки состава BLOCKER/MAJOR/MINOR приняты юзером целиком; арбитраж — MINOR simplicity «unique выживает автоматически» опровергнут (родная эмпирика `e5f7a9c3b1d8:120-124` + доки alembic о batch-режиме); механизм сохранения уникальности оставлен (§3.1).

## 2. User Scenarios

Каждый сценарий маппится на e2e-тест (обновляемый в этой сдаче):

- **S1. Сортировка и поиск локаций.** Админ открывает справочник «Локации», сортирует по колонке названий, ищет через `?q=` по подстроке названия. → `frontend/admin/e2e/locations-crud.spec.ts` (payload'ы и sort-параметр), базлайны см. §3.9.
- **S2. Создание/правка локации.** Модалка шлёт `title`, серверная NOT_NULL-валидация работает по `title`. → `locations-crud.spec.ts`.
- **S3. Справочник тегов.** Создание/переименование тега, таблица показывает значение (колонка с accessor `title`, заголовок «Тег»), уникальность сохраняется. → `frontend/admin/e2e/tags-crud.spec.ts`.
- **S4. Теги в услугах.** В карточке услуги теги отображаются; пикер тегов фильтрует по названию тега. → `frontend/admin/e2e/combobox-dictionaries.spec.ts`.
- **S5. Фото по тегам.** Фильтр фото по тегам и чипы в модалке показывают названия тегов. → `frontend/admin/e2e/photos-crud.spec.ts`.
- **S6. Расписание по локациям.** Фильтр расписания по локациям работает, занятия отображают локацию. → `frontend/admin/e2e/schedule-filters.spec.ts`.
- **S7. Web-бронирование.** Фильтры web по локациям и тегам рендерят названия. **Гейт — юнит-тесты web (существующие):** `frontend/web/app/__tests__/page.test.tsx`, `frontend/web/app/hooks/__tests__/useSchedule.test.tsx`, `frontend/web/app/lib/api/__tests__/locations.test.ts`, маппер-тесты `lib/mappers/__tests__/*` — тесты ассертят `title`/текст label'а на рендере, а не `.name` (файла `__tests__/LocationFilter.test.tsx` в дереве нет — поправлено ревью плана). Уточнение по факту панели: web e2e в репо **существует** (`frontend/web/playwright.config.ts:4` → `tests/*.spec.ts`), но **не подключён** к прогонам (нет `test:e2e`-скрипта в `frontend/web/package.json`, нет в root `package.json`) — его подключение вне скоупа (§4).

## 3. Изменения по слоям

### 3.1 ORM + миграция (backend)

| Сущность | Файл | Было → Стало |
|---|---|---|
| Location | `backend/src/models/location.py:19` | `name: Mapped[str]` → `title` |
| Tag | `backend/src/models/tag.py:72` | `tag: Mapped[str]` (String(100), unique=True) → `title` |

**Миграция — рецепт #266 (ревизия `e5f7a9c3b1d8`), полностью:**

- **Одна alembic-ревизия** в `backend/alembic/versions/` (две таблицы — одна ревизия, один PR).
- **`naming_convention`** внутри каждого `batch_alter_table` — копия `FK_NAMING_CONVENTION` из `e5f7a9c3b1d8:30-41` (`uq: 'uq_%(table_name)s_%(column_0_name)s'`): детерминированные имена для исходно НЕименованных constraints.
- **Отдельные batch-блоки на каждую операцию.** Репозиторий уже зафиксировал эмпирику (`e5f7a9c3b1d8:120-124`): «rename и create в одном блоке молча дропает новый constraint (verified empirically)». Для tags:
  1. блок 1 — drop legacy unnamed unique (адресуется по конвенции как `uq_tags_tag`);
  2. блок 2 — `alter_column('tag', new_column_name='title')`;
  3. блок 3 — `create_unique_constraint('uq_tags_title', ['title'])`.
- Для locations — один rename-блок (unique у локаций нет).
- **Post-check в теле ревизии:** `conn.execute(sa.text("PRAGMA index_list(tags)"))` + assert наличия уникального индекса на `title` (имя по конвенции — `uq_tags_title`). Два уточнения дельта-ревью: (а) форма вызова фиксируется в плане — прецедента PRAGMA в миграциях репо нет (`grep PRAGMA backend/alembic/versions/` = 0), соединение миграции работает под `PRAGMA foreign_keys=OFF` (`env.py:60-100`); (б) порядок блоков обязателен: drop-констрейнт должен отработать ДО ренейма колонки — иначе batch-рекрейт отражает constraint по pre-rename набору колонок и drop срабатывает вхолостую.
- **Downgrade не пишем — осознанное отклонение** от большинства существующих ревизий (большинство downgrade имеют; прецеденты без него — `e5f7a9c3b1d8`, `4d5e6f7a8b9c`, `b7c8d9e0f1a2`); откат = восстановление dev-копии БД.
- Контекст, почему это несущее: тест-схема создаётся alembic-апгрейдом (`backend/tests/conftest.py:78-104`), потерянный UNIQUE сломал бы сюиту неочевидным образом — поэтому post-check обязателен, а не «проверить руками».
- `location.name` NOT NULL → прямой rename, бэкфилл не нужен (паттерн `ce42b37ee405` не требуется).
- FK-безопасность: ассоциативные таблицы `*_tags` (созданы в initial-ревизии `4af69d9eff31`, каждая несёт FK на `tags.id`) и `secondaryjoin` `master_tags` (`staff.py:49`) ссылаются на `tags.id` — ренейм label-колонки их не затрагивает; точный счёт таблиц — в плане по initial-ревизии.

### 3.2 Pydantic-схемы + sort-ключи (backend)

| Файл | Правка |
|---|---|
| `backend/src/schemas/location.py` | в whitelist `LocationSortBy` (`:9-13`, 9 членов) заменяется **один литерал** `"name"` → `"title"`; остальные 8 (`short_title`, `capacity`, `address`, `location_hint`, `description`, `archived`, `yandex_map_url`, `created_at`) не меняются. `LocationBase.name` (:18; Create/Update/Response наследуют) и `LocationPatch.name` (:59) → `title` |
| `backend/src/schemas/tag.py` | `TagSortBy = Literal["tag"]` → `Literal["title"]` (:8); `TagCreate.tag` (:12), `TagPatch.tag` (:21, nullable), `TagResponse.tag` (:27) → `title` |

Контракт: неизвестный sort-ключ → 422 через Literal (существующее поведение); после ренейма `sort_by=name`/`sort_by=tag` дают 422 — приёмка это фиксирует как ожидаемое (не баг). Форма 422-ответа остаётся FastAPI-дефолтной (новых обработчиков нет).

### 3.3 Сервисы, SQLAdmin, API (backend)

| Файл | Правка |
|---|---|
| `backend/src/services/location.py` | `NOT_NULL_FIELDS` `{"name", ...}` → `"title"` (:15); `SearchField(Location.name)` → `SearchField(Location.title)` (:23) |
| `backend/src/services/tag.py` | `NOT_NULL_FIELDS` `{"tag"}` → `{"title"}` (:15); `SearchField(Tag.tag)` → `(Tag.title)` (:19) |
| `backend/src/services/record.py` | **источник display-пайплайна:** `select(Location.name)` → `select(Location.title)` (:253 — label `location_name` в списке record-view; :341/:374 — подзапрос sort-ключа `"location"`). **Само производное поле `location_name` НЕ переименовывается** — контракт records API и api-client (:422) не меняется, меняется только колонка-источник |
| `backend/src/admin/setup.py` | SQLAdmin: `column_list`/`column_searchable_list` — `Location.name` → `Location.title` (:177-178), `Tag.tag` → `Tag.title` (:200-201) |
| `backend/src/api/v1/locations.py` | sort map `"name": [Location.name]` → `"title"` (:51); дефолт `asc(Location.name)` → `title` (:71, :134); докстринги (:66, :91, :127) |
| `backend/src/api/v1/tags.py` | `_TAG_SORT_MAP {"tag": [Tag.tag]}` → `"title"` (:41); дефолт `asc(Tag.tag)` (:54, :106); докстринги (:39, :48, :76) |

`?q=` остаётся тем же параметром URL (ищет по label-полю; ретаргетится внутренним SearchField — `search.py:24-25`, bound-parameter, без raw-SQL интерполяции; контракт строки запроса не меняется). Общий модуль `backend/src/repositories/search.py` ссылок на сущности не содержит — правятся только call-sites. Ключ сортировки `"location"` в records API не меняется (вне скоупа).

### 3.4 Seed

`backend/src/seed/seed.py`: словари локаций (:290 `Location(**loc)`) — ключи `name` → `title` в словарях-источниках; `_seed_tags` (:357-361, `Tag(id=tag_id, tag=name)`) — kwarg `tag=` → `title=`; локальная python-переменная с текстом тега переименовывается по усмотрению импл (обязателен только kwarg).

### 3.5 Бэкенд-тесты и фикстуры

**Связующий список правок — grep-обход в плане** (таблицы ниже — индикативные, проверены панелью):

- **ORM-конструкторы** (`Location(name=…)` — 21 хит в 7 файлах; `Tag(tag=…)`): `test_models.py` (5× Location + 6× Tag), `tests/services/test_staff_service.py` (3×), `tests/services/test_archive_service.py`, `tests/services/test_delete_cascades.py`, `domain/test_deletion.py`, `test_repository_list.py`, `test_location_short_title.py:29` (`LocationBase(name=...)`).
- **API-payload-сайты** (другая форма правки — тела запросов): `test_api_locations.py` (хелперы `create_location(name=…)`), `test_api_tags.py` (`create_tag(tag=…)`).
- **Общий контрактный конфиг:** `tests/generic_contract.py` — `:237-260` (Location: `create_data={"name": …}`, `not_null_field="name"`), `:395-418` (Tag: `create_data={"tag": …}`, `not_null_field="tag"`, `unique_row_field="tag"`).
- **JSON-фикстуры:** `backend/tests/fixtures/locations.json` (ключи `name` → `title`), постится в API через `tests/fixtures/seed.py` (:75-84) — под новым полем иначе 422. tag-JSON-фикстур в fixtures нет — теги конструируются инлайн в `test_models.py` и через API (поправлено ревью плана).

Поведение тестов не меняется — только имена полей (см. §5.5 для единственного нового теста).

### 3.6 api-client (`packages/api-client/src/schemas.ts`)

`LocationResponseSchema.name` (:165) и `TagResponseSchema.tag` (:231), `TagCreateSchema` (:239), `LocationListResponseSchema` (:806), `TagListResponseSchema` (:807), `TagAllResponseSchema` (:826) → `title`; массив `tags` в `ServiceResponseSchema` (:281) следует за TagResponse. Юнит-тесты пакета (`schemas.test.ts` и потребители) обновляются. **Не трогается:** `location_name` (:422) — производное display-поле визитов/записей, другой ручеёк (см. §3.3 record.py).

### 3.7 Admin (`frontend/admin`)

| Область | Файлы |
|---|---|
| Словарь локаций `app/(main)/locations/` | `page.tsx`, `components/`: `LocationModal.tsx`, `locationFields.tsx`, `LocationsTable.tsx`, `locationColumns.tsx`, `LocationFilters.tsx` (комментарий с whitelist'ом в `locationColumns.tsx:9-13` — см. §3.10) |
| Словарь тегов `app/(main)/tags/` | `components/tagColumns.tsx` (:11 accessor `t.tag`), `components/TagsTable.tsx` (:36-37, :53, :120) |
| Потребители тегов вне словаря | `app/(main)/photos/components/PhotosFilters.tsx` (:38, :177), `PhotoModal.tsx` (:90, :109), `photoColumns.tsx`, `app/(main)/services/components/serviceColumns.tsx` (:122) |
| Контексты/хуки | `contexts/LocationsContext.tsx`, `contexts/TagsContext.tsx`, `contexts/PhotosContext.tsx`, `contexts/schedule/ScheduleDataContext.tsx`, `hooks/useLocations.ts`, `hooks/useLocationsMutations.ts` |
| Тесты | `__tests__/LocationsTable.test.tsx`, `__tests__/useLocationsMutations.test.ts` и потребители `LocationResponse|TagResponse` (~20 тест-файлов по grep) |

Список индикативный; связующий — grep-обход в плане.

### 3.8 Web (`frontend/web`)

| Область | Файлы |
|---|---|
| UI | `app/ui/LocationFilter.tsx` (локальный тип `{ id, name }[]` :7, потребление `?.name` :21), `app/ui/ActivityTagFilter.tsx` (см. §4: web-локальный union — не трогается) |
| DTO/view | `app/lib/model/dto/location.ts` (`name` :3), `app/lib/model/view/location.ts`, `app/lib/model/view/activity.ts` (`location.name` :12; `ActivityTag` — web-локальный union, не трогается) |
| Mappers | `lib/mappers/to-location-vm.ts:7` (`name: raw.name`), `lib/mappers/buildSchedule.ts` (`buildTagSet(serviceTags: { tag: string }[])` :30-40, вызов с `service.tags` :93, `locationName: location.name` :85) |
| API-заглушки | `lib/api/locations.ts` — `MOCK_LOCATIONS` (4× `name`), переименовывается **под канон** (это web-заглушка, runtime-связи с backend-seed нет — §4) |
| Страница/оверлеи | `app/page.tsx` (:28, :35, :50, :66, :102), `ActivityDetail.tsx`, `BookingPrivateOverlay.tsx`, `BookingActivityOverlay.tsx`, `Hero.tsx` |
| Тесты | `lib/api/__tests__/locations.test.ts` (`:20`, потребляет `LocationDTO`), `__tests__/page.test.tsx`, `hooks/__tests__/useSchedule.test.tsx` (фикстура `tag: 'взрослым'`), `lib/mappers/__tests__/*` (гейта `__tests__/LocationFilter.test.tsx` не существует — поправлено ревью плана) |

Правило: слои, зеркалящие API-поле (dto → view → mappers → ui), переименовываются до конца (`title`); web-локальные типы, не являющиеся полями сущностей (см. §4), не трогаются.

### 3.9 e2e и базлайны (`frontend/admin/e2e`)

- **Первичная цель правки — общая фабрика:** `fixtures/factories.ts` — `:252-256` (`name: 'Локация …'`), `:307-318` (POST body `{ tag: … }`) — единственная точка, питающая 16 call sites в 4 спеках; без неё критерии §5.1-5.2 невыполнимы.
- Спеки, задевающие локации/теги (payload'ы/аксессоры): `locations-crud`, `tags-crud`, `combobox-dictionaries`, `schedule-filters`, `photos-crud`, `archive-restore-parity`, `clients`-каскады, `master-role-*`, `update-rejects-is-active`, `visual-regression`, `server-push-invalidation`, `error-messages` — точный список в плане.
- **Базлайны** `visual-regression.spec.ts-snapshots/`: кандидаты — все `locations-table-*` и `tags-table-*` (7+7). Реально меняются только снапшоты, чей рендер зависит от переименованного (sort-dropdown-перечисления, error-состояния с ключами) — подтверждённые кандидаты `locations-table-{error,dropdown-open,picker-open}`; финальный список брейков — отчёт IMPL-прогона, приёмка формулируется через зелёный прогон (§5.6), а не через заранее закрытый список. Перегенерация штатная: workflow `update-snapshots.yml`.

### 3.10 Domain rules (едут с этой спекой одним коммитом на G1b)

- `docs/domain-rules/_overview.md` — канон-строка «label-поле словарных сущностей = `title`; персон = `name`» (добавление; стальных упоминаний полей в файле нет).
- `docs/domain-rules/locations.md` — поле `title` + актуализация sort-whitelist (`:50`, где перечислен `name`).
- `docs/domain-rules/tags.md` — поле `title` + Literal-ключ сортировки.

## 4. Не в скоупе

- `client.name` / `visitor.name` — персоны, канон оставляет `name`.
- Доменная политика удаления тегов (soft-delete drift → hard-delete) — отдельный issue #189; механики soft-delete на модели Tag нет, спека не конфликтует.
- Dual-ключи sort_by (поддержка старых значений) — нет.
- Алиасы/версионирование старого API-поля — нет.
- Производное **поле** `location_name` (records API, api-client :422) — не переименовывается; меняется только колонка-источник в `record.py` (§3.3).
- Видимые подписи UI («Тег», «Название») — не меняются.
- Web-локальные типы, не являющиеся полями сущностей: union `ActivityTag` (`'взрослым' | 'вместе' | 'детям'`) и `CATEGORY_ITEMS` в `ActivityTagFilter.tsx:12-21` — это категории-значения, не поле Tag.
- Подключение web e2e к CI/прогонам — нет (существует, не подключено; см. S7).
- Sort-ключи остальных сущностей — уже соответствуют канону, не трогаются (§1).

## 5. Критерии приёмки

1. Поведение не меняется: существующие бэкенд-тесты зелёные после обновления payload'ов; покрытие не падает; SQLAdmin монтируется без ошибок (`backend/src/admin/setup.py` ссылается только на новые поля).
2. **Атрибутный grep-критерий:** ноль ORM-атрибутных ссылок на старые поля (`Location.name`, `Tag.tag`) и литералов sort-ключей (`"name"`/`"tag"` в sort-конфигах обеих сущностей) в живом коде: `backend/src`, `backend/tests` (вкл. `generic_contract.py`, `fixtures/`), `packages/api-client/src`, `frontend/admin/app`, `frontend/admin/e2e/fixtures`, `frontend/web/app`. Не считаются (классифицируются отдельно, остаются как есть): история миграций, производное display-поле `location_name` (backend `record.py` и api-client `schemas.ts:422` — оба места), web-локальный union `ActivityTag`, отображаемые подписи UI, легаси-строки в докстрингах миграций. Точные команды — в плане.
3. `sort_by=title` работает на /locations и /tags; `sort_by=name`/`sort_by=tag` → 422 (Literal, FastAPI-дефолтная форма ответа) — проверено тестом.
4. `?q=` ищет по новым полям (локации и теги), контракт параметра не меняется (bound-parameter поиск, без raw SQL) — существующий поисковый тест обновлён.
5. **Уникальность `tags.title`:** (а) ревизия содержит post-check `PRAGMA index_list(tags)`; (б) в `backend/tests/test_models.py` добавляется ORM-тест дубль-тега (второй `Tag(title=…)` → `IntegrityError`) — единственный тест новой логики. Поведение API на дубль-тег вне скоупа (сегодня не покрыто тестом, ренейм его не меняет).
6. Базлайны: финальный список брейков — отчёт IMPL-прогона (§3.9); приёмка — visual e2e зелёный после штатной перегенерации.
7. Канон в `docs/domain-rules/` закоммичен вместе со спекой (G1b).

## 6. Открытые вопросы

Нет — решения G1a и панели приняты юзером (§1).

## 7. История ревизий

- **rev1** — исходная (G1a-решения юзера; слои §3; приёмка).
- **rev2** (17.09) — панель G1b 6/6: вплетены 3 BLOCKER (рецепт миграции #266 с naming-конвенцией и post-check; record.py как источник `location_name`; SQLAdmin setup.py), 4 MAJOR (тесты/фикстуры/generic_contract — grep-обход в плане; web-инвентарь до конца dto→view→mappers; S7 переформулирован — web e2e существует, не подключён; e2e-фабрика factories.ts) и MINOR'ы (whitelist :9-13, якоря, критерий базлайнов, атрибутный grep-предикат, no-downgrade как отклонение, domain-rules whitelists). Решения юзера: состав принят целиком; дельта-ре-проверка completeness + feasibility назначена.
- **rev3** (17.09) — дельта-ре-проверка: feasibility PASSED_WITH_CONCERNS (7/7 ревизионных PASS; план-уровень: форма PRAGMA-вызова и порядок drop→rename→create) и completeness PASSED_WITH_CONCERNS (8/8 PASS; 4 текстовых MINOR). Все 6 уточнений вплетены (post-check форма, порядок блоков, S7 assert-форма, MOCK_LOCATIONS «под канон», api-client:422 в исключениях §5.2, search-модуль без ссылок на сущности). Новый ре-диспетч не требуется — правки суть собственные формулировки ревьюеров.
- **rev3-поправка** (17.09, ревью плана G2, APPROVED без BLOCKER/MAJOR): S7-гейт переписан на фактически существующие web-тесты (`__tests__/LocationFilter.test.tsx` в дереве нет); в §3.8 добавлен `lib/api/__tests__/locations.test.ts`; из §3.5 убрана несуществующая «соседняя tag-фикстура». Поправка едет в коммит плана (G2).
