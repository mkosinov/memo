# План: #327 — удаление клиента в сценарий delete_client (каскадный долг 3/3)

- Спека: `docs/specs/2026-09-26-delete-client-scenario-327-design.md` (rev2, `28c77b07`). Behavioral Delta — в спеке (для пользователя ничего не меняется), здесь не дублируется.
- Дата: 2026-09-26. Статус: черновик к ревью плана.
- Follow-up вне скоупа: #375 (метка `"visits"` в сетках), #378 (expected-сверка клиента) — обе depends-on #327, стартуют после мержа.

## Goal

Перенести execute-ветку удаления клиента (отвязка записей и фото, каскад посетителей с их визитами, теги и строка клиента) из общего исполнителя сервисного слоя в сценарий `usecases/clients.py::delete_client`; удаление визитов посетителя — пачковым методом сервиса-владельца визитов по собственной колонке-ссылке `visitor_id`. Контракт эндпоинта, эффекты в БД, событийные сетки (включая публикацию на ветке 404) и атомарность — без изменений; существующие тесты зелёные без правок.

## Architecture

Коридор 2 канона `docs/domain-rules/service-layer.md`: роут → сценарий `@transactional` (selfless-вызов `delete_client(None, db_session=..., id=..., resolutions=...)`, конвенция `usecases/records.py`). Сценарий ставит `mark_changed("clients")` явно сразу после проверки существования — у selfless-вызова аккумулятор открывается пустым, а сегодня метку сеет декоратор метода сервиса на каждой непасходной ветке (включая 404). Дальше фазы нынешнего исполнителя: сбор зависимостей → блокирующий контроль → валидация резолюций → nullify-фаза через `NULLIFY_HANDLERS` по `FK_MATRIX[Client]` → каскад посетителей (визит-кирпич + `VisitorService._delete_cascade`) → own-edge «теги + строка». Метки зависимостей безусловны — по факту диспетчеризации, не по наличию строк (паритет). `VisitorService._delete_cascade` становится own-edge «теги посетителя + строка» (имя сохранено ради структурного теста и точки monkeypatch теста атомарности); standalone `delete` посетителя композитит визит-кирпич перед ним. Каскад-хендлеры клиента и их регистрации удаляются из `domain/deletion.py` (прецедент #325 — хендлеры записей удалены); `FK_MATRIX[Client]` и клиентские `NULLIFY_HANDLERS` остаются (dry-run-дерево, валидация, nullify-диспетчеризация сценария). Импорт класса `Client` в сценарии — задокументированное в спеке отклонение от буквы прецедента `type(строки)` (клиентский точечный get возвращает Pydantic-схему): импорт — статический ключ доменных реестров, сценарий ORM-строк не строит.

## Tech Stack

Python (FastAPI, SQLAlchemy 2 async), pytest (юниты по конвенции #171 — прецеденты `tests/usecases/test_records_*.py`, `tests/services/test_visitor_service.py`), e2e Playwright — существующие спеки без правок. Фронт не затрагивается. Новых зависимостей нет.

## Task 1 — пачковые кирпичи визитов по посетителю

small | Сценарии U5, U6

`VisitRepository.delete_by_visitor_id(session, visitor_id)` — один set-based `DELETE FROM visits WHERE visitor_id = :vid`, без коммита (зеркало `delete_by_record_id`; шапка репозитория визитов предписывает bulk-команды по собственной колонке-ссылке). `VisitService.delete_visits_by_visitor(db_session, visitor_id, *, mark_visits=True)` — недекорированный сценарный кирпич: делегирует в репозиторий, при `mark_visits` помечает `"visits"` (зеркало `delete_visits_by_record`; оба вызова из задач 2 и 4 передают `False` — паритет сеток, True-ветка остаётся для будущих сценариев). Юнит-тесты (`tests/services/`, блок визитного сервиса): ровно один оператор DELETE (без построчного цикла), no-commit (rollback откатывает удаление), `mark_visits=False` подавляет метку, `True` — ставит.

Required Docs: спека §4.1; канон `service-layer.md` правила 1, 3–4; `src/services/visit.py` (прецедент `delete_visits_by_record`).

## Task 2 — перестройка `VisitorService`: own-edge вместо чужой таблицы

small | Сценарий U5

`_delete_cascade`: из тела удаляется прямое удаление визитов; метод становится own-edge «visitor_tags + строка Visitor» (порядок join-до-строки сохранён — FK без ondelete). Имя и сигнатура НЕ меняются: на них держатся структурный тест (`hasattr` + no-commit) и точка monkeypatch теста атомарности (спека §3, §8) — docstring переписывается под новую роль. Декорированный `delete` (standalone-роут `DELETE /visitors/{id}`): перед `_delete_cascade` вызывает `get_visit_service().delete_visits_by_visitor(db_session, id, mark_visits=False)` — итоговые эффекты и сетка (авто-метка `"visitors"` декоратора, без `"visits"`) идентичны сегодняшним; импорт `services.visit` в `services.visitor` цикла не образует (проверено). Юнит-тест RED-якорь перестройки: прямой вызов `_delete_cascade` удаляет посетителя и его теги, но НЕ визиты (до Task 2 — падает). Существующие якоря без правок: `tests/services/test_visitor_service.py`, `tests/services/test_delete_cascades.py::test_visitor_delete_cascades_to_visits`.

Required Docs: спека §4.2, §3 (граница: имя метода); канон правила 1, 3; `tests/test_api_clients.py` (тест атомарности — почему имя держим).

## Task 3 — own-edge клиента (аддитивно)

small | Сценарий U1

Новый `src/repositories/client.py`: `ClientRepository(ArchiveRepository)` + `get_client_repository` (`@lru_cache`); метод `delete_tags_by_client_id(session, client_id)` — один set-based DELETE джойн-строк `client_tags` (зеркало `RecordRepository.delete_tags_by_record_id`; сегодня клиентский сервис сидит на generic-репозитории — специализация появляется с первой собственной табличной командой). `ClientService.delete_row_with_tags(db_session, client_id)` — недекорированный кирпич: теги + строка клиента, no-commit, без меток (метки — у сценария; прецедент `RecordService.delete_row_with_tags`). Фабрика `get_client_service` переключается на специализированный репозиторий. Задача чисто аддитивная: DI-инъекция `_visitor_service` и каскад-хендлеры НЕ трогаются — их демонтаж сходится с переключением роута в Task 4 одним шагом (хендлер `_h_cascade_client_visitors` читает инъекцию, а исполнитель молча пропускает деп без хендлера: разнос демонтажа на два шага в любом порядке оставляет красный промежуток — 204-каскад падает).

Required Docs: спека §4.3; канон правила 1, 3–4; `src/repositories/record.py` + `src/services/record.py` (`delete_row_with_tags`-прецеденты).

## Task 4 — сценарий `delete_client`, проводка роута, чистка реестров

standard | Сценарии U1–U4, U6

Новый `src/usecases/clients.py`: `delete_client(db_session, id, resolutions) -> bool`, `@transactional`, selfless-конвенция. Фазы по спеке §4.4: probe сервисным `get` → сразу `mark_changed("clients")` (паритет публикации и на 404, и на успехе; исключение — аккумулятор сбрасывается без публикации); `collect_dependencies` (класс `Client` — статический импорт-ключ реестров, отклонение задокументировано в спеке); `has_blocking_deps` → `BlockingDepsError` (паритет-защита, недостижима для текущей матрицы); `validate_resolutions` → `InvalidResolutionError`; nullify-фаза диспетчеризацией по `FK_MATRIX[Client]` через `NULLIFY_HANDLERS` (records, photos) с `mark_changed(dep.entity)`; каскад: `VisitorService.list_by_client(db_session, client_id, master_key=None)` → для каждого посетителя `delete_visits_by_visitor(..., mark_visits=False)` → `_delete_cascade`; после цикла `mark_changed("visitors")`; `delete_row_with_tags` + `mark_changed("client_tags")`; `True`. Сервисные синглтоны — фабриками внутри тела сценария при каждом вызове (не модульный захват: monkeypatch теста атомарности патчит синглтон). Роут `api/v1/clients.py`: execute-ветка вызывает сценарий (маппинг `ResolutionError` → 422, `False` → 404 прежний); dry-run-ветка не трогается. Вместе с переключением роута — демонтаж старого пути одним шагом: в `domain/deletion.py` удалить `_h_cascade_client_visitors`, `_h_cascade_client_tags` и регистрации `(Client, "visitors")` / `(Client, "client_tags")` из `CASCADE_HANDLERS` (`FK_MATRIX[Client]` и клиентские записи `NULLIFY_HANDLERS` остаются); из `ClientService` уходит DI-инъекция `_visitor_service` (конструктор — стандартная форма `ArchiveService`, фабрика упрощается, docstring про тест-патч переписать: сценарий берёт синглтон `get_visitor_service()` сам — патч синглтона продолжает перехватываться); подчистить неиспользуемые импорты `VisitorService`/`get_visitor_service` в `src/services/client.py` и устаревшие комментарии вокруг удалённых хендлеров в `deletion.py`. Юнит-тесты `tests/usecases/test_clients_delete.py`: сетка успеха `{"clients","records","photos","visitors","client_tags"}` байт-в-байт (отдельно — execute с пустыми резолюциями `{}` на клиенте без зависимостей: метки зависимостей безусловны), ветка 404 → ровно `{"clients"}`, ветки 422 → пустая, атомарность сбоя посреди каскада. Структурный регрессионный: в `CASCADE_HANDLERS` нет клиентских ключей (прецедент Activity-guard в `tests/domain/test_deletion.py`) + execute-ветка роута клиентов импортирует сценарий (нагружающая защита от возврата к `resolve_delete`). Быстрая петля: `pytest backend/tests/test_api_clients.py backend/tests/usecases backend/tests/test_events_emit.py backend/tests/services/test_visitor_service.py`.

Required Docs: спека §4.4–4.5, §7; `src/usecases/records.py` (прецедент selfless-сценария, сеток, метки собственной сущности); канон правила 2–6.

## Task 5 — канон и полная верификация

small | Сценарии U1–U6 (все закреплены существующими тестами)

Канон `docs/domain-rules/service-layer.md` правило 10: вычеркнуть строку «удаление клиента (каскад посетителя стирает его визиты)» (строка «операции сотрудников» остаётся до мержа #326), ревизию канона bump'нуть с датой. Полный прогон: `pytest backend/tests` зелёный без правок существующих файлов; линт и типизация бэкенда зелёные; e2e Playwright admin (существующие клиентские спеки) зелёные на PR CI без правок. Любая правка контракта, сеток или существующих тестов по ходу — стоп и возврат к дизайну (Gate C).

Required Docs: спека §7, §Behavioral Delta; канон правило 10.
