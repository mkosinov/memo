# GH #529 — волна миграции `datetime.utcnow()` → `utc_now()` + страж DTZ003/DTZ005 (шум DeprecationWarning в backend-прогоне обнулён)

- **Date**: 2026-10-24
- **Branch**: `529-utcnow-wave`
- **Status**: Completed (PR pending; CI-watch/merge — на finishing/@manager)
- **Range**: base `5637e68b` — 5 коммитов (`d6583f98..2f29dae2`), 42 файла, +195/−127
- **Issue**: #529 — волна миграции `datetime.utcnow()` → единый наивный UTC-помощник + страж возврата (backend-only, UI не меняется)
- **Спека**: `docs/specs/2026-10-23-utcnow-migration-wave-design.md` рев.2 — Visual Compliance: N/A (backend-only)
- **План**: `docs/plans/2026-10-23-utcnow-migration-wave-plan.md` — 5/5 задач
- **Характер**: чистка + страж — значения времени и поведение не меняются, осознанные исключения спеки п. 4 не тронуты

## Проблема

Полный backend-прогон выдаёт ~74 303 предупреждения одного класса:
`DeprecationWarning: datetime.utcnow() is deprecated` — вызов устарел с
Python 3.12 (проект пинит `requires-python = ">=3.12"`). Шум одного класса
глушит сводку: любые НОВЫЕ предупреждения перестают быть видимым сигналом.
Идиом «сейчас» в проекте четыре (наивный `utcnow()` — 81 вызов; aware
`now(UTC)` — 12 мест в src; наивный локальный `now()` — 4 вызова в одном
тест-файле; бизнес-настенный `business_now()` #482 — легитимно живёт своей
жизнью); решением Gate A (2026-10-23) выбрана волна миграции с сохранением
наивного времени — aware-время и часовые пояса остаются задачей #498.

## Что выполнено

