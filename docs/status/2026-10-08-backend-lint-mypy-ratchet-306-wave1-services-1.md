# GH #306 — mypy-волна services, под-PR 1 (транш 1: record + generic)

- **Date**: 2026-10-08
- **Branch**: `306-mypy-services-1`
- **Status**: Под-PR 1 из ~2–3 волны 1 (mypy services) completed — PR pending; multi-wave #306
  продолжается (Refs, НЕ Closes — закроется финальной волной)
- **Range**: base `4633001a` (main после волны 0) — 2 коммита (`e584933b..6371b520`), 7 файлов,
  +120/−58
- **Issue**: #306 — волновая чистка mypy-долга до нуля; этот под-PR — транш 1 семьи services
  (план Task 4)
- **Spec**: `docs/specs/2026-10-08-backend-lint-mypy-ratchet-306-design.md`
- **Plan**: `docs/plans/2026-10-08-backend-lint-mypy-ratchet-306-plan.md`
- **Волна 0**: `docs/status/2026-10-08-backend-lint-mypy-ratchet-306-wave0.md`

## Скоуп

- **Транш:** `src/services/record.py` (37 → 0), `src/services/generic.py` (24 → 0).
- **Коллатерал** — ложные типы в сигнатурах-источниках (чинились попутно, самостоятельной
  чистки семей не было): `repositories/search.py`, `domain/sorting.py`,
  `repositories/generic.py`, `api/v1/locations.py`.
- Полиш-коммит `6371b520` (по ревью): `order_by: Sequence[SortExpr]`, дедуп алиаса,
  унификация narrowing.

## Рахет-счётчики (до → после)

| Инструмент | Было | Стало | Дельта |
|---|---|---|---|
| mypy (тотал, порог в скрипте) | 531 | **397** | −134 = транш 61 + коллатерал services 32 + api/v1 32 + репо 11 |
| ruff (сумма per-rule) | 119 | **119** | не менялся (baseline; B008 = 0) |

## Подавления (точечные, с обоснованиями)

| Подавление | Где | Обоснование |
|---|---|---|
| `type: ignore[override]` ×2 | `record.py` | контракт GH #171 — usecase-сигнатуры осознанно сужают базовый сервис |
| `[attr-defined]` ×2 | `generic.py` | `.id` на `type[Base]` — SQLAlchemy-дескриптор недоступен mypy на классе |
| `noqa: UP040` ×1 | `generic.py` | SchemaList→ModelList — осознанный паттерн, не TypeAlias |

Глобальных оверрайдов нет.

## Поведение

Не менялось — только аннотации + один LSP-фикс порядка параметров `ArchiveService.list`;
все вызовы keyword-only (проверено ревью по 11 роутерам).

## Test Results

- Полный pytest-сьют: **3179 passed / 0 failed / 15 skipped**.
- `tests/test_lint_budget.py`: **33/33**.
- `tests/services`: **375 passed / 0 failed / 12 skipped** (после полиш-коммита).

## Ревью

- Комплаенс ✅; качество — approved (3 minor найдены и исправлены в полиш-коммите `6371b520`).

## Остаток семьи services (транш 2)

Сумма **77**: staff 20, client 16, service 15, activity 7, material 6, photo 5, payment 5,
visitor 1, visit 1, position 1 — следующий под-PR волны 1.

## References

- **GitHub Issue**: #306 (Refs)
- **Design Spec**: `docs/specs/2026-10-08-backend-lint-mypy-ratchet-306-design.md`
- **Plan**: `docs/plans/2026-10-08-backend-lint-mypy-ratchet-306-plan.md` (Task 4)
- **PR**: _(to be added after PR creation)_
