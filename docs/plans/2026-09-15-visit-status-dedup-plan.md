# VisitStatus Dedup Implementation Plan (#134)

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Один enum `VisitStatus` в `backend/src/domain/visit_status.py` и ноль сырых статусных литералов в рабочем коде `backend/src`; поведение API не меняется (одна задокументированная микродельта — см. Behavioral Delta).

**Architecture:** Удаляем дублирующее определение enum из `models/enums.py`, перепривязываем двух потребителей схем на доменную копию, заменяем сырые строки-статусы членами enum в services и seed. БД не затрагивается: колонки статусов — `String(20)` без SQL-enum, миграций нет. Регрессия якорится существующими e2e (S1–S6) и API-тестом (S7) — новых тестов спека не требует. Порядок задач = порядку исполнения (Task 2 и Task 3 после Task 1: общий grep-критерий).

**Tech Stack:** Python 3.11+, FastAPI (Pydantic v2), SQLAlchemy 2.0, pytest (`uv run --extra dev` из `backend/`), Playwright e2e (`frontend/admin/`).

Закрытие issue #134 — только через описание IMPL PR; closing-слова (Closes/Fixes/Resolves) в сообщениях коммитов запрещены.

---

## Behavioral Delta

Как это поведёт себя для пользователя, по критериям спеки (`docs/specs/2026-09-15-visit-status-dedup-design.md`):

- **Фильтр записей по статусу (спека §2.3):** работает как раньше на тех же четырёх значениях (`waiting`/`visited`/`missed`/`cancelled`); единственная разница — вариант «капсом» именем статуса (`CANCELLED`) теперь тоже принимается, а раньше возвращал ошибку 422.
- **Всё остальное — без изменений (спека §3):** списки и бейджи статусов, пересчёт статуса записи при смене статуса визита, счётчик «пропущено» в списке клиентов, занятость занятий, пикеры статусов — ровно как сегодня; сценарии S1–S7 — якоря регрессии.

---

## Task 1: Перепривязка схем на канон и удаление дубля enum
### Classification: small
### Required Docs
- `docs/specs/2026-09-15-visit-status-dedup-design.md` — §2.1 (канон и перепривязка) и §2.3 (замена Literal на enum); это источник решений, задача их исполняет
- `docs/domain-rules/visits.md`, `docs/domain-rules/records.md` — контекст статуса визита и выводимого статуса записи; семантика не меняется, читать для понимания домена

**Files:** `backend/src/schemas/visit.py`, `backend/src/schemas/record.py`, `backend/src/models/enums.py`

**Steps:**
- [ ] 1. `backend/src/schemas/visit.py` (строка 5): заменить `from src.models.enums import VisitStatus` на `from src.domain.visit_status import VisitStatus`. Остальные импорты файла не трогать.
- [ ] 2. `backend/src/schemas/record.py` (строка 8): та же замена импорта.
- [ ] 3. `backend/src/schemas/record.py` (строка ~143): удалить определение `RecordStatusFilter = Literal["waiting", "visited", "missed", "cancelled"]`; поле фильтра (строка ~159) аннотировать типом `VisitStatus` напрямую; убрать `Literal` из импорта `typing`, если в файле больше не осталось использований.
- [ ] 4. `backend/src/models/enums.py` (строки 18–22): удалить `class VisitStatus(str, enum.Enum)` с четырьмя членами. Импорт `enum` в файле НЕ трогать — остальные enum его используют. Остальные enum (UserRole, RecordStatus, PaymentMethod, Channel, ArchiveStatus) не трогать.
- [ ] 5. Проверить грепы (обе команды должны вывести пусто):
```bash
grep -rn "models.enums" backend/src --include='*.py' | grep -i visit
grep -rn "RecordStatusFilter" backend/src --include='*.py'
```
- [ ] 6. Прогнать затронутые API-тесты:
```bash
cd backend && uv run --extra dev pytest tests/test_api_visits.py tests/test_api_records.py -q
```
Ожидание: все passed, 0 failed (состав тестов не менялся).
- [ ] 7. Commit: `git commit -m "refactor(#134): схемы VisitStatus перепривязаны на src.domain.visit_status, дубль из models/enums.py удалён"`

**DoD:** оба грепа из шага 5 пусты; тесты шага 6 зелёные; в `backend/src/models/enums.py` нет `VisitStatus`.

---

## Task 2: Свип сырых литералов в продакшен-коде
### Classification: small
### Required Docs
- `docs/specs/2026-09-15-visit-status-dedup-design.md` — §2.2 (политика свипа: что меняем, что осознанно остаётся строками) и §2.4 (почему члены enum безопасны для строковых колонок и сериализации)
- `docs/domain-rules/clients.md` — контекст счётчика «пропущено» в списке клиентов (место `client.py:117`)
- `docs/domain-rules/records.md` — контекст дефолта статуса визита при сборке visit-_items

**Files:** `backend/src/services/client.py`, `backend/src/services/record.py`, `backend/src/seed/seed.py`

