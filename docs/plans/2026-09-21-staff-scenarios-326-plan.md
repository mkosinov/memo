# План: #326 — операции сотрудников в сценарии (каскадный долг 2/3)

- Спека: `docs/specs/2026-09-21-staff-scenarios-326-design.md` (rev2, `4be239bc`). Behavioral Delta — в спеке (для пользователя ничего не меняется), здесь не дублируется.
- Дата: 2026-09-21. Статус: черновик к ревью плана.

## Goal

Перенести составные действия карточки сотрудника (создание, обновление, частичное обновление, увольнение, удаление) из `StaffService` (композитные `@transactional`-методы с сырыми командами в `users`/`masters`) в сценарии `usecases/staff.py`, вводя пишущих владельцев `users` и `masters`. Контракты эндпоинтов, поведение и событийные сетки — без изменений; контрактные тесты и e2e зелёные без правок.

## Architecture

Коридор 2 канона `docs/domain-rules/service-layer.md`: эндпоинт → сценарий `@transactional` (selfless-вызов `create_staff(None, db_session=..., data=...)`, конвенция `usecases/records.py:13–26` — ведущий `None` и ключевые аргументы, сессия позиционно не передаётся). Сценарии составляют вызовы сервисов и домена, ORM-модели не импортируют (правило 2; `UserRole` — словарный енам, не ORM-модель). Владельцы — standalone-классы с явным `entity_name` по прецеденту `VisitService`/`UserSettingsService`, все методы без `@transactional` (правило 3), только flush, марки `mark_changed` по факту изменения (rowcount/наличие). Selfless-аккумулятор сценария открывается пустым — `mark_changed("staff")` ставится явно. `delete_staff` — сценарий-обёртка над без-транзакционным ядром `resolve_delete` (правило 3: тонкий декорированный метод поверх общего ядра); FK-матрица `domain/deletion.py` не переписывается. Связка `staff_positions` остаётся у `StaffService` (правило 1, прецедент `record_tags`).

## Tech Stack

