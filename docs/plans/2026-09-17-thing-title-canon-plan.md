# План: канон label-полей «вещи = title» — Location + Tag → title

- **Issue:** #172 · **Спека:** `docs/specs/2026-09-17-thing-title-canon-design.md` (rev3, запушена `2b16999`) · **Дата:** 2026-09-17

## Goal

Единый канон label-полей: словарные сущности («вещи») — `title`, персоны — `name`. Чистый ренейм `Location.name → title` и `Tag.tag → title` во всех слоях (backend → api-client → admin → web) без изменения поведения. Канон зафиксирован в `docs/domain-rules/` (запушено со спекой).

## Architecture

Один PR по всем слоям (breaking-ренейм, потребители только admin+web, обе стороны в одной сдаче). Порядок: backend (ORM → миграция → схемы/сервисы/API/SQLAdmin → seed/тесты) → packages/api-client → admin → web. Миграция — одна alembic-ревизия по рецепту #266 (`e5f7a9c3b1d8`): naming-конвенция + отдельные batch-блоки + PRAGMA post-check; downgrade не пишется (осознанное отклонение, откат = dev-копия БД).

## Tech Stack

SQLAlchemy + Alembic (SQLite batch mode), FastAPI + Pydantic, pytest; zod api-client (workspace-пакет), Next.js admin (vitest + Playwright), Next.js web (vitest).

## Behavioral Delta

Пользовательские поведения НЕ меняются — это ренейм полей. Наблюдаемые дельты:

1. `GET /locations` и `GET /tags` отдают `title`; `sort_by=name`/`sort_by=tag` → 422 (Literal), `sort_by=title` работает. — покрывают сценарии S1–S6.
2. Видимые подписи UI («Тег», «Название») и производное display-поле `location_name` (records) без изменений; уникальность тега сохраняется на уровне БД (post-check в ревизии + новый ORM-тест). — сценарий S3.
3. Web: dto/view/mappers переименованы до конца (`title`), web-локальные типы-не-сущности (`ActivityTag` union, `CATEGORY_ITEMS`) не тронуты. — сценарий S7 (юнит-гейт).

## Task 1: ORM-модели + alembic-ревизия + ORM-тест дубль-тега

### Classification: large

