# GH #306 — Бэкенд lint/mypy рахет-гейт + волновая чистка до нуля (волна 0)

- **Date**: 2026-10-08
- **Branch**: `306-backend-lint-mypy-ratchet`
- **Status**: Волна 0 completed (PR pending) — multi-wave feature: волны 1–9 (задачи 4–9 плана) идут следующими PR после мержа этого
- **Range**: base `93dbba1a` — 3 коммита (`a949d09c..e58bf6f6`), 73 файла, +805/−197
- **Issue**: #306 — остановить рост долга статических проверок бэкенда (ruff 272 / mypy 531 на старте) и обнулить его волнами
- **Spec**: `docs/specs/2026-10-08-backend-lint-mypy-ratchet-306-design.md`
- **Plan**: `docs/plans/2026-10-08-backend-lint-mypy-ratchet-306-plan.md` (9 задач; в этом PR — задачи 1–3)

## Goal

Немедленный CI-рахет-гейт останавливает рост lint/mypy-долга бэкенда, а волна 0 делает первый безопасный шаг чистки (B008 → 0 конфигом + безопасные автоправки ruff) и фиксирует пороги = факту. Поведение прод-кода не менялось — только конфиг линтера, автоправки импортов/стиля и test-infra.

## Summary of Changes (per task)

- **T1 — скрипт бюджета `backend/scripts/lint_budget.py` (small, `a949d09c`):** единственный
  исполнитель обоих инструментов и владелец их exit-кодов: `ruff check src tests scripts
  --output-format json` (пороги per-rule словарём) + `mypy src --no-incremental` (тотал из
  итоговой строки `Found N errors`). Правила сравнения: факт > порога → красный («PR добавил
  ошибок»), факт < порога → красный («опусти порог до F»), равенство → зелёный; fail-closed на
  поломке инструмента (неожиданный exit-код / пустой-непарсимый вывод → exit 1 «инструмент
  сломан»). Запрет роста порогов в CI: скрипт читает пороги из базы
  (`git show <merge-base>:…`, для пуша в main — `HEAD~1`) и краснеет на рост любого; файла в
  базе нет → создание (волна 0) разрешено. Отчёты обоих инструментов печатаются всегда, без
  короткого замыкания. Юнит-тесты `tests/test_lint_budget.py` — 33 кейса.
- **T2 — джоба `backend-lint` в `.github/workflows/test.yml` (small, `1a206559`):** рядом с
  `backend-coverage`, без `needs` (быстрый сигнал параллельно тестам); триггеры как у workflow
  (`pull_request` + `push` в main); шаги checkout (`fetch-depth: 0` — для чтения базы) →
  `uv sync --extra dev` → `uv run python scripts/lint_budget.py` из `backend/`.
- **T3 — волна 0: конфиг B008 + безопасные автоправки + пороги = факту (small, `e58bf6f6`):**
  в `backend/pyproject.toml` — `[tool.ruff.lint.flake8-bugbear] extend-immutable-calls`
  (fastapi.Depends/Query/Body/File/Form/Header/Path/Cookie/Security) — B008 37 → 0 без правок
  кода; затем `ruff check --fix` — только safe-фиксы по 71 файлу: I001 −44, F401 −29 (мёртвые
  импорты, проверено ревью), RUF100 16 → 3, UP037 −11, W292 −9, F811 −4 (мёртвые дубликаты,
  проверено ревью). Пороги в скрипте пересняты = фактическим счётчикам после волны:
  **ruff per-rule суммарно 119, mypy 531** (mypy в волне 0 не трогался — осознанно).

## Рахет-счётчики (до → после волны 0)

| Инструмент | Было | Стало | Порог в скрипте |
|---|---|---|---|
| ruff (сумма per-rule) | 272 | **119** | 119 (= факту) |
| — в т.ч. B008 | 37 | **0** | 0 |
| mypy (тотал) | 531 | **531** | 531 (= факту) |

## Test Results

- Полный pytest-сьют: **3179 passed / 0 failed / 15 skipped** (detached, 40:25) — авто-правки
  импортов в FastAPI/Pydantic-коде поведение не сломали.
- Юниты скрипта `tests/test_lint_budget.py`: **33/33**.
- Гейт локально: `uv run python scripts/lint_budget.py` — exit 0.
- e2e-шарды — гейт PR CI (ожидаемо зелёные: прод-поведение не менялось, спеки не тронуты).

## Acceptance Criteria (волна 0)

| Критерий | Статус |
|---|---|
| Скрипт-рахет: fail-closed + запрет роста порогов против базы | ✅ (T1) |
| CI-джоба `backend-lint`: без `needs`, fetch-depth 0, те же триггеры | ✅ (T2) |
| B008 = 0 (конфиг extend-immutable-calls) | ✅ (T3) |
| Только safe-фиксы ruff (I001/F401/RUF100/UP037/W292/F811 — ревью пройдено) | ✅ (T3) |
| Пороги в скрипте = фактическим счётчикам после волны | ✅ (ruff 119 / mypy 531) |
| Полный pytest-сьют зелёный | ✅ (3179p/0f/15s) |
| e2e-шарды CI зелёные | ⏳ PR CI этого PR |

## Remaining waves (вне этого PR — следующие PR после мержа)

- **Задачи 4–7 — mypy-волны по семьям:** services (~170) → admin (~148) → api (~110) →
  хвосты domain/seed/repositories/schemas/прочее (~103); параллельные под-PR сериализуются
  ребейзом (равенство порога факту принуждает). Граница: файл определения `@transactional`
  (`src/services/decorators.py`, #394) не трогать.
- **Задача 8 — ruff-хвост:** RUF012/F841/RUF001/RUF059/UP042/F811-остаток; каждое F811 —
  разбор на реальный баг.
- **Задача 9 — финал:** оба порога 0 → снос `lint_budget.py`, джоба зовёт `ruff`/`mypy`
  напрямую по exit-коду.

## Key Files Changed

- `backend/scripts/lint_budget.py` — **новый** скрипт бюджета (рахет-гейт, 415 строк)
- `backend/tests/test_lint_budget.py` — **новый** (33 юнит-теста)
- `.github/workflows/test.yml` — новая джоба `backend-lint`
- `backend/pyproject.toml` — `[tool.ruff.lint.flake8-bugbear] extend-immutable-calls`
- ~71 файл автоправок ruff в `backend/src/` + `backend/tests/` (импорты/стиль, поведение нетто)

## Docs Impact

- `PLAN.md` — баннер волны 0 в шапке + строка в таблице Priorities and Time (этот docs-коммит).
- `CHANGELOG.md` — пункт под `[Unreleased] — 2026-10-08` → `### Added` (этот docs-коммит).

## References

- **GitHub Issue**: #306
- **Design Spec**: `docs/specs/2026-10-08-backend-lint-mypy-ratchet-306-design.md`
- **Plan**: `docs/plans/2026-10-08-backend-lint-mypy-ratchet-306-plan.md` (3/9 задач в этом PR)
- **PR**: _(to be added after PR creation)_