**Steps:**
- [ ] 1. `backend/src/services/client.py`: добавить `from src.domain.visit_status import VisitStatus` (если импорта ещё нет); строка 117: `Record.status == "missed"` → `Record.status == VisitStatus.MISSED`.
- [ ] 2. `backend/src/services/record.py`: добавить ОТДЕЛЬНЫЙ импорт `from src.domain.visit_status import VisitStatus` — сегодня файл импортирует `src.domain.dates` (:12), `src.domain.deletion` (:13) и `src.domain.record_visits` (:20), но НЕ `visit_status`; существующий импорт `record_visits` не трогать (прямой импорт enum обязателен, §2.1 спеки — не через `record_visits`). Строка 712: `visit_item.get("status", "waiting")` → `visit_item.get("status", VisitStatus.WAITING)`.
- [ ] 3. `backend/src/seed/seed.py`: добавить импорт `VisitStatus`; строки 432–437 (словари записей, 6 литералов) и 445–454 (словари визитов, 10 литералов): каждое значение `"status": "<lit>"` заменить членом enum (`VisitStatus.VISITED`, `VisitStatus.WAITING`, ...). Ключи словарей и структуру не менять.
- [ ] 4. Grep-критерий спеки (§5.3). Легаси-член `RecordStatus.CANCELLED = "cancelled"` в `models/enums.py:14` намеренно остаётся (спека §2.1/§4: RecordStatus не трогаем), поэтому исключаем файл явно; ожидание — совпадения ТОЛЬКО в `backend/src/domain/visit_status.py`:
```bash
grep -rnE "[\"'](waiting|visited|missed|cancelled)[\"']" backend/src --include='*.py' | grep -v '/tests/' | grep -v '/alembic/' | grep -v 'models/enums.py'
```
- [ ] 5. Прогнать целевые тесты (включая якорь S7):
```bash
cd backend && uv run --extra dev pytest tests/test_client_stats.py tests/test_compute_record_status.py tests/test_record_visits.py -q
```
Ожидание: все passed, 0 failed.
- [ ] 6. Commit: `git commit -m "refactor(#134): сырые литералы статусов в backend/src заменены членами VisitStatus (services/client, services/record, seed)"`

**DoD:** grep шага 4 чист (совпадения только в `domain/visit_status.py`); тесты шага 5 зелёные — включая API-тест `test_client_stats.py` (якорь сценария S7 спеки).

---

## Task 3: Регресс-верификация (pytest + e2e S1–S6) и CHANGELOG
### Classification: standard
### Required Docs
- `docs/specs/2026-09-15-visit-status-dedup-design.md` — §3 (таблица сценариев S1–S7 с якорями) и §5 (критерии готовности)
- `CHANGELOG.md` — формат записи (Keep a Changelog: секция `[Unreleased] — дата`, подраздел `### Changed`)

**Files:** `CHANGELOG.md` (только он; кодовых правок в задаче нет)

**Steps:**
- [ ] 1. Полный бэкенд-прогон:
```bash
cd backend && uv run --extra dev pytest -q
```
Ожидание: 0 failed.
- [ ] 2. E2E-якоря сценариев спеки (из `frontend/admin/`; файлы-якоря не входят в известное локальное семейство флейков visual-baseline `visual-regression.spec.ts`/`wave6-status-snapshots.spec.ts` — их падения к #134 не относятся):
```bash
cd frontend/admin
npx playwright test e2e/wave6-record-status-derived.spec.ts   # S1
npx playwright test e2e/admin-changes-status.spec.ts          # S2
npx playwright test e2e/records.spec.ts                       # S3
npx playwright test e2e/wave6-status-shared.spec.ts           # S4
npx playwright test e2e/occupied-calc.spec.ts                 # S5
npx playwright test e2e/records-view.spec.ts                  # S6
```
Ожидание: все passed. (E2E test for scenarios S1–S6 passes; S7 покрыт API-тестом из Task 2. Цикл RED-GREEN-REFACTOR не применяется: это рефакторинг, новые тесты спека §4 не требует — якоря уже существуют.)
- [ ] 3. Финальные критерии спеки §5 (каждая команда — ожидание в комментарии):
```bash
grep -rn "VisitStatus" backend/src/models/enums.py            # пусто
grep -rn "RecordStatusFilter" backend/src --include='*.py'    # пусто
grep -rn "from src.models.enums import VisitStatus" backend/src  # пусто
grep -rn "class VisitStatus" backend/src --include='*.py'     # ровно одно совпадение: backend/src/domain/visit_status.py
```
- [ ] 4. `CHANGELOG.md`: добавить новую секцию сразу после строки `---` (перед текущей `[Unreleased] — 2026-09-14`):
```markdown
## [Unreleased] — 2026-09-15

### Changed
- **#134 — tech-debt: единый enum `VisitStatus` (канон `src/domain/visit_status.py`); дубль из `models/enums.py` удалён, сырые литералы статусов в `backend/src` (schemas/services/seed) заменены членами enum** — поведение не меняется; единственная дельта: фильтр записей по статусу принимает и имя статуса капсом (`CANCELLED`), раньше — 422. Тесты и миграции намеренно остались на строках (спека §2.2). Tests: полный pytest + e2e-якоря S1–S6 и API-якорь S7 зелёные.
  - Closes: #134.
  - Design spec: `docs/specs/2026-09-15-visit-status-dedup-design.md`
  - Plan: `docs/plans/2026-09-15-visit-status-dedup-plan.md`
```
- [ ] 5. Commit: `git commit -m "docs(changelog): #134 — запись о дедупликации VisitStatus"`

**DoD:** полный pytest зелёный; e2e-якоря S1–S6 зелёные, API-якорь S7 зелёный (из Task 2); грепы шага 3 чисты; запись CHANGELOG добавлена по формату файла.
