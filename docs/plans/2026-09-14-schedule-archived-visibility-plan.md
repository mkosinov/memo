# План: #267 — занятия архивированных мастеров/локаций/услуг в расписании

**Goal:** Занятия архивных сущностей перестают исчезать из сетки расписания. Архивные мастера видны сразу (дефолт `show_archived_masters=true`), архивные локации — по чекбоксу (дефолт off), архивные услуги — всегда. Карточки — приглушённые, с пилюлей «Архив». Чекбоксы «Показывать архивные» — футеры дропдаунов мастеров/локаций в topbar, состояние в user.settings. DayView «по мастерам»/«по локациям» получает приглушённые архивные колонки (только в дни с занятиями, вне reorder/dnd).

**Architecture:** Четыре слоя. (1) Бэкенд: `status` на `GET /masters/all` (по образцу locations/services, `ArchiveStatus`) + `archived` в `MasterViewResponse`; две булевы колонки в `user_settings` с server_default. (2) Данные фронта: расписанию — собственные ключи React Query и хуки `status=all`; `ScheduleDataContext` производит активный срез (опции фильтров) и держит полный список (сборка сетки, архивные колонки). (3) Сборка: `buildAdminSchedule` строит карточки архивных сущностей с флагами `masterArchived/serviceArchived/locationArchived` в DTO; гейт видимости в `ScheduleDataContext` — архивные карточки обходят id-фильтр. (4) UI: футер-чекбоксы в `MultiSelect`, mute+бейдж в `ActivityCard`, архивные колонки DayView вне `useColumnReorder` и не drop-цели.

