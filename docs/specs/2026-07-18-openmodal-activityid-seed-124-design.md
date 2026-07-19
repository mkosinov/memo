# Design: #124 Wave 1 — openModal activity_id targeting + tariff seed

**Date:** 2026-07-18
**Type:** test-infra fix (E2E harness) + seed-data addition
**Issue:** #124 (items 1+2)
**Related:** #121 (stale-cache — items 10/15/15b OUT of scope), Wave 2 (CRUD PATCH consolidation)

## Problem

`openModal()` в `frontend/admin/e2e/fixtures/helpers.ts:177-233` открывает **первую карточку с client-tabs** на неделе вместо нужной по `activity_id`. Когда несколько seed/factory activities делят неделю → открывается не тот activity → `visit-row-{id}` не найден → timeout.

**Второй root:** tariff seed gap — `createTestActivity` (factories.ts:63) берёт `services[0]`, но на нём <2 тарифов → сценарий 6 (tariff→price switch) не может переключить тариф.

## Scope: A (user-approved)

**8 skipped сценариев в `unified-rows.spec.ts`** (явные openModal+seed):

| # | Сценарий | Root |
|---|---|---|
| 5 | edit existing visitor name → PUT | openModal (+ возможный InlineEditCell timing — диагностируем) |
| 6 | selecting tariff changes price | openModal + **seed gap** |
| 7 | × on existing row → DELETE | openModal |
| 9c | × on existing payment → DELETE | openModal |
| 16 | no F5 after delete visitor (reopen) | openModal |
| 16b | no F5 after delete payment (reopen) | openModal |
| 17 | tariff dropdown populated | openModal + **seed gap** |
| 19 | undo delete restores payment | openModal |

**OUT of scope:** сценарии 10/15/15b — помечены #124 но audit (ses_091bf0bc4ffe) нашёл их **MISLABELED** (factory isolated, реальный root = stale-cache #121). Не трогаем. Relabel в #121 hygiene отдельно.

## Approach: Hybrid testid targeting + fiber payload (user-approved)

**Item 1 — openModal fix:**

1. `resolveRecordDate(recordId)` расширяется: возвращает `{date, activityId}` вместо только `date`. SQL уже имеет `JOIN activities a ON r.activity_id = a.id` — добавить `a.id AS activityId` в SELECT.
2. `openModal()` в цикле по карточкам: вместо "first with client-tabs" — находит карточку где `activity.id === activityId` (сравнение из fiber payload). Fallback: если recordId не передан — старое поведение (first with client-tabs).
3. **Targeting:** использовать `data-testid="activity-${activityId}"` для предварительной фильтрации карточек (каноничный Playwright), fiber — только для извлечения полного activity-объекта из уже найденной правильной карточки (dispatchEvent требует полный объект).

**Item 2 — tariff seed:**

Добавить ≥2 тарифа на `services[0]` в `backend/src/seed/seed.py` (первый сервис, который берёт `createTestActivity`). Pure seed-data addition, backend-only.

## Test Strategy

**DoD anchor (RED→GREEN):**
1. RED: 8 сценариев skipped → снимаем `test.skip` → они FAIL (openModal picks wrong activity / tariff insufficient)
2. GREEN: фикс openModal + seed → 8 сценариев PASS
3. Регрессия: остальные unified-rows + полный E2E shard-run (shard-rest) — 0 новых фейлов

**Верификация:** локальный shard-прогон (project `shard-rest`, SHARD_ID=2) ×2 → 0 флейков. Затем CI на PR.

**Ожидаемая не-openModal неудача:** сценарий 5 (InlineEditCell commit timing) может упасть после openModal fix — диагностируем внутри волны. Если это отдельный prod/UI баг — фиксим здесь (bug-fix two-gate), если крупный — отдельное issue.

## Out of Scope

- Сценарии 10/15/15b (stale-cache #121)
- Item 3 (visitor age-only 422) — Wave 2 (CRUD PATCH)
- Item 4 (stale TODO comment) — Wave 2
- Любые прод-код изменения кроме seed.py

## User Scenarios

- **US-1:** E2E сценарий 5 — openModal открывает r1's activity, edit visitor name триггерит PUT /visitors/{id} → PASS
- **US-2:** E2E сценарий 6 — openModal открывает factory activity, tariff select имеет ≥2 опции (seed), переключение меняет price → PASS
- **US-3:** E2E сценарий 7 — openModal открывает r2's activity, × на visit row триггерит DELETE → PASS
- **US-4:** E2E сценарии 9c, 16, 16b, 17, 19 — openModal открывает правильный activity, reopen/delete/undo flows работают → PASS
- **US-5 (регрессия):** остальные unified-rows тесты + shard-rest run — 0 новых фейлов

## Visual Compliance Checks

N/A — test-infra + seed, нет UI-изменений.
