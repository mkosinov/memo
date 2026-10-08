# GH #306 — mypy-волна services, под-PR 2 (транш 2: остаток семьи → 0)

- **Date**: 2026-10-08
- **Branch**: `306-mypy-services-2`
- **Status**: Под-PR 2 из 2 волны 1 (mypy services) completed — PR pending; **семья services
  завершена целиком** (под-PR 1+2); multi-wave #306 продолжается (Refs, НЕ Closes — закроется
  финальной волной)
- **Range**: base `a42edf14` (main после под-PR 1) — 1 коммит (`0538d599`)
- **Issue**: #306 — волновая чистка mypy-долга до нуля; этот под-PR — транш 2 (финал) семьи
  services (план Task 4)
- **Spec**: `docs/specs/2026-10-08-backend-lint-mypy-ratchet-306-design.md`
- **Plan**: `docs/plans/2026-10-08-backend-lint-mypy-ratchet-306-plan.md`
- **Волна 0**: `docs/status/2026-10-08-backend-lint-mypy-ratchet-306-wave0.md` ·
  **Под-PR 1**: `docs/status/2026-10-08-backend-lint-mypy-ratchet-306-wave1-services-1.md`

## Скоуп

- **Транш:** остаток семьи `src/services/*` → 0 — staff 21→0, client 16→0, service 15→0,
  activity 7→0, material 6→0, photo 5→0, payment 5→0, visitor 1→0, visit 1→0, position 1→0
  (честный замер `--no-incremental`).
- **Коллатерал** — `api/v1/staff.py` (1 ошибка).
- **Граница соблюдена:** `decorators.py` не тронут (0 ошибок и до, и после; граница #394).

## Рахет-счётчики (до → после)

| Инструмент | Было | Стало | Дельта |
|---|---|---|---|
| mypy (тотал, порог в скрипте) | 397 | **318** | −79 = 78 services + 1 коллатерал api/v1/staff.py |
| ruff (сумма per-rule) | 119 | **119** | не менялся (baseline; B008 = 0) |

## Подавления (точечные, с обоснованиями)

| Подавление | Где | Обоснование |
|---|---|---|
| `type: ignore[override]` ×4 | `services/service.py` | get/create/update/patch — контракт-замена validated-schema → ORM, прецедент GH #171 (блок-комментарий) |

Глобальных оверрайдов нет.

## Поведение

Не менялось — комплаенс-ревью проверило все call-sites `order_by`/`ids` (keyword-only);
новые точки применения — без callers.

## Test Results

- Полный pytest-сьют: **3179 passed / 0 failed / 15 skipped**.
- `tests/services` + `tests/test_lint_budget.py`: **408 passed / 0 failed / 12 skipped**.

## Ревью

- Комплаенс ✅; качество — approved.

## Метод-факт (для следующих волн)

Замеры mypy снимать только `--no-incremental` — устаревший `.mypy_cache` даёт артефакты.

## Остаток mypy-долга (318) по семьям — для планирования волн

admin 148 / api 76 / domain 28 (deletion 26) / seed 26 / repositories 15 (generic.py) /
schemas 9 / main.py 7 / models 3 / auth 3 / cli.py 2 / core 1 — следующая волна 2: admin (~148).

## References

- **GitHub Issue**: #306 (Refs)
- **Design Spec**: `docs/specs/2026-10-08-backend-lint-mypy-ratchet-306-design.md`
- **Plan**: `docs/plans/2026-10-08-backend-lint-mypy-ratchet-306-plan.md` (Task 4)
- **PR**: _(to be added after PR creation)_
