# #124 Wave 1: openModal activity_id targeting + tariff seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Починить openModal helper (матчить по activity_id вместо "first with client-tabs") + добавить tariff seed → un-skip 8 сценариев в unified-rows.spec.ts.

**Architecture:** Hybrid testid targeting + fiber payload. `resolveRecordDate` возвращает `{date, activityId}`, openModal находит карточку по `data-testid="activity-${activityId}"`, извлекает activity-объект из fiber для dispatchEvent. Seed: ≥2 тарифа на services[0].

**Tech Stack:** Playwright E2E, TypeScript, backend seed.py.

**Spec:** `docs/specs/2026-07-18-openmodal-activityid-seed-124-design.md`

---

## Behavioral Delta

How this behaves, mapped to spec acceptance criteria:

- **US-1 (сценарий 6):** E2E tariff→price — openModal открывает правильный factory activity, tariff select имеет ≥2 опции (новый seed), переключение тарифа меняет price → тест PASS
- **US-2 (сценарий 7):** E2E × на visit row — openModal открывает r2's activity (не r1), × триггерит DELETE → PASS
- **US-3 (сценарии 8, 9c, 16, 16b, 17, 19):** openModal детерминированно открывает правильный activity по recordId → add-with-0-visits/reopen/delete/undo flows → PASS
- **US-4 (сценарий 5):** остаётся skipped, аннотация обновлена на "waiting for PATCH /visitors (Wave 2)"
- **US-5 (регрессия):** остальные unified-rows + shard-rest run — 0 новых фейлов

---

## Task 1: Tariff seed — ≥2 tariffs on services[0]

### Classification: small

### Required Docs
- `docs/specs/2026-07-18-openmodal-activityid-seed-124-design.md` — spec
- `frontend/admin/e2e/fixtures/factories.ts:63-104` — createTestActivity берёт services[0]

### Files
- Modify: `backend/src/seed/seed.py` (добавить тарифы на первый сервис)

### Task Description

`createTestActivity` (factories.ts:79) использует `services[0].id`. Сценарии 6 и 17 требуют ≥2 тарифов на этом сервисе. Найти первый сервис в seed (по порядку создания/сортировки GET /api/v1/services) и добавить ≥2 тарифа.

**Критично:** определить какой сервис возвращается первым в `GET /api/v1/services` (проверить ordering в service repository — скорее ORDER BY title или created_at). Добавить тарифы именно на него.

### Steps

- [ ] 1. Определить первый сервис: `cd backend && uv run python -c "from src.seed.seed import *; # или sqlite3 memo.db 'SELECT id,title FROM services ORDER BY ... LIMIT 1'"` — выяснить ordering и id первого сервиса
- [ ] 2. Прочитать текущий seed tariffs для этого сервиса в `backend/src/seed/seed.py`
- [ ] 3. Добавить/убедить ≥2 тарифа с разными price на первом сервисе
- [ ] 4. Re-seed test DB: проверить что `GET /api/v1/services` → services[0] имеет ≥2 tariffs
- [ ] 5. Commit: `test(#124): add ≥2 tariffs on first seed service for E2E tariff scenarios`

### DoD
- [ ] services[0] (первый в GET /api/v1/services) имеет ≥2 тарифа с разными price
- [ ] Seed идемпотентен (re-seed не дублирует)

---

## Task 2: openModal — match by activity_id (hybrid testid + fiber)

### Classification: standard

### Required Docs
- `docs/specs/2026-07-18-openmodal-activityid-seed-124-design.md` — spec, approach section
- `frontend/admin/e2e/fixtures/helpers.ts:55-234` — resolveRecordDate + openModal (текущая реализация)
- Skill: `vitest-playwright-patterns` — E2E conventions

### Files
- Modify: `frontend/admin/e2e/fixtures/helpers.ts` (resolveRecordDate 66-81, openModal 178-234)

### Task Description

**RED:** снять `test.skip` с 8 сценариев (6,7,8,9c,16,16b,17,19) → они FAIL (openModal picks wrong activity / tariff insufficient).

