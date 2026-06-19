# Testing Strategy v2 — Memo Project

> **Date:** 2026-06-19
> **Status:** Draft (awaiting G1b approval)
> **Supersedes:** `2026-06-03-testing-strategy.md` (v1) — kept as historical reference
> **Companion document:** `2026-06-19-current-user-scenarios.md` — living doc of all current user tasks

## Context

On 2026-06-19, manual review of the admin app surfaced **14 UX/behavioral bugs** (issues #73–#86) — click handlers missing, state not invalidating, layouts broken, status text in English instead of Russian, occupied counter wrong, etc.

The v1 testing strategy (`2026-06-03-testing-strategy.md`) was **partially implemented**:

| v1 Item | Status |
|---------|--------|
| Backend tests (200+, enum, factories) | ✅ Done |
| 5-shard CI matrix (PR #72) | ✅ Done |
| Robustness bundle (PR #70) | ✅ Done |
| E2E infrastructure (db-query, factories) | ✅ Done |
| **Visual regression** | ⚠️ Exists but `grep: skip in CI` (line 29 of `playwright.config.ts`) |
| **Visual compliance gate in CI** | ❌ Not in `.github/workflows/` |
| **PR template** | ❌ Does not exist |
| **User Scenarios in spec** | ❌ Not in any spec |
| **E2E full-flow (outcome assertions)** | ⚠️ Most E2E check `toBeVisible()`, not what user sees |

The bugs that escaped detection are exactly the kind v1 was supposed to catch. v2 closes these gaps and adds **local test execution** (GitHub runners are near their limits) and **scenario-driven development** (UX behavior tested end-to-end).

## Goals

1. **Catch UX bugs before merge** — every user task has an E2E that verifies the outcome, not the click
2. **Move test execution off CI** — full suite runs locally on `git push`; CI only does smoke checks
3. **Make the "what user can do" explicit** — single living doc lists every user task; each maps to E2E
4. **Enforce visual compliance** — no PR merges with broken UI; visual diff blocks push
5. **Preserve the gains of v1** — do not regress the backend test discipline or 5-shard split

## Non-Goals

- **Fixing the 14 bugs (#73–#86)** — separate batch fix PR, not part of v2
- **Cross-browser testing** — Playwright already Chromium-only; out of scope
- **Performance/Accessibility tests** — separate initiatives
- **Migrating existing 25 specs** to the new format — covered by the living user-scenarios doc
- **Backend test refactor** — v1 already delivered this

---

## The 5 Steps

### Step 1: User Scenarios in spec template (for new specs)

**Where:** `docs/specs/YYYY-MM-DD-*-design.md` (every new spec from 2026-06-19 onward)

**What:** Mandatory `## User Scenarios` section listing the user tasks the feature must enable. Each scenario maps to an E2E test (in the "E2E coverage mapping" subsection).

**Format:**

```markdown
## User Scenarios

After this feature ships, the following MUST work end-to-end:

1. **Admin can add a visitor to an activity** — fill name, phone, 2 seats → record visible in modal WITHOUT page refresh, occupied +2 in footer
2. **Admin can change a record's status** — click status icon → choose new status → icon updates, occupied recalculates
3. **Admin can open a client profile from a record** — click "Открыть профиль" → land on `/client/{id}` with card expanded

## E2E coverage mapping

| Scenario | E2E test | Status |
|----------|----------|--------|
| 1 | `frontend/admin/e2e/admin-adds-visitor.spec.ts` | ❌ RED → ✅ GREEN |
| 2 | `frontend/admin/e2e/admin-changes-status.spec.ts` | ❌ RED → ✅ GREEN |
| 3 | `frontend/admin/e2e/admin-opens-profile.spec.ts` | ❌ RED → ✅ GREEN |
```

**Trigger:** Brainstorming skill (Step 1 of workflow) requires this section. Skill prompts: "What user tasks does this feature enable?"

### Step 2: Full-flow E2E pattern

**Where:** `frontend/admin/e2e/*.spec.ts`, helper `frontend/admin/e2e/fixtures/scenarios.ts`

**What:** Every User Scenario → 1 E2E test that asserts on **outcomes** (what the user sees and what is stored), not on intermediate clicks.

**Standard template:**

```ts
test('Admin can add visitor — full flow', async ({ page, request }) => {
  // ARRANGE: login + navigate + preconditions
  await loginAsAdmin(page);
  await openActivityWithCapacity(page, 10);
  
  // ACT: perform user task
  await page.click('button:has-text("Добавить посетителя")');
  await page.fill('input[name="name"]', 'Иван Иванов');
  await page.fill('input[name="phone"]', '+79991234567');
  await page.fill('input[name="seats"]', '2');
  await page.click('button:has-text("Сохранить")');
  
  // ASSERT: outcomes (visible to user + persisted in DB)
  await expect(page.locator('[data-testid="record"]')).toContainText('Иван Иванов');
  await expect(page.locator('[data-testid="record"]')).toContainText('+79991234567');
  await expect(page.locator('[data-testid="record"]')).toContainText('2 места');
  await expect(page.locator('[data-testid="occupied"]')).toContainText('2/10');
  
  // Verify in DB
  const row = await queryDBRow(`SELECT seats FROM records WHERE client_name = 'Иван Иванов'`);
  expect(row?.seats).toBe(2);
  
  // No F5 — assert no reload was needed
  // (test does not call page.reload())
});
```

**DoD:**
- [ ] Helper `e2e/fixtures/scenarios.ts` created (`loginAsAdmin`, `openActivityWithCapacity`, `addVisitor`, etc.)
- [ ] ≥5 full-flow E2E for the top scenarios in `current-user-scenarios.md`
- [ ] Existing E2E not regressed (all 18 spec files still pass)

### Step 3: Visual regression — turn it on in pre-push

**Where:** `frontend/admin/playwright.config.ts` + `frontend/admin/e2e/visual-regression.spec.ts`

**What:** Remove the `grep: skip in CI` exclusion. Visual regression runs as part of the local full suite (pre-push hook), not in CI (which now only does smoke).

**Change:**

```diff
- // Skip visual regression tests in CI — they need baseline screenshots
- grep: process.env.CI ? /^(?!.*visual regression|...)/i : undefined,
+ // Visual regression runs in pre-push locally, not in CI (smoke only)
+ // Baseline screenshots committed in *-snapshots/ directories
```

**DoD:**
- [ ] Baselines in `frontend/admin/e2e/visual-regression.spec.ts-snapshots/` and `week-view.spec.ts-snapshots/` reflect current UI
- [ ] `npm run test:e2e` (without CI=1) runs visual regression successfully locally
- [ ] All 4 existing snapshots are stable (no diff at HEAD)

**Frozen state:** 4 existing snapshots are the baseline. Expansion (more key states) is a separate task — not part of v2.

### Step 4: Hard Visual Gate in pre-push (not in CI)

**Where:** `scripts/test-all.sh` + `superagents/scripts/visual-compliance-check.sh`

**What:** Pre-push hook runs the visual-compliance script. If visual diff exceeds threshold, push is blocked and a report is generated.

**Flow:**

```
$ git push origin fix/some-branch
🔍 Running local test suite...
   ✓ lint
   ✓ type-check
   ✓ vitest
   ✓ playwright (incl. visual regression)
   ✓ visual-compliance-check.sh → diff: 0 pixels
   ✓ backend pytest
🚀 All checks passed. Pushing...
```

If visual diff > threshold:

```
$ git push origin fix/some-branch
🔍 Running local test suite...
   ✓ lint
   ✓ type-check
   ✗ visual-compliance-check.sh → diff: 1247 pixels in modal-new-booking.png
   Report: /tmp/visual-compliance/report.md
❌ Push blocked. Fix visual diff or update baseline (separate commit).
```

**Baseline update policy:** When UI legitimately changes, the implementer commits baseline updates **as a separate commit** from the fix. The fix commit shows the change, the baseline commit shows the new expected state. Both reviewed.

**DoD:**
- [ ] `scripts/test-all.sh` includes `visual-compliance-check.sh` invocation
- [ ] `scripts/git-hooks/pre-push` runs `test-all.sh`
- [ ] Setup script installs the hook on `pnpm install` (via `postinstall`)
- [ ] New clones get the hook automatically

### Step 5: PR template with manual smoke checklist

**Where:** `.github/PULL_REQUEST_TEMPLATE.md` (new file)

**What:** Template with checklist sections for author and reviewer.

**Content:**

```markdown
## Описание
<!-- что меняется, зачем -->

## User Scenarios (из спеки)
<!-- Какие сценарии из спеки затронуты? E2E добавлены/обновлены? -->
- [ ] Scenario X: E2E test `path/to/test.spec.ts` added/updated
- [ ] Scenario Y: covered by existing E2E `path/to/test.spec.ts`

## Manual smoke — автор
- [ ] `pnpm test:all` прошёл локально
- [ ] `cd backend && pytest` прошёл локально
- [ ] Visual regression прошёл (или baseline обновлён осознанно, отдельным commit)
- [ ] Если менял UI: скриншоты ключевых state'ов приложены к PR

## Manual smoke — ревьюер
- [ ] Все User Scenarios из спеки покрыты E2E
- [ ] E2E проходят (видно в pre-push логе)
- [ ] Визуальных регрессий нет (или обоснованно обновлён baseline)
- [ ] Acceptance criteria спеки выполнены

## Visual changes
- [ ] UI не менялся
- [ ] UI менялся — diff в скриншотах, baseline обновлён отдельным commit
```

**DoD:**
- [ ] `.github/PULL_REQUEST_TEMPLATE.md` exists
- [ ] Template renders in new PRs (GitHub auto-picks it up)

---

## Scenario-Driven Development Workflow

Extends TDD for UX behavior. TDD stays for logic; SDD adds end-to-end scenarios.

### When User Scenarios are tested

```
Step 1: Brainstorming
  └─ Спека содержит секцию "## User Scenarios" (Step 1 of v2)
     └─ 3-7 сценариев: "Пользователь может сделать X"

Step 2: writing-plans
  └─ План разбивает сценарии на задачи
     └─ Каждая задача, которая трогает сценарий, имеет DoD:
        "E2E test for scenario N passes"

Step 4: Implementer
  └─ Для задачи, реализующей сценарий:
     1. Пишет E2E (RED — test fails on current code)
     2. Реализует компонент (GREEN — test passes)
     3. Рефакторит (REFACTOR)
  └─ В отчёте: "E2E covered scenarios: N, M"

Step 4d: Reviewer (spec-reviewer)
  └─ Проверяет: какие сценарии из спеки покрыты E2E?
  └─ Если задача трогает сценарий, а E2E нет → BLOCK

Pre-push (локально)
  └─ Прогоняет ВСЕ E2E (старые + новые)
  └─ Если упал хоть один → push заблокирован
```

### Principle

> **A scenario is not "done" until an E2E test verifies it end-to-end.**

This applies to:
- **New features** — scenarios in spec, E2E in PR
- **Bug fixes** — bug → scenario → E2E that fails on broken code, passes after fix
- **Refactors** — existing E2E must still pass; no behavior change

### Existing 25 specs

**Not migrated.** The living doc `2026-06-19-current-user-scenarios.md` documents all current user tasks. Old specs remain as historical feature designs.

---

## Local Test Execution (replaces full CI suite)

### Why

GitHub Actions runners are near monthly limits. Running the full E2E + pytest + vitest on every PR is expensive. v2 moves full execution local.

### Mechanism: native pre-push hook (no Husky)

```
scripts/
├── test-all.sh              # Main test runner
├── install-hooks.sh         # One-time setup for new clones
└── git-hooks/
    └── pre-push             # Source for the hook
```

**`scripts/test-all.sh`** (bash):

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "🔍 Running local test suite..."

echo "  → lint..."
pnpm run lint

echo "  → type-check..."
pnpm run type-check

echo "  → vitest..."
pnpm run test

echo "  → playwright (incl. visual regression)..."
pnpm run test:e2e

echo "  → visual-compliance-check..."
"$ROOT/superagents/scripts/visual-compliance-check.sh" \
  http://localhost:3001 \
  docs/specs/2026-06-19-current-user-scenarios.md \
  /tmp/visual-compliance \
  mobile || {
    echo "❌ Visual compliance failed. See /tmp/visual-compliance/report.md"
    exit 1
  }

echo "  → backend pytest..."
cd backend && pytest
cd "$ROOT"

echo "🚀 All checks passed."
```

**`scripts/git-hooks/pre-push`** (copied to `.git/hooks/pre-push` by install script):

```bash
#!/usr/bin/env bash
exec "$(dirname "$0")/../../scripts/test-all.sh"
```

**`scripts/install-hooks.sh`** (run by `postinstall`):

```bash
#!/usr/bin/env bash
HOOK_SRC="$(dirname "$0")/git-hooks/pre-push"
HOOK_DST="$(git rev-parse --git-dir)/hooks/pre-push"

if [ -f "$HOOK_DST" ]; then
  echo "pre-push hook already installed at $HOOK_DST"
  exit 0
fi

cp "$HOOK_SRC" "$HOOK_DST"
chmod +x "$HOOK_DST"
echo "✅ pre-push hook installed at $HOOK_DST"
```

**`package.json`** (postinstall):

```json
{
  "scripts": {
    "postinstall": "bash scripts/install-hooks.sh",
    "test:all": "bash scripts/test-all.sh"
  }
}
```

### CI: smoke only

`.github/workflows/smoke.yml`:

```yaml
name: smoke
on: [push, pull_request]
jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm run lint
      - run: pnpm run type-check
      - run: pnpm run test
      - run: pnpm run test:unit  # vitest only, no playwright
```

The existing `test.yml` (full E2E matrix) is **removed or simplified** to remove the full Playwright matrix.

### Trade-offs

| Pro | Con | Mitigation |
|-----|-----|------------|
| 0 CI minutes on full suite | Developer can `git push --no-verify` | Code review catches missing E2E |
| Fast local feedback | Pre-push takes 2-3 min | Parallel execution of vitest+pytest |
| CI stays cheap (smoke) | New clones need `pnpm install` to get hook | `postinstall` runs install-hooks.sh automatically |

---

## Current User Scenarios Doc

`docs/specs/2026-06-19-current-user-scenarios.md` (companion to this spec) lists **all 14 user tasks the admin app currently supports**. Each maps to:
- An E2E test (path)
- A status (✅ covered by E2E, ❌ known gap)
- Related issues (e.g., #75, #80, #85 → US-M03)

**Owner:** @docser (writes and maintains). Developers flag new scenarios in PRs.

**Update rules:**
- New feature → add scenario to doc + E2E test (PR review checks)
- Bug fix → link bug to existing scenario; update scenario status
- Removed feature → remove scenario; mark E2E as deleted

This doc is the **single source of truth** for "what does the app do for users." It is referenced by the PR template, by the testing strategy, and by code review.

---

## Implementation Waves

### Wave 1 — Infrastructure (today, ~4–6 hours)

| # | Action | Owner | Files |
|---|--------|-------|-------|
| W1.1 | Create PR template | @infra | `.github/PULL_REQUEST_TEMPLATE.md` |
| W1.2 | Create test-all.sh + git-hooks/pre-push + install-hooks.sh | @infra | `scripts/*` |
| W1.3 | Update package.json with postinstall + test:all | @infra | `package.json` |
| W1.4 | Update playwright.config.ts (remove grep:skip) | @frontend-coder | `frontend/admin/playwright.config.ts` |
| W1.5 | Verify/refresh visual regression baselines | @frontend-coder | `frontend/admin/e2e/*-snapshots/` |
| W1.6 | Create smoke workflow | @infra | `.github/workflows/smoke.yml` |
| W1.7 | Simplify/remove existing test.yml full E2E matrix | @infra | `.github/workflows/test.yml` |
| W1.8 | Update CONTRIBUTING.md | @docser | `CONTRIBUTING.md` |
| W1.9 | Update superagents `brainstorming` skill (require User Scenarios) | @infra | `superagents/skills/brainstorming/SKILL.md` |
| W1.10 | Update superagents `writing-plans` skill (require E2E coverage in DoD) | @infra | `superagents/skills/writing-plans/SKILL.md` |

### Wave 2 — Docs + E2E pattern (tomorrow, ~1 day)

| # | Action | Owner | Files |
|---|--------|-------|-------|
| W2.1 | Create `current-user-scenarios.md` (14 scenarios) | @docser | `docs/specs/2026-06-19-current-user-scenarios.md` |
| W2.2 | Create `e2e/fixtures/scenarios.ts` (helpers) | @frontend-coder | `frontend/admin/e2e/fixtures/scenarios.ts` |
| W2.3 | (this spec committed) | @docser | `docs/specs/2026-06-19-testing-strategy-v2.md` |

### Wave 3 — E2E for current scenarios (1–2 days)

| # | Action | Owner |
|---|--------|-------|
| W3.1 | Write 10 new E2E for US-S01, US-S03, US-M01, US-M03, US-M04, US-M05, US-M06, US-M09, US-M10, US-ST01 (US-M07, US-M08 covered by US-M03; US-S02, US-M02 use existing E2E) | @frontend-coder |
| W3.2 | Confirm all 10 new E2E are RED on current `main` | @frontend-coder |
| W3.3 | Update coverage matrix in living doc | @docser |

**E2E go on the fix branch, not main**, to avoid a red `main`. After the fix lands, all 10 new E2E are GREEN.

### Wave 4 — Batch bug fix #73–#86 (after Wave 3, ~2–3 days)

| # | Action | Owner |
|---|--------|-------|
| W4.1 | Fix all 14 bugs in one batch PR | @frontend-coder |
| W4.2 | Verify all 10 new E2E are GREEN | @frontend-coder |
| W4.3 | Update visual regression baselines (separate commit) | @frontend-coder |
| W4.4 | Update coverage matrix in living doc (all ✅) | @docser |

---

## Acceptance Criteria

### Documents
- [ ] `docs/specs/2026-06-19-testing-strategy-v2.md` (this file) exists and approved
- [ ] `docs/specs/2026-06-19-current-user-scenarios.md` exists with 14 scenarios
- [ ] 25 old specs **not modified** (living doc covers)

### Infrastructure
- [ ] `.github/PULL_REQUEST_TEMPLATE.md` with manual smoke checklist
- [ ] `scripts/test-all.sh` runs: lint, type-check, vitest, playwright, visual-compliance, pytest
- [ ] `scripts/git-hooks/pre-push` blocks push on test failure
- [ ] `scripts/install-hooks.sh` runs automatically on `pnpm install` (postinstall)
- [ ] `.github/workflows/smoke.yml` runs only lint + types + unit
- [ ] Existing `.github/workflows/test.yml` simplified (no full Playwright matrix)
- [ ] `CONTRIBUTING.md` documents local test execution
- [ ] `frontend/admin/playwright.config.ts` no longer skips visual regression in CI

### Skills (framework)
- [ ] `superagents/skills/brainstorming/SKILL.md` requires `## User Scenarios` section
- [ ] `superagents/skills/writing-plans/SKILL.md` requires E2E coverage in DoD

### E2E coverage
- [ ] 10 new E2E tests for scenarios linked to bugs #73–#86 (US-S01, US-S03, US-M01, US-M03, US-M04, US-M05, US-M06, US-M09, US-M10, US-ST01)
- [ ] US-M07 and US-M08 covered by US-M03 E2E (assertions on name and seats)
- [ ] US-S02 and US-M02 use existing E2E (`schedule.spec.ts`, `activity-details-modal.spec.ts`)
- [ ] Replay test: all 10 new E2E are RED on `main` (proves they catch the bugs)
- [ ] After Wave 4: all 10 new E2E are GREEN

### Process
- [ ] Bugs #73–#86 closed
- [ ] Living doc coverage matrix: all 14 scenarios ✅
- [ ] Pre-push hook blocks at least 1 known-broken scenario (replay test)

---

## Risks

| # | Risk | Probability | Mitigation |
|---|------|-------------|------------|
| 1 | Developer does `git push --no-verify` | Medium | Code review catches missing E2E; CONTRIBUTING documents |
| 2 | Pre-push is slow (2–3 min) | High | Parallel execution where possible; progress bar |
| 3 | E2E flaky in pre-push | Medium | Retry policy (1 retry); stabilize fixtures |
| 4 | Visual baselines break on legitimate UI changes | High | Separate commit for baseline; PR template requires justification |
| 5 | 10 new E2E miss some bugs | Low | Bug↔scenario links in issues #73–#86; reviewer checks |
| 6 | Living doc forgotten on new feature | High | PR template requires "added new scenario to living doc" |
| 7 | Smoke CI catches less than before | Medium | Pre-push compensates; visual gate + smoke = sufficient |
| 8 | Superagents skill edit breaks other projects | Low | Brainstorming skill change is additive (new section), not breaking |
| 9 | Backend pytest in pre-push slow | Medium | Already 1m47s (PR #68); tolerable |
| 10 | After Wave 3, `main` is red | High | E2E added on fix branch, not `main`; merge only after fix |

---

## Resolved Open Questions

| # | Question | Decision | Date |
|---|----------|----------|------|
| Q1 | `scripts/test-all.sh` — bash or node? | **bash** (polyglot standard, no deps) | 2026-06-19 |
| Q2 | Husky vs native pre-push? | **native `.git/hooks/pre-push`** (no extra dep) | 2026-06-19 |
| Q3 | Visual regression baseline — same or separate commit? | **separate commit** (easier review of visual diff) | 2026-06-19 |
| Q4 | Owner of `current-user-scenarios.md`? | **@docser** (writers/owners docs) | 2026-06-19 |
| Q5 | `visual-regression.spec.ts` — expand now? | **freeze at 4 snapshots** (expand later) | 2026-06-19 |
| Q6 | How to add RED E2E without breaking `main`? | **on fix branch, merge with fix** | 2026-06-19 |

---

## Visual Compliance Checks

These states should be screenshot-stable. The `visual-compliance-check.sh` script verifies these (run during pre-push).

- [ ] `/schedule` with 1 activity
- [ ] `/schedule` with 5+ activities (grid stress)
- [ ] `/schedule` with `ActivityDetailModal` open (full backdrop blur)
- [ ] `ActivityDetailModal` — Settings tab (default state)
- [ ] `ActivityDetailModal` — Records tab with 1 record
- [ ] `ActivityDetailModal` — Records tab with 5+ records (scrollable)
- [ ] `ActivityDetailModal` — Records tab with cancelled record
- [ ] Status icon — 4 variants (Ожидание, Посетил, Отменил, Неявка)

**Current baseline snapshots (4):**
- `modal-settings-chromium-linux.png`
- `modal-new-booking-chromium-linux.png`
- `records-default-chromium-linux.png`
- `records-filtered-chromium-linux.png`

**Frozen at v2 ship.** Expansion tracked separately.

---

## References

- v1: `docs/specs/2026-06-03-testing-strategy.md` (kept as historical)
- v1 audit: `docs/specs/2026-06-03-testing-audit.md`
- Bugs surfaced: issues #73–#86
- Recent merges: PR #70 (robustness bundle), PR #72 (E2E 5-shard), PR #68 (pytest optimization)
- Visual gate script: `superagents/scripts/visual-compliance-check.sh`