1. `backend/src/models/location.py:19` — `name: Mapped[str]` → `title` (остальные поля не трогать, `short_title` остаётся).
2. `backend/src/models/tag.py:72` — `tag: Mapped[str]` → `title`; `String(100), unique=True` сохраняются.
3. Новая ревизия `backend/alembic/versions/<rev>_rename_location_tag_label_fields.py` — рецепт #266, дословно:
   - `naming_convention` — копия `FK_NAMING_CONVENTION` из `e5f7a9c3b1d8:30-41` (`uq: 'uq_%(table_name)s_%(column_0_name)s'`);
   - `locations` — один batch-блок с `alter_column('name', new_column_name='title')`;
   - `tags` — ТРИ отдельных batch-блока (не один): блок 1 `drop_constraint('uq_tags_tag', type_='unique')`; блок 2 `alter_column('tag', new_column_name='title')`; блок 3 `create_unique_constraint('uq_tags_title', ['title'])`;
   - порядок блоков ОБЯЗАТЕЛЕН: drop ДО rename — иначе batch-рекрейт отражает constraint по pre-rename набору колонок и drop срабатывает вхолостую (эмпирика `e5f7a9c3b1d8:120-124`);
   - post-check в теле `upgrade()`: `conn.execute(sa.text("PRAGMA index_list(tags)"))` + assert наличия уникального индекса на `title` (имя `uq_tags_title`);
   - downgrade не пишется (практика #266, осознанное отклонение от большинства ревизий).
4. Новый тест в `backend/tests/test_models.py`: второй `Tag(title=…)` с тем же значением → `IntegrityError` (единственный тест новой логики; поведение API на дубль не меняется).

### Required Docs

- `docs/domain-rules/locations.md`, `docs/domain-rules/tags.md` (уже обновлены спека-коммитом `2b16999` — сверить, не дублировать).

### DoD

`alembic upgrade head` на чистой схеме зелёный; backend pytest зелёный; E2E-проверка сценариев S1/S3 — в Task 6.

## Task 2: Схемы + sort-ключи + сервисы + API + SQLAdmin + record.py

### Classification: standard

1. `backend/src/schemas/location.py` — в 9-членном whitelist `LocationSortBy` (`:9-13`) заменить литерал `"name"` → `"title"` (остальные 8 не менять); `LocationBase.name` → `title` (`:18`); `LocationPatch.name` → `title` (`:59`).
2. `backend/src/schemas/tag.py` — `TagSortBy` (`:8`), `TagCreate.tag` (`:12`), `TagPatch.tag` (`:21`, nullable), `TagResponse.tag` (`:27`) → `title`.
3. `backend/src/services/location.py` — `NOT_NULL_FIELDS` (`:15`), `SearchField(Location.title)` (`:23`).
4. `backend/src/services/tag.py` — `NOT_NULL_FIELDS` (`:15`), `SearchField(Tag.title)` (`:19`).
5. `backend/src/api/v1/locations.py` — sort map `"title": [Location.title]` (`:51`), дефолт `asc(Location.title)` (`:71`, `:134`), докстринги (`:66`, `:91`, `:127`).
6. `backend/src/api/v1/tags.py` — `_TAG_SORT_MAP` → `"title"` (`:41`), дефолт (`:54`, `:106`), докстринги (`:39`, `:48`, `:76`).
7. `backend/src/services/record.py` — источник display-пайплайна: `select(Location.title)` на `:253` (label `location_name`), `:341`/`:374` (подзапрос sort-ключа `"location"`); **само производное поле `location_name` НЕ переименовывается**.
8. `backend/src/admin/setup.py` — `Location.title` (`:177-178`), `Tag.title` (`:200-201`).
9. Общий модуль `backend/src/repositories/search.py` не трогается (ссылок на сущности нет).

### Required Docs

- `docs/domain-rules/locations.md`, `docs/domain-rules/tags.md`, `docs/domain-rules/records.md` (граница производного поля).

### DoD

Backend pytest зелёный; тесты фиксируют: `sort_by=title` → 200, `sort_by=name`/`sort_by=tag` → 422 (FastAPI-дефолтная форма), `?q=` ищет по `title` (bound-parameter, контракт параметра не меняется). E2E S1/S3 — в Task 6.

## Task 3: Seed + бэкенд-тесты + фикстуры (grep-обход — binding)

### Classification: small

1. `backend/src/seed/seed.py` — словари локаций (`:290`, ключи `name` → `title`); `_seed_tags` (`:361`) kwarg `tag=` → `title=` (локальная python-переменная — по усмотрению).
2. **Binding-обход** (список §3.5 спеки — индикативный, эта задача — связующая): все `Location(name=`/`Tag(tag=` конструкторы, payload-хелперы (`create_location`, `create_tag`), `tests/generic_contract.py` (`:237-260` Location: `create_data`/`not_null_field`; `:395-418` Tag: + `unique_row_field="tag"`), ключи в `backend/tests/fixtures/*.json` (`locations.json` существует; tag-JSON-фикстур в fixtures нет — теги конструируются инлайн в `test_models.py` и через API).
3. Поведение тестов не меняется — только имена полей; тест дубль-тега из Task 1 — единственное добавление.

### Required Docs

- `docs/domain-rules/locations.md`, `docs/domain-rules/tags.md`.

### DoD

Backend pytest зелёный (критерий спеки §5.1).

## Task 4: api-client

### Classification: small

1. `packages/api-client/src/schemas.ts` — `LocationResponseSchema.name` → `title` (`:165`), `TagResponseSchema.tag` → `title` (`:231`), `TagCreateSchema` (`:239`), `LocationListResponseSchema` (`:806`), `TagListResponseSchema` (`:807`), `TagAllResponseSchema` (`:826`); `tags` в `ServiceResponseSchema` (`:281`) следует за TagResponse.
2. `location_name` (`:422`) НЕ трогается.
3. Обновить юнит-тесты пакета (`schemas.test.ts` и потребители схем).

### Required Docs

- (нет entity-specific правил; пусто)

### DoD

Vitest пакета api-client зелёный.

## Task 5: Admin компоненты + контексты/хуки + юнит-тесты

### Classification: standard

1. Словарь локаций `app/(main)/locations/` — `page.tsx`, `LocationModal.tsx`, `locationFields.tsx`, `LocationsTable.tsx`, `locationColumns.tsx` (вкл. комментарий с whitelist'ом `:9-13`), `LocationFilters.tsx`.
2. Словарь тегов `app/(main)/tags/` — `tagColumns.tsx` (`:11` accessor `t.tag` → `t.title`), `TagsTable.tsx` (`:36-37`, `:53`, `:120`).
3. Потребители: `photos/components/PhotosFilters.tsx` (`:38`, `:177`), `PhotoModal.tsx` (`:90`, `:109`), `photoColumns.tsx`, `services/components/serviceColumns.tsx` (`:122`).
4. Контексты/хуки: `LocationsContext.tsx`, `TagsContext.tsx`, `PhotosContext.tsx`, `contexts/schedule/ScheduleDataContext.tsx`, `useLocations.ts`, `useLocationsMutations.ts`.
5. Юнит-тесты: `LocationsTable.test.tsx`, `useLocationsMutations.test.ts` и потребители `LocationResponse|TagResponse` (~20 файлов).
6. **Binding** — grep-обход admin: ноль атрибутных `.name` на location-объектах и `.tag` на tag-объектах в живом коде (критерий спеки §5.2; исключения — подписи UI, `location_name`, web-локальные типы).
7. Видимые подписи («Тег», «Название») НЕ менять.

### Required Docs

- `docs/design-system.md` (таблицы/колонки — канон DataTable), `docs/domain-rules/locations.md`, `docs/domain-rules/tags.md`.

### DoD

Vitest admin зелёный; E2E S1–S6 — в Task 6.

## Task 6: e2e фабрика + спеки + базлайны

### Classification: standard

1. **Первичная точка:** `fixtures/factories.ts` — `:252-256` (`name: 'Локация …'`) и `:307-318` (POST body `{ tag: … }`) → `title` (одно место-определение; вызовы в 4 спеках, 17 grep-хитов).
2. Спеки по списку §3.9 спеки (`locations-crud`, `tags-crud`, `combobox-dictionaries`, `schedule-filters`, `photos-crud`, `archive-restore-parity`, `clients`-каскады, `master-role-*`, `update-rejects-is-active`, `server-push-invalidation`, `error-messages`, `visual-regression`) — payload'ы/аксессоры.
3. Прогон: сломанные базлайны (`visual-regression.spec.ts-snapshots/`, кандидаты `locations-table-*`/`tags-table-*` 7+7, реально брейкают рендер-зависимые) перегенерировать штатным workflow `update-snapshots.yml`; финальный список — отчёт прогона.
4. CHANGELOG-строка о ренейме (канон #252-прецедент).

### Required Docs

- `docs/design-system.md`.

### DoD

**E2E тесты сценариев S1–S6 проходят (RED-GREEN-REFACTOR)**: S1/S2 = `locations-crud.spec.ts`, S3 = `tags-crud.spec.ts`, S4 = `combobox-dictionaries.spec.ts`, S5 = `photos-crud.spec.ts`, S6 = `schedule-filters.spec.ts`; visual-regression зелёный после перегенерации.

## Task 7: Web

### Classification: small

1. `app/lib/model/dto/location.ts` (`name` `:3`), `app/lib/model/view/location.ts`, `app/lib/model/view/activity.ts` (`location.name` `:12`) — переименование до конца (`title`).
2. `lib/mappers/to-location-vm.ts:7`, `lib/mappers/buildSchedule.ts` (`buildTagSet(serviceTags: { title: string }[])` `:30-40` — в теле функции `:34-36` три использования `t.tag` тоже переименовать; вызов с `service.tags` `:93`; `locationName: location.title` `:85` — имя производной web-переменной остаётся).
3. `app/ui/LocationFilter.tsx` (тип `{ id, title }[]` `:7`, потребление `:21`), `app/page.tsx` (`:28`, `:35`, `:50`, `:66`, `:76` хелпер `toLocationOption` шлёт `{ id, name }` → `{ id, title }`, `:102`), `ActivityDetail.tsx`, `BookingPrivateOverlay.tsx`, `BookingActivityOverlay.tsx`, `Hero.tsx`.
4. `lib/api/locations.ts` — `MOCK_LOCATIONS` под канон (web-заглушка).
5. НЕ трогать: union `ActivityTag`, `CATEGORY_ITEMS` в `ActivityTagFilter.tsx:12-21`.
6. Тесты: `lib/api/__tests__/locations.test.ts` (`:20` — потребляет `LocationDTO`, тоже переименовать), `page.test.tsx`, `useSchedule.test.tsx` (фикстура `tag: 'взрослым'` → `title: 'взрослым'`), маппер-тесты — **ассертят `title`/текст label'а на рендере, а не `.name`**. Файла `__tests__/LocationFilter.test.tsx` в дереве НЕТ (уточнение ревью плана) — гейт по фактически существующим файлам.

### Required Docs

- `docs/domain-rules/locations.md`, `docs/domain-rules/tags.md`.

### DoD

**E2E-эквивалент сценария S7 — юнит-гейт (e2e-прогона web нет, спека §2):** vitest web зелёный; существующие web-тесты (`page.test.tsx`, `useSchedule.test.tsx`, `lib/api/__tests__/locations.test.ts`, маппер-тесты) ассертят `title`/label-текст, не `.name`.

## Task 8: Финальная верификация

### Classification: small

1. Атрибутный grep-обход по критерию спеки §5.2 по всем шести областям (`backend/src`, `backend/tests`, `packages/api-client/src`, `frontend/admin/app`, `frontend/admin/e2e/fixtures`, `frontend/web/app`) — ноль старых атрибутных ссылок; исключения классифицированы (история миграций, `location_name` в `record.py`+`schemas.ts:422`, `ActivityTag`, подписи UI).
2. SQLAdmin монтируется без ошибок (`backend/src/admin/setup.py` — только новые поля).
3. `alembic upgrade head` на чистой схеме + backend pytest + vitest (пакет/admin/web) + e2e зелёные.
4. Изменения domain-rules уже в спека-коммите `2b16999` — сверить, что план ничего не перетирает.

### Required Docs

- (верификация; нет entity-правок)

### DoD

Все критерии приёмки спеки §5 закрыты; PR готов к сдаче (Closes #172 — в описании PR).