**GREEN:**
1. `resolveRecordDate(recordId)` (helpers.ts:66-81) — добавить `a.id AS activityId` в SELECT, возвращать `{date: row.d, activityId: row.activityId}` вместо `row.d`. Обновить сигнатуру: `resolveRecordDate(recordId?: string): {date: string, activityId: string} | null`.
2. `openModal()` (helpers.ts:178-234) — когда recordId передан: после navigateToWeek искать карточку по `[data-testid="activity-${activityId}"]` вместо перебора первых 5. Извлечь activity-объект из fiber (существующий паттерн 202-211) только из этой конкретной карточки. Когда recordId НЕ передан — fallback на старое поведение (first with client-tabs, для openAddTab и др.).
3. Проверить все вызовы `resolveRecordDate` (openAddTab:250 использует `resolveRecordDate()` без аргументов — должен получить `.date`).

**Un-skip:** снять `test.skip(true, ...)` со строк:
- 100 (сценарий 5 — **НЕ трогаем**, обновляем аннотацию на "waiting for PATCH /visitors (Wave 2)")
- 142 (сценарий 6)
- 208 (сценарий 7)
- 246 (сценарий 8)
- 347 (сценарий 9c)
- 706 (сценарий 16)
- 761 (сценарий 16b)
- 818 (сценарий 17)
- 925 (сценарий 19)

**Верификация:** 8 сценариев PASS standalone, затем shard-run (project shard-rest, SHARD_ID=2) ×2 → 0 флейков.

### Steps

- [ ] 1. Обновить resolveRecordDate: `{date, activityId}` + сигнатура
- [ ] 2. Обновить openModal: activity_id targeting (recordId → testid selector), fallback без recordId
- [ ] 3. Проверить openAddTab:250 — resolveRecordDate() теперь возвращает объект, нужен `.date`
- [ ] 4. Снять test.skip с 8 сценариев (сохранить тела тестов)
- [ ] 5. Обновить аннотацию сценария 5 → "waiting for PATCH /visitors (Wave 2)"
- [ ] 6. RED→GREEN: запустить 8 сценариев standalone → PASS (seed из Task 1 уже применён)
- [ ] 7. Shard-run ×2: `SHARD_ID=2 npx playwright test --project=shard-rest` → 8 сценариев PASS, 0 флейков
- [ ] 8. tsc clean: `npx tsc --noEmit`
- [ ] 9. Commit: `test(#124): openModal matches by activity_id + un-skip 8 unified-rows scenarios`

### DoD
- [ ] E2E сценарии 6,7,8,9c,16,16b,17,19 PASS (RED-GREEN)
- [ ] Сценарий 5 аннотация обновлена (остаётся skipped)
- [ ] Shard-run ×2 — 0 флейков
- [ ] tsc clean
- [ ] Fallback openModal (без recordId) работает — openAddTab и другие callers не сломаны

---

## Task 3: Verification gate + #124/#121 hygiene

### Classification: small

### Required Docs
- `docs/specs/2026-07-18-openmodal-activityid-seed-124-design.md` — DoD

### Task Description

Финальная верификация + issue hygiene (без кода).

### Steps

- [ ] 1. Полный shard-rest прогон ×2 (SHARD_ID=2) → 0 флейков на 8 сценариях
- [ ] 2. Проверить 0 `test.skip` осталось для openModal-причины в unified-rows.spec.ts (кроме сценария 5 → Wave 2, и 10/15/15b → #121)
- [ ] 3. Draft комментарий для #124: "Wave 1 (items 1+2) shipped — 8 scenarios re-enabled (6,7,8,9c,16,16b,17,19). Scenario 5 → Wave 2 (PATCH). Items 3+4 → Wave 2 (CRUD PATCH consolidation)."
- [ ] 4. Draft комментарий для #121: обновить счёт (Wave 1=13, Wave A=4, #124 Wave 1=8; остаток ~19 E2E + #149)

### DoD
- [ ] Shard-run ×2 зелёный
- [ ] Draft-комментарии готовы (для architect — постит после мержа)
