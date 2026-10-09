# GH #306 — mypy-волна 4 хвосты (Task 7: МИЛСТОУН — mypy src → 0)

- **Date**: 2026-10-09
- **Branch**: `306-mypy-tails-1`
- **Status**: Волна 4 (mypy хвосты) completed — PR pending; **МИЛСТОУН: весь `src/` чист —
  mypy = 0** (147 файлов); Refs #306, НЕ Closes — issue закроется Task 9 (финал)
- **Range**: base `452ea658` (main после волны 3) — 1 коммит (`8edbdba0`), 20 файлов,
  +210/−95
- **Issue**: #306 — волновая чистка mypy-долга до нуля; этот под-PR — волна 4 (финальная
  mypy-волна): хвосты (план Task 7)
- **Spec**: `docs/specs/2026-10-08-backend-lint-mypy-ratchet-306-design.md`
- **Plan**: `docs/plans/2026-10-08-backend-lint-mypy-ratchet-306-plan.md`
- **Волна 0**: `docs/status/2026-10-08-backend-lint-mypy-ratchet-306-wave0.md` ·
  **Волна 1**: под-PR 1 `...306-wave1-services-1.md` · под-PR 2 `...306-wave1-services-2.md` ·
  **Волна 2**: `...306-wave2-admin.md` · **Волна 3**: `...306-wave3-api.md`

## Скоуп

- **Транш:** хвосты — 10 семейств, 94 → 0: domain/deletion 26, seed 26,
  repositories/generic 15, schemas 9, main.py 7, auth 3, models 3, domain/record_visits 2,
  cli 2, core/config 1.
- **Милстоун:** рахет mypy завершён — `mypy src --no-incremental` = 0 ошибок на всех 147
  файлах `src/`; порог в скрипте = 0.
- **Коллатерал ruff:** 119 → 117 — TYPE_CHECKING-импорты forward-refs моделей
  (`"Activity"`/`"Visit"`) починили F821 ×2; запись F821 удалена из бюджета (= «порог =
  факту», только вниз). B008 = 0.

## Рахет-счётчики (до → после)

| Инструмент | Было | Стало | Дельта |
|---|---|---|---|
| mypy (тотал, порог в скрипте) | 94 | **0** | −94 = хвосты целиком; **mypy src = 0 — милстоун #306** |
| ruff (сумма per-rule) | 119 | **117** | коллатерал −2 (F821 ушли с TYPE_CHECKING-импортами; запись снята с бюджета) |

## Подавления

20 — все точечные с обоснованиями, strict не ослаблен:

- schemas ×8 `[prop-decorator]` — pydantic `@computed_field` над `@property`
  (7 файлов: client, location, material, photo, service, staff, user);
- repositories/generic ×9 `[attr-defined]` — прецедент #232: `id`/`is_active`/`sort_order`
  вне TypeVar-базы;
- cli ×2 — selfless-сценарий `@transactional`, прецедент GH #171;
- core/config ×1 `[call-arg]` — `_env_file` реальный kwarg pydantic-settings, плагин его
  теряет; верифицирован по установленному pydantic-settings 2.14.1 (комплаенс-ревью).

В `main.py` один устаревший `# type: ignore` снят. Глобальных оверрайдов нет;
`decorators.py` не тронут (граница #394), семьи services/admin/api остались на 0.

## Ключевые идиомы волны (без подавлений)

| Идиома | Где | Зачем |
|---|---|---|
| `GenericService[Any, Any, Any]` в реестре хендлеров | domain/deletion | гетерогенный реестр без бесструктурных словарей |
| Честные сигнатуры + PEP-695 `type _ActivityRow` | seed | вместо `Any`-протечек в сид-данных |
| TYPE_CHECKING forward-refs (`"Activity"`/`"Visit"`) | models (record/service/tag) | починило и ruff F821 ×2 — бюджет снят |

## Поведение

Не менялось — аннотации/тайпинг; единственные исполняемые добавки — ассерты-подсветки
тикет-кандидата (ниже). Ревью — комплаенс ✅ (в т.ч. `_env_file` верифицирован по
установленному pydantic-settings 2.14.1), качество approved.

## Баг найден, не чинен (тикет-кандидат)

`auth/service.py` `change_password`: у passwordless-аккаунта (`password_hash` NULL,
#348) вызов дал бы 500 вместо 401. Недостижимо на практике (у passwordless-аккаунта нет
сессии → до сценария не доходит); подсвечено ассертами. По политике волн не чинился.

## Test Results

- Полный pytest-сьют: **3184 passed / 0 failed / 15 skipped** (+5 новых
  `TestZeroMypyBudget` — нулевой режим порога: 0/0 green, факт 1 при пороге 0 red,
  рост от нулевой базы red).
- Гейты зелёные: mypy 0 == порог 0, ruff 117 == бюджет (= факту).

## Остаток #306 (mypy закрыт — остались ruff и финал)

- **Task 8 — ruff-хвост 117 → 0:** RUF012, F841, RUF001/RUF059, UP042, F811
  (каждое F811 — разбор на реальный баг).
- **Task 9 — финал:** оба порога 0/0 → удалить `lint_budget.py`, джоба зовёт
  `ruff`/`mypy` напрямую по exit-коду; **Closes #306**.

## References

- **GitHub Issue**: #306 (Refs)
- **Design Spec**: `docs/specs/2026-10-08-backend-lint-mypy-ratchet-306-design.md`
- **Plan**: `docs/plans/2026-10-08-backend-lint-mypy-ratchet-306-plan.md` (Task 7)
- **PR**: _(to be added after PR creation)_
