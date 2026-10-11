# GH #317 — Динамические порты + тег прогона для локальных e2e-шардовых стеков

- **Date**: 2026-10-10
- **Branch**: `317-shard-dynamic-ports`
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `34973c9a` — 12 коммитов (`29e46a14..9094385a`), 13 файлов, +3584/−134 (+ docs-коммит)
- **Issue**: #317 — шардовые стеки без коллизий портов/артефактов при параллельных прогонах
- **Спека**: `docs/specs/2026-10-09-shard-stack-dynamic-ports-317-design.md` rev6
- **План**: `docs/plans/2026-10-10-shard-stack-dynamic-ports-317-plan.md` — 10 задач (0–9), все закрыты + fix-bundle после смоука
- **Характер**: harness/framework change — прод-код, контракты API и БД не тронуты

## Что выполнено

1. **`scripts/test-all.sh`** — тег прогона и динамические порты: аллокация в окне
   28000–32700, лиз-файлы, mkdir-сид-лок, `trap EXIT INT TERM` на уборку,
   EADDRINUSE-фатал, `TZ=UTC`, режим `SHARD_MANAGED_STACK`.
2. **`scripts/lib/shard-helpers.sh`** — библиотека: `gen_run_tag`,
   `allocate_shard_ports`, лизы write/remove, `sweep_dead_runs` с LISTEN-семплированием
   и старением лизов 24 ч, `audit_orphan_tagged`, wipe/cleanup по контракту тега.
3. **`scripts/e2e-shard-start.sh`** — тег в `NEXT_DIST_DIR`/`FILES_DIR`/
   `TEST_FILES_DIR`, свой лиз ручного стека, валидация тега, managed-режим.
4. **TS тег-резолверы** — `frontend/admin/e2e/lib/db-path.ts` и
   `frontend/admin/e2e/fixtures/seed-reset.ts`: резолв путей по тегу, контракт #209
   сохранён; харнесс-фикстуры (`db-query.ts`, `seed-reset.ts`) и `globalSetup.ts`
   проведены через тег.
5. **Dryrun-харнесса** — `scripts/lib/shard-helpers.dryrun.test.sh` (24 assert-кейса)
   и `scripts/e2e-shard-start.dryrun.test.sh` (51 assert-кейс); vitest-гейт
   `db-path` + `seed-reset` (48 тестов).
6. **Доки харнесса** — `docs/tests_workflow.md` +
   `.opencode/skills/dev-workflow/SKILL.md` (единственная копия): канон тега/портов,
   rev6.

## Механика тега

- Пустой тег = байт-идентичные легаси-имена и маски — CI-путь не изменился
  (оба харнесса это пиннят ассертами).
- Тег-контракт управляет изоляцией артефактов (`NEXT_DIST_DIR`, `FILES_DIR`,
  `TEST_FILES_DIR`), лизами портов и уборкой (`sweep_dead_runs`, wipe/cleanup).
- Дисциплина bash 3.2 выдержана: без `mapfile`/nameref/ассоциативных массивов.

## Верификация (это дерево, `9094385a`)

| Проверка | Результат |
| --- | --- |
| shard-helpers.dryrun | **24/24** × 3 прогона |
| e2e-shard-start.dryrun | **51/51** × 3 прогона |
| vitest-гейт db-path + seed-reset | **48/48** |
| Admin vitest (полный, standalone) | **2550/2550** |
| Backend pytest (полный) | **3184/3184** (не тронут) |
| Smoke A: два параллельных ручных стека | разные теги; auth-login / anonymous-visits против каждого — все зелёные; разделение ресурсов и уборка подтверждены |
| Полный `test-all.sh` (run `ce9500`) | 5/7 стадий зелёных in-run (lint, typecheck ×2, pytest, shard-schedule); e2e 370/370 и vitest 2550/2550 после standalone-перезапуска всех 56 in-run редов |

Полный прогон: 2 красные стадии — **только внешняя нагрузка** (волны spec-panel,
load 25–37); exit 1 зафиксирован как environment-отклонение, не дефект фичи.
Все 56 in-run редов перезапущены standalone — **зелёные**. Механика #317
подтверждена живьём: 4-портовый лиз стабилен, уборка после внешнего kill чистая.

## DoD-отклонения (2)

1. **Локальный полный прогон exit 1 при внешней нагрузке** — все реды
   классифицированы load-flake (standalone-зелёные); CI в PR — авторитетный гейт.
2. **Host-macOS dryrun-прогон (bash 3.2 гарант) не выполнялся** — контейнер
   Linux; дисциплина bash 3.2 выдержана, оба харнесса зелёные в контейнере.

## Известные env-хвосты (кандидаты на отдельные issues)

- Слепота контейнера к next-server сокетам: `lsof`/`/proc/net/tcp` не видят
  LISTEN next-серверов → kill-лестница не может матчить порт; остатки
  build-каталогов само-убираются аудитом. Кандидат — curl-based port-hold
  fallback в `_masked_pids`.
- Readiness-бюджеты холодного старта тесны при внешней нагрузке (спека §4 —
  отдельная тема).
- `PhotosTable.test.tsx` флакует под concurrency-нагрузкой (последовательно
  зелёный в обеих TZ).

## PR-заметки

- **Grep-бейзлайн потребителей (Task 0)**: CI-workflows ×3 не тронуты
  (фиксированные порты, пустой тег); `frontend/admin/tsconfig.json` — статические
  include `.next-shard-1/2`, бенигно (типы, CI-путь без тега);
  `next.config.mjs` — env-косвенный потребитель (`NEXT_DIST_DIR`), без правок;
  исторические docs/specs/plans не переписывались.
- **Ветка позади main на 5+ коммитов**; 3 файла пересекаются с main-дрейфом
  (`docs/tests_workflow.md`, `.opencode/skills/dev-workflow/SKILL.md`,
  `frontend/admin/e2e/globalSetup.ts`) — auto-merge чистый (0 конфликт-маркеров),
  CI проверит merge-ref.
- **Пустой тег = легаси-путь**: CI-путь не изменился (ассерты харнессов пиннят).

## Тронутые файлы (`git diff --name-only 34973c9a..HEAD`)

```
.opencode/skills/dev-workflow/SKILL.md
docs/tests_workflow.md
frontend/admin/__tests__/db-path.test.ts
frontend/admin/__tests__/seed-reset.test.ts
frontend/admin/e2e/fixtures/db-query.ts
frontend/admin/e2e/fixtures/seed-reset.ts
frontend/admin/e2e/globalSetup.ts
frontend/admin/e2e/lib/db-path.ts
scripts/e2e-shard-start.dryrun.test.sh
scripts/e2e-shard-start.sh
scripts/lib/shard-helpers.dryrun.test.sh
scripts/lib/shard-helpers.sh
scripts/test-all.sh
```

Docs-коммит: `docs/status/2026-10-10-shard-dynamic-ports-317.md` — только мета-док,
код/спеки/планы не тронуты.

## Scope guards

Прод-код, api-client, миграции, e2e-спеки — без изменений; спека/план правились
только коммитами самой ветки (rev6), docser их не касался; follow-ups из
«env-хвостов» — вне скоупа этой ветки; `Closes #317` — только в описании PR
(канон репо).

## References

- **GitHub Issue**: #317
- **Design Spec**: `docs/specs/2026-10-09-shard-stack-dynamic-ports-317-design.md` (rev6)
- **Plan**: `docs/plans/2026-10-10-shard-stack-dynamic-ports-317-plan.md` (10/10 + fix-bundle)
- **PR**: _(to be added after PR creation)_
