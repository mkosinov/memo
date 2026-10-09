# GH #306 — mypy-волна 3 api (Task 6: семья `src/api/` → 0, одним под-PR)

- **Date**: 2026-10-09
- **Branch**: `306-mypy-api-1`
- **Status**: Волна 3 (mypy api) completed — PR pending; **семья api завершена одним
  под-PR** (под-PR 2 не нужен); multi-wave #306 продолжается (Refs, НЕ Closes — закроется
  финальной волной)
- **Range**: base `f2f09896` (main после волны 2) — 1 коммит (`82ec6133`), 17 файлов,
  +165/−78
- **Issue**: #306 — волновая чистка mypy-долга до нуля; этот под-PR — волна 3: семья api
  (план Task 6)
- **Spec**: `docs/specs/2026-10-08-backend-lint-mypy-ratchet-306-design.md`
- **Plan**: `docs/plans/2026-10-08-backend-lint-mypy-ratchet-306-plan.md`
- **Волна 0**: `docs/status/2026-10-08-backend-lint-mypy-ratchet-306-wave0.md` ·
  **Волна 1**: под-PR 1 `...306-wave1-services-1.md` · под-PR 2 `...306-wave1-services-2.md` ·
  **Волна 2**: `docs/status/2026-10-09-backend-lint-mypy-ratchet-306-wave2-admin.md`

## Скоуп

- **Транш:** семья `src/api/` = 15 файлов, 76 → 0
  (records 13, clients 10, tags/services/materials/activities 6×4, staff/locations 5+5,
  visitors 4, visits/position/photos/payments 3×4, user_settings 2, `_delete_family` 1).
- **Под-PR 2 не нужен** — семейство целиком в одном транше.
- **Поддерживающее изменение:** расширение сигнатуры
  `UserSettingsService.update_by_user_id` — принимает
  `UserSettingsUpdate | UserSettingsPatch` (поля идентичны, поведение не менялось).

## Рахет-счётчики (до → после)

| Инструмент | Было | Стало | Дельта |
|---|---|---|---|
| mypy (тотал, порог в скрипте) | 170 | **94** | −76 = семья `src/api/` целиком |
| ruff (сумма per-rule) | 119 | **119** | не менялся (baseline; B008 = 0) |

## Подавления

6 пар `# type: ignore[misc]` + `[arg-type]` — по паре на selfless-сценарий `@transactional`
(records ×4, clients ×1, activities ×1), все с обоснованием; прецедент — GH #171
(см. также волну 1: `ignore[override]` ×4 в `services/service.py`).
Глобальных оверрайдов нет; `decorators.py` не тронут (граница #394), семья services
осталась на 0.

## Ключевые идиомы волны (без подавлений)

| Идиома | Где | Зачем |
|---|---|---|
| `-> None` → `-> Response` + явный `Response(status_code=204)` | delete-family роуты (`_delete_family.py` и потребители) | FastAPI 0.141 ассертит «204 без тела» для `Response \| None`; комплаенс-ревью: статус/тело/заголовки идентичны, OpenAPI байт-идентичен, контракт-сьют пиннит 204 + `b""` |
| `deps: list[DependencyNode]` | records (delete-preview) | вместо бесструктурного списка |
| `Annotated[VisitorService]` | visitors | вместо `any` |
| `PaymentResponse.model_validate` (from_attributes) | payments | типизация ответа без ручного маппинга |

## Поведение

Не менялось — единственная нетривиальная замена (delete-family `Response(status_code=204)`)
проверена комплаенс-ревью: статус/тело/заголовки идентичны, OpenAPI-схема байт-идентична,
контракт-сьют пиннит 204 + пустое тело. Сигнатура `update_by_user_id` — union из двух
схем с идентичными полями; call-sites не менялись.

## Test Results

- Полный pytest-сьют: **3179 passed / 0 failed / 15 skipped** (+33 `test_lint_budget`).
- Контракт-сьют: **244 passed / 0 failed / 3 skipped**.
- Гейты зелёные: mypy 94 == порог, ruff 119 == baseline.

## Ревью

- Комплаенс ✅; качество — approved.

## Остаток mypy-долга (94) по семьям — для планирования волн

domain/deletion 26 / seed 26 / repositories/generic 15 / schemas 9 / main.py 7 /
models 3 / auth 3 / domain/record_visits 2 / cli 2 / core/config 1 —
следующая волна 4: хвосты (план Task 7), финальная волна #306.

## References

- **GitHub Issue**: #306 (Refs)
- **Design Spec**: `docs/specs/2026-10-08-backend-lint-mypy-ratchet-306-design.md`
- **Plan**: `docs/plans/2026-10-08-backend-lint-mypy-ratchet-306-plan.md` (Task 6)
- **PR**: _(to be added after PR creation)_
