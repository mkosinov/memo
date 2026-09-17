# План: ge=0 для числовых фильтров ClientListParams — #149

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Шесть числовых фильтров статистики `GET /api/v1/clients` (`min_records`, `max_records`, `min_paid`, `max_paid`, `missed_from`, `missed_to`) получают нижнюю границу `ge=0`: отрицательные значения отвечают 422, ноль и отсутствие параметра работают как раньше.

**Architecture:** Изменение — только входная валидация: schema-level `Field(default=None, ge=0)` на шести полях `ClientListParams` (backend/src/schemas/client.py:145–150). SQL/сервисный слой, фронтенд и миграции не затрагиваются. 422 отдаётся штатным путём FastAPI с кастомным обработчиком (`backend/src/main.py:163–180`): тело `{detail: {code, message}}`.

**Tech Stack:** FastAPI (Depends()-params модель) + Pydantic v2 `Field`; pytest (backend/tests).

**Спека:** `docs/specs/2026-09-17-client-filters-ge0-design.md` (rev2). Сценарии — спецификация §3 (User Scenarios 1–3), тесты — §4, DoD — §8.

---

## Behavioral Delta

Как ведёт себя фича для юзера, по критериям спеки (E2E-уровень для backend-only = API-интеграционные тесты):

- **S1 «Отрицательный фильтр отклонён»** → запрос списка клиентов с отрицательным значением любого из шести фильтров (`min_records=-5` и т.п.) отвечает 422 («Проверьте правильность заполнения полей» на фронте); молчаливый пустой фильтр исчезает.
- **S2 «Ноль легален»** → фильтр «Пропущенные: до 0» и любой другой из шести с нулём работает как сейчас (200, фильтрация по прежней семантике).
- **S3 «Штатные фильтры не сломались»** → существующие позитивные фильтры (`min_records=2`+`max_records=4`, `missed_to=0` и др.) и запросы без фильтров отвечают как раньше; всё остальное API `/clients` без изменений.

