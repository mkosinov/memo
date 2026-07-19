# Design: #124 Wave 1 — openModal activity_id targeting + tariff seed

**Date:** 2026-07-18
**Type:** test-infra fix (E2E harness) + seed-data addition
**Issue:** #124 (items 1+2)
**Related:** #121 (stale-cache — items 10/15/15b OUT of scope), Wave 2 (CRUD PATCH consolidation)

## Problem

`openModal()` в `frontend/admin/e2e/fixtures/helpers.ts:177-233` открывает **первую карточку с client-tabs** на неделе вместо нужной по `activity_id`. Когда несколько seed/factory activities делят неделю → открывается не тот activity → `visit-row-{id}` не найден → timeout.

**Второй root:** tariff seed gap — `createTestActivity` (factories.ts:63) берёт `services[0]`, но на нём <2 тарифов → сценарий 6 (tariff→price switch) не может переключить тариф.

## Scope: A (user-approved)

**7 skipped сценариев в `unified-rows.spec.ts`** (явные openModal+seed):

| # | Сценарий | Root |
|---|---|---|
| 6 | selecting tariff changes price | openModal + **seed gap** |
| 7 | × on existing row → DELETE | openModal |
| 9c | × on existing payment → DELETE | openModal |
| 16 | no F5 after delete visitor (reopen) | openModal |
| 16b | no F5 after delete payment (reopen) | openModal |
| 17 | tariff dropdown populated | openModal + **seed gap** |
| 19 | undo delete restores payment | openModal |

**Сценарий 5 (edit existing visitor name → API call)** — остаётся **skipped до Wave 2**: тест ждёт `PATCH /visitors/{id}` (single-field edit семантика), которая появится только после CRUD PATCH consolidation (VisitorPatch). Un-skip переносится в Wave 2 scope. Skip-аннотация обновляется: "waiting for PATCH /visitors (Wave 2)".

**OUT of scope:**
- Сценарий 5 (edit visitor name) — ждёт PATCH в Wave 2 (выше)
- Сценарии 10/15/15b — помечены #124 но audit (ses_091bf0bc4ffe) нашёл их **MISLABELED** (factory isolated, реальный root = stale-cache #121). Не трогаем. Relabel в #121 hygiene отдельно.

## Approach: Hybrid testid targeting + fiber payload (user-approved)

**Item 1 — openModal fix:**

1. `resolveRecordDate(recordId)` расширяется: возвращает `{date, activityId}` вместо только `date`. SQL уже имеет `JOIN activities a ON r.activity_id = a.id` — добавить `a.id AS activityId` в SELECT.
2. `openModal()` в цикле по карточкам: вместо "first with client-tabs" — находит карточку где `activity.id === activityId` (сравнение из fiber payload). Fallback: если recordId не передан — старое поведение (first with client-tabs).
3. **Targeting:** использовать `data-testid="activity-${activityId}"` для предварительной фильтрации карточек (каноничный Playwright), fiber — только для извлечения полного activity-объекта из уже найденной правильной карточки (dispatchEvent требует полный объект).

**Item 2 — tariff seed:**

Добавить ≥2 тарифа на `services[0]` в `backend/src/seed/seed.py` (первый сервис, который берёт `createTestActivity`). Pure seed-data addition, backend-only.

## Test Strategy

**DoD anchor (RED→GREEN):**
1. RED: 7 сценариев skipped → снимаем `test.skip` → они FAIL (openModal picks wrong activity / tariff insufficient)
2. GREEN: фикс openModal + seed → 7 сценариев PASS
3. Сценарий 5: skip-аннотация обновляется на "waiting for PATCH /visitors (Wave 2)" (остаётся skipped)
4. Регрессия: остальные unified-rows + полный E2E shard-run (shard-rest) — 0 новых фейлов

**Верификация:** локальный shard-прогон (project `shard-rest`, SHARD_ID=2) ×2 → 0 флейков. Затем CI на PR.

**Ожидаемые не-openModal неудачи:** если после openModal fix какой-то из 7 упадёт на НЕ-openModal причине (UI/timing/seed) — диагностируем внутри волны. Мелкий prod/UI баг → фиксим здесь (bug-fix two-gate), крупный → отдельное issue.

## Out of Scope

- Сценарии 10/15/15b (stale-cache #121)
- Item 3 (visitor age-only 422) — Wave 2 (CRUD PATCH)
- Item 4 (stale TODO comment) — Wave 2
- Любые прод-код изменения кроме seed.py

## User Scenarios

- **US-1:** E2E сценарий 6 — openModal открывает factory activity, tariff select имеет ≥2 опции (seed), переключение меняет price → PASS
- **US-2:** E2E сценарий 7 — openModal открывает r2's activity, × на visit row триггерит DELETE → PASS
- **US-3:** E2E сценарии 9c, 16, 16b, 17, 19 — openModal открывает правильный activity, reopen/delete/undo flows работают → PASS
- **US-4:** Сценарий 5 skip-аннотация обновлена на "waiting for PATCH /visitors (Wave 2)" (остаётся skipped, un-skip в Wave 2)
- **US-5 (регрессия):** остальные unified-rows тесты + shard-rest run — 0 новых фейлов

## Visual Compliance Checks

N/A — test-infra + seed, нет UI-изменений.
