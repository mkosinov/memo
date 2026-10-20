# GH #415 — e2e CI: 4 нативных шарда Playwright + HTML-отчёт с трейсами + блокирующий флейк-гейт

- **Date**: 2026-10-20
- **Branch**: `415-e2e-ci-native-shards`
- **Status**: Completed (PR/приёмка T8 — у архитектора; PR pending, CI-watch/merge на finishing/@manager)
- **Range**: base `88c20845` (main) — 8 коммитов (`d7192263..915e5bae`), 14 файлов, +790/−146 (+ docs-коммит)
- **Issue**: #415 — ci(e2e): 4 шарда вместо 2 + HTML-репортер с трейсами + видимость флейков
- **Спека**: `docs/specs/2026-10-13-e2e-ci-native-shards-415-design.md` рев.4 — на main, unchanged by IMPL
- **План**: `docs/plans/2026-10-19-e2e-ci-native-shards-415-plan.md` — 8 задач (T1–T7 закрыты, T8 — PR/приёмка) — на main, unchanged by IMPL
- **Характер**: harness/CI change — продуктовый код (admin, бэкенд, api-client) не тронут; единственное касание e2e-спеки — внеплановый фикс pre-existing флейка `clients.spec.ts` (санкционирован архитектором, см. ниже)

## Что выполнено

1. **Конфиг Playwright (T1, `d7192263`, small)** — один проект `e2e` вместо двух ручных
   regex-проектов `shard-schedule`/`shard-rest`; репортеры `list`+`html`+`json` с
   env-управляемыми путями выходов (`PLAYWRIGHT_JSON_OUTPUT_NAME`, HTML-репорт,
   сохранение `outputDir`).
2. **Флейк-сводка (T2, `8724df41`, standard)** — `scripts/e2e-report-summary.mjs`
   (Node ESM, без зависимостей): чистая `summarize()`, строки `FLAKY: …`,
   Markdown-таблица в `$GITHUB_STEP_SUMMARY`, `::warning`-аннотации; контракт
   exit-кодов — ≥1 статус `flaky` → 1 (блокирует мерж, решение Gate B), ноль → 0,
   битый/отсутствующий файл → предупреждение + 0. Юнит-тест
   `frontend/admin/__tests__/e2e-report-summary.test.ts` — **13/13**.
3. **Allowlist SHARD_ID (T3, `4330f117`, small)** — `scripts/e2e-shard-start.sh`
   принимает только `SHARD_ID` ∈ {1,2,3,4} (локальные прогоны используют подмножество
   {1,2}); dryrun-сьют переведён на табличные кейсы — **65/0**.
4. **test.yml (T4, `da60be81`, standard)** — матрица 4 нативных шардов
   (`--shard=i/4`), гард spec-файлов перед стартом серверов (локальные пины
   144/143/143/143), артефакты `e2e-report-shard-<i>` (HTML-отчёт + трейсы при
   падении, `if-no-files-found: warn`), шаг флейк-сводки с `GITHUB_STEP_SUMMARY`.
5. **Локальный test-all.sh (T5, `63b75fef`, small)** — нативные локальные шарды
   1/2–2/2, пер-шардные выходы отчётов (параллельные локальные прогоны без
   коллизий артефактов), `frontend/admin/.gitignore` + `results*.json`.
6. **Сопутствующие workflows (T6, `3da60bb4`, small)** — `visual-check.yml` и
   `update-snapshots.yml` → `--project=e2e`, артефакт `updated-snapshots-e2e`,
   чистка следов `shard-rest` (заголовки, имена шагов).
7. **Доки + скиллы (T7, `915e5bae`, small)** — `docs/tests_workflow.md`: раздел
   шардов переписан под нативное деление, мигрированы ВСЕ упоминания старых имён
   (включая заметку об авторитете скриншотов, ~строка 328 — греп
   `shard-rest|shard-schedule` по зоне пуст); `.opencode/skills/dev-workflow/SKILL.md`
   и `.opencode/skills/vitest-playwright-patterns/SKILL.md` — команды, drill-ссылки,
   маппинг SHARD_ID, имя артефакта.
