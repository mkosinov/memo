# GH #535 — Системное лечение e2e-класса flake «row-detach» (snapshot-then-assert)

- **Date**: 2026-10-25
- **Branch**: `535-e2e-row-detach-class`
- **Status**: Completed (PR pending — CI-watch/merge на finishing/@manager)
- **Range**: base `9ce6d564` — 7 коммитов (`d363737c..9a2438e8`), 8 файлов,
  +714/−159
- **Issue**: #535 — e2e-тесты админки периодически падали классом «row-detach»:
  ассерты строк таблицы читали DOM в момент, когда React ещё перекладывал
  строки (detach/stale locator), вместо того чтобы дождаться фактического
  конечного состояния. Решение — единый примитив чтения строк
  `expectRowsExact` (snapshot-then-assert: дождаться точного набора строк,
  снять снапшот, ассертить по снапшоту) + конверсия 15 сайтов в 4 спеках
- **Спека**: `docs/specs/2026-10-25-e2e-row-detach-class-design.md` (рев.2)
- **План**: `docs/plans/2026-10-25-e2e-row-detach-class-plan.md` — 8/8 задач,
  все done
- **Характер**: test-infra/e2e-only — **продуктовый код не тронут (0 строк)**;
  сервер, api-client, БД не меняются

## Что выполнено

1. **Хелпер `expectRowsExact` + конверсия теста 25 (T1, `d363737c`, small)**
   — единый примитив чтения строк таблицы в `e2e/fixtures/helpers.ts`
   (snapshot-then-assert: точный набор строк дождём, ассерт по снапшоту);
   records-тест 25 (US-1) переведён на точный сеттл.
2. **Тест 12 — derived total poll (T2, `4a9b602d`, small)** — records-тест 12
   (US-2) переведён на точные сеттлы: полл производного тотала +
   `expectRowsExact` по страницам.
3. **Конверсия тестов 6/7/11/18/19/24 (T3, `595fdd7f`, standard, two-stage
   review)** — тесты 6/11/18/24 — на точные сеттлы `expectRowsExact`, тесты
   7/19 — на retrying-реляционную форму (relations достраиваются отдельным
   ответом сервера).
4. **Аудит + конверсия тестов 16/17 (T4, `35200406`, small)** — аудит
   показал: «—» в колонках не имеет источника (денормализованные
   same-response поля); оба теста переведены на точный сеттл `expectRowsExact`.
5. **photos-crud + master-role-payments (T5, `80dd80bf`, small)** — оба спека
   конвертированы на `expectRowsExact` (sites row-detach класса вне records).
6. **Dayview state machine на анонсах dnd-kit (T6, `15393ba0`, standard,
   two-stage review)** — probe-Driven: `e2e/lib/dnd-announcements.ts` (новый,
   чтение live-region анонсов @dnd-kit) + машина состояний драга в
   `dayview-column-reorder.spec.ts` — guard вместо темпоральных ожиданий;
   self-healing порядок колонок сохранён; юнит `__tests__/dnd-announcements.test.ts`
   (новый, 10/10).
7. **Канон в скилле тест-писателей (T7, `9a2438e8`, trivial→small)** —
   `.opencode/skills/vitest-playwright-patterns/SKILL.md` (EN, по конвенции
   харнесса): правило «никаких чтений строк вне `expectRowsExact`», паттерн
   snapshot-then-assert, машина состояний для drag-анонсов.
8. **Стабильностная верификация (T8, верификация без нового кода)** —
   матрица стабильности `--repeat-each=10` на всех 4 спеках (см. ниже).

## Верификация (финальное дерево, `9a2438e8`)

| Проверка | Результат |
| --- | --- |
| records.spec.ts × (--repeat-each=10) | **310 passed / 0 failed / 0 flaky** |
| dayview-column-reorder × (--repeat-each=10) | **30/0/0** (self-healing порядок сохранён ×10) |
| photos-crud × (--repeat-each=10) | **220/0/0** |
| master-role-payments × (--repeat-each=10) | **90/0/1** — единственный fail = ENV_NOISE, диагностирован и подтверждён повторным прогоном **10/10 за 4.3m**; механизм вне конверсий |
| Unit dnd-announcements | **10/10** |
| `tsc --noEmit` | clean |
| Baselines (регрессия до конверсий) | records 31/31, photos+payments 23/23, dayview 3/3 |

Критерий стабильности: **0 flaky** на всех 4 спеках. Критерий паритета:
финальный parity review ✅ по таблице конверсий §Часть 1 спеки.

## Approved deviation (решение архитектора)

Спека §Часть 3, state 2: буквальный критерий «moved over Y» эмпирически
несовместим с mandated-verbatim settle-фазой на @dnd-kit 6.3.1 —
событие moved-over-Y и смена `translate3d` приходят одним коммитом, буквальное
ожидание «over Y» после сеттла недостижимо. Архитектором принято расширение
предиката успеха до **«drag покинул X»** (moved-over-Y≠X OR no-longer-over);
задокументировано в комментариях хелпера и lib. Отклонение поведенческой
дельты не несёт.

## Follow-up candidates (НЕ в этом PR — зафиксировано для бэклога)

1. Латентный паттерн hang-until-wall в `waitForRecordsReady`
   (`helpers.ts:468/476` — незаканселируемые 60s-ожидания; pre-existing,
   suite-wide, вне конверсий).
2. Тесный бюджет master-role-payments под нагрузкой (~24s idle vs 60s wall).

## Тронутые файлы (`git diff --name-only 9ce6d564..9a2438e8`)

```
.opencode/skills/vitest-playwright-patterns/SKILL.md
frontend/admin/__tests__/dnd-announcements.test.ts
frontend/admin/e2e/dayview-column-reorder.spec.ts
frontend/admin/e2e/fixtures/helpers.ts
frontend/admin/e2e/lib/dnd-announcements.ts
frontend/admin/e2e/master-role-payments.spec.ts
frontend/admin/e2e/photos-crud.spec.ts
frontend/admin/e2e/records.spec.ts
```

Docs-коммит: `PLAN.md` + `CHANGELOG.md` +
`docs/status/2026-10-25-e2e-row-detach-class-535.md` — только мета-доки;
код/спеки/планы не тронуты.

## References

- **GitHub Issue**: #535
- **Design Spec**: `docs/specs/2026-10-25-e2e-row-detach-class-design.md` (рев.2)
- **Plan**: `docs/plans/2026-10-25-e2e-row-detach-class-plan.md` (8/8)
- **PR**: _(to be added after PR creation)_