**Tech Stack:** FastAPI / SQLAlchemy / Alembic / pytest (uv, маркеры api|integration); React / TanStack Query v5 / zod api-client (hand-written schemas) / vitest+jsdom; Playwright (per-test seed reset #252).

**Спека:** `docs/specs/2026-09-14-schedule-archived-visibility-design.md` (rev2, после панели).

**Domain-rules уже обновлены:** правки `docs/domain-rules/activities.md` (правило видимости) и `docs/domain-rules/user_settings.md` (два ключа) закоммичены вместе со спекой (`1836caa`) по правилу «тем же коммитом» — IMPL их не меняет (при расхождении с фактом кода на момент старта — синхронизировать отдельной правкой).

**Зависимости (гейт Task 0):** общие файлы с неготовыми работами — `ScheduleDataContext.tsx`, `Topbar.tsx`, `DayView.tsx` у #258/#259 (create-режим + пустая неделя, Ready to IMPL) и #261 (тост «Сохраняем…», Ready to IMPL). Перед стартом: если #258/#259 не в main — скоординировать очерёдность (их план трогает init-эффекты контекста и сетку); #261 меняет другие регионы Topbar — при пересборке после их мержа `git pull --rebase origin main` перед каждым коммитом.

## Behavioral Delta

- Неделя и день: занятие архивного мастера видно сразу (без действий пользователя) — карточка приглушена (opacity), с пилюлей «Архив»; имя и цвет мастера на месте.
- Занятие архивной локации по умолчанию НЕ видно (как сегодня); включение чекбокса «Показывать архивные» в дропдауне локаций показывает его.
- Занятие архивной услуги видно всегда; чекбоксы на него не влияют.
- Карточка с несколькими архивными сущностями видна, только если включены все соответствующие чекбоксы.
- Выбор конкретных мастеров/локаций в фильтрах архивные карточки не скрывает — фильтр действует только на активных.
- Чекбоксы живут в user.settings: мгновенный эффект, переживают перезагрузку и другие устройства; отсутствующий ключ = дефолт (мастера on, локации off).
- DayView «по мастерам»/«по локациям»: архивная колонка появляется при включённом чекбоксе и только в дни, где есть её занятия; приглушённая шапка с бейджем; колонку нельзя перетащить и на неё нельзя перетащить занятие; в персональный порядок колонок она не пишется.
- `GET /api/v1/masters/all` принимает `status=active|archived|all` (по умолчанию active) и возвращает `archived` в каждой строке; пагинированный `GET /masters` и клиентский сайт — без изменений.

## Структура файлов

**Создаётся:** `frontend/admin/e2e/schedule-archived-visibility.spec.ts`; миграция `backend/alembic/versions/<rev>_add_user_settings_archive_toggles.py`; `frontend/admin/app/components/shared/ArchiveBadge.tsx` (+ тест).

**Изменяется:** `backend/src/api/v1/masters.py`; `backend/src/services/master.py`; `backend/src/schemas/master.py`; `backend/src/schemas/user_settings.py`; `backend/src/models/user_settings.py`; `backend/src/services/user_settings.py`; `backend/tests/test_api_staff.py`; `backend/tests/test_api_user_settings.py` (и patch-тесты); `packages/api-client/src/schemas.ts`; `frontend/admin/lib/queryKeys.ts`; `frontend/admin/hooks/useMasters.ts`; `frontend/admin/hooks/useLocations.ts`; `frontend/admin/hooks/useServices.ts`; `frontend/admin/contexts/UserSettingsContext.tsx`; `frontend/admin/contexts/schedule/ScheduleDataContext.tsx`; `frontend/admin/lib/buildSchedule.ts`; `packages/domain/src/schedule.ts`; `frontend/admin/app/components/shared/MultiSelect.tsx`; `frontend/admin/app/components/layout/Topbar.tsx`; `frontend/admin/app/components/schedule/ActivityCard.tsx`; `frontend/admin/app/components/schedule/DayView.tsx`; `frontend/admin/hooks/useDnD.ts`; `frontend/admin/e2e/fixtures/seed-reset.ts`; unit-тесты затронутых узлов; `CHANGELOG.md`.

## Task 0: Гейт зависимостей

### Classification: trivial

### Required Docs
Спека §«Зависимости».

### Steps
1. `git fetch origin && git status -sb` — рабочая копия чиста и синхронна.
2. `gh pr list` / борд: #258/#259 и #261 смержены? Если #258/#259 не в main — СТОП, скоординировать очерёдность у менеджера (общие `ScheduleDataContext.tsx`/`DayView.tsx`). #261 не блокер (другой регион Topbar), но перед коммитами делать `git pull --rebase origin main`.

### DoD
Зависимости проверены; решение по очерёдности принято и записано в чат.

## Task 1: Бэкенд — `status` на `/masters/all` + `archived` в ответе

### Classification: standard

### Required Docs
Спека D1; domain-rules `staff.md` (D7/D8 контекст), `activities.md` (правило видимости).

### Steps
1. `backend/src/api/v1/masters.py`: импортировать `Query` (fastapi) и `ArchiveStatus` (`src.models.enums`); в `GET /all` добавить параметр `status: ArchiveStatus = Query(ArchiveStatus.ACTIVE)`; пробросить в `service.list_all(db_session=..., order_by=..., status=status)`. Пагинированный `GET ""` не меняется.
2. `backend/src/services/master.py`: `list_all` принимает `status: ArchiveStatus = ArchiveStatus.ACTIVE`; базовый `_fetch` (JOIN staff⨝masters, `.where(Master.is_active)` на `:66-83`) parameterize: ACTIVE → `Master.is_active.is_(True)`, ARCHIVED → `.is_(False)`, ALL → без фильтра. Метод `list` (пагинированный) вызывает `_fetch` всегда с ACTIVE — поведение неизменно.
3. `_MasterViewRow.build` (services/master.py:32-58): добавить поле `archived: bool = not ext.is_active` (ext — полный ORM `Master`, `is_active` доступен).
4. `backend/src/schemas/master.py`: `MasterViewResponse` += `archived: bool`; обновить докстринг модуля (сейчас «archived — the list only ever returns acting masters» — устаревает: строка есть всегда при `status=all|archived`, поле отдаёт состояние).
5. BARE_LIST guard: собственный `+1`-лимит `list_all` (services/master.py:113-128) сохраняется для всех значений статуса; превышение → существующий 422 путь.
6. Тесты (`backend/tests/test_api_staff.py`, класс masters-view): (а) дефолт `GET /all` — только действующие; (б) `?status=all` содержит архивного (заархивировать через `POST /api/v1/staff/{id}/archive`, `archive_master` default true) с `archived: true`; (в) `?status=archived` — только архивные; (г) `?status=foo` → 422; (д) пагинированный `GET /masters` не изменился (в т.ч. ключ `archived` присутствует и всегда `false`). Тест `status=archived` отдельного потребителя не имеет — допускается один комбинированный кейс с (б).

### DoD
`uv run pytest -m api test_api_staff.py` зелёный; контракт `status`/`archived` покрыт; пагинированный маршрут без поведенческих изменений.

## Task 2: Бэкенд — user_settings: `show_archived_masters` / `show_archived_locations`

### Classification: small

### Required Docs
Спека D2; domain-rules `user_settings.md`.

### Steps
1. Миграция: новая ревизия с `down_revision='f1a2b3c4d5e6'` (текущий HEAD); `op.add_column('user_settings', sa.Column('show_archived_masters', sa.Boolean, nullable=False, server_default=sa.true()))` и `... show_archived_locations ... server_default=sa.false()`.
2. `backend/src/models/user_settings.py`: две колонки `Boolean`, `default=True` / `default=False`, `nullable=False`.
3. `backend/src/schemas/user_settings.py`: `UserSettingsResponse` += оба поля; `UserSettingsCreate` += с дефолтами True/False; `UserSettingsUpdate`/`UserSettingsPatch` += опциональные.
4. `backend/src/services/user_settings.py`: `create`, `_to_response`, whitelist `_not_null_fields` (строка ~100) и `update_by_user_id` — новые поля проходят по существующему механизму `model_dump(exclude_unset=True)`; добавить в whitelist.
5. Тесты: `test_api_user_settings.py` — create возвращает дефолты (true/false); `test_user_settings_patch.py` — PATCH `show_archived_masters: false` → в ответе false; PATCH второго поля аналогично; PATCH без полей не меняет.

### DoD
Миграция накатывается на копию БД с существующими строками (дефолты проставлены); `uv run pytest -m api test_api_user_settings.py test_user_settings_patch.py` зелёный.

## Task 3: api-client — zod-схемы

### Classification: trivial

### Required Docs
Спека D1/D2.

### Steps
1. `packages/api-client/src/schemas.ts`: `MasterViewResponseSchema` (:104-114) += `archived: z.boolean()`; `UserSettingsResponseSchema` (:629-641) += оба поля (`z.boolean()`); `UserSettingsCreateSchema` += с дефолтами; `UserSettingsUpdateSchema` наследует `.partial()`.
2. `endpoints.ts` не меняется — `AllParams.status` уже есть (`:878`), `getAllMasters` уже пробрасывает параметры через `allQuery()`.
3. `packages/api-client/src/endpoints.test.ts:1686` — тест `getAllMasters({status:'all'})` снова валиден; снять оговорки/скипы, если ставились, прогнать.

### DoD
`npm test` (workspace api-client) зелёный; типы фронта видят `archived` и новые поля настроек.

## Task 4: UserSettingsContext — два ключа

### Classification: small

### Required Docs
Спека D2; domain-rules `user_settings.md`.

### Steps
1. `frontend/admin/contexts/UserSettingsContext.tsx`: интерфейс `UserSettings` (:6-11) += `showArchivedMasters: boolean; showArchivedLocations: boolean`; `DEFAULT_SETTINGS` (:23-28) += `true` / `false`.
2. Кэш localStorage (`loadFromStorage` :36-44): прочитать порядок merge — итоговая форма обязана быть `{...DEFAULT_SETTINGS, ...cached}` (отсутствующие в старом кэше ключи = дефолты, «первый кадр» не мигает выключенными мастерами); при необходимости поправить merge.
3. Три точки маппинга: wire→internal (:81-90), create-ветка (:100-113), `apiPartial` (:140-144) — `show_archived_masters` ↔ `showArchivedMasters`, `show_archived_locations` ↔ `showArchivedLocations`.
4. Тесты: `__tests__/UserSettingsContext.test.tsx` существует — дополнить: дефолты при пустом кэше; PATCH отправляет новые ключи; ключи из кэша читаются.

### DoD
`npm test` (admin, vitest) зелёный; переключение настроек пишет оба ключа на сервер (PATCH) и восстанавливается из GET.

## Task 5: Данные расписания — свои ключи, `status=all`, активный срез

### Classification: standard

### Required Docs
Спека D3; domain-rules `activities.md` (правило видимости).

### Steps
1. `frontend/admin/lib/queryKeys.ts`: в секцию point-ключей добавить `scheduleMasters: ['masters', 'schedule']`, `scheduleServices: ['services', 'schedule']`, `scheduleLocations: ['locations', 'schedule']` — ключи **вложены в семейный префикс**, поэтому префикс-инвалидация `invalidateQueries({queryKey: ['masters']})` из `lib/invalidate.ts:83-86` и SSE-инвалидация достаются обоим наборам без правки `invalidate.ts`. Обновить таксономический комментарий (L5-11): пара с общим ключом — для справочных потребителей, `* + 'schedule'` — для сборки сетки (архивные включены).
2. `useMasters.ts`: новый хук `useScheduleMasters()` = `useQuery({ queryKey: qk.scheduleMasters, queryFn: () => getAllMasters({ status: 'all' }), staleTime: DICT_STALE_TIME })`, возвращает `MasterViewResponse[]` как есть. Аналогично `useScheduleLocations()` в `useLocations.ts`, `useScheduleServices()` в `useServices.ts`. Исправить устаревшие комментарии raw-хуков (useLocations.ts/useServices.ts:18 обещают «incl. archived», но не передают статус) — привести к факту.
3. `ScheduleDataContext.tsx`: заменить вызовы `useMastersRaw/useServicesRaw/useLocationsRaw` (:100-102) и `useMasters/useServices/useLocations` (:107-109) на три новых хука; произвести срезы: `activeMasters = scheduleMasters.filter(m => !m.archived)` (аналогично locations; у services — по `archived`); домен-срезы для существующих потребителей (`masters`, `services`, `locations` в значении контекста — активные, как сегодня, через `transformMaster`/трансформеры); полный список держать в контексте (`scheduleMasters`/`scheduleLocations` — для buildSchedule и DayView, Task 10).
4. Init-эффекты фильтров (:115-126) — сеют из активных срезов: убедиться, что ссылаются на новые переменные; поведение «в фильтрах только активные» сохранено.
5. `buildAdminSchedule` (:267-276) получает полные списки вместо сырых активных.
6. Unit: `__tests__/schedule/ScheduleDataContext.test.tsx` — моки (`vi.mock('@memo/api-client')`) перевести на новые функции с `{status:'all'}`; кейс: архивные в списке, в опциях фильтра (эффекты init) их нет.

### DoD
Unit зелёный; расписание запрашивает справочники своими ключами с `status=all`; ни один посторонний потребитель (`BookingFilters`, меню, карточка клиента) не получает архивных строк (общие ключи не тронуты).

## Task 6: buildSchedule — флаги архивности вместо дропа

### Classification: small

### Required Docs
Спека D4; domain-rules `activities.md`.

### Steps
1. `packages/domain/src/schedule.ts`: `ScheduleAdminDTO` += `masterArchived?: boolean; serviceArchived?: boolean; locationArchived?: boolean` (опциональные — `createMockScheduleItem` в `__tests__/helpers/mockData.ts:68` не ломается).
2. `frontend/admin/lib/buildSchedule.ts`: дроп `if (!master || !service || !location) continue` остаётся только для отсутствующей строки; при наличии строки карточка строится всегда, флаги из `archived` полей списков (`master.archived`, `service.archived`, `location.archived` — у MasterViewResponse поле появляется в Task 1; у Location/ServiceResponse — уже есть).
3. Unit `__tests__` для `buildAdminSchedule`: архивный мастер — карточка есть, `masterArchived: true`; архивная услуга — `serviceArchived: true`; отсутствие сущности — карточки нет (сирота).

### DoD
Unit зелёный; сборка не теряет архивные карточки, DTO несёт три флага.

## Task 7: Гейт видимости + обход id-фильтра (ScheduleDataContext)

### Classification: standard

### Required Docs
Спека D5; domain-rules `activities.md`.

### Steps
1. `ScheduleDataContext.tsx`: `useUserSettings()` (провайдер настроек обёртывает дерево — `providers.tsx:66` выше `ScheduleProvider`); значения с fallback: `showMasters = settings.showArchivedMasters ?? true`, `showLocations = settings.showArchivedLocations ?? false` (страховка от undefined в кэше).
2. Перед сборкой индекса (:295-298) заменить фильтр (:279-284) на составной предикат по элементам `enrichedData.items`:
   - `hasArchived = masterArchived || locationArchived` (услуги не участвуют в гейте);
   - гейт: `(!masterArchived || showMasters) && (!locationArchived || showLocations)` — иначе элемент скрыт;
   - id-фильтр `filterMasterIds`/`filterLocationIds` применяется ТОЛЬКО к элементам без архивных сущностей (`!hasArchived`); архивные, прошедшие гейт, — мимо фильтра.
   Итог: `filteredItems = activePassed.filter(idFilter) ∪ archivedPassed`.
3. Тестовая обёртка `__tests__/schedule/ScheduleDataContext.test.tsx` (~:205-226) дополняется `UserSettingsProvider` (с мокнутым api-client или предзаданными настройками) — без него гейт не читается.
4. Unit `ScheduleDataContext.test.tsx`: (а) арх. мастер + дефолт (on) → карточка в `activities`; (б) арх. локация + дефолт (off) → карточки нет; (в) арх. локация + включили → есть; (г) id-фильтр = один активный мастер, арх. карточки остаются (S1/S4/S7-аналоги на уровне контекста); (д) у услуги `archived` — карточка есть без чекбоксов.

### DoD
Unit зелёный; гейт мгновенно реагирует на переключение настроек (перерасчёт memo), ид-фильтр не прячет архивные карточки.

## Task 8: MultiSelect-футер + чекбоксы в Topbar

### Classification: standard

### Required Docs
Спека D6; domain-rules `user_settings.md`.

### Steps
1. `shared/MultiSelect.tsx`: опциональный проп `footer?: React.ReactNode`; рендер сразу после скроллируемого контейнера списка (точка — перед закрытием dropdown-`div`, ~:237, вне `max-h-[240px]`); футер внутри контейнера клика (outside-click закрывает только по клику вне — `containerRef`, :70-80, не трогать).
2. `Topbar.tsx`: мастерам в MultiSelect (`:225-242`) — `footer` = чекбокс «Показывать архивные» (`data-testid="show-archived-masters-toggle"`), checked = `settings.showArchivedMasters`, onChange = `updateSettings({ showArchivedMasters: next })`; локациям (`:243-250`) — аналогично `...-locations-toggle`. Контекст `useUserSettings` уже доступен в Topbar (дерево провайдеров).
3. Unit: тест MultiSelect — футер рендерится, клик по футеру не закрывает дропдаун; `__tests__/Topbar.test.tsx` существует — дополнить: переключение чекбокса зовёт `updateSettings` с корректным ключом; обёртка тестов — `UserSettingsProvider` с мокнутым api-client (паттерн `ScheduleDataContext.test.tsx:213-240`).

### DoD
Unit зелёный; чекбоксы видны под списками, переключение мгновенно меняет сетку (совместно с Task 7) и сохраняется.

## Task 9: ActivityCard — приглушение + бейдж «Архив»

### Classification: small

### Required Docs
Спека D7.

### Steps
1. Новый `shared/ArchiveBadge.tsx`: пилюля «Архив» (размер/скругления по образцу `StatusBadge`, `rounded-full px-2 py-0.5 text-xs`), проп `parts: Array<'мастер'|'локация'|'услуга'>` → `aria-label="Архив: мастер, локация"`; `data-testid="archived-badge"`.
2. `ActivityCard.tsx`: если `activity.masterArchived || serviceArchived || locationArchived` — root получает приглушение `opacity-60` (проверить читаемость итогового контраста по WCAG 1.4.3 на светлом и тёмном фонах карточек; при необходимости поднять значение — решение по факту рендера, класс один) и рядом с названием услуги рендерится `ArchiveBadge` с parts из трёх флагов.
3. Unit: тест ActivityCard — с флагами: приглушение + бейдж + корректный aria-label; без флагов: ни бейджа, ни opacity.

### DoD
Unit зелёный; карточка архивной сущности визуально отличима и доступно озвучивается.

## Task 10: DayView — архивные колонки (вне reorder, не drop-цели)

### Classification: large

### Required Docs
Спека D8; domain-rules `activities.md`.

### Steps
1. `DayView.tsx`, memo колонок (~:198-255): после активных колонок (логика не меняется) добавить архивные: источник — полные списки `scheduleMasters`/`scheduleLocations` из контекста (Task 5); условие колонки: соответствующий гейт включён (`settings`) И на видимый день есть ≥1 занятие этого мастера/локации в `filteredItems`; сортировка архивной группы — общим правилом (`sort_order`, имя); дедупликация с активными невозможна (id различны по определению).
2. Рендер: `SortableContext` и `SortableColumnHeader` — только для активных колонок (порядок/стрелки не касаются архивных); архивные шапки — обычный `ScheduleColumnHeader` с классом приглушения и `ArchiveBadge`; архивная `DayColumn` без регистрации droppable.
3. `useColumnReorder` (вызов в `DayView.tsx:257-266`) получает ТОЛЬКО активные колонки — auto-insert/persist (`useColumnReorder.ts`) не видит архивных id, `column_order_*` и `reorderLocations` не затрагиваются.
4. `useDnD.ts` `onDragEnd` (:142-218): guard сразу после резолва `targetColumnId` (~:166) — если целевая колонка архивная (передать в хук множество архивных id текущего режима или проверять по флагам дня), перенос игнорируется без запроса (защита от 422 `MASTER_NOT_ACTIVE` и молчаливого отката `ScheduleDataContext.tsx:177-182`).
5. Unit: DayView-тесты — (а) гейт on + занятия архивного мастера в этот день → колонка есть, шапка с бейджем, вне `SortableContext`; (б) в день без занятий архивного мастера — колонки нет; (в) `column_order_*` не изменился после рендера с архивной колонкой; (г) dnd на архивную колонку не создаёт PATCH. Обёртка: `UserSettingsProvider` + моки api-client.

### DoD
Unit зелёный; архивные колонки видимы по правилу, не участвуют в reorder/dnd, персист порядка не загрязняется.

## Task 11: e2e-инфра — reset user_settings

### Classification: small

### Required Docs
Спека D9.

### Steps
1. `frontend/admin/e2e/fixtures/seed-reset.ts`: в `RESET_SQL` (:70-88) добавить `DELETE FROM user_settings;` — таблица сейчас переживает reset и делает «дефолтные» тесты недетерминированными.
2. Чистый localStorage: в новом e2e-спеке (Task 12) в `beforeEach` — `page.addInitScript(() => window.localStorage.removeItem('memo-user-settings'))` (ключ — `UserSettingsContext.tsx:21`); storageState авторизации не трогаем.

### DoD
Существующие e2e зелёные после добавления DELETE (сброс настроек не ломает сценарии, их не пишущие); перед каждым тестом нового спека настройки сервера и кэш пусты.

## Task 12: e2e — сценарии S1–S7

### Classification: large

### Required Docs
Спека §User Scenarios, D5–D9; domain-rules `activities.md`.

### Task Description
`frontend/admin/e2e/schedule-archived-visibility.spec.ts` — 7 тестов, по одному на сценарий спеки. Фабрики: `createTestMaster`/`createTestLocation`/`createTestService`/`createTestActivity` (`e2e/fixtures/factories.ts`:193-285); архивация через `POST /api/v1/staff/{id}/archive` (мастер), `POST /api/v1/locations/{id}/archive`, `POST /api/v1/services/{id}/archive` (паттерн `archive-restore-parity.spec.ts:80-87`). `createTestActivity` фиксирует `start` внутри навигируемой недели (дефолт фабрики — UTC-сейчас). Ожидание сетки — `waitForScheduleReady(page)` (`fixtures/helpers.ts:60`).

### Steps
1. S1: мастер+услуга+локация+занятие → архивировать мастера → на текущей неделе карточка видна: `data-testid="activity-..."`, бейдж `archived-badge`, приглушение.
2. S2: архивировать локацию → карточки нет (дефолт off) → открыть дропдаун локаций, включить `show-archived-locations-toggle` → карточка видна; режим дня «по локациям» — колонка появилась.
3. S3: архивировать услугу → карточка видна сразу, оба чекбокса не влияют (выключить оба — карточка остаётся).
4. S4: гейт мастеров on, фильтр по одному активному мастеру (через дропдаун) → архивные карточки остаются.
5. S5: включить чекбокс локаций → перезагрузка страницы → чекбокс включён, карточки видны; выключить мастер-чекбокс → reload → выключен, архивные мастера скрыты.
6. S6: режим дня «по мастерам», занятие архивного мастера на дне D → колонка есть на D и отсутствует на соседнем дне.
7. S7: архивировать мастера И локацию одного занятия: оба off → карточки нет; только мастер on → нет; оба on → видна.

### DoD
E2E-тесты для сценариев 1–7 проходят (RED-GREEN-REFACTOR); локальный прогон `npx playwright test schedule-archived-visibility.spec.ts` зелёный.

## Task 13: Финал — прогоны, снапшоты, CHANGELOG, PR

### Classification: standard

### Required Docs
Спека §Тестирование.

### Steps
1. Полные прогоны: admin `npm test` (vitest); backend `uv run pytest` (все группы); e2e — локальный полный прогон расписания (`npx playwright test` schedule-спеки) + `schedule.spec.ts`, `schedule-filters.spec.ts`, `week-view.spec.ts` на отсутствие деградации.
2. Визуальные снапшоты: дефолт теперь показывает архевых мастеров — прогнать `visual-regression`/`wave6-*`; обновить снапшоты осознанно (дельта = архивные карточки/колонки, не что-то иное).
3. `npm run lint` (admin) — чисто.
4. `CHANGELOG.md` — строка фичи.
5. PR: заголовок по конвенции, тело с `Closes #267`; после мержа issue и карточка закрываются автоматически.

### DoD
Все прогоны зелёные; снапшоты пересмотрены; PR открыт, `Closes #267` в теле.