8. **PR/приёмка (T8)** — в работе у архитектора (открывается после этого
   docs-коммита).

### Внеплановый фикс (санкционирован архитектором)

- **`6350f6b3`** — `frontend/admin/e2e/clients.spec.ts` US-4: тест гонял
  `toHaveURL` против промежуточного URL до синка дебаунса поиска #349 —
  pre-existing флейк, который новый блокирующий флейк-гейт превратил бы в
  красный мерж-блокер этого самого PR. Фикс: ждать финальный URL с `?q=`.
  Изолированно **5/5**, ревьюерский прогон **2/2**.

## Верификация (это дерево, `915e5bae`)

| Проверка | Результат |
| --- | --- |
| Юнит-тест флейк-сводки | **13/13** |
| Dryrun `e2e-shard-start` (табличные кейсы) | **65/0** |
| Полный `test-all.sh` ×3 (тестировщик) | pytest **3392p**, vitest **3066p**, структурный DoD зелёный в каждом прогоне |
| `clients.spec.ts` изолированно / ревью | **5/5** / **2/2** |
| Визуальный комплаенс-гейт (G4.5) | **exit 0** — секция Visual Compliance Checks спеки помечена `- N/A` (CI-инфраструктура, видимых поверхностей нет) |
| Греп старых имён по зоне (T7 DoD) | пуст |

## DoD-статус

- **Локально верифицируемый DoD — выполнен целиком** (все пункты выше).
- **PR-временной DoD — не трекается этой веткой, владелец архитектор** (T8):
  4 зелёных e2e-джобы в CI, wall-время каждой ≤ 10 мин (при провале — рычаг
  «5-й шард», спека §8), принудительно-красная проба с контролем скачивания
  артефакта (HTML + трейс), счётчики гарда spec-файлов в логах CI,
  контрольный `update-snapshots.yml`/`visual-check.yml` после мержа.

## PR-заметки

- `Closes #415` — только в описании PR (канон репо), в коммиты не пишется.
- Балансировка 4 шардов устраняет дисбаланс ~4:1 ручных regex-проектов
  (shard-rest 16–25 мин vs shard-schedule 4,5–5,5 мин); деление spec-файлами
  отныне автоматическое — новые спеки не ломают баланс.
- Ретраи (`retries: 1`) остаются: статус `flaky` отличает нестабильный тест от
  регрессии (`failed`), но теперь флейк роняет джобу сводкой вместо тихого
  зелёного.
- Продуктовый код, контракты API/БД, api-client — без изменений; из e2e-спек
  тронут только `clients.spec.ts` US-4 (внеплановый фикс, см. выше).

## Тронутые файлы (`git diff --name-only 88c20845..915e5bae`)

```
.github/workflows/test.yml
.github/workflows/update-snapshots.yml
.github/workflows/visual-check.yml
.opencode/skills/dev-workflow/SKILL.md
.opencode/skills/vitest-playwright-patterns/SKILL.md
docs/tests_workflow.md
frontend/admin/.gitignore
frontend/admin/__tests__/e2e-report-summary.test.ts
frontend/admin/e2e/clients.spec.ts
frontend/admin/playwright.config.ts
scripts/e2e-report-summary.mjs
scripts/e2e-shard-start.dryrun.test.sh
scripts/e2e-shard-start.sh
scripts/test-all.sh
```

Docs-коммит: `PLAN.md` + `CHANGELOG.md` + `docs/status/2026-10-20-e2e-ci-native-shards-415.md`
— только мета-доки; код/спеки/планы не тронуты.

## Scope guards

Прод-код, api-client, миграции — без изменений; спека/план на main, docser их не
касался; DoD уровня PR — вне скоупа этого docs-коммита (T8, архитектор);
`Closes #415` — только в описании PR (канон репо).

## References

- **GitHub Issue**: #415
- **Design Spec**: `docs/specs/2026-10-13-e2e-ci-native-shards-415-design.md` (рев.4)
- **Plan**: `docs/plans/2026-10-19-e2e-ci-native-shards-415-plan.md` (7/8 закрыто, T8 — PR)
- **PR**: _(to be added after PR creation)_
