# План #217: составные чтения — выравнивание до свободных функций

## Goal

Выровнять 5 легаси-композитов (№2 записи, №3 мастера, №4 фото, №6 занятость, №7 счётчики материалов) до канонической формы коридора 3 — свободная функция в модуле своего сервиса; списочный композит мастеров перевести на механику списков репозитория; удалить мёртвую привязку `_model`. Поведение, HTTP-контракты и фронт не меняются. Решение и границы — спека `docs/specs/2026-09-20-composite-reads-form-217-design.md` (rev4) и ADR 007.

## Architecture

- Функции живут в `backend/src/services/<сущность>.py` рядом с сервисом своей сущности; роуter зовёт их напрямую, сессия приходит аргументом.
- Списочная механика — `BaseRepository.list_custom` (порядок параметром, statement без запечённого порядка); итоги/словари — прямая сессия (правило путей исполнения ADR 007).
- Скоуп мастера (`master_key`, #263) сохраняется в сигнатурах №2/№4 и передаётся из роутов; гарды доступа остаются в роутах.
- События: привязка `MasterViewService._model` мертва (реестр маппит только GenericService-инстансы) — удаляется, докстринг реестра обновляется.
- Конвенция имён табличных страниц (решение пользователя, 2026-09-21): `list_<сущность>_view` — `list_records_view`, `list_masters_view`, `list_photos_view`, `list_clients_view` (переименование в Task 5).
- Фронтенд и `packages/api-client` не затрагиваются (подтверждено панелью: класс бэкенд-only; схема `ClientViewResponse` — внутреннее имя Python, JSON не меняется).

## Tech Stack

FastAPI (DI-провайдеры), SQLAlchemy 2.x async (`Select`, коррелированные подзапросы), pytest (контрактные + скоуп-гейты), Playwright (US1–US7 без правок), ruff/mypy.

**Предусловия уже в дереве (не трогать повторно):** ADR 007 (`docs/decisions/007-composite-reads-free-functions.md`) и канон `service-layer.md` rev5 (правило 8 со ссылкой на ADR) закоммичены вместе со спекой. Слой сценариев `usecases/records.py` метод `list_view` не вызывает (только `get_record_service`) — аудит usecases на потребителей `list_view` не нужен, вмешательства #171 нет.

---

## Task 1 — №2 записи: `list_records_view` + общие блоки уровня модуля

classification: standard
Required Docs: спека §«Техническое содержание» п.2; канон `docs/domain-rules/service-layer.md` (коридор 3, дерево выбора); правила скоупа мастера #263.

- Вынести общие строительные блоки `record.py` на уровень модуля: `search_fields`, строитель запроса `_build_list_stmt`, колонки сортировки `_sort_columns` — используются и `RecordService.list` (поведение неизменно), и новой функцией.
- Свободная функция `list_records_view(db_session, params, master_key)` — проектция отображения как сегодня, исполнение через `list_custom`, `master_key` в сигнатуре и передаче из роута (`get_scope`).
- Роут GET /records/view зовёт функцию напрямую; сервисная зависимость из обработчика убрана (в остальных роутах модуля остаётся — там CRUD).
- Перепривязать тесты: `test_service_record_view.py`, `test_api_records_view.py`, `test_master_scope_read.py`, `tests/services/test_record_service.py`, `test_coverage_boost.py`, `test_copy_week.py`, `test_events_emit.py`, `tests/usecases/test_records_*.py`.
- Гейт: pytest зелёный; US2 (`records-view.spec.ts`) зелёный без правок; скоуп-гейты мастера зелёные.

## Task 2 — №3 мастера: расформировать `MasterViewService`

classification: standard
Required Docs: спека п.3; ADR 007 (правило путей исполнения); #205 (охранный предел плоских списков), #267 (статусы архива мастеров).

- `list_masters_view(db_session, page, per_page, order_by, status)` — пагинированный список через `list_custom`: statement без запечённого порядка/лимита, порядок параметром; count по подзапросу эквивалентен рукописному (INNER JOIN один-к-одному) — закрепить отдельным тестом эквивалентности.
- `list_all_masters_view(db_session, order_by, status)` — плоский список: предел `BARE_LIST_MAX_ROWS + 1` и `BareListLimitExceededError` на стороне функции; статусы active/archived/all сохраняются параметром в обеих функциях.
- Удалить обе кэшированные фабрики: `get_master_view_service` (services/master.py) и `_get_master_view_service` + `_ServiceDep` (api/v1/masters.py); роуты зовут функции напрямую.
- Мёртвая привязка `_model = Staff` удаляется вместе с классом; обновить докстринг реестра событий (events/entities.py:30–33, называет класс по имени); перепривязать `test_events_entities.py`. Гейт: разрешение сущностей мастеров в событиях живо (Master покрыт явной записью карты).
- Гейт: US3 (`staff-crud.spec.ts`) зелёный без правок.

## Task 3 — №4 фото: `list_photos_view`

classification: small
Required Docs: спека п.4 (ревизия 5 — имя `list_photos_view`); #263 (скоуп мастера, EXISTS-предикат).

- Свободная функция `list_photos_view(db_session, params, master_key)` в photo.py: скоуп-предикат EXISTS и условный outerjoin переезжают как есть; исполнение через `list_custom` (как сегодня).
- Роуты GET /photos и GET /photos/web зовут функцию; `PhotoService` остаётся для создания/изменения/удаления; DI меняется только в этих двух обработчиках.
- Перепривязать тесты: `test_service_photo_list.py` (шпион `list_custom` — на новый путь модуля), `generic_contract.py` (импорт `PhotoService`).
- Гейт: US4 (`photos-crud.spec.ts`) зелёный без правок.

## Task 4 — №6/№7 помощники: модульные функции

classification: small
Required Docs: спека п.5–6.

- `sum_active_seats_bulk` → модульная функция activity.py; обработчик GET /activities зовёт её напрямую; метод из класса удаляется без остаточного шима; перепривязать `test_list_activities_query_count.py`.
- `_attach_counts` → модульная функция material.py (подчёркивание — конвенция «внутренняя для модуля»); все 5 вызовов `self._attach_counts(...)` → `_attach_counts(...)`.
- Гейт: US6 (`schedule.spec.ts`) и US7 (`services-materials.spec.ts`) зелёные без правок.

## Task 5 — переименование №1, докстринги и полная верификация

classification: small
Required Docs: спека п.1 (ревизия 5) и §«Тестирование»; ADR 007 (пункт 5 — конвенция имён).

- Переименование №1: `list_clients_with_stats` → `list_clients_view`, схема `ClientWithStats` → `ClientViewResponse`; перепривязать импорты и тесты (имена внутренние, HTTP-контракт и JSON не меняются — контракты API-тестов остаются зелёными).
- Докстринг `list_clients_view`: «future — #217» → «decision — ADR 007»; ссылка на #206 (обоснование дешёвого count) остаётся.
- Полный прогон: pytest (весь бэкенд), Playwright US1–US7 без правок спек, скоуп-гейты (`test_master_scope_contract.py`, `master-role-photos.spec.ts`, `master-role-record-create.spec.ts`), ruff + mypy без новых находок.
- US1/US5 — образцы, кодом не затрагиваются, покрыты регрессионно этим прогоном.

---

## Критерии готовности (DoD)

- Все 7 композитов — свободные функции в модулях своих сервисов; `MasterViewService` не существует; `queries/` не существует.
- Табличные вью-функции носят имена `list_<сущность>_view` (включая переименованные клиенты и их схему `ClientViewResponse`).
- Списочные композиты №2/№3/№4 исполняются через `list_custom`; №1 — задокументированное исключение (ручной дешёвый count сохранён); №5/№6/№7 — прямая сессия.
- Тест эквивалентности счётчика мастеров (переход на `list_custom`) присутствует и зелёный.
- Веток `gate` нет; pytest + US1–US7 + скоуп-гейты + линт/тайпчек зелёные.
