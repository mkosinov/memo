# План: #325 — удаление занятия в сценарий `delete_activity`

- Спека: `docs/specs/2026-09-20-activity-delete-scenario-design.md` (rev1, `203c753`). Behavioral Delta — в спеке (для пользователя ничего не меняется), здесь не дублируется.
- Дата: 2026-09-20. Статус: черновик к ревью плана.

## Goal

Перенести исполнение коммита удаления занятия из `ActivityService.delete` (сырые команды в чужие таблицы) в сценарий `usecases/activities.py::delete_activity` без изменения контракта эндпоинта, поведения и сеток событий. Каскад — только через без-транзакционных помощников сервисов-владельцев. Аудит каскадов приложен к issue (комментарий от 2026-09-20, вне кода).

## Architecture

Коридор 2 канона `docs/domain-rules/service-layer.md`: эндпоинт → сценарий usecases, декорированный `@transactional` (selfless-вызов `delete_activity(None, db_session=..., id=...)`, прецедент — `delete_record` в `api/v1/records.py:387`). Сценарий составляет вызовы сервисов и домена, ORM-модели не импортирует (правило 2); модель занятия берёт из загруженной при проверке существования строки (`type(loaded)`). Сбор id записей — переиспользованием `collect_dependency_ids` (`domain/deletion.py:1266`). Помощники — без транзакции (правило 3), bulk по набору id одной командой (правило 4), вложенных декорированных вызовов нет (правило 5). Обе сетки марок событий и порядок каскада — идентичны текущим (см. спеку «Марки событий»).

## Tech Stack

Python (FastAPI, SQLAlchemy 2 async; bulk DELETE/UPDATE на Core), pytest (+ юнит-тесты помощников по конвенции #171), e2e Playwright — существующий файл без правок. Фронт не затрагивается.

## Task 1 — bulk-помощники визитов и платежей

small | Сценарий 3 (каскад: записи → их визиты/платежи)

`VisitService.delete_visits_by_record_ids(db_session, record_ids)` — одна команда `DELETE ... WHERE record_id IN (...)`, марка «visits»; `PaymentService.delete_by_record_ids(db_session, record_ids)` — аналогично, марка «payments». Оба — без транзакции, рядом с существующими однозаписными (`visit.py:286`, `payment.py:177`), которые не трогаются. Пустой набор — no-op без запроса. Юнит-тесты по конвенции #171 (прецеденты: `tests/services/test_visit_service.py:150`, `test_payment_service.py:32`): удаление по набору + ассерт «не коммитит».

Required Docs: спека §«Выбранный концепт» шаг 3; `docs/domain-rules/service-layer.md` правила 1, 3, 4.

## Task 2 — bulk-помощник записей и открепление фото

small | Сценарии 1 (чистое занятие: фото открепляются и без записей), 3 (связки и строки записей)

`RecordService.delete_rows_with_tags_bulk(db_session, record_ids)` — `record_tags` затем `Record` по набору id, марки «records» и «tags» (за record_tags); без транзакции; рядом с `delete_row_with_tags` (`record.py:345`), который не трогается. `PhotoService.unlink_from_activity(db_session, activity_id)` — `UPDATE photos SET activity_id = NULL`, марка «photos», безусловно; без транзакции. Юнит-тесты по той же конвенции, включая случай пустого набора.

Required Docs: спека §«Выбранный концепт» шаги 3–4, §«Марки событий»; `docs/domain-rules/deletion.md` (фото выживает при потере владельца, FK → NULL).

## Task 3 — сценарий `delete_activity`

standard | Сценарии 1–6 (единая точка исполнения всех веток удаления)

Новый модуль `backend/src/usecases/activities.py`: `@transactional async def delete_activity(db_session, id) -> bool` (selfless; вызов `delete_activity(None, db_session=..., id=...)`). Шаги по спеке: (1) существование через сервис занятия — нет → `False`; (2) `model = type(loaded)`; id записей через `collect_dependency_ids` (без нового помощника сбора); (3) при наличии записей — bulk-помощники Task 1–2 в порядке «визиты → платежи → связки/строки записей»; (4) фото-открепление Task 2; (5) свои таблицы занятия — `activity_tags` + `Activity` через сервис занятия (или его репозиторий), марки «tags» (activity_tags) и «activities» (своя сущность — selfless-аккумулятор пуст, марка ставится явно). Сетки событий — обе идентичны текущим: с записями `{records, visits, payments, tags, photos, activities}`, без записей `{photos, tags, activities}`. Юнит-тест сетки чистого занятия (сегодня не покрыта, обязателен) + тест каскадного случая на уровне сценария (если четыре переезжающих теста Задачи 4 уже закрывают каскад — отдельный тест не дублируется). Быстрая петля проверки: `pytest backend/tests/test_api_activities.py backend/tests/usecases backend/tests/services/test_delete_cascades.py`.

Required Docs: спека целиком; `docs/domain-rules/service-layer.md` правила 2, 5, 7; `backend/src/usecases/records.py` — прецедент selfless-сценария и меток.

## Task 4 — проводка роута, демонтаж старого метода, документация

standard | Сценарии 1–6 (все ветки контракта проходят через сценарий)

Роут `api/v1/activities.py` (ветка коммита, сегодня `activities.py:341`) вызывает сценарий вместо `service.delete`; контракт, guards, dry-run/422/404/409-ветки — без изменений. `ActivityService.delete` удалить; других production-вызывателей нет (проверено разведкой и панелью). Обновить устаревающие упоминания: докстринг роута (`activities.py:274–278`), комментарий FK-карты (`domain/deletion.py:36–39`), комментарии `tests/test_events_emit.py:120` и `tests/domain/test_deletion.py:413`; канон `service-layer.md` правило 10 — снять пункт про занятие (остаются сотрудники #326 и клиент #327). Переезд тестов проводки (ассерты без изменений): spy-тест `test_delete_goes_through_handwritten_service` (`tests/test_api_activities.py:590`) → на сценарий; четыре юнит-теста каскада (`tests/services/test_delete_cascades.py:159, 194, 250, 330`) → на вызов сценария. Быстрая петля проверки: `pytest backend/tests/test_api_activities.py backend/tests/usecases backend/tests/services/test_delete_cascades.py`.

Required Docs: спека §«Исправленные премиссы issue», §Verification, §«Побочно обновляются»; правило 10 канона.

## Task 5 — полная верификация

trivial | Сценарии 1–6 (все закреплены существующими тестами)

Полный прогон: `pytest backend/tests` зелёный; e2e `frontend/admin/e2e/activity-deferred-delete.spec.ts` (S1–S6, S1m, S3m) зелёный без правок; линт и типизация бэкенда зелёные. Любая правка контракта или сеток событий по ходу — стоп и возврат к дизайну (Gate C).

Required Docs: спека §Verification, §Behavioral Delta.