1. **Помощник + юнит-тест + перекрёстные докстринги (T1 `d6583f98`, trivial)** —
   новый модуль `backend/src/util/utc.py::utc_now()` — единая точка наивного
   UTC-«сейчас» в src (имя `utc.py`, не `time.py` — чтобы не дублировать
   `src/notify/time.py` с другой семантикой); чистый юнит-тест
   `backend/tests/test_util_utc.py` (маркер `pure_unit`: `tzinfo is None` +
   совпадение с UTC-мгновением в допуске ≤2 с); перекрёстные ссылки в
   докстрингах `utc_now()` ↔ `business_now()` (мгновения UTC vs бизнес-стена;
   #498 — следующий шаг).
2. **Волна src (T2 `d6be088c`, standard)** — 26 вызовов `datetime.utcnow()` →
   `utc_now()` (`auth/service.py` 11, `usecases/password_setup.py` 4,
   `notify/scenarios.py` 3 и хвосты); 8 ORM-ссылок вне вызовов на 6 строках →
   `default=utc_now` / `onupdate=utc_now` (`models/abstract.py` — базовая
   модель, `models/master.py`, `models/audit_log.py`, `auth/password_setup.py`);
   проза (докстринги/комментарии) в `services/payment.py`, `notify/journal.py`,
   `src/seed/seed.py`; нормализация 7 aware-записей `record.updated_at =
   datetime.now(UTC)` (`domain/record_visits.py`, `services/visit.py`,
   `services/record.py`) и порога чистки `notify/dispatcher.py` на помощника —
   хранимые значения в любом случае наивные (SQLite срезает зону), дельты нет.
   Осознанные исключения спеки п. 4 (`notify/dispatcher.py:121,129`,
   `notify/scenarios.py:63`, `notify/snapshots.py:45`, миграция
   `dc47abd1ad2d`, `business_now()`) не тронуты.
3. **Волна tests (T3 `74d2e8f9`, standard)** — 55 вызовов в 15 тест-файлах →
   `utc_now()`; 4 наивных локальных `now()` в `test_location_short_title.py`
   → помощник (четвёртый идиом схлопнут); проза в 3 файлах. Ожидания
   фикстур/базлайнов не правились — значения не менялись.
4. **Внеплановый фикс докстринга (mid-phase `c04ebed6`)** — «НЕ» → «не» в
   докстринге `utc_now()`: кириллические Н/Е — конфузаблы латинских H/E для
   RUF002, факт 6 > бюджет 4 — lint-budget CI был бы красным. **Задокументированная
   девиация от спеки**: текст спеки п. 1 содержал «НЕ», реализация — строчное
   «не»; семантика не изменилась.
5. **Страж возврата (T4 `2f29dae2`, trivial)** — `DTZ003`/`DTZ005` в ruff
   `select` (`backend/pyproject.toml`) + нулевые бюджеты в
   `backend/scripts/lint_budget.py` (рахет #306): любой новый `utcnow()`/
   `utcfromtimestamp()` или наивный `now()` в backend-коде красит CI.
   Полная верификация (T5) — без правок кода, см. таблицу.

## Верификация

| Проверка | Результат |
| --- | --- |
| Полный backend-прогон (T5) | **3632 passed / 0 failed / 44 skipped** (24:14, exit 0) |
| Warnings summary | записей класса `DeprecationWarning: ...utcnow()...` = **0** (было ~74 303), включая пути ORM-дефолтов |
| Юнит-семейства auth/OTP/токенов | **80/80** без правок ожиданий |
| Волна-tests файлы (T3) | **280/0** |
| lint-budget (рахет #306) | **зелёный** — DTZ003/DTZ005 = 0 |
| Негативная проба US-2 | вставка `utcnow()` → **красный по DTZ003**, откат → зелёный |
| US-1 (чистая сводка) | ✅ локально; CI подтвердит на PR |
| US-3 (регрессия) | фикстуры/базлайны не тронуты — diff не содержит `e2e/`-файлов; e2e-шарды — гейт PR CI |

Приёмка спеки (DoD): US-1/US-2 закрыты локально; US-3 — e2e-шарды и джобы
CI на PR-стадии (@manager/finishing).

## Вне скоупа (остаются в warnings summary, существующие классы)

15× `PytestWarning` (`mark.asyncio` на не-async функциях в
`test_archive`/`master`/`user_service`) и 1× `DeprecationWarning` `athrow()`
(`test_database.py`) — к utcnow-волне не относятся, не тронуты.

## PR-заметки

- `Closes #529` — только в описании PR (канон репо), в коммиты не пишется.
- Behavioral delta: нулевая — значения времени и поведение не меняются
  (наивный UTC сохранён; aware-исключения на месте); единственная видимая
  дельта — чистая warnings-сводка прогона и страж DTZ003/DTZ005 = 0.
- Задокументированная девиация: докстринг `utc_now()` — «не» вместо «НЕ»
  спеки п. 1 (RUF002-конфузаблы, бюджет 4 — рост запрещён CI); семантика
  без изменений.
- Не менялось: `business_now()` (тело и семантика; только перекрёстная
  докстринг-ссылка), осознанные aware-сайты спеки п. 4, миграции,
  api-client, фронтенд, e2e-фикстуры/базлайны.

## Тронутые файлы (`git diff --numstat 5637e68b..2f29dae2`, 42 файла +195/−127)

```
 2	0	backend/pyproject.toml
 2	0	backend/scripts/lint_budget.py
 2	1	backend/src/auth/otp.py
 2	2	backend/src/auth/otp_service.py
 2	1	backend/src/auth/password_setup.py
12	11	backend/src/auth/service.py
 2	1	backend/src/auth/session.py
 3	4	backend/src/domain/record_visits.py
 3	2	backend/src/models/abstract.py
 2	1	backend/src/models/audit_log.py
 4	3	backend/src/models/master.py
 2	1	backend/src/notify/dispatcher.py
 5	4	backend/src/notify/journal.py
 4	3	backend/src/notify/scenarios.py
 2	0	backend/src/notify/time.py
 1	1	backend/src/seed/seed.py
 3	3	backend/src/services/payment.py
 4	3	backend/src/services/record.py
 2	2	backend/src/services/staff.py
 3	3	backend/src/services/user_settings.py
 4	4	backend/src/services/visit.py
 5	4	backend/src/usecases/password_setup.py
12	0	backend/src/util/utc.py
 1	1	backend/tests/services/test_generic_service_contract.py
 1	1	backend/tests/services/test_standalone_patch_contract.py
 4	2	backend/tests/test_api_payments.py
 2	1	backend/tests/test_api_staff_account.py
 2	1	backend/tests/test_api_users.py
 7	6	backend/tests/test_auth_otp.py
 4	4	backend/tests/test_auth_password_setup_api.py
16	15	backend/tests/test_auth_service.py
 3	2	backend/tests/test_auth_session_model.py
 2	2	backend/tests/test_generic_api_contract.py
 6	8	backend/tests/test_location_short_title.py
 2	1	backend/tests/test_models.py
 5	5	backend/tests/test_my_records_api.py
 4	3	backend/tests/test_notify_journal_transactional.py
 8	8	backend/tests/test_password_setup_tokens.py
 6	3	backend/tests/test_schemas_photo.py
 5	5	backend/tests/test_schemas_user_settings.py
28	0	backend/tests/test_util_utc.py
 6	5	backend/tests/usecases/test_password_setup.py
```

Docs-коммит: `docs/status/2026-10-24-utcnow-migration-wave-529.md` + записи в
CHANGELOG.md и PLAN.md — только мета-доки; код, спека и план не тронуты.

## Scope guards

Прод-поведение, aware-исключения спеки п. 4, `business_now()`, миграции,
api-client, фронтенд — без изменений; спека (рев.2) и план docser не трогал;
DoD уровня PR (зелёный CI: backend-прогон с чистой сводкой US-1, lint-budget
US-2, e2e-шарды US-3) — вне скоупа этого docs-коммита; `Closes #529` — только
в описании PR (канон репо); aware-время и часовые пояса — отдельная задача
#498 (эта волна её не блокирует, а готовит).

## References

- **GitHub Issue**: #529
- **Design Spec**: `docs/specs/2026-10-23-utcnow-migration-wave-design.md` (рев.2)
- **Plan**: `docs/plans/2026-10-23-utcnow-migration-wave-plan.md` (5/5)
- **PR**: _(to be added after PR creation)_
