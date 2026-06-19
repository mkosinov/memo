# Testing Strategy v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace CI-based full E2E suite with local pre-push execution; add User Scenarios to specs; add full-flow E2E for 10 user tasks; enforce visual compliance via local gate.

**Architecture:**
- Native `.git/hooks/pre-push` (no Husky) blocks `git push` if local test suite fails
- `scripts/test-all.sh` runs: lint, type-check, vitest, playwright, visual-compliance, pytest
- `postinstall` in root `package.json` installs the hook for new clones
- GitHub Actions simplified to smoke-only (no full Playwright matrix)
- Superagents `brainstorming` and `writing-plans` skills require User Scenarios and E2E coverage
- 10 new full-flow E2E tests for current admin scenarios — RED on `main`, GREEN after bugs fixed (in separate batch fix PR)

**Tech Stack:** bash, Playwright, vitest, pytest, GitHub Actions, native git hooks

**Out of scope:** Wave 4 (batch fix of bugs #73–#86) — separate workstream with its own plan after v2 is merged.

**Note on framework files:** Tasks 11–12 modify `superagents/skills/` (golden source). Task 13 syncs to `memo/.opencode/skills/`. Per workflow: edit framework first, then sync.

---

## File Structure

### New files

| Path | Purpose |
|------|---------|
| `scripts/git-hooks/pre-push` | Source for the pre-push hook |
| `scripts/install-hooks.sh` | Copies hook to `.git/hooks/` |
| `scripts/test-all.sh` | Main test runner (lint, type-check, vitest, e2e, visual, pytest) |
| `.github/PULL_REQUEST_TEMPLATE.md` | PR template with manual smoke checklist |
| `.github/workflows/smoke.yml` | CI smoke workflow (no full E2E matrix) |
| `frontend/admin/e2e/fixtures/scenarios.ts` | Helpers for full-flow E2E (login, openActivity, addVisitor, etc.) |
| `frontend/admin/e2e/admin-clicks-empty-slot.spec.ts` | US-S01 |
| `frontend/admin/e2e/occupied-calc.spec.ts` | US-S03 |
| `frontend/admin/e2e/private-toggle-layout.spec.ts` | US-M01 |
| `frontend/admin/e2e/admin-adds-visitor.spec.ts` | US-M03 (covers M07, M08) |
| `frontend/admin/e2e/admin-opens-profile.spec.ts` | US-M04 |
| `frontend/admin/e2e/admin-changes-status.spec.ts` | US-M05 |
| `frontend/admin/e2e/admin-manages-payments.spec.ts` | US-M06 |
| `frontend/admin/e2e/modal-no-jump.spec.ts` | US-M09 |
| `frontend/admin/e2e/modal-blur-footer.spec.ts` | US-M10 |
| `frontend/admin/e2e/statuses-russian.spec.ts` | US-ST01 |
| `CONTRIBUTING.md` | Documents local test execution |

### Modified files

| Path | Change |
|------|--------|
| `package.json` | Add `postinstall: bash scripts/install-hooks.sh` |
| `frontend/admin/package.json` | Add `type-check` script |
| `frontend/admin/playwright.config.ts` | Remove `grep: skip in CI` line |
| `.github/workflows/test.yml` | Remove `e2e-tests` job (replaced by local) |
| `superagents/skills/brainstorming/SKILL.md` | Require `## User Scenarios` section in spec |
| `superagents/skills/writing-plans/SKILL.md` | Require E2E coverage in DoD |
| `.opencode/skills/brainstorming/SKILL.md` | Synced from superagents |
| `.opencode/skills/writing-plans/SKILL.md` | Synced from superagents |

---

## Task 1: Create `scripts/git-hooks/pre-push`

### Classification: small

### Required Docs
- `docs/specs/2026-06-19-testing-strategy-v2.md` — "Local Test Execution" section, "Mechanism" subsection

### Task Description

Create the source for the git pre-push hook. This script will be copied to `.git/hooks/pre-push` on clone. It runs `scripts/test-all.sh` and blocks the push if any check fails.

### Steps

- [ ] Create directory: `mkdir -p scripts/git-hooks`
- [ ] Create file `scripts/git-hooks/pre-push` with content:
  ```bash
  #!/usr/bin/env bash
  # Pre-push hook: runs local test suite, blocks push on failure
  # Source: scripts/git-hooks/pre-push
  # Installed by: scripts/install-hooks.sh (via postinstall)

  set -euo pipefail

  # Resolve repo root (hooks live in .git/hooks, project in parent)
  HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
  if [[ "$HOOK_DIR" == *"/.git/hooks" ]]; then
    REPO_ROOT="$(cd "$HOOK_DIR/../../.." && pwd)"
  else
    REPO_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
  fi

  TEST_SCRIPT="$REPO_ROOT/scripts/test-all.sh"

  if [ ! -x "$TEST_SCRIPT" ]; then
    echo "❌ test-all.sh not found or not executable at $TEST_SCRIPT"
    echo "   Run: pnpm install (postinstall installs the hook)"
    exit 1
  fi

  exec "$TEST_SCRIPT"
  ```
- [ ] Make executable: `chmod +x scripts/git-hooks/pre-push`
- [ ] Verify file exists: `ls -la scripts/git-hooks/pre-push`
- [ ] Commit:
  ```bash
  git add scripts/git-hooks/pre-push
  git commit -m "feat(scripts): add pre-push hook source

  Source for the git pre-push hook that runs the local test suite
  before allowing push. Installed by scripts/install-hooks.sh via
  postinstall. Part of testing strategy v2 (Wave 1, step W1.2)."
  ```

### Expected output

- File `scripts/git-hooks/pre-push` exists, is executable, contains the bash content above
- One commit added

---

## Task 2: Create `scripts/install-hooks.sh`

### Classification: small

### Required Docs
- `docs/specs/2026-06-19-testing-strategy-v2.md` — "Mechanism" subsection

### Task Description

Create the install script that copies the pre-push hook to `.git/hooks/`. Runs automatically on `pnpm install` via `postinstall`.

### Steps

- [ ] Create file `scripts/install-hooks.sh` with content:
  ```bash
  #!/usr/bin/env bash
  # Installs git hooks from scripts/git-hooks/ to .git/hooks/
  # Runs on `pnpm install` via postinstall in package.json
  # Safe to run multiple times (skips if already installed)

  set -euo pipefail

  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  SRC_DIR="$SCRIPT_DIR/git-hooks"
  GIT_DIR="$(git rev-parse --git-dir 2>/dev/null || echo "")"

  if [ -z "$GIT_DIR" ]; then
    echo "⚠️  Not a git repository. Skipping hook installation."
    exit 0
  fi

  HOOKS_DIR="$GIT_DIR/hooks"

  for hook_file in "$SRC_DIR"/*; do
    [ -e "$hook_file" ] || continue
    hook_name="$(basename "$hook_file")"
    dest="$HOOKS_DIR/$hook_name"

    if [ -f "$dest" ] && [ ! -L "$dest" ]; then
      # Existing hook is not a symlink; skip (don't overwrite)
      echo "⚠️  $hook_name already exists at $dest (not a symlink). Skipping."
      continue
    fi

    if [ -L "$dest" ]; then
      # Remove old symlink
      rm "$dest"
    fi

    cp "$hook_file" "$dest"
    chmod +x "$dest"
    echo "✅ Installed $hook_name → $dest"
  done
  ```
- [ ] Make executable: `chmod +x scripts/install-hooks.sh`
- [ ] Verify: `ls -la scripts/install-hooks.sh`
- [ ] Test in a temp dir (optional): `cd /tmp && git init testhooks && cd testhooks && /root/workspace/memo/scripts/install-hooks.sh && ls -la .git/hooks/`
- [ ] Commit:
  ```bash
  git add scripts/install-hooks.sh
  git commit -m "feat(scripts): add install-hooks.sh

  Copies pre-push hook from scripts/git-hooks/ to .git/hooks/.
  Idempotent: skips if hook already exists. Part of v2 (W1.2)."
  ```

### Expected output

- File `scripts/install-hooks.sh` exists, is executable
- Test install in temp dir shows hook copied

---

## Task 3: Create `scripts/test-all.sh`

### Classification: standard

### Required Docs
- `docs/specs/2026-06-19-testing-strategy-v2.md` — full "Local Test Execution" section

### Task Description

Create the main test runner. Runs lint, type-check, vitest, playwright (including visual regression), visual-compliance check, and backend pytest. Exits 1 if any step fails. Multi-step coordination across 6 distinct test layers — standard complexity.

### Steps

- [ ] Create file `scripts/test-all.sh` with content:
  ```bash
  #!/usr/bin/env bash
  # Local test suite runner. Run by pre-push hook or manually via `pnpm test:all`.
  # Exits 1 on any failure, blocking the push.

  set -euo pipefail

  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  cd "$ROOT"

  echo "🔍 Running local test suite..."

  # 1. Lint
  echo "  → lint..."
  pnpm run lint

  # 2. Type-check (admin app)
  echo "  → type-check..."
  if [ -f "frontend/admin/package.json" ] && \
     grep -q '"type-check"' frontend/admin/package.json; then
    (cd frontend/admin && pnpm run type-check)
  else
    echo "  ⚠️  type-check script not found in frontend/admin/package.json (skip)"
  fi

  # 3. Vitest (admin unit tests)
  echo "  → vitest..."
  (cd frontend/admin && pnpm run test)

  # 4. Playwright (admin E2E + visual regression)
  echo "  → playwright (incl. visual regression)..."
  (cd frontend/admin && pnpm run test:e2e)

  # 5. Visual compliance (against current-user-scenarios.md)
  echo "  → visual-compliance-check..."
  SPEC_FILE="$ROOT/docs/specs/2026-06-19-current-user-scenarios.md"
  if [ ! -f "$SPEC_FILE" ]; then
    echo "  ⚠️  $SPEC_FILE not found; skipping visual compliance"
  elif [ -x "$ROOT/superagents/scripts/visual-compliance-check.sh" ]; then
    "$ROOT/superagents/scripts/visual-compliance-check.sh" \
      http://localhost:3001 \
      "$SPEC_FILE" \
      /tmp/visual-compliance \
      mobile || {
        echo "❌ Visual compliance failed. See /tmp/visual-compliance/report.md"
        exit 1
      }
  else
    echo "  ⚠️  visual-compliance-check.sh not found; skipping"
  fi

  # 6. Backend pytest
  echo "  → backend pytest..."
  if [ -d "backend" ]; then
    (cd backend && uv run pytest)
  else
    echo "  ⚠️  backend/ not found; skipping"
  fi

  echo "🚀 All checks passed."
  ```
- [ ] Make executable: `chmod +x scripts/test-all.sh`
- [ ] Verify: `ls -la scripts/test-all.sh`
- [ ] Commit:
  ```bash
  git add scripts/test-all.sh
  git commit -m "feat(scripts): add test-all.sh

  Local test suite runner: lint, type-check, vitest, playwright,
  visual-compliance, pytest. Exits 1 on failure, blocking push.
  Part of v2 (W1.2)."
  ```

### Expected output

- File `scripts/test-all.sh` exists, is executable
- Manual `bash scripts/test-all.sh` runs all steps (may fail if dev server not running, that's expected)

---

## Task 4: Update root `package.json` with `postinstall`

### Classification: trivial

### Required Docs
- `docs/specs/2026-06-19-testing-strategy-v2.md` — "Mechanism" subsection

### Task Description

Add `postinstall` script to root `package.json` so `pnpm install` automatically installs the git hooks.

### Steps

- [ ] Read current `package.json` (already known: scripts include `build`, `dev`, `lint`, `test`, `test:e2e`, `test:all`, `format`)
- [ ] Add `postinstall` to `scripts` (after `test:all`):
  ```json
  "postinstall": "bash scripts/install-hooks.sh"
  ```
- [ ] Final scripts section should be:
  ```json
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "lint": "turbo lint",
    "test": "turbo test",
    "test:e2e": "turbo test:e2e",
    "test:all": "turbo test:all",
    "postinstall": "bash scripts/install-hooks.sh",
    "format": "prettier --write \"**/*.{ts,tsx,md}\""
  }
  ```
- [ ] Verify JSON is valid: `node -e "JSON.parse(require('fs').readFileSync('package.json'))"`
- [ ] Test: `pnpm install` (in a sandbox clone if possible). Hook should be installed.
- [ ] Commit:
  ```bash
  git add package.json
  git commit -m "chore: run install-hooks.sh on pnpm install

  Adds postinstall script to install git hooks for new clones.
  Part of v2 (W1.3)."
  ```

### Expected output

- `package.json` has `postinstall` script
- `pnpm install` runs install-hooks.sh automatically

---

## Task 5: Add `type-check` script to `frontend/admin/package.json`

### Classification: trivial

### Required Docs
- `docs/specs/2026-06-19-testing-strategy-v2.md` — Wave 1, W1.3

### Task Description

Add a `type-check` script (`tsc --noEmit`) to admin's package.json so the pre-push hook can run TypeScript validation.

### Steps

- [ ] Read `frontend/admin/package.json` (already known: has `lint`, `test`, `test:e2e`, etc.)
- [ ] Add to `scripts`:
  ```json
  "type-check": "tsc --noEmit"
  ```
- [ ] Final scripts section (new line):
  ```json
  "test:e2e:update": "playwright test --update-snapshots",
  "type-check": "tsc --noEmit",
  "test:all": "vitest run && playwright test"
  ```
- [ ] Verify JSON: `node -e "JSON.parse(require('fs').readFileSync('frontend/admin/package.json'))"`
- [ ] Test: `cd frontend/admin && pnpm run type-check` — should complete (may show type errors; that's OK, we'll fix later)
- [ ] Commit:
  ```bash
  git add frontend/admin/package.json
  git commit -m "chore(admin): add type-check script

  Adds tsc --noEmit as pnpm type-check. Used by scripts/test-all.sh
  in pre-push hook. Part of v2 (W1.3)."
  ```

### Expected output

- `frontend/admin/package.json` has `type-check` script
- `pnpm run type-check` works (run from `frontend/admin/`)

---

## Task 6: Remove `grep: skip in CI` from `playwright.config.ts`

### Classification: small

### Required Docs
- `docs/specs/2026-06-19-testing-strategy-v2.md` — Step 3
- `frontend/admin/playwright.config.ts` — current config

### Task Description

Remove the `grep` line that skips visual regression tests in CI. Visual regression should now run as part of `pnpm test:e2e` (called by pre-push hook locally).

### Steps

- [ ] Open `frontend/admin/playwright.config.ts`
- [ ] Find the `grep:` line (around line 29):
  ```ts
  // Skip visual regression tests in CI — they need baseline screenshots
  grep: process.env.CI ? /^(?!.*visual regression|.*schedule with activity|.*schedule — different|.*default state visual|.*menubar visual)/i : undefined,
  ```
- [ ] Replace with comment only:
  ```ts
  // Visual regression runs locally (pre-push) — not skipped.
  // Baseline screenshots committed in *-snapshots/ directories.
  ```
- [ ] Verify: `grep -n "grep:" frontend/admin/playwright.config.ts` — should not find any `grep:` config
- [ ] Test locally: `cd frontend/admin && pnpm run test:e2e` — visual-regression.spec.ts should now run (may fail if baselines stale — note in report)
- [ ] Commit:
  ```bash
  git add frontend/admin/playwright.config.ts
  git commit -m "chore(admin): remove grep:skip for visual regression

  Visual regression now runs as part of pnpm test:e2e (called by
  scripts/test-all.sh in pre-push). Was skipped in CI; now runs
  locally where baselines can be updated consciously. Part of v2
  (W1.4, W1.5)."
  ```

### Expected output

- `grep:` line removed from `playwright.config.ts`
- `pnpm run test:e2e` runs visual-regression.spec.ts (may show diffs; expected if UI changed since baselines)

---

## Task 7: Create `.github/PULL_REQUEST_TEMPLATE.md`

### Classification: trivial

### Required Docs
- `docs/specs/2026-06-19-testing-strategy-v2.md` — Step 5

### Task Description

Create the GitHub PR template with manual smoke checklist for author and reviewer.

### Steps

- [ ] Create file `.github/PULL_REQUEST_TEMPLATE.md` with content:
  ```markdown
  ## Описание
  <!-- Что меняется и зачем. Ссылка на issue/spec. -->

  ## User Scenarios (из спеки)
  <!-- Какие User Scenarios из спеки затронуты? E2E добавлены/обновлены? -->
  - [ ] Scenario X: E2E `path/to/test.spec.ts` added/updated
  - [ ] Scenario Y: covered by existing E2E `path/to/test.spec.ts`
  - [ ] Если добавил новый feature: добавлен scenario в `docs/specs/2026-06-19-current-user-scenarios.md`

  ## Manual smoke — автор (обязательно)
  - [ ] `pnpm test:all` прошёл локально
  - [ ] `cd backend && uv run pytest` прошёл локально
  - [ ] Visual regression прошёл (или baseline обновлён **отдельным** commit, см. ниже)
  - [ ] Если менял UI: ключевые state'ы проверены в браузере

  ## Manual smoke — ревьюер (обязательно)
  - [ ] Все User Scenarios из спеки покрыты E2E
  - [ ] E2E проходят (видно в pre-push логе)
  - [ ] Визуальных регрессий нет (или baseline обновлён обоснованно)
  - [ ] Acceptance criteria спеки выполнены

  ## Visual changes
  - [ ] UI не менялся
  - [ ] UI менялся — diff в скриншотах, baseline обновлён **отдельным** commit с обоснованием
  ```
- [ ] Verify: `cat .github/PULL_REQUEST_TEMPLATE.md`
- [ ] Commit:
  ```bash
  git add .github/PULL_REQUEST_TEMPLATE.md
  git commit -m "chore(ci): add PR template with manual smoke checklist

  Forces author and reviewer to verify local test suite, visual
  regression, and E2E coverage of User Scenarios. Part of v2
  (W1.1)."
  ```

### Expected output

- `.github/PULL_REQUEST_TEMPLATE.md` exists
- GitHub auto-picks it up for new PRs

---

## Task 8: Create `.github/workflows/smoke.yml`

### Classification: standard

### Required Docs
- `docs/specs/2026-06-19-testing-strategy-v2.md` — "CI: smoke only" subsection
- `.github/workflows/test.yml` — current state (for context)

### Task Description

Create a new smoke-only workflow that runs lint, type-check, backend tests, and frontend unit tests — **no full Playwright matrix**. Replaces the heavy e2e-tests job. New CI workflow with 2 parallel jobs — standard complexity.

### Steps

- [ ] Create file `.github/workflows/smoke.yml` with content:
  ```yaml
  name: Smoke

  on:
    push:
      branches: [main]
    pull_request:
      branches: [main]

  jobs:
    # Backend smoke: install + run pytest quickly (single group)
    backend-smoke:
      runs-on: ubuntu-latest
      defaults:
        run:
          working-directory: backend
      steps:
        - uses: actions/checkout@v4
        - uses: astral-sh/setup-uv@v3
        - run: uv python install 3.12
        - run: uv sync --extra dev
        - name: Run pytest (unit + api only)
          run: uv run pytest -m "unit or api" -v --tb=short

    # Frontend smoke: lint + type-check + vitest (no playwright)
    frontend-smoke:
      runs-on: ubuntu-latest
      defaults:
        run:
          working-directory: frontend/admin
      steps:
        - uses: actions/checkout@v4
        - uses: pnpm/action-setup@v4
        - uses: actions/setup-node@v4
          with:
            node-version: 22
            cache: pnpm
        - run: pnpm install --frozen-lockfile
        - run: pnpm run lint
        - run: pnpm run type-check
        - run: pnpm run test
  ```
- [ ] Verify YAML: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/smoke.yml'))"`
- [ ] Commit:
  ```bash
  git add .github/workflows/smoke.yml
  git commit -m "ci: add smoke workflow (lint + types + unit, no playwright)

  Replaces heavy e2e-tests matrix (which moves to local pre-push).
  Runs backend pytest (unit+api) and frontend lint+types+vitest.
  Part of v2 (W1.6)."
  ```

### Expected output

- `.github/workflows/smoke.yml` exists, valid YAML
- Has 2 jobs: backend-smoke, frontend-smoke

---

## Task 9: Remove `e2e-tests` job from `.github/workflows/test.yml`

### Classification: small

### Required Docs
- `.github/workflows/test.yml` — current state
- `docs/specs/2026-06-19-testing-strategy-v2.md` — "CI: smoke only" subsection

### Task Description

Remove the heavy `e2e-tests` job from `test.yml` since the new `smoke.yml` covers what's needed in CI. Full E2E runs locally via pre-push.

### Steps

- [ ] Open `.github/workflows/test.yml`
- [ ] Delete the entire `e2e-tests:` job (lines 101–159 in current file). Keep `backend-tests`, `backend-coverage`, `frontend-tests`.
- [ ] Verify the file still parses: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/test.yml'))"`
- [ ] Verify the structure: `grep -E "^  [a-z-]+:$" .github/workflows/test.yml` should show `backend-tests:`, `backend-coverage:`, `frontend-tests:` (no `e2e-tests:`)
- [ ] Optional: rename the workflow name to reflect smoke-only intent. Change `name: Tests` to `name: Tests (unit + smoke)`. Or leave for clarity.
- [ ] Commit:
  ```bash
  git add .github/workflows/test.yml
  git commit -m "ci: remove e2e-tests job (moved to local pre-push)

  Full Playwright matrix is too expensive for CI runners (near
  monthly limits). Full E2E now runs via scripts/test-all.sh in
  the pre-push hook. CI keeps unit tests + smoke. Part of v2
  (W1.7)."
  ```

### Expected output

- `test.yml` has 3 jobs: backend-tests, backend-coverage, frontend-tests
- No `e2e-tests` job

---

## Task 10: Create/update `CONTRIBUTING.md`

### Classification: trivial

### Required Docs
- `docs/specs/2026-06-19-testing-strategy-v2.md` — full doc

### Task Description

Create `CONTRIBUTING.md` documenting local test execution. If file exists, update with new section.

### Steps

- [ ] Check if `CONTRIBUTING.md` exists: `ls CONTRIBUTING.md 2>/dev/null || echo "create new"`
- [ ] If creating new file, content:
  ```markdown
  # Contributing to Memo

  ## Local development setup

  1. Install dependencies:
     ```bash
     pnpm install
     ```
     This runs `postinstall` which installs git hooks (pre-push runs the test suite).

  2. Run dev servers:
     ```bash
     pnpm dev
     ```

  ## Before pushing

  The pre-push hook runs `scripts/test-all.sh` automatically. If any check fails, push is blocked.

  To run manually:
  ```bash
  pnpm test:all            # frontend (vitest + playwright + visual)
  cd backend && uv run pytest
  ```

  What runs in `scripts/test-all.sh`:
  1. `pnpm lint` (turbo lint)
  2. `pnpm type-check` (admin `tsc --noEmit`)
  3. `pnpm test` (admin vitest)
  4. `pnpm test:e2e` (admin playwright, includes visual regression)
  5. visual-compliance-check.sh (against `docs/specs/2026-06-19-current-user-scenarios.md`)
  6. backend `uv run pytest`

  ## Updating visual regression baselines

  When UI legitimately changes:
  ```bash
  cd frontend/admin
  pnpm run test:e2e:update
  ```
  Commit the baseline PNG updates **as a separate commit** from the fix.

  ## Pre-push hook not installed?

  If you cloned without running `pnpm install`:
  ```bash
  bash scripts/install-hooks.sh
  ```

  Or skip the hook once (NOT recommended):
  ```bash
  git push --no-verify
  ```

  ## Adding a User Scenario

  1. Add scenario to `docs/specs/2026-06-19-current-user-scenarios.md` (and link to E2E)
  2. Add E2E in `frontend/admin/e2e/`
  3. Reference both in your PR description (PR template has checklist)

  ## Adding a new feature

  1. Create a spec in `docs/specs/YYYY-MM-DD-<feature>-design.md`
  2. Spec MUST have a `## User Scenarios` section (Step 1 of v2 strategy)
  3. Implementation plan in `docs/plans/YYYY-MM-DD-<feature>-plan.md`
  4. Each task in plan that touches a User Scenario has DoD: "E2E test for scenario N passes"
  ```
- [ ] If file existed, append a "Local development" section with the content above (preserve existing content).
- [ ] Commit:
  ```bash
  git add CONTRIBUTING.md
  git commit -m "docs: add CONTRIBUTING.md with local test execution

  Documents pre-push hook, scripts/test-all.sh, visual baseline
  updates, and User Scenario workflow. Part of v2 (W1.8)."
  ```

### Expected output

- `CONTRIBUTING.md` exists with sections on local dev, pre-push, visual baseline, User Scenarios

---

## Task 11: Update `superagents/skills/brainstorming/SKILL.md`

### Classification: standard

### Required Docs
- `docs/specs/2026-06-19-testing-strategy-v2.md` — Step 1
- `superagents/skills/brainstorming/SKILL.md` — current

### Task Description

Add a requirement to the brainstorming skill: every new spec must include a `## User Scenarios` section. Framework-wide change affecting all projects that use superagents — standard complexity.

### Steps

- [ ] Open `superagents/skills/brainstorming/SKILL.md`
- [ ] Find the "Checklist" section. After step 4 ("Present design sections"), add a new sub-bullet or note:
  ```markdown
  4. **Present design sections** — in sections scaled to their complexity, get user approval after each section. **Must include a `## User Scenarios` section** listing 3-7 user tasks the feature enables. Each scenario maps to an E2E test.
  ```
- [ ] Also in the "Spec Structure" implicit guidance, the `docs/specs/YYYY-MM-DD-<topic>-design.md` template should now include `## User Scenarios`. Update the example/format to show this section.
- [ ] Add to the "User Review Gate" message: "Confirm spec has `## User Scenarios` section before approval."
- [ ] Commit (in superagents):
  ```bash
  cd /root/workspace/superagents
  git add skills/brainstorming/SKILL.md
  git commit -m "feat(skills): require User Scenarios section in spec

  Part of v2 testing strategy (W1.9). Every new spec must list
  user tasks the feature enables, each mapping to an E2E test."
  ```

### Expected output

- `superagents/skills/brainstorming/SKILL.md` has updated checklist requiring `## User Scenarios`

---

## Task 12: Update `superagents/skills/writing-plans/SKILL.md`

### Classification: standard

### Required Docs
- `docs/specs/2026-06-19-testing-strategy-v2.md` — Step 1 (SDD workflow)
- `superagents/skills/writing-plans/SKILL.md` — current

### Task Description

Add a requirement to the writing-plans skill: every task that touches a User Scenario must have E2E coverage in DoD. Framework-wide change — standard complexity.

### Steps

- [ ] Open `superagents/skills/writing-plans/SKILL.md`
- [ ] Find the "Required Docs Section" guidance. Add a note:
  ```markdown
  **E2E coverage in DoD:** If a task implements a User Scenario from the spec, the DoD must include "E2E test for scenario N passes" — written as a RED-GREEN-REFACTOR cycle. See testing strategy v2.
  ```
- [ ] Also, in the "Task Structure" example, add a sample DoD line referencing E2E.
- [ ] Commit (in superagents):
  ```bash
  cd /root/workspace/superagents
  git add skills/writing-plans/SKILL.md
  git commit -m "feat(skills): require E2E coverage in DoD for scenario tasks

  Part of v2 testing strategy (W1.10). Tasks that implement a
  User Scenario must have E2E in DoD."
  ```

### Expected output

- `superagents/skills/writing-plans/SKILL.md` updated to require E2E in DoD for scenario tasks

---

## Task 13: Sync skill changes to `.opencode/`

### Classification: trivial

### Required Docs
- `/root/workspace/superagents/skills/brainstorming/SKILL.md` — updated in T11
- `/root/workspace/superagents/skills/writing-plans/SKILL.md` — updated in T12

### Task Description

Copy the updated framework skill files to the project's `.opencode/skills/`. Per workflow: framework changes sync to project.

### Steps

- [ ] Sync brainstorming:
  ```bash
  cp /root/workspace/superagents/skills/brainstorming/SKILL.md /root/workspace/memo/.opencode/skills/brainstorming/SKILL.md
  ```
- [ ] Sync writing-plans:
  ```bash
  cp /root/workspace/superagents/skills/writing-plans/SKILL.md /root/workspace/memo/.opencode/skills/writing-plans/SKILL.md
  ```
- [ ] Verify diff (should be empty if already synced): `diff /root/workspace/superagents/skills/brainstorming/SKILL.md .opencode/skills/brainstorming/SKILL.md`
- [ ] Commit:
  ```bash
  git add .opencode/skills/brainstorming/SKILL.md .opencode/skills/writing-plans/SKILL.md
  git commit -m "chore: sync skill updates from superagents

  Synced User Scenarios and E2E coverage requirements from
  superagents to .opencode/. Part of v2 (W1.9, W1.10)."
  ```

### Expected output

- `.opencode/skills/brainstorming/SKILL.md` and `.opencode/skills/writing-plans/SKILL.md` match superagents versions

---

## Task 14: Create `frontend/admin/e2e/fixtures/scenarios.ts`

### Classification: standard

### Required Docs
- `docs/specs/2026-06-19-testing-strategy-v2.md` — Step 2 (template)
- `docs/specs/2026-06-19-current-user-scenarios.md` — scenarios
- `frontend/admin/e2e/fixtures/helpers.ts` — existing helpers
- `frontend/admin/e2e/fixtures/db-query.ts` — existing DB helpers
- `vitest-playwright-patterns` skill (REQUIRED before starting)

### Task Description

Create reusable helpers for full-flow E2E tests. These wrap common actions like login, opening an activity, adding a visitor. Used by the 10 new E2E tests (T15–T24). 5+ exported helpers, integrates with existing fixtures — standard complexity.

### Steps

- [ ] Read existing `frontend/admin/e2e/fixtures/helpers.ts` and `db-query.ts` to understand conventions
- [ ] Invoke `vitest-playwright-patterns` skill
- [ ] Create file `frontend/admin/e2e/fixtures/scenarios.ts` with content:
  ```ts
  import { Page, expect } from '@playwright/test';
  import { waitForScheduleReady } from './helpers';
  import { queryDB, queryDBRow } from './db-query';

  /**
   * Full-flow scenario helpers. Each helper performs a complete
   * user action and returns data the test can assert on.
   *
   * Pattern: helpers throw on failure (use expect), so tests can
   * chain them and assert at the end.
   */

  /**
   * Open a specific activity on the schedule by its title text.
   * Assumes admin is already on /schedule.
   */
  export async function openActivityByTitle(
    page: Page,
    title: string
  ): Promise<void> {
    await waitForScheduleReady(page);
    const card = page.locator(`[data-testid="activity-card"]`).filter({
      hasText: title,
    });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.locator('[role="dialog"]')).toBeVisible();
  }

  /**
   * Switch to the Records tab inside the open activity modal.
   */
  export async function switchToRecordsTab(page: Page): Promise<void> {
    await page.click('button[role="tab"]:has-text("Запись")');
    await expect(page.locator('[data-testid="records-tab"]')).toBeVisible();
  }

  /**
   * Add a visitor (record) to the currently open activity.
   * Returns the record ID from the DB.
   */
  export async function addVisitor(
    page: Page,
    data: { name: string; phone: string; seats: number }
  ): Promise<string> {
    await page.click('button:has-text("Добавить посетителя")');

    await page.fill('input[name="name"]', data.name);
    await page.fill('input[name="phone"]', data.phone);
    await page.fill('input[name="seats"]', String(data.seats));

    await page.click('button:has-text("Сохранить")');

    // Wait for record to appear in list
    const record = page.locator('[data-testid="record"]').filter({
      hasText: data.name,
    });
    await expect(record).toBeVisible({ timeout: 5000 });

    // Return ID from DB
    const row = await queryDBRow(
      `SELECT id FROM records WHERE client_name = '${data.name.replace(/'/g, "''")}' ORDER BY id DESC LIMIT 1`
    );
    if (!row) throw new Error(`Record not found in DB: ${data.name}`);
    return String(row.id);
  }

  /**
   * Read the occupied value from the activity card footer.
   * Returns "N/M" string.
   */
  export async function getOccupied(page: Page): Promise<string> {
    const el = page.locator('[data-testid="occupied"]').first();
    return (await el.textContent()) ?? '';
  }

  /**
   * Get a record's status icon name (Russian).
   */
  export async function getRecordStatus(
    page: Page,
    recordName: string
  ): Promise<string> {
    const record = page.locator('[data-testid="record"]').filter({
      hasText: recordName,
    });
    const icon = record.locator('[data-testid="status-icon"]');
    return (await icon.getAttribute('data-status')) ?? '';
  }
  ```
- [ ] Verify file: `ls -la frontend/admin/e2e/fixtures/scenarios.ts`
- [ ] Type-check: `cd frontend/admin && pnpm run type-check`
- [ ] Commit:
  ```bash
  git add frontend/admin/e2e/fixtures/scenarios.ts
  git commit -m "feat(admin-e2e): add full-flow scenario helpers

  Helpers for login, openActivity, addVisitor, etc. Used by the
  10 new full-flow E2E (W3.1). Part of v2 (Step 2, W2.2)."
  ```

### Expected output

- `frontend/admin/e2e/fixtures/scenarios.ts` exists with helpers
- Type-check passes

---

## Task 15: E2E for US-S01 (click empty slot)

### Classification: small

### Required Docs
- `docs/specs/2026-06-19-current-user-scenarios.md` — US-S01
- `frontend/admin/e2e/fixtures/scenarios.ts` — helpers (T14)
- `vitest-playwright-patterns` skill

### Task Description

Write E2E that verifies admin can click an empty slot to create a new activity. Currently RED (bug #73).

### Steps

- [ ] Invoke `vitest-playwright-patterns` skill
- [ ] Create file `frontend/admin/e2e/admin-clicks-empty-slot.spec.ts`:
  ```ts
  import { test, expect } from '@playwright/test';
  import { waitForScheduleReady } from './fixtures/helpers';

  test('US-S01: Admin can click empty slot to create activity', async ({
    page,
  }) => {
    // ARRANGE: on /schedule
    await page.goto('/schedule');
    await waitForScheduleReady(page);

    // ACT: click an empty time slot
    const emptySlot = page.locator('[data-testid="empty-slot"]').first();
    await expect(emptySlot).toBeVisible();
    await emptySlot.click();

    // ASSERT: create-activity dialog opens with prefilled fields
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('input[name="start"]')).not.toHaveValue('');
    await expect(dialog.locator('input[name="end"]')).not.toHaveValue('');
  });
  ```
- [ ] Run test: `cd frontend/admin && pnpm exec playwright test admin-clicks-empty-slot.spec.ts` — should FAIL (RED)
- [ ] Commit:
  ```bash
  git add frontend/admin/e2e/admin-clicks-empty-slot.spec.ts
  git commit -m "test(admin-e2e): add US-S01 (click empty slot) — RED

  Verifies admin can click an empty slot on /schedule to open
  create-activity dialog with prefilled start/end. Currently
  RED (bug #73). Part of v2 (W3.1)."
  ```

### Expected output

- Test file exists
- Test FAILS on current code (confirms bug #73)

---

## Task 16: E2E for US-S03 (occupied calculation)

### Classification: small

### Required Docs
- `docs/specs/2026-06-19-current-user-scenarios.md` — US-S03
- `frontend/admin/e2e/fixtures/scenarios.ts` — helpers (T14)
- `vitest-playwright-patterns` skill

### Task Description

Write E2E that verifies occupied = sum of seats for active records (excludes cancelled). Currently RED (bug #84).

### Steps

- [ ] Invoke `vitest-playwright-patterns` skill
- [ ] Create file `frontend/admin/e2e/occupied-calc.spec.ts`:
  ```ts
  import { test, expect } from '@playwright/test';
  import { waitForScheduleReady } from './fixtures/helpers';
  import { createActivity, createClient, createRecord, apiClient } from './fixtures/factories';
  import { queryDB } from './fixtures/db-query';

  test('US-S03: occupied = sum of seats for active records (excludes cancelled)', async ({
    page,
    request,
  }) => {
    // ARRANGE: create activity + 3 records (seats 2, 1, 3) + 1 cancelled (seats 5)
    const activity = await createActivity({ capacity: 20 });
    const client1 = await createClient();
    const client2 = await createClient();
    const client3 = await createClient();
    const client4 = await createClient();
    await createRecord({ activity_id: activity.id, client_id: client1.id, visits: [{ seats: 2, status: 'waiting' }] });
    await createRecord({ activity_id: activity.id, client_id: client2.id, visits: [{ seats: 1, status: 'visited' }] });
    await createRecord({ activity_id: activity.id, client_id: client3.id, visits: [{ seats: 3, status: 'waiting' }] });
    await createRecord({ activity_id: activity.id, client_id: client4.id, visits: [{ seats: 5, status: 'cancelled' }] });

    // ACT: load /schedule
    await page.goto('/schedule');
    await waitForScheduleReady(page);

    // ASSERT: occupied shows 2+1+3 = 6, NOT (3 records = 3) and NOT including 5 from cancelled
    const card = page.locator('[data-testid="activity-card"]').filter({
      hasText: activity.service?.title ?? '',
    });
    await expect(card.locator('[data-testid="occupied"]')).toContainText('6/20');
  });
  ```
- [ ] Check existing factories in `frontend/admin/e2e/fixtures/factories.ts` — adapt to actual API. If `createActivity`, `createClient`, `createRecord` don't exist, add them or use direct API calls.
- [ ] Run: `cd frontend/admin && pnpm exec playwright test occupied-calc.spec.ts` — should FAIL
- [ ] Commit:
  ```bash
  git add frontend/admin/e2e/occupied-calc.spec.ts
  git commit -m "test(admin-e2e): add US-S03 (occupied calc) — RED

  Verifies occupied = sum of seats for active records, excluding
  cancelled. Currently RED (bug #84). Part of v2 (W3.1)."
  ```

### Expected output

- Test FAILS on current code (occupied shows wrong value)

---

## Task 17: E2E for US-M01 (private toggle layout)

### Classification: small

### Required Docs
- `docs/specs/2026-06-19-current-user-scenarios.md` — US-M01
- `frontend/admin/e2e/fixtures/scenarios.ts` — helpers (T14)

### Task Description

Verify "Приватное" label is stacked above selector (not in one line). RED (bug #83).

### Steps

- [ ] Create file `frontend/admin/e2e/private-toggle-layout.spec.ts`:
  ```ts
  import { test, expect } from '@playwright/test';
  import { waitForScheduleReady } from './fixtures/helpers';
  import { openActivityByTitle } from './fixtures/scenarios';

  test('US-M01: "Приватное" label is stacked above selector', async ({
    page,
  }) => {
    await page.goto('/schedule');
    await waitForScheduleReady(page);

    // Open any activity
    const card = page.locator('[data-testid="activity-card"]').first();
    await card.click();

    // Switch to Settings tab
    await page.click('button[role="tab"]:has-text("Настройка")');

    // Find "Приватное" label and its selector
    const label = page.locator('label:has-text("Приватное")');
    const selector = page.locator('[data-testid="private-selector"]');

    await expect(label).toBeVisible();
    await expect(selector).toBeVisible();

    // Assert: label is above selector (smaller y-coordinate)
    const labelBox = await label.boundingBox();
    const selectorBox = await selector.boundingBox();
    expect(labelBox).not.toBeNull();
    expect(selectorBox).not.toBeNull();
    if (labelBox && selectorBox) {
      expect(labelBox.y).toBeLessThan(selectorBox.y);
      // And NOT side-by-side (label.x should be less than selector.x with similar y, or label.y much less than selector.y)
      expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(selectorBox.y + 5);
    }
  });
  ```
- [ ] Run: `cd frontend/admin && pnpm exec playwright test private-toggle-layout.spec.ts` — should FAIL
- [ ] Commit:
  ```bash
  git add frontend/admin/e2e/private-toggle-layout.spec.ts
  git commit -m "test(admin-e2e): add US-M01 (private toggle layout) — RED

  Verifies label and selector are stacked, not side-by-side.
  Currently RED (bug #83). Part of v2 (W3.1)."
  ```

---

## Task 18: E2E for US-M03 (add visitor — covers M07, M08)

### Classification: small

### Required Docs
- `docs/specs/2026-06-19-current-user-scenarios.md` — US-M03, US-M07, US-M08
- `frontend/admin/e2e/fixtures/scenarios.ts` — helpers (T14)

### Task Description

Verify admin can add visitor with name/phone/seats and see it in modal without F5. Also covers US-M07 (seats count) and US-M08 (client name) assertions. RED (bugs #75, #80, #85).

### Steps

- [ ] Create file `frontend/admin/e2e/admin-adds-visitor.spec.ts`:
  ```ts
  import { test, expect } from '@playwright/test';
  import { waitForScheduleReady } from './fixtures/helpers';
  import { openActivityByTitle, addVisitor, switchToRecordsTab } from './fixtures/scenarios';
  import { queryDBRow } from './fixtures/db-query';

  test('US-M03: Admin can add visitor and see it in modal without F5', async ({
    page,
  }) => {
    await page.goto('/schedule');
    await waitForScheduleReady(page);

    // Open an activity
    const card = page.locator('[data-testid="activity-card"]').first();
    const titleText = (await card.textContent()) ?? '';
    await card.click();

    // Switch to Records tab
    await switchToRecordsTab(page);

    // Add a visitor
    const recordId = await addVisitor(page, {
      name: 'Тест Тестов',
      phone: '+79991234567',
      seats: 2,
    });

    // US-M03 assertions
    const record = page.locator('[data-testid="record"]').filter({
      hasText: 'Тест Тестов',
    });
    await expect(record).toBeVisible();
    await expect(record).toContainText('+79991234567');
    await expect(record).toContainText('2 места'); // US-M07

    // US-M08: name is shown (not just phone)
    await expect(record.locator('[data-testid="client-name"]')).toContainText('Тест Тестов');

    // Verify in DB
    const row = await queryDBRow(`SELECT seats, status FROM records WHERE id = '${recordId}'`);
    expect(row?.seats).toBe(2);

    // No F5: do not call page.reload()
  });
  ```
- [ ] Run: `cd frontend/admin && pnpm exec playwright test admin-adds-visitor.spec.ts` — should FAIL
- [ ] Commit:
  ```bash
  git add frontend/admin/e2e/admin-adds-visitor.spec.ts
  git commit -m "test(admin-e2e): add US-M03 (add visitor, covers M07, M08) — RED

  Verifies adding visitor with name/phone/seats shows record in
  modal without F5. Covers US-M07 (seats) and US-M08 (name).
  Currently RED (bugs #75, #80, #85). Part of v2 (W3.1)."
  ```

---

## Task 19: E2E for US-M04 (open client profile)

### Classification: small

### Required Docs
- `docs/specs/2026-06-19-current-user-scenarios.md` — US-M04
- `frontend/admin/e2e/fixtures/scenarios.ts`

### Task Description

Verify "Открыть профиль" navigates to `/client/{id}`. RED (bug #76).

### Steps

- [ ] Create file `frontend/admin/e2e/admin-opens-profile.spec.ts`:
  ```ts
  import { test, expect } from '@playwright/test';
  import { waitForScheduleReady } from './fixtures/helpers';
  import { switchToRecordsTab } from './fixtures/scenarios';

  test('US-M04: Admin can open client profile from a record', async ({
    page,
  }) => {
    await page.goto('/schedule');
    await waitForScheduleReady(page);

    // Open an activity with at least one record
    const card = page.locator('[data-testid="activity-card"]').first();
    await card.click();
    await switchToRecordsTab(page);

    // Click "Открыть профиль" on first record
    const firstRecord = page.locator('[data-testid="record"]').first();
    await firstRecord.locator('button:has-text("Открыть профиль")').click();

    // Assert: URL changes to /client/{id}
    await expect(page).toHaveURL(/\/client\/\d+/);

    // Assert: client card is visible
    await expect(page.locator('[data-testid="client-card"]')).toBeVisible();

    // Assert: activity modal is closed
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  });
  ```
- [ ] Run: `pnpm exec playwright test admin-opens-profile.spec.ts` — should FAIL
- [ ] Commit:
  ```bash
  git add frontend/admin/e2e/admin-opens-profile.spec.ts
  git commit -m "test(admin-e2e): add US-M04 (open profile) — RED"
  ```

---

## Task 20: E2E for US-M05 (change status)

### Classification: small

### Required Docs
- `docs/specs/2026-06-19-current-user-scenarios.md` — US-M05
- `frontend/admin/e2e/fixtures/scenarios.ts`

### Task Description

Verify status change via icon picker. Status must be one of 4 Russian names. RED (bugs #77, #78).

### Steps

- [ ] Create file `frontend/admin/e2e/admin-changes-status.spec.ts`:
  ```ts
  import { test, expect } from '@playwright/test';
  import { waitForScheduleReady } from './fixtures/helpers';
  import { switchToRecordsTab, getRecordStatus } from './fixtures/scenarios';

  test('US-M05: Admin can change record status via icon picker', async ({
    page,
  }) => {
    await page.goto('/schedule');
    await waitForScheduleReady(page);

    const card = page.locator('[data-testid="activity-card"]').first();
    await card.click();
    await switchToRecordsTab(page);

    // Find first record's status icon
    const firstRecord = page.locator('[data-testid="record"]').first();
    const recordName = (await firstRecord.locator('[data-testid="client-name"]').textContent()) ?? '';
    const statusIcon = firstRecord.locator('[data-testid="status-icon"]');
    await statusIcon.click();

    // Picker opens with 4 options (icons, Russian labels in tooltips)
    const picker = page.locator('[data-testid="status-picker"]');
    await expect(picker).toBeVisible();
    const options = picker.locator('[data-status]');
    await expect(options).toHaveCount(4);
    await expect(picker).toContainText('Ожидание');
    await expect(picker).toContainText('Посетил');
    await expect(picker).toContainText('Отменил');
    await expect(picker).toContainText('Неявка');

    // Select "Отменил"
    await picker.locator('[data-status="cancelled"]').click();

    // Assert: icon updated
    await expect.poll(async () => getRecordStatus(page, recordName)).toBe('cancelled');
  });
  ```
- [ ] Run: `pnpm exec playwright test admin-changes-status.spec.ts` — should FAIL
- [ ] Commit:
  ```bash
  git add frontend/admin/e2e/admin-changes-status.spec.ts
  git commit -m "test(admin-e2e): add US-M05 (change status) — RED"
  ```

---

## Task 21: E2E for US-M06 (manage payments)

### Classification: small

### Required Docs
- `docs/specs/2026-06-19-current-user-scenarios.md` — US-M06
- `frontend/admin/e2e/fixtures/scenarios.ts`

### Task Description

Verify add multiple payments + delete one. RED (bug #79).

### Steps

- [ ] Create file `frontend/admin/e2e/admin-manages-payments.spec.ts`:
  ```ts
  import { test, expect } from '@playwright/test';
  import { waitForScheduleReady } from './fixtures/helpers';
  import { switchToRecordsTab } from './fixtures/scenarios';

  test('US-M06: Admin can manage multiple payments (add and delete)', async ({
    page,
  }) => {
    await page.goto('/schedule');
    await waitForScheduleReady(page);

    const card = page.locator('[data-testid="activity-card"]').first();
    await card.click();
    await switchToRecordsTab(page);

    // Expand first record's payment section
    const firstRecord = page.locator('[data-testid="record"]').first();
    await firstRecord.locator('button:has-text("Оплата")').click();

    const paymentList = firstRecord.locator('[data-testid="payment-list"]');
    const addBtn = firstRecord.locator('button:has-text("Добавить оплату")');

    // Add 1st payment (1000)
    await addBtn.click();
    await firstRecord.locator('input[name="amount"]').fill('1000');
    await firstRecord.locator('button:has-text("Сохранить")').click();
    await expect(paymentList.locator('[data-testid="payment-row"]')).toHaveCount(1);

    // Add 2nd payment (500)
    await addBtn.click();
    await firstRecord.locator('input[name="amount"]').fill('500');
    await firstRecord.locator('button:has-text("Сохранить")').click();
    await expect(paymentList.locator('[data-testid="payment-row"]')).toHaveCount(2); // NOT 1

    // Delete the 2nd (500)
    const rows = paymentList.locator('[data-testid="payment-row"]');
    await rows.nth(1).locator('button:has-text("Удалить")').click();
    await expect(paymentList.locator('[data-testid="payment-row"]')).toHaveCount(1);
    await expect(rows.first()).toContainText('1000');
  });
  ```
- [ ] Run: `pnpm exec playwright test admin-manages-payments.spec.ts` — should FAIL
- [ ] Commit:
  ```bash
  git add frontend/admin/e2e/admin-manages-payments.spec.ts
  git commit -m "test(admin-e2e): add US-M06 (manage payments) — RED"
  ```

---

## Task 22: E2E for US-M09 (modal no jump)

### Classification: small

### Required Docs
- `docs/specs/2026-06-19-current-user-scenarios.md` — US-M09

### Task Description

Verify modal doesn't jump in height on tab switch. RED (bug #74).

### Steps

- [ ] Create file `frontend/admin/e2e/modal-no-jump.spec.ts`:
  ```ts
  import { test, expect } from '@playwright/test';
  import { waitForScheduleReady } from './fixtures/helpers';

  test('US-M09: Modal does not jump when switching tabs', async ({ page }) => {
    await page.goto('/schedule');
    await waitForScheduleReady(page);

    const card = page.locator('[data-testid="activity-card"]').first();
    await card.click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Measure initial position
    const initialBox = await dialog.boundingBox();
    expect(initialBox).not.toBeNull();

    // Switch to Records tab
    await page.click('button[role="tab"]:has-text("Запись")');
    await page.waitForTimeout(300);
    const recordsBox = await dialog.boundingBox();

    // Switch back to Settings
    await page.click('button[role="tab"]:has-text("Настройка")');
    await page.waitForTimeout(300);
    const settingsBox = await dialog.boundingBox();

    // Width must be unchanged across all three states
    expect(recordsBox?.width).toBe(initialBox?.width);
    expect(settingsBox?.width).toBe(initialBox?.width);

    // Height is fixed (within tolerance)
    expect(Math.abs((recordsBox?.height ?? 0) - (initialBox?.height ?? 0))).toBeLessThan(5);
    expect(Math.abs((settingsBox?.height ?? 0) - (initialBox?.height ?? 0))).toBeLessThan(5);

    // X position unchanged (no horizontal shift)
    expect(recordsBox?.x).toBe(initialBox?.x);
    expect(settingsBox?.x).toBe(initialBox?.x);
  });
  ```
- [ ] Run: `pnpm exec playwright test modal-no-jump.spec.ts` — should FAIL
- [ ] Commit:
  ```bash
  git add frontend/admin/e2e/modal-no-jump.spec.ts
  git commit -m "test(admin-e2e): add US-M09 (modal no jump) — RED"
  ```

---

## Task 23: E2E for US-M10 (modal blur footer)

### Classification: small

### Required Docs
- `docs/specs/2026-06-19-current-user-scenarios.md` — US-M10

### Task Description

Verify footer "x cards" is blurred with the rest. RED (bug #86).

### Steps

- [ ] Create file `frontend/admin/e2e/modal-blur-footer.spec.ts`:
  ```ts
  import { test, expect } from '@playwright/test';
  import { waitForScheduleReady } from './fixtures/helpers';

  test('US-M10: Schedule footer blurs when modal is open', async ({ page }) => {
    await page.goto('/schedule');
    await waitForScheduleReady(page);

    // Capture initial footer text and check it has no filter/blur
    const footer = page.locator('[data-testid="day-footer"]').first();
    await expect(footer).toBeVisible();
    const initialFilter = await footer.evaluate(
      (el) => getComputedStyle(el).filter || getComputedStyle(el.parentElement!).filter
    );
    expect(initialFilter).not.toContain('blur');

    // Open an activity
    const card = page.locator('[data-testid="activity-card"]').first();
    await card.click();
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await page.waitForTimeout(300);

    // Assert: footer (or its parent) has blur
    const blurredFilter = await footer.evaluate(
      (el) => getComputedStyle(el).filter || getComputedStyle(el.parentElement!).filter
    );
    expect(blurredFilter).toContain('blur');
  });
  ```
- [ ] Run: `pnpm exec playwright test modal-blur-footer.spec.ts` — should FAIL
- [ ] Commit:
  ```bash
  git add frontend/admin/e2e/modal-blur-footer.spec.ts
  git commit -m "test(admin-e2e): add US-M10 (modal blur footer) — RED"
  ```

---

## Task 24: E2E for US-ST01 (statuses Russian)

### Classification: small

### Required Docs
- `docs/specs/2026-06-19-current-user-scenarios.md` — US-ST01

### Task Description

Verify status displays use Russian names (not enum). RED (bug #77).

### Steps

- [ ] Create file `frontend/admin/e2e/statuses-russian.spec.ts`:
  ```ts
  import { test, expect } from '@playwright/test';
  import { waitForScheduleReady, waitForRecordsReady } from './fixtures/helpers';

  test('US-ST01: All status displays use Russian names', async ({ page }) => {
    // Visit /records (or wherever statuses appear as text)
    await page.goto('/records');
    await waitForRecordsReady(page);

    // If there are records, check status cells
    const statusCells = page.locator('[data-testid="record-status"]');
    const count = await statusCells.count();
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const text = (await statusCells.nth(i).textContent())?.trim() ?? '';
        expect(['Ожидание', 'Посетил', 'Отменил', 'Неявка']).toContain(text);
      }
    }

    // Also check the status filter dropdown (if present)
    const filter = page.locator('select[aria-label="Фильтр по статусу"]');
    if (await filter.count() > 0) {
      const options = await filter.locator('option').allTextContents();
      for (const opt of options) {
        if (opt === '' || opt === 'Все') continue;
        expect(['Ожидание', 'Посетил', 'Отменил', 'Неявка']).toContain(opt);
      }
    }
  });
  ```
- [ ] Run: `pnpm exec playwright test statuses-russian.spec.ts` — should FAIL
- [ ] Commit:
  ```bash
  git add frontend/admin/e2e/statuses-russian.spec.ts
  git commit -m "test(admin-e2e): add US-ST01 (statuses Russian) — RED"
  ```

---

## Task 25: Replay test — verify all 10 E2E are RED

### Classification: small

### Required Docs
- All 10 E2E test files (T15–T24)
- `docs/specs/2026-06-19-testing-strategy-v2.md` — Acceptance criteria "replay test"

### Task Description

Run all 10 new E2E tests on current `main` (no fixes yet) and confirm they all FAIL. This proves the tests actually catch the bugs — without this, we can't trust that going GREEN means the bugs are fixed.

### Steps

- [ ] Switch to main if not already: `git checkout main` (only in worktree; in main repo stay on main)
- [ ] Run all 10 E2E:
  ```bash
  cd frontend/admin
  pnpm exec playwright test \
    admin-clicks-empty-slot.spec.ts \
    occupied-calc.spec.ts \
    private-toggle-layout.spec.ts \
    admin-adds-visitor.spec.ts \
    admin-opens-profile.spec.ts \
    admin-changes-status.spec.ts \
    admin-manages-payments.spec.ts \
    modal-no-jump.spec.ts \
    modal-blur-footer.spec.ts \
    statuses-russian.spec.ts \
    2>&1 | tee /tmp/replay-test-1.log
  ```
- [ ] Verify all 10 failed: `grep -c "passed" /tmp/replay-test-1.log` should be 0 or low; `grep -c "failed" /tmp/replay-test-1.log` should be 10
- [ ] Save report: `cp /tmp/replay-test-1.log /tmp/replay-test-RED.log`
- [ ] Update coverage matrix in `docs/specs/2026-06-19-current-user-scenarios.md` to mark all 10 as ❌ RED (already is, but verify)
- [ ] Commit report (optional):
  ```bash
  git add docs/specs/2026-06-19-current-user-scenarios.md
  git commit -m "test(admin-e2e): confirm all 10 new E2E are RED on main

  Replay test: ran all 10 new full-flow E2E on current main code.
  All FAIL (as expected — they catch bugs #73-86). After Wave 4
  (batch bug fix) all should be GREEN. Part of v2 (W3.2, W3.3)."
  ```
- [ ] Add a tracking comment to the spec:
  > "**Replay test result (2026-06-19):** 10/10 RED. See `/tmp/replay-test-RED.log`."

### Expected output

- All 10 E2E FAIL on current main
- Replay test log saved at `/tmp/replay-test-RED.log`
- Spec updated with replay test result

---

## Self-Review Checklist

After all tasks complete, verify:

- [ ] All 25 tasks done, each with a commit
- [ ] `pnpm test:all` runs all 6 steps (lint, type-check, vitest, e2e, visual, pytest) — may fail until Wave 4 fix
- [ ] `bash scripts/install-hooks.sh` works in a fresh clone
- [ ] `.git/hooks/pre-push` exists and runs `scripts/test-all.sh` on `git push`
- [ ] `.github/workflows/smoke.yml` exists; `.github/workflows/test.yml` no longer has `e2e-tests` job
- [ ] `.github/PULL_REQUEST_TEMPLATE.md` exists
- [ ] `CONTRIBUTING.md` has local test execution section
- [ ] `superagents/skills/brainstorming/SKILL.md` requires User Scenarios
- [ ] `superagents/skills/writing-plans/SKILL.md` requires E2E coverage in DoD
- [ ] `.opencode/skills/brainstorming/SKILL.md` and `writing-plans/SKILL.md` synced
- [ ] 10 E2E tests exist and all FAIL on current main (replay test passed)
- [ ] No `frontend/admin/playwright.config.ts` `grep:` line for visual regression
- [ ] `frontend/admin/e2e/fixtures/scenarios.ts` exists with helpers
- [ ] `package.json` has `postinstall: bash scripts/install-hooks.sh`
- [ ] `frontend/admin/package.json` has `type-check: tsc --noEmit`

## Out of Scope (separate workstream)

- **Wave 4: Batch bug fix #73–#86** — separate plan, will use the new testing infrastructure built here. After this plan's tasks complete, the next step is to write a new plan for Wave 4.
