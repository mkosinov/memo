# План: standalone PATCH mini-contract для Visits и UserSettings (#179)

## Goal

Одно место правды по общим PATCH-семантикам для standalone-сервисов
`VisitService` и `UserSettingsService`: параметризованный контракт-тест,
прод-фикс `VisitService.patch` (стрип `null` на `price`/`status`, полный
no-op пустого запроса), выравнивание `docs/domain-rules/visits.md` и удаление
чистых дублей из личных тест-файлов.

Спека: `docs/specs/2026-09-18-standalone-patch-contract-design.md` (rev3).

## Architecture

- Контракт: новый файл `backend/tests/services/test_standalone_patch_contract.py`,
  два явных конфига по образцу `EntityConfig` из `backend/tests/generic_contract.py`
  (без наследования и авто-обнаружения). Уровень проверок — сервис: прямой
  вызов `service.patch` / `service.update_by_user_id` с `db_session`, как в
  generic-контракте #175.
- Прод-код: только `backend/src/services/visit.py`, метод `patch` — приём
  как у `UserSettingsService.update_by_user_id` (локальный NOT NULL набор +
  ранний выход на пустом запросе).
- Playwright E2E НЕ пишутся: пользовательские сценарии спеки (§5) якорятся
  pytest-ом — задача не меняет UI-поведение.

## Tech Stack

pytest (asyncio auto-режим), SQLAlchemy async + фикстуры
`backend/tests/conftest.py`, сервисы/модели `backend/src`.

---

## Task 1: Каркас контракта + семантики, зелёные на текущем коде

### Classification: standard

### Required Docs

- `docs/domain-rules/visits.md` — merge-семантика PATCH, обязательный каскад
  `record.status`
- `docs/domain-rules/user_settings.md` — own-only контракт, PATCH без
  `user_id`-параметра

### Work

1. Создать `backend/tests/services/test_standalone_patch_contract.py`:
   - конфиг-структура (NamedTuple/dataclass): `service_factory`,
     `patch_schema` (`VisitPatch` / `UserSettingsPatch`), `not_null_fields`,
     `nullable_field`, sentinel-пара «original/sentinel» с гарантией
     различия (аналог `_ensure_different` из generic-контракта), сценарий
     not-found, фабрика строки-владельца;
   - конфиги: Visits — `not_null_fields={price, status}`, nullable-пример
     `custom_price`; UserSettings — `not_null_fields` = все 6 полей
     (`theme`, `language`, `column_order_staff`, `column_order_locations`,
     `show_archived_masters`, `show_archived_locations`), nullable в схеме нет.
2. Async-фабрика владельца для UserSettings: вставка `User` через
   `db_session` + создание строки настроек сервисным вызовом. Синхронную
   `_user`-фикстуру из conftest НЕ переиспользовать (она коммитит в
   отдельном коннекте) — пишем собственный async-сетап. Для Visits —
   существующие async-фикстуры conftest (`sample_visit` и родня), без HTTP.
3. Реализовать три семантики (параметризовано по двум конфигам; на
   текущем коде обе стороны зелёные):
   - partial update: sentinel применяется; ВСЕ прочие поля схемы равны
     pre-state;
   - not-found: Visits — `patch` по несуществующему `visit_id` → `None`;
     UserSettings — `update_by_user_id` для `user_id` без строки → `None`;
   - реальный patch обновляет `updated_at` (сравнение `>=` либо сдвиг
     времени перед вызовом — защита от совпадения тиков SQLite).

### DoD

- Scenario S1: контракт параметризован 2×3; `pytest
  backend/tests/services/test_standalone_patch_contract.py` — зелёный.

## Task 2: Null-policy + пустой запрос: RED → фикс `VisitService.patch` → GREEN

### Classification: standard

### Required Docs

- `docs/domain-rules/visits.md`
- `docs/domain-rules/_overview.md` — таблица PATCH Contract (канон
  null-правила: `null` на NOT NULL → игнор; на nullable → применяется)

### Work

1. Добавить в контракт две семантики (параметризовано):
   - null-policy: `null` на поле из `not_null_fields` → игнор (значение
     прежнее); `null` на `nullable_field` → применяется (очистка). Для
     list-полей: `null` → игнор, `[]` → применяется как значение;
   - empty body: значения полей И `updated_at` не меняются (полный no-op).
2. Прогнать для Visits — ожидаемо RED: сегодня `null` на `price`/`status`
   доезжает до flush и падает `IntegrityError` (в API — 422
   `INTEGRITY_VIOLATION`), пустое тело двигает `updated_at`. UserSettings —
   уже зелёная.
3. Фикс `backend/src/services/visit.py`, метод `patch`:
   - ранний выход при пустом наборе полей после `model_dump(exclude_unset=True)`
     — без записи `updated_at`, без каскада `recompute_record_status`, без
     `mark_changed`;
   - стрип явного `null` для `{price, status}` перед setattr (локальный
     NOT NULL набор, приём `UserSettingsService`).
4. GREEN для обоих конфигов; наследование `GenericService` не вводить.

### DoD

- Scenario S2: null-policy и empty-body тесты для Visits красные до фикса
  и зелёные после (RED-GREEN-REFACTOR); весь контракт зелёный.

## Task 3: Дедуп личных тест-файлов

### Classification: small

### Required Docs

- `docs/domain-rules/visits.md`

### Work

1. `backend/tests/services/test_visit_service.py`: удалить
   `test_visit_service_patch_partial` (сервис-уровневый дубль partial,
   покрыт контрактом).
2. `backend/tests/test_api_user_settings.py`: удалить
   `test_patch_language_only` (чистый дубль theme-only). Остаются
   `test_patch_theme_only` (HTTP-якорь 200), `test_patch_empty_body_noop`,
   `test_patch_not_found_404`.
3. `backend/tests/test_user_settings_patch.py`: удалить класс
   `TestUserSettingsPatchSemantic`; `TestUserSettingsPatchArchivedVisibility`
   остаётся. Перемещений кода нет.
4. `backend/tests/test_api_visits.py` — НЕ трогать (HTTP-якорь 200, каскад,
   `seats`, 404).
5. Прогнать полный backend pytest — удалить можно только после зелёного
   прогона.

### DoD

- Scenario S3: удалённые имена тестов отсутствуют в дереве; полный
  backend pytest зелёный.
- Scenario S4 + S5: каскад/`seats`/archived/`test_user_settings_auth.py`
  на месте и зелёные; каждая семантика × сервис покрыта хотя бы одним
  тестом (инвентаризация в описании PR).

## Task 4: Домен-правило визитов — выравнивание формулировки

### Classification: trivial

### Required Docs

- `docs/domain-rules/visits.md` (объект правки)

### Work

1. В `docs/domain-rules/visits.md` заменить неточное «None means
   'don't change'» на точную формулировку: «`null` на NOT NULL полях
   (`price`, `status`) игнорируется („не менять"); `null` на nullable
   полях (`visitor_id`, `tariff_id`, `custom_price`) очищает поле».

### DoD

- Формулировка соответствует коду Task 2 и канону `_overview.md`
  (PATCH Contract); противоречия «правило vs код» нет.

---

## Verification (финал, после Task 4)

- `pytest backend/tests/services/test_standalone_patch_contract.py` — зелёный;
- полный backend pytest — зелёный;
- backend lint + typecheck — зелёные;
- в описании PR: инвентаризация «семантика × сервис → каким тестом покрыт»
  (S5) и формулировка «to be closed by the IMPL PR» без `Closes #N` в
  коммитах.