Python (FastAPI, SQLAlchemy 2 async), pytest (юнит-тесты сценариев/владельцев по конвенции #171 — прецеденты `tests/usecases/test_records_*.py`, `tests/services/test_visit_service.py`), e2e Playwright — существующие файлы без правок. Фронт не затрагивается. Новых зависимостей нет.

## Task 1 — владелец `users`: сервис и карта сущностей

standard | Сценарии 1 (роль учётки при создании), 2–3 (правка роли), 4 (деактивация учётки)

Новый `backend/src/services/user.py`: `UserService` (standalone, `entity_name = "users"`, фабрика `get_user_service` c `@lru_cache`; репозиторий — общий `BaseRepository`; ни один метод не декорирован). Операции: `create_staff_account(db_session, staff_id, phone, password, role)` — `validate_password` → `hash_password` внутри (`auth/passwords.py`, без правок auth), хранится только хеш, марка «users»; `set_role_by_staff` → rowcount, марка по факту; `deactivate_active_by_staff` → rowcount только по активным, марка по факту. Чистая функция `resolve_account_role(explicit_role, position_ids, has_master_section)` — перенос вычисления роли из `staff.py:379–395` (явная роль → шаблон по закреплённым должностям, admin старше master → фолбэк «мастер-секция есть → master, иначе admin»), вычисление уходит из `StaffService` (`_POSITION_ROLE_TEMPLATE`/`_template_role`, `staff.py:114–137`). Карта `src/events/entities.py`: `User` из `_CASCADE_ONLY_MODEL_ENTITY` → явная пара `model_entity[User]`/`service_entity[UserService]` по образцу `Visit`/`UserSettings` (значение «users» то же); докстринги карты и `test_events_entities.py` про «users has NO service of its own» обновить (ассерт значения жив; счётчик completeness не растёт — у сервиса нет `@transactional`-методов). Юнит-тесты: все ветки `resolve_account_role`; rowcount-семантика деактивации; ассерт «не коммитит».

Required Docs: спека §«Выбранный концепт» п.1; `docs/domain-rules/service-layer.md` правила 1, 3; `src/events/entities.py` (прецедент standalone-пары).

## Task 2 — владелец `masters`: пишущий сервис расширения

standard | Сценарии 2 (снятие секции блокируется занятиями), 4 (архив мастера при увольнении)

В `backend/src/services/master.py` рядом с читающим вью — пишущий `MasterService` (standalone, `entity_name = "masters"`, `get_master_service`; методы без декоратора): `upsert_extension(db_session, staff_id, specialty, color, archived)` — создание/обновление строки `masters` c сегодняшней семантикой `archived`, марка «masters»; `remove_extension(db_session, staff_id)` — удаление строки с доменной блокировкой «есть занятия → `BlockingDepsError`» (перенос `_assert_section_removable`, `staff.py:630–644`); `archive_active_extension(db_session, staff_id)` → rowcount только по активным, марка по факту. Самоописание модуля обновить («read-only» устарело); читающие функции `list_masters_view`/`list_all_masters_view` (свободные функции после #217/#369, класс `MasterViewService` удалён) не трогать. Карта сущностей: `Master` из cascade-only → явная пара (значение «masters» то же); зеркальный комментарий «Cascade-only entities» в карте переписать; тест `test_master_is_cascade_only_entry` переименовать (например, `test_master_is_owner_entry`) — ассерт значения `MODEL_ENTITY[Master] == "masters"` жив, докстринг обновить. Юнит-тесты: upsert двух веток; remove при живых занятиях (422-семантика) и без; rowcount деактивации; «не коммитит».

Required Docs: спека §«Выбранный концепт» п.2; `docs/domain-rules/service-layer.md` правила 1, 3; `docs/domain-rules/staff.md` (D7 — блокировка снятия секции занятиями).

## Task 3 — сценарии create/update/patch/archive и проводка роутов

large | Сценарии 1–5 (создание, PUT, PATCH, увольнение, контрольный restore)

Новый `backend/src/usecases/staff.py`: `create_staff`, `update_staff`, `patch_staff`, `archive_staff` — `@transactional`, selfless (`None` + ключевые аргументы), `mark_changed("staff")` явно, порядок шагов как сегодня. Состав: карточка и позиции — без-транзакционное ядро `StaffService` (поля карточки + `_replace_positions` + сборка ответа читающими помощниками); секция — `MasterService` (Task 2); учётка/роль — `UserService` + `resolve_account_role` (Task 1). PATCH-подготовка (трёх-state `master`, sent-наборы, стрипинг null через `_patch_payload`/`NOT_NULL_FIELDS`) — в сценарии `patch_staff`, поведение подготовки не меняется. Читающие методы `StaffService` остаются без `@transactional` — сборка ответа не порождает вторую публикацию. Роуты `api/v1/staff.py` (POST/PUT/PATCH/archive) → сценарии; guards без изменений. Демонтаж в `StaffService`: `create`, `update`, `patch`, `_patch_composite`, `archive`, `_apply_master_section`, `_apply_role_template`, `_assert_section_removable`; остаются читающие, `restore` (US-5 — контрольный ассерт «restore не тронут»), позиционные методы. Переезд статических аудитов: `test_staff_archive_marks_users` (`test_events_emit.py:343`) — переименовывается (суть — марки владельцев при увольнении) и переносится путём на `src/services/user.py` (+`master.py`); `TestCascadeSourceAudit` дополняется по образцу `record.py`-блока: в `staff.py` запрещены `mark_changed("masters")`/`mark_changed("users")` (сегодня их восемь: строки 407, 409, 411, 578, 598, 628, 675, 683 — все обязаны исчезнуть), во владельцах — обязательны. Юнит-тесты `tests/usecases/test_staff_create.py`, `test_staff_update_patch.py`, `test_staff_archive.py`: сетки всех веток (create/update/patch пинятся впервые — оракул до демонтажа), атомарность (сбой посреди цепочки → ничего не сохранено), порядок шагов, null-стрипинг PATCH, негатив-кейс авторизации (роль `master` → 403 на мутирующие staff-эндпоинты; если уже покрыт `test_auth_guards.py`/`test_master_scope_contract.py` — не дублировать, ссылкой). Быстрая петля: `pytest backend/tests/test_api_staff.py backend/tests/usecases backend/tests/test_events_emit.py backend/tests/test_events_entities.py`.

Required Docs: спека §«Выбранный концепт» п.3–4, §«События и транзакции»; `backend/src/usecases/records.py` — прецедент selfless-сценария, сеток и переезда source-аудита.

## Task 4 — сценарий `delete_staff` (ядро `resolve_delete`)

standard | Сценарий 6 (удаление: 409-превью / коммит с resolutions / каскады)

В `backend/src/services/generic.py`: исполняющее тело `resolve_delete` (`generic.py:212–299`) выделяется в метод-ядро `_resolve_delete_core` без `@transactional` (bound-метод, сигнатура прежняя); `resolve_delete` остаётся декорированным тонким вызовом ядра — все наследники (`Tag`/`Client`/`Activity`/…) без изменений поведения. В `usecases/staff.py`: `delete_staff(db_session, id, resolutions)` — `@transactional`, `mark_changed("staff")` явно + вызов ядра на экземпляре staff-сервиса (недекорированный вызов правилом 5 разрешён); сценарий покрывает ОБЕ ветки исполнения — bare-чистую (зависимостей нет → снос строки) и с `resolutions` (исполнение резолюций); превью-ветка (`collect_dependencies` → 409 с деревом) остаётся в роуте, как сегодня (контракт #207 не по образцу записей — без `dry_run`/`expected`). Каскадные марки сеёт ядро (`mark_changed(dep.entity)`), сетка идентична сегодняшней (пин новым тестом: обе ветки). Роут `DELETE /{staff_id}` → сценарий; dry-run/409/404-ветки не меняются. Юнит-тесты: обе ветки через сценарий, атомарность. Быстрая петля: `pytest backend/tests/test_api_staff.py backend/tests/usecases backend/tests/test_events_emit.py`.

Required Docs: спека §«Выбранный концепт» п.3 (`delete_staff`), §«События и транзакции»; `docs/domain-rules/service-layer.md` правило 3; `docs/domain-rules/deletion.md` (контракт удалений не меняется).

## Task 5 — канон и полная верификация

small | Сценарии 1–6 (все закреплены существующими тестами и e2e)

Канон `docs/domain-rules/service-layer.md` правило 10: вычеркнуть пункт «операции сотрудников» (остаются занятие #325 и клиент #327), ревизию канона bump'нуть с датой. Полный прогон: `pytest backend/tests` зелёный; линт и типизация бэкенда зелёные; e2e `frontend/admin/e2e/staff-*.spec.ts` (crud, s2, s6, s7, delete-blocked, delete-auto-cascade) зелёные на PR CI без правок. Любая правка контракта или сеток по ходу — стоп и возврат к дизайну (Gate C).

Required Docs: спека §«Тестирование», §Behavioral Delta; правило 10 канона.
