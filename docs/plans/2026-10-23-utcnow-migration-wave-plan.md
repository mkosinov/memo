# План #529: волна миграции `datetime.utcnow` → `utc_now()`

## Goal

Убрать класс предупреждений об устаревании `datetime.utcnow()` (~74 303 в
полном backend-прогоне) и застражить возврат: правила DTZ003/DTZ005 с
нулевым бюджетом в рахете #306. Значения времени и поведение не меняются.
Спека: `docs/specs/2026-10-23-utcnow-migration-wave-design.md` (рев.2).

## Architecture

- Backend: FastAPI + SQLAlchemy 2.0.50 + SQLite; конвенция времени — наивный
  UTC; осознанные исключения (aware-сайты, `business_now()`) перечислены в
  спеке п. 4 и не трогаются.
- Новый помощник `backend/src/util/utc.py::utc_now()` — единая точка
  наивного UTC-«сейчас» в src; сосед `src/notify/time.py::business_now()`
  (бизнес-настенное, #482) остаётся, докстринги перекрёстно связаны.
- Страж: `backend/scripts/lint_budget.py` (рахет #306; бюджеты — литеральные
  константы в скрипте, CI перечитывает базовую версию) + правила
  `DTZ003`/`DTZ005` в `[tool.ruff.lint]` select (`backend/pyproject.toml`).

## Tech Stack

Python 3.12+ (`datetime.UTC`), SQLAlchemy 2.0, ruff 0.15.x, pytest.

## Task 1: Помощник `utc_now()` + юнит-тест + перекрёстные докстринги

### Classification: trivial

### Required Docs

- `docs/specs/2026-10-23-utcnow-migration-wave-design.md` — п. 1 (текст
  модуля, докстринга и перекрёстной ссылки `notify/time.py`).

### Что делается

- Новый модуль `backend/src/util/utc.py` с функцией `utc_now()` ровно в
  формулировке спеки (п. 1), включая докстринг с отсылками к
  `business_now()` и #498.
- Юнит-тест `backend/tests/test_util_utc.py` (чистый, без БД, маркер
  `pure_unit` — «Fast tests, NO database», `backend/pyproject.toml` markers):
  `utc_now()` возвращает наивное значение (`tzinfo is None`), совпадающее с
  UTC-мгновением в допуске ≤2 с.
- В докстринг `backend/src/notify/time.py::business_now()` добавлена
  перекрёстная ссылка на `utc_now()` («для мгновений UTC — utc_now()»).

### DoD

- `cd backend && uv run pytest tests/test_util_utc.py` зелёный.
- Все замены задач 2–3 проходят через эту точку — основа US-1/US-3.

## Task 2: Волна в src — вызовы, ORM-ссылки, проза, нормализация aware-записей

### Classification: standard

### Required Docs

- Спека (выше) — п. 2 (вызовы), п. 3 (ORM-ссылки), п. 4 (нормализация и
  список осознанных исключений), п. 5 (проза).

### Что делается

- 26 вызовов `datetime.utcnow()` → `utc_now()`, замена по вхождениям,
  импорт по месту в стиле соседних модулей: `auth/service.py` (11),
  `usecases/password_setup.py` (4), `notify/scenarios.py` (3),
  `auth/{session,otp,otp_service}.py`, `services/{user_settings,payment,staff}.py`,
  `notify/journal.py`.
- 8 ORM-ссылок на 6 строках → `default=utc_now` / `onupdate=utc_now`:
  `models/abstract.py:24,27` (3 ссылки), `models/master.py:45,48` (3),
  `models/audit_log.py:30`, `auth/password_setup.py:60`.
- Проза в src → `utc_now()`: `services/payment.py:182`,
  `notify/journal.py:22,91`, `src/seed/seed.py:141`.
- Нормализация на помощника: 7 записей `record.updated_at =
  datetime.now(UTC)` (`domain/record_visits.py:50,79`,
  `services/visit.py:252,308,371`, `services/record.py:569,618`) и порог
  чистки `notify/dispatcher.py:250` → `utc_now() - timedelta(...)`.
- НЕ трогать (осознанные исключения спеки п. 4; для `src/notify/time.py` —
  тело и семантика функции, докстринг-ссылка из Task 1 разрешена):
  `notify/dispatcher.py:121,129`, `notify/scenarios.py:63`,
  `notify/snapshots.py:45`, `alembic/versions/dc47abd1ad2d_…py:48`,
  `src/notify/time.py`.

### DoD

- `grep -rn 'datetime\.utcnow' src` → 0.
- Юнит-семейства auth/OTP/токенов (`tests/test_auth_service.py`,
  `tests/test_auth_otp.py`, `tests/test_password_setup_tokens.py`,
  `tests/usecases/test_password_setup.py`) зелёные без правок ожиданий —
  замена не меняет значения (основа US-3).

## Task 3: Волна в tests — вызовы, наивные `now()`, проза

### Classification: standard

### Required Docs

- Спека (выше) — п. 2 (пословная замена), п. 4 (4 нормализации), п. 5
  (проза и критерий чистоты).

### Что делается

- 55 вызовов `datetime.utcnow()` в 15 тест-файлах → `utc_now()`, по
  вхождениям (не по строкам), импорт по месту в стиле соседних модулей:
  в `tests/test_password_setup_tokens.py:245` два вызова на одной строке.
  Крупнейшие: `test_auth_service.py` (15),
  `test_password_setup_tokens.py` (7 строк / 8 вызовов), `test_auth_otp.py`
  (5).
- 4 вызова `datetime.now()` без зоны в
  `tests/test_location_short_title.py:49,50,65,66` → `utc_now()`
  (нормализация локального → UTC; ассерты файла значения не сравнивают).
- Проза → `utc_now()`: `tests/test_notify_journal_transactional.py:181`,
  `tests/services/test_generic_service_contract.py:341`,
  `tests/services/test_standalone_patch_contract.py:559`.

### DoD

- `grep -rn 'datetime\.utcnow' src tests` → 0 — критерий чистоты спеки
  (п. 5); вместе с Task 2 волна закрыта полностью (US-1).

## Task 4: Страж — select + нулевые бюджеты (одним PR с волной)

### Classification: trivial

### Required Docs

- Спека (выше) — п. 6 (две части стража, атомарность, обоснование
  исключения DTZ001).

### Что делается

- `backend/pyproject.toml`, `[tool.ruff.lint]` select: добавить `"DTZ003"`,
  `"DTZ005"`.
- `backend/scripts/lint_budget.py`, словарь `RUFF_BUDGET`: добавить
  `"DTZ003": 0`, `"DTZ005": 0` (литеральные константы; проверка роста против
  merge-base-версии скрипта — новые нулевые ключи проходят).
- Порядок в ветке: задачи 2–3 (волна) до этого шага — иначе select при
  живых вызовах даёт красный промежуточный CI (атомарность, спека п. 6).

### DoD

- `cd backend && uv run python scripts/lint_budget.py` зелёный.
- Негативная проба (US-2): временно вставить `datetime.utcnow()` в любой
  src-файл → скрипт красный по DTZ003; убрать вставку, вернуть зелёный.

## Task 5: Полная верификация — чистая сводка + регрессия

### Classification: small

### Required Docs

- Спека (выше) — раздел «Тестирование и страж» целиком.

### Что делается

- Полный `cd backend && uv run pytest -q` зелёный; в warnings summary нет
  записей класса `DeprecationWarning: ...utcnow()...` — было ~74 303, стало
  0, включая пути ORM-дефолтов.
- e2e regression: оба шарда зелёные, без правок фикстур и базлайнов —
  канон-сид и значения не менялись.
- CI: джобы backend-прогона и lint-budget зелёные на PR.

### DoD

- Полный backend-прогон в CI зелёный с чистой сводкой (US-1).
- E2E regression-шарды зелёные без правок фикстур (US-3).
- lint-budget джоба зелёная (US-2).
