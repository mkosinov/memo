# GH #373 — канон-тесты сида переехали из vitest админки в pytest (флейк-класс «seed-reset под нагрузкой» устранён как класс)

- **Date**: 2026-10-21
- **Branch**: `seed-canon-pytest-373`
- **Status**: Completed (PR pending; CI-watch/merge — на finishing/@manager)
- **Range**: base `ab7b0f76` (main) — 4 коммита (`52d096f8..17ed0ae0`), 4 файла, +744/−221
- **Issue**: #373 — нагрузочный флейк SQL-тестов сида в полном vitest-прогоне админки (39 с под нагрузкой против таймаута 30 с; 2 падения «wipes user_settings whole» при зелёном CI на том же коммите)
- **Спека**: `docs/specs/2026-10-21-seed-canon-pytest-move-design.md` рев.2.1 — на main с `ab7b0f76`, unchanged by IMPL
- **План**: `docs/plans/2026-10-21-seed-canon-pytest-move-plan.md` — 4/4 задачи — на main, unchanged by IMPL
- **Характер**: test-infra change — семантика канона не меняется, меняется только дом закрепления; продуктовый код, e2e-слой и CI-джобы не тронуты

## Проблема

SQL-группа (7 тяжёлых тестов: реальная sqlite-база + порождение python-генератора) исторически жила в юнит-сьюте админки `frontend/admin/__tests__/seed-reset.test.ts` как попутчик e2e-фикстуры сброса. Её предмет — не фронтенд, а в пуле процессов полного vitest-прогона каждый тест раздувается с 2.3 с до 39 с и упирается в потолок 30 с → ложный красный «фронт сломан» на загруженной машине. Решение по гейту концепта: переносить семантику в родной pytest-дом бэкенда; бюджеты/таймауты не поднимать, e2e не трогать, не удалять (это единственное место закрепления полной семантики отката).

## Что выполнено

1. **T1 `52d096f8` (standard)** — pytest-обвязка канона `backend/tests/test_seed_canon.py` (маркер `misc`): база из реальной схемы + реальный `seed_data()` (паттерн `test_seed.py`), генератор — реальный скрипт `scripts/gen_seed_canon.py` списком аргументов (`sys.executable`, `shell=False`, `check=True`, страховочный timeout), применение канона — та же sqlite-команда `.read`, что у обёртки; всё под `tmp_path` с явным утверждением путей перед применением. Первая семантика — полный рестор канона.
2. **T2 `1639ebb8` (small)** — остальные 6 семантик канона: словари/`sort_order`, users, user_settings, исключения, notify_templates, идемпотентность повторного применения.
3. **T3 `09bcf30e` (small)** — сокращение `frontend/admin/__tests__/seed-reset.test.ts` 26 → 19 тестов: 7 SQL-тестов удалены (переиммигрировали в T1–T2), осталась лёгкая TypeScript-обёртка (резолверы путей, аватары, громкая ошибка); новый инвариант сьюта — «никаких внешних процессов».
4. **T4 `17ed0ae0` (trivial)** — coverage map в `docs/tests_workflow.md` (канон-семантика теперь живёт в pytest-сьюте) + `.gitignore` `*.canon.sql` (дампы канона не коммитятся).

## Верификация

| Проверка | Результат |
| --- | --- |
| `backend/tests/test_seed_canon.py` | **7 passed** (независимые прогоны: ревьюер качества 1 passed на T1, ревьюер соответствия 7 passed на T2) |
| Регрессия соседнего сьюта | `tests/test_seed.py` **29 passed** |
| Полный vitest админки | **3100 passed / 188 файлов** |
| `seed-reset.test.ts` после сокращения | **19 passed** |
| Grep-страж инварианта «никаких внешних процессов» (`execSync\|spawn\|child_process`) | **0 совпадений** |
| Ruff | clean |

## Ревью и гейты

- Ревью: T1 compliance ✅ + quality ✅; T2 compliance ✅; T3 compliance ✅; T4 — architect spot-check ✅.
- Визуальный комплаенс-гейт: секция Visual Compliance Checks спеки помечена `N/A` → **exit 0** («not applicable» — видимых поверхностей нет).
- Open deviations: **нет**.

## DoD-статус

Приёмка спеки: все User Scenarios выполнены — US1 полный прогон admin зелёный, US2 7 семантик в pytest, US3 локальный прогон канона за секунды (~5–10 с), US5 coverage map + gitignore; US4 (CI на PR) — PR-временной DoD, на стадии finishing/@manager.

## Тронутые файлы (`git diff --numstat ab7b0f76..17ed0ae0`)

```
3	0	.gitignore
706	0	backend/tests/test_seed_canon.py
9	2	docs/tests_workflow.md
26	219	frontend/admin/__tests__/seed-reset.test.ts
```

Docs-коммит: `PLAN.md` + `CHANGELOG.md` + `docs/status/2026-10-21-seed-canon-pytest-373.md` — только мета-доки; код/спеки/планы не тронуты.

## Scope guards

Продуктовый код, api-client, миграции, e2e-слой (`e2e/fixtures/seed-reset.ts`, `globalSetup.ts` с его `CANON_EXCEPTIONS`), бюджеты/таймауты, CI-джобы — без изменений; спека (рев.2.1) и план на main, docser их не касался; DoD уровня PR (зелёный CI) — вне скоупа этого docs-коммита; `Closes #373` — только в описании PR (канон репо).

## References

- **GitHub Issue**: #373
- **Design Spec**: `docs/specs/2026-10-21-seed-canon-pytest-move-design.md` (рев.2.1)
- **Plan**: `docs/plans/2026-10-21-seed-canon-pytest-move-plan.md` (4/4)
- **PR**: _(to be added after PR creation)_