**Параллельные IMPL:** соседние задачи (#257, #285, #286) трогают другие области; этот план — только `schemas/client.py` + тесты, конфликтов на мерже не ожидается.

---

## Task 1: RED — параметризованный тест границы ge=0

### Classification: small

### Required Docs
- `docs/specs/2026-09-17-client-filters-ge0-design.md` §2 (решение и формат 422), §3 (User Scenarios), §4 (параметризация теста)
- `backend/tests/test_api_clients.py` — стиль: классы-методы с `api_client`, `pytestmark = pytest.mark.api`, секции через `───`-сепараторы
- `backend/tests/conftest.py` — фикстура `api_client` (pre-authenticated admin TestClient)

### Steps

- [ ] Append в конец `backend/tests/test_api_clients.py` (после последней секции, новый `───`-сепаратор):

```python
# ─── Client list numeric stat filters: ge=0 bounds (GH #149, spec §2/§3) ──────

_STAT_FILTER_FIELDS = [
    "min_records",
    "max_records",
    "min_paid",
    "max_paid",
    "missed_from",
    "missed_to",
]


class TestClientListStatFilterBounds:
    """GH #149: numeric stat filters reject negatives (ge=0), accept zero."""

    @pytest.mark.parametrize("value", [-1, -42])
    @pytest.mark.parametrize("field", _STAT_FILTER_FIELDS)
    def test_negative_stat_filter_returns_422(self, api_client, field: str, value: int) -> None:
        """GET /clients with a negative stat filter → 422 (ge=0, spec §3.1)."""
        resp = api_client.get("/api/v1/clients", params={field: value})
        assert resp.status_code == 422

    @pytest.mark.parametrize("field", _STAT_FILTER_FIELDS)
    def test_zero_stat_filter_is_accepted(self, api_client, field: str) -> None:
        """GET /clients with a stat filter = 0 is a valid request (spec §3.2)."""
        resp = api_client.get("/api/v1/clients", params={field: 0})
        assert resp.status_code == 200

    def test_422_body_is_custom_handler_shape(self, api_client) -> None:
        """422 body comes from the custom RequestValidationError handler (spec §2)."""
        resp = api_client.get("/api/v1/clients", params={"min_records": -1})
        assert resp.status_code == 422
        body = resp.json()
        assert "code" in body["detail"]
        assert "message" in body["detail"]
```

- [ ] Run RED: `cd backend && uv run pytest "tests/test_api_clients.py::TestClientListStatFilterBounds" -q`
- [ ] Expected: **13 failed, 6 passed** — 12 негативных кейсов и body-shape кейс падают (`assert resp.status_code == 422` при текущем 200 = тихий no-op, спека §1); 6 нулевых кейсов зелёны сразу (граница «ноль принимается» существует и до изменения — они якорь против будущего сдвига до `ge=1`).
- [ ] Commit: `test(#149): RED — parameterized ge=0 bounds tests for client stat filters`

### DoD
- Тест-класс существует, параметры соответствуют спеке §4 (6 полей × `-1`/`-42` → 422; 6 × `0` → 200; body-shape на `min_records`).
- RED зафиксирован: негативные кейсы падают, нулевые зелёные.
- E2E (API) test for scenario 1: RED-фаза выполнена (GREEN наступает в Task 2 — RED-GREEN-REFACTOR цикл растянут на две задачи сознательно).

---

## Task 2: GREEN — Field(ge=0) на шести полях

### Classification: trivial

### Required Docs
- `docs/specs/2026-09-17-client-filters-ge0-design.md` §2 (решение, наследование `PaginationParams` — `ge=1` дублировать не нужно)
- `backend/src/schemas/client.py` — блок полей `ClientListParams` (:145–150) и комментарий-ловушка о model-level валидаторах (:126–136) — читать, не трогать

### Steps

- [ ] В `backend/src/schemas/client.py` в классе `ClientListParams` заменить блок:

```python
    min_records: int | None = None
    max_records: int | None = None
    min_paid: int | None = None
    max_paid: int | None = None
    missed_from: int | None = None
    missed_to: int | None = None
```

на:

```python
    # GH #149: numeric stat filters are counts/sums — negatives are meaningless
    # (today they degrade to a silent SQL no-op like `records_count >= -5`);
    # zero is legal (e.g. missed_to=0 = "no missed records"). Schema-level
    # Field(ge=0) maps to 422 for Depends() query params; model-level
    # validators are forbidden here (500-trap, see phone comment above).
    min_records: int | None = Field(default=None, ge=0)
    max_records: int | None = Field(default=None, ge=0)
    min_paid: int | None = Field(default=None, ge=0)
    max_paid: int | None = Field(default=None, ge=0)
    missed_from: int | None = Field(default=None, ge=0)
    missed_to: int | None = Field(default=None, ge=0)
```

(`Field` уже импортирован в модуле — используется `q` и `phone` выше.)

- [ ] Run GREEN: `cd backend && uv run pytest "tests/test_api_clients.py::TestClientListStatFilterBounds" -q` → **19 passed**.
- [ ] Регрессия позитивных фильтров: `cd backend && uv run pytest tests/test_client_stats.py -q` → все зелёные (это сценарии 2–3 спеки: `missed_to=0` и комбинированные фильтры уже покрыты, :850–892).
- [ ] Commit: `fix(api): ge=0 bounds on client list stat filters (GH #149)` — в теле коммита closing-слова (`Closes #149`) НЕ писать, закрытие уезжает в PR-описании.

### DoD
- E2E (API) test for scenario 1 passes (RED-GREEN-REFACTOR): негативные кейсы зелёные.
- E2E (API) test for scenario 2 passes: нулевые кейсы зелёные.
- E2E (API) test for scenario 3 passes: существующий набор `test_client_stats.py` зелёный.
- Схема содержит ровно шесть `Field(ge=0)`; `page`/`per_page` не тронуты (`git diff` не содержит изменений `pagination.py`).

---

## Task 3: Регрессия, линт/тайпчек, CHANGELOG

### Classification: small

### Required Docs
- `docs/specs/2026-09-17-client-filters-ge0-design.md` §8 (DoD чек-лист)
- `CHANGELOG.md` — формат Keep a Changelog, секция `## [Unreleased] — 2026-09-17`
- `.github/workflows/test.yml` — бэкенд в CI = pytest-группы `unit|api|integration|misc` (метки в pyproject `[tool.pytest.ini_options]`)

### Steps

- [ ] Полная регрессия группы api: `cd backend && uv run pytest -m api -q` → все зелёные.
- [ ] Линт: `cd backend && uv run ruff check src tests` → чисто.
- [ ] Тайпчек: `cd backend && uv run mypy src` → чисто.
- [ ] CHANGELOG.md: в существующую секцию `## [Unreleased] — 2026-09-17` добавить буллет (формат — как соседние строки секции):

```markdown
- fix(api): числовые фильтры статистики /clients (records/paid/missed) отвергают отрицательные значения — `ge=0` → 422 (GH #149)
```

- [ ] Final check: `cd backend && uv run pytest tests/test_api_clients.py tests/test_client_stats.py -q` → зелёные.
- [ ] Commit: `chore(#149): changelog + green-check of ge=0 bounds`
- [ ] PR-описание (делает менеджер IMPL): содержит `Closes #149` — единственное легальное место closing-ключевого слова.

### DoD
- Группа `api` целиком зелёная; линт и тайпчек чисты; CHANGELOG-строка добавлена.
- Спека §8 DoD-чеклист выполнен полностью.

---

## Памятка для IMPL

- Файл спеки самодостаточен: премиссы issue устаревшего контекста (xfail) пересчитаны в спеке §6 — искать xfail-тесты НЕ нужно.
- Не менять `backend/src/services/client.py` и фронтенд: скоуп = schema + тесты (спека §5).
- Пользовательский эффект на фронте — общий тост «Проверьте правильность заполнения полей» (кастомный обработчик main.py:163–180); поле в теле 422 не называется — это принятый trade-off (спека §2/§5).
