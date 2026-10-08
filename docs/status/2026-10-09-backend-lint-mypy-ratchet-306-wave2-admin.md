# GH #306 — mypy-волна 2 admin (Task 5: admin/setup.py → 0, одним под-PR)

- **Date**: 2026-10-09
- **Branch**: `306-mypy-admin-1`
- **Status**: Волна 2 (mypy admin) completed — PR pending; **семья admin завершена одним
  под-PR** (под-PR 2 не нужен); multi-wave #306 продолжается (Refs, НЕ Closes — закроется
  финальной волной)
- **Range**: base `8063b940` (main после волны 1 под-PR 2) — 1 коммит (`a9064752`), 4 файла,
  +155/−41
- **Issue**: #306 — волновая чистка mypy-долга до нуля; этот под-PR — волна 2: семья admin
  (план Task 5)
- **Spec**: `docs/specs/2026-10-08-backend-lint-mypy-ratchet-306-design.md`
- **Plan**: `docs/plans/2026-10-08-backend-lint-mypy-ratchet-306-plan.md`
- **Волна 0**: `docs/status/2026-10-08-backend-lint-mypy-ratchet-306-wave0.md` ·
  **Волна 1**: под-PR 1 `...306-wave1-services-1.md` · под-PR 2 `...306-wave1-services-2.md`

## Скоуп

- **Транш:** семья admin = один файл `src/admin/setup.py`, 148 → 0
  (90 list-item, 28 type-arg, 26 assignment, 2 import-untyped, 1 no-untyped-def, 1 misc).
- **Под-PR 2 не нужен** — семейство целиком в одном транше.

## Рахет-счётчики (до → после)

| Инструмент | Было | Стало | Дельта |
|---|---|---|---|
| mypy (тотал, порог в скрипте) | 318 | **170** | −148 = setup.py целиком |
| ruff (сумма per-rule) | 119 | **119** | не менялся (baseline; B008 = 0) |

## Подавления

**НОЛЬ** — ни `type: ignore`, ни оверрайдов. Ключевые идиомы (без подавлений):

| Идиома | Где | Зачем |
|---|---|---|
| `ClassVar[Sequence[_AdminAttr]]` + PEP-695 `type _AdminAttr` | `setup.py` | контракт sqladmin 0.26 `MODEL_ATTR`, ковариантность `Sequence` |
| `types-WTForms` в dev-зависимостях | `pyproject.toml` | −2 import-untyped (sqladmin тянется к wtforms-полям); CI ставит `uv sync --extra dev` |

Глобальных оверрайдов нет.

## Поведение

Не менялось — runtime AST-идентичен (комплаенс-ревью: все 26 списков сравнены
element-for-element).

## Найденный баг (НЕ чинен — вне скоупа, тикет-кандидат)

`inline_models` НЕ существует в sqladmin 0.26.0 — атрибут в `StaffAdmin` молча игнорируется,
inline-редактирование master-расширения Staff, вероятно, не работает вовсе (семантика списана
с flask-admin); `tests/test_admin.py:55` проверяет только наличие атрибута. По политике волны
поведение не трогали — оформить отдельным тикетом.

## Test Results

- Полный pytest-сьют: **3179 passed / 0 failed / 15 skipped**.
- `tests/test_admin.py` + `tests/test_lint_budget.py`: **37/37**.
- Гейты зелёные: mypy 170 == порог, ruff 119 == baseline.

## Ревью

- Комплаенс ✅; качество — approved.

## Остаток mypy-долга (170) по семьям — для планирования волн

api/v1 ≈77 (records 13, clients 11, tags/services/materials/activities 6×4, staff/locations
5+5, visitors 4, visits/position/photos/payments 3×4, user_settings 2, _delete_family 1) /
seed/seed.py 26 / domain/deletion.py 26 / repositories/generic.py 15 / main.py 7 / schemas/* 9 /
auth/service 3 / domain/record_visits 2 / cli 2 / models/* 3 / core/config 1 —
следующая волна 3: api (~77).

## References

- **GitHub Issue**: #306 (Refs)
- **Design Spec**: `docs/specs/2026-10-08-backend-lint-mypy-ratchet-306-design.md`
- **Plan**: `docs/plans/2026-10-08-backend-lint-mypy-ratchet-306-plan.md` (Task 5)
- **PR**: _(to be added after PR creation)_
