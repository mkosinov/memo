# GH #311 — Обязательная секция Visual Compliance Checks в дизайн-спеках

- **Date**: 2026-10-10
- **Branch**: `311-visual-compliance-section`
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `a42edf14` — 11 коммитов (`bc57e80e..4b338599`), 13 файлов, +794/−117
- **Issue**: #311 — каждый дизайн-спека несёт машиночитаемый контракт визуального комплаенса
- **Спека**: `docs/specs/2026-10-08-visual-compliance-spec-section-311-design.md` rev4
- **План**: `docs/plans/2026-10-08-visual-compliance-spec-section-311-plan.md` — 10/10 задач, все done + reviewed
- **Характер**: harness/framework change — прод-код, контракты API и БД не тронуты

## Что выполнено

1. **Парсер (`scripts/visual-compliance-parser.js`)** — `bc57e80e`: флаг `applicable` +
   грамматика N/A-маркера (`N/A` / `- N/A`, ASCII-дефис, единственная содержательная строка
   секции, регистронезависимо) + node-тесты; `0d1e9c48` (rev4): навигационная подсказка
   `url="/абсолютный/путь"` в пункте чек-листа. Выход парсера — `{applicable, checks}`.
2. **Раннер (`scripts/visual-compliance-check.sh`)** — `b5ee1ba6`: порядок стадий, exit 3
   (детерминированный возврат карточки в In Design с git-анти-тампер стражем), ранний
   N/A-выход (exit 0 до любых стадий зависимостей/сервера), JSON-потребители, `node -e`
   гигиена + smoke; `d04ef914` (rev4): навигация раннера по `url=`-подсказке — Playwright
   проверяет не-корневые экраны. Канон exit-кодов 0/1/2/3 — в шапке скрипта.
3. **`scripts/test-all.sh`** — `3b44383f`: parser node-тесты + bash smoke включены в общий
   прогон (`scripts/test-visual-compliance-parser.js`, `scripts/visual-compliance-check.smoke.test.sh`).
4. **Доки харнесса** — `849c0df3`: канон секции в `.zcode/skills/design-phase/SKILL.md`
   (хост) + указатель в `.zcode/skills/auto-design/SKILL.md`; `c55dc530`: контейнерные
   маршруты кода 3 — `.opencode/agents/architect.md`, `.opencode/agents/manager.md`,
   `.opencode/skills/subagent-driven-development/SKILL.md`. Зеркалирование в superagents
   framework repo — отдельные коммиты `b06217f`, `3ef2c27` (локально, вне этой ветки).
5. **Пробная спека** — `docs/specs/2026-06-19-current-user-scenarios.md` получил секцию
   с машинными подсказками (`ddd88684`, `c897738d`), rev4-дозаправка (`d8884bbb`,
   `4b338599` — проба `url="/login"` в пункте экрана входа).

## Контракт секции

- Каждый пункт чек-листа несёт машинную подсказку — `data-testid`, `aria-*` или
  «цитируемый текст» — либо секция целиком помечена N/A-маркером.
- Секция отсутствует / пуста / без подсказок → **exit 3** (возврат карточки в In Design,
  анти-тампер страж по git).
- N/A → «не применимо» + **exit 0** до каких-либо стадий зависимостей/сервера.
- `url="/путь"` на пункте — подсказка навигации раннера (rev4, решение пользователя
  2026-10-09, гейт G4.5 вариант B).

## Верификация (это дерево, `4b338599`)

| Проверка | Результат |
| --- | --- |
| Backend pytest | **3179 passed / 15 skipped / 0 failed** |
| Backend lint (рахет-гейт #306) | exit 0 |
| Typecheck | exit 0 |
| Admin vitest | **3013/3013** (TZ=UTC; 3 in-suite load-флейка переподтверждены зелёными изолированно) |
| e2e shard-schedule | **116/116** |
| e2e shard-rest | **356/356** |
| Parser node-тесты | зелёные |
| VC smoke | зелёный (US-2 exit 0 / US-3 exit 3) |
| US-4 canary | exit 0 — 1 автоматизируемый PASSED (`url="/login"` → phone-input), 8 на ручную сверку |

Логи: `/tmp/opencode/final-run.log`, `/tmp/test-all-logs/`, канареечный отчёт
`/tmp/visual-compliance/visual-compliance-report.md` (эфемерно, контейнер).

## Известные env-хвосты (только контейнер, НЕ дефекты ветки)

Кандидаты на отдельные issues: blind-lsof портовые стражи (осиротевшие next-server),
vitest load-флейки, TZ-пин.

## Тронутые файлы (`git diff --name-only a42edf14..HEAD`)

```
.opencode/agents/architect.md
.opencode/agents/manager.md
.opencode/skills/subagent-driven-development/SKILL.md
.zcode/skills/auto-design/SKILL.md
.zcode/skills/design-phase/SKILL.md
docs/plans/2026-10-08-visual-compliance-spec-section-311-plan.md
docs/specs/2026-06-19-current-user-scenarios.md
docs/specs/2026-10-08-visual-compliance-spec-section-311-design.md
scripts/test-all.sh
scripts/test-visual-compliance-parser.js
scripts/visual-compliance-check.sh
scripts/visual-compliance-check.smoke.test.sh
scripts/visual-compliance-parser.js
```

Docs-коммит: `CHANGELOG.md`, `PLAN.md`, `docs/status/2026-10-10-visual-compliance-section-311.md` — только meta-доки, код/спеки/планы не тронуты.

## Scope guards

Прод-код, api-client, миграции, e2e-спеки — без изменений; спека/план правились только
коммитами самой ветки (rev1→rev4), docser их не касался; зеркальные коммиты superagents
repo — вне этой ветки; `Closes #311` — только в описании PR (канон репо).

## References

- **GitHub Issue**: #311
- **Design Spec**: `docs/specs/2026-10-08-visual-compliance-spec-section-311-design.md` (rev4)
- **Plan**: `docs/plans/2026-10-08-visual-compliance-spec-section-311-plan.md` (10/10)
- **PR**: _(to be added after PR creation)_
