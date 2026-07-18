# ClientListParams ge=1 Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить `ge=1` constraint на `page`/`per_page` в `ClientListParams` — закрыть дыру валидации, снять 4 xfail-теста.

**Architecture:** Чистый Pydantic-фикс на уровне схемы. FastAPI автоматически возвращает 422 при нарушении constraint. Никаких изменений в route/service.

**Tech Stack:** FastAPI, Pydantic v2, pytest.

**Spec:** `docs/specs/2026-07-18-clientlistparams-ge1-design.md`

---

## Behavioral Delta

How this feature behaves, mapped to spec acceptance criteria:

- **US-1..US-4: page/per_page = 0 или отрицательные** → API возвращает 422 с описанием нарушенного constraint (вместо текущего 200 с пустым/мусорным ответом)
- **US-5 (регрессия): валидные page=1/per_page=20** → 200, ответ неизменен — существующее поведение не ломается

---

## Task 1: Add ge=1 constraints + un-xfail 4 tests

### Classification: small

(1 файл прод-кода, ~2 строки изменений; 1 тест-файл, снятие 4 декораторов; spec-review only)

### Required Docs
- `docs/specs/2026-07-18-clientlistparams-ge1-design.md` — spec, user scenarios, DoD
- Skill: `pytest-patterns` — перед запуском тестов

### Files
- Modify: `backend/src/schemas/client.py` (строки 72-73 — поля page/per_page)
- Modify: `backend/tests/test_client_stats.py` (строки 857-892 — снять 4 `@pytest.mark.xfail`)

### Task Description

**Part 1 — GREEN (прод-код):**

В `backend/src/schemas/client.py` изменить два поля в `ClientListParams`:

```python
# было (строки 72-73):
    page: int = 1
    per_page: int = Field(default=20, le=100)

# станет:
    page: int = Field(default=1, ge=1)
    per_page: int = Field(default=20, ge=1, le=100)
```

`Field` уже импортирован в файле (используется на строке 73). Новых импортов не нужно.

**Part 2 — снять xfail (RED→GREEN фиксация):**

В `backend/tests/test_client_stats.py` снять 4 декоратора `@pytest.mark.xfail(...)` в классе `TestClientListPaginationEdgeCases`:
- строки 857-861 (`test_page_zero_returns_422`)
- строки 867-870 (`test_negative_page_returns_422`)
- строки 876-879 (`test_per_page_zero_returns_422`)
- строки 885-888 (`test_negative_per_page_returns_422`)

Сами тела тестов НЕ менять — они уже написаны корректно (ожидают 422).

### Steps

- [ ] 1. Подтвердить RED: запустить `cd backend && uv run pytest tests/test_client_stats.py::TestClientListPaginationEdgeCases -q` — 4 xfailed (strict), остальные passed
- [ ] 2. Изменить `page`/`per_page` в `backend/src/schemas/client.py` (diff выше)
- [ ] 3. Снять 4 `@pytest.mark.xfail` декоратора в `tests/test_client_stats.py`
- [ ] 4. GREEN: `cd backend && uv run pytest tests/test_client_stats.py::TestClientListPaginationEdgeCases -q` — все тесты класса passed, 0 xfailed
- [ ] 5. Регрессия US-5: `cd backend && uv run pytest tests/test_client_stats.py -q` — весь файл passed, 0 xfailed, 0 failed
- [ ] 6. Полный backend: `cd backend && uv run pytest -q` — 0 failed (было 664 passed + 4 xfailed → станет 668 passed + 0 xfailed)
- [ ] 7. Commit: `fix(backend): add ge=1 constraint to ClientListParams page/per_page — un-xfail 4 tests`

### DoD
- [ ] 4 бывших xfail-теста GREEN (422 на page=0/-1, per_page=0/-5)
- [ ] 0 xfailed во всём backend test suite
- [ ] US-5: валидные запросы возвращают 200 (регрессии нет)
- [ ] Полный `pytest -q` зелёный
