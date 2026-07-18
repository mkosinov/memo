# Design: ge=1 constraint на ClientListParams.page/per_page

**Date:** 2026-07-18
**Type:** bug fix (validation gap), test debt wave A
**Source:** 4 `xfail(strict=True)` теста в `backend/tests/test_client_stats.py:857-892`
**Related:** #149 (numeric filters ge=0 — OUT of scope, отдельное issue)

## Problem

`ClientListParams` (`backend/src/schemas/client.py:69-87`) не имеет нижней границы на параметрах пагинации:

- `page: int = 1` — принимает `0`, отрицательные
- `per_page: int = Field(default=20, le=100)` — принимает `0`, отрицательные

`page=0` / `per_page=0` / отрицательные значения семантически невалидны, но проходят Pydantic и уходят в сервисный слой (возвращают 200 с пустым списком или мусор). Это дыра валидации API-контракта.

## Approach: A — Direct Pydantic constraints (approved)

Единственный изменяемый прод-код — два поля в схеме:

```python
# backend/src/schemas/client.py
- page: int = 1
- per_page: int = Field(default=20, le=100)
+ page: int = Field(default=1, ge=1)
+ per_page: int = Field(default=20, ge=1, le=100)
```

FastAPI/Pydantic автоматически рендерит 422 с описанием нарушенного constraint. Никаких кастомных валидаторов, никаких изменений в route/service.

## Test Strategy

4 теста уже написаны и зафиксированы как `xfail(strict=True)` (RED-фаза задокументирована):

| Тест | Вход | Ожидание |
|---|---|---|
| `test_page_zero_returns_422` | `page=0` | 422 |
| `test_negative_page_returns_422` | `page=-1` | 422 |
| `test_per_page_zero_returns_422` | `per_page=0` | 422 |
| `test_negative_per_page_returns_422` | `per_page=-5` | 422 |

**DoD:**
1. Снять 4 декоратора `@pytest.mark.xfail` (строки 857-861, 867-870, 876-879, 885-888)
2. Все 4 теста → GREEN после добавления constraints
3. Полный прогон `backend/tests/test_client_stats.py` — 0 failed, 0 xfailed

## Out of Scope

- `ge=0` на numeric-фильтры (`min_records`, `max_records`, `min_paid`, `max_paid`, `missed_from`, `missed_to`) → **#149**
- Любые изменения frontend (всегда шлёт валидные page≥1/per_page≥1)
- Изменение поведения валидных запросов (page=1&per_page=20 → 200 как раньше)

## User Scenarios

- **US-1:** API-потребитель шлёт `GET /api/v1/clients?page=0` → 422 с описанием `ge=1` violation
- **US-2:** API-потребитель шлёт `GET /api/v1/clients?page=-1` → 422
- **US-3:** API-потребитель шлёт `GET /api/v1/clients?per_page=0` → 422
- **US-4:** API-потребитель шлёт `GET /api/v1/clients?per_page=-5` → 422
- **US-5 (регрессия):** `GET /api/v1/clients?page=1&per_page=20` → 200, ответ неизменен

## Visual Compliance Checks

N/A — backend-only, нет UI-изменений.
