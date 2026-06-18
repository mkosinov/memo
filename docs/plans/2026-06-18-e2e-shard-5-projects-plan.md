# E2E Sharding: 5 Project-Based Shards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Playwright's alphabetical auto-sharding with 5 explicit project-based shards, parallelizing e2e CI runs.

**Architecture:** Add 5 named projects in `playwright.config.ts` with `testMatch` regex per project. Update GH Actions matrix from `shard: [1, 2]` to `project: [...]` so each project runs in parallel.

**Tech Stack:** Playwright 1.60, pnpm, GitHub Actions matrix.

**Branch:** `ci/e2e-shard-5-projects`
**PR title:** `ci(e2e): split tests into 5 project-based shards (services, schedule, records+activity, clients, rest)`
**Closes:** #71

---

## Task 1: Update `playwright.config.ts` with 5 projects
**Classification:** small (single file, ~20 lines changed)

### Required Docs
- `frontend/admin/playwright.config.ts` — current config (read first)
- `docs/specs/2026-06-18-e2e-shard-5-projects-design.md` — design spec, sections "Projects" and "Test file → Project mapping"

### Task Description
Replace the single `projects: [{name: 'chromium', use: ...}]` block with 5 named projects. Each project has a `testMatch` regex that matches exactly one group of e2e spec files.

### Steps

- [ ] **Step 1.1:** Read current config
  ```bash
  cat /root/workspace/memo/.worktrees/ci/e2e-shard-5-projects/frontend/admin/playwright.config.ts
  ```
  Identify the `projects: [...]` block (around line 47-52).

- [ ] **Step 1.2:** Replace the `projects` block
  Find the existing block:
  ```ts
    projects: [
      {
        name: 'chromium',
        use: { ...devices['Desktop Chrome'] },
      },
    ],
  ```
  Replace with:
  ```ts
    projects: [
      {
        name: 'shard-services',
        testMatch: /services-crud\.spec\.ts/,
        use: { ...devices['Desktop Chrome'] },
      },
      {
        name: 'shard-schedule',
        testMatch: /schedule.*\.spec\.ts/,
        use: { ...devices['Desktop Chrome'] },
      },
      {
        name: 'shard-records',
        testMatch: /(records|activity-details-modal)\.spec\.ts/,
        use: { ...devices['Desktop Chrome'] },
      },
      {
        name: 'shard-clients',
        testMatch: /clients\.spec\.ts/,
        use: { ...devices['Desktop Chrome'] },
      },
      {
        name: 'shard-rest',
        testMatch: /^((?!services|schedule|records|activity-details-modal|clients).)*\.spec\.ts$/,
        use: { ...devices['Desktop Chrome'] },
      },
    ],
  ```

- [ ] **Step 1.3:** Verify the config still parses
  ```bash
  cd /root/workspace/memo/.worktrees/ci/e2e-shard-5-projects/frontend/admin
  npx playwright test --list 2>&1 | head -20
  ```
  Expected: shows project names (`shard-services`, `shard-schedule`, etc.) before test names.

- [ ] **Step 1.4:** Verify each spec file lands in exactly one project
  ```bash
  cd /root/workspace/memo/.worktrees/ci/e2e-shard-5-projects/frontend/admin
  for spec in e2e/*.spec.ts; do
    matches=$(npx playwright test --list "$spec" 2>&1 | grep -oE "shard-[a-z]+" | sort -u | tr '\n' ',' | sed 's/,$//')
    echo "$spec → $matches"
  done
  ```
  Expected: each spec appears once, mapped to exactly one shard.

  Reference output (lines vary by file, mapping should be):
  - `activity-card-adaptive.spec.ts` → `shard-rest`
  - `activity-details-modal.spec.ts` → `shard-records`
  - `clients.spec.ts` → `shard-clients`
  - `dayview-column-reorder.spec.ts` → `shard-rest`
  - `locations-crud.spec.ts` → `shard-rest`
  - `masters-crud.spec.ts` → `shard-rest`
  - `masters-submenu.spec.ts` → `shard-rest`
  - `navigation.spec.ts` → `shard-rest`
  - `photos-crud.spec.ts` → `shard-rest`
  - `records.spec.ts` → `shard-records`
  - `schedule.spec.ts` → `shard-schedule`
  - `schedule-column-visibility.spec.ts` → `shard-schedule`
  - `schedule-day-view.spec.ts` → `shard-schedule`
  - `schedule-filters.spec.ts` → `shard-schedule`
  - `services-crud.spec.ts` → `shard-services`
  - `tags-crud.spec.ts` → `shard-rest`

- [ ] **Step 1.5:** Commit
  ```bash
  cd /root/workspace/memo/.worktrees/ci/e2e-shard-5-projects
  git add frontend/admin/playwright.config.ts
  git commit -m "ci(e2e): replace auto-shard with 5 project-based shards

  - shard-services: services-crud
  - shard-schedule: schedule-*
  - shard-records: records + activity-details-modal
  - shard-clients: clients
  - shard-rest: catch-all for everything else (regex negative lookahead)

  Each shard runs in parallel in CI, replacing the previous 2-shard
  auto-distribute. Expected wall time reduction: 5m15s → ≤5m.

  Part of #71."
  ```

---

## Task 2: Update `.github/workflows/test.yml` matrix
**Classification:** small (single file, ~5 lines changed)

### Required Docs
- `.github/workflows/test.yml` — current CI config (read the e2e-tests job, around line 70-100)
- `docs/specs/2026-06-18-e2e-shard-5-projects-design.md` — section "CI workflow"

### Task Description
Change GH Actions matrix from `shard: [1, 2]` to `project: [shard-services, shard-schedule, shard-records, shard-clients, shard-rest]`. Update the playwright test command to use `--project=${{ matrix.project }}` instead of `--shard=${{ matrix.shard }}/2`.

### Steps

- [ ] **Step 2.1:** Read current workflow
  ```bash
  cat /root/workspace/memo/.worktrees/ci/e2e-shard-5-projects/.github/workflows/test.yml
  ```
  Find the `e2e-tests` job (around line 70-110). Look for:
  - The matrix `shard: [1, 2]`
  - The step name `Run E2E tests (shard ${{ matrix.shard }}/2)`
  - The command `pnpm exec playwright test --shard=${{ matrix.shard }}/2`

- [ ] **Step 2.2:** Update the matrix
  Find:
  ```yaml
  e2e-tests:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2]
  ```
  Replace with:
  ```yaml
  e2e-tests:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        project: [shard-services, shard-schedule, shard-records, shard-clients, shard-rest]
  ```

- [ ] **Step 2.3:** Update the step name
  Find:
  ```yaml
    - name: Run E2E tests (shard ${{ matrix.shard }}/2)
  ```
  Replace with:
  ```yaml
    - name: Run E2E tests (${{ matrix.project }})
  ```

- [ ] **Step 2.4:** Update the playwright command
  Find:
  ```bash
    pnpm exec playwright test --shard=${{ matrix.shard }}/2
  ```
  Replace with:
  ```bash
    pnpm exec playwright test --project=${{ matrix.project }}
  ```

- [ ] **Step 2.5:** Verify the workflow YAML is valid
  ```bash
  cd /root/workspace/memo/.worktrees/ci/e2e-shard-5-projects
  python3 -c "import yaml; yaml.safe_load(open('.github/workflows/test.yml'))" && echo "YAML valid"
  ```
  Expected: `YAML valid`.

- [ ] **Step 2.6:** Commit
  ```bash
  cd /root/workspace/memo/.worktrees/ci/e2e-shard-5-projects
  git add .github/workflows/test.yml
  git commit -m "ci(e2e): switch CI matrix to 5 project-based shards

  - Matrix changed: 'shard: [1, 2]' → 'project: [shard-services, ...]'
  - Step name updated to use project name
  - playwright command: --shard=N/2 → --project=<name>

  Each project runs in parallel in CI. Total wall time = max shard,
  not sum. Expected reduction: 5m15s → ≤5m.

  Part of #71."
  ```

---

## Task 3: Local end-to-end verification
**Classification:** small (smoke test, ~5 minutes)

### Required Docs
- `frontend/admin/playwright.config.ts` — new config (with 5 projects)
- `docs/specs/2026-06-18-e2e-shard-5-projects-design.md` — section "Verification"

### Task Description
Run one of the 5 projects end-to-end locally to confirm the new sharding works (tests actually execute, no setup issues). Then run all 4-fixed-specs (clients, records, schedule-*, services) to confirm no regressions.

### Steps

- [ ] **Step 3.1:** Verify dev environment is running
  ```bash
  curl -s -o /dev/null -w "Backend: %{http_code}\n" http://localhost:8000/api/v1/health
  curl -s -o /dev/null -w "Admin: %{http_code}\n" http://localhost:3001
  ```
  Expected: 200, 307.
  If not running: `cd /root/workspace/memo && setsid bash -c 'cd frontend/admin && CI=true exec node_modules/.bin/next dev -p 3001' > /tmp/admin-dev.log 2>&1 < /dev/null & disown` and start backend via `dev.sh -a`.

- [ ] **Step 3.2:** Run shard-services (lightest, fastest)
  ```bash
  cd /root/workspace/memo/.worktrees/ci/e2e-shard-5-projects/frontend/admin
  npx playwright test --project=shard-services
  ```
  Expected: all services-crud tests pass.

- [ ] **Step 3.3:** Run shard-clients (heavy)
  ```bash
  cd /root/workspace/memo/.worktrees/ci/e2e-shard-5-projects/frontend/admin
  npx playwright test --project=shard-clients
  ```
  Expected: all clients tests pass (1 known to be slow).

- [ ] **Step 3.4:** Run shard-rest (catch-all)
  ```bash
  cd /root/workspace/memo/.worktrees/ci/e2e-shard-5-projects/frontend/admin
  npx playwright test --project=shard-rest
  ```
  Expected: all non-services/schedule/records/clients tests pass.

- [ ] **Step 3.5:** Verify shard-records and shard-schedule don't break
  ```bash
  cd /root/workspace/memo/.worktrees/ci/e2e-shard-5-projects/frontend/admin
  npx playwright test --project=shard-records --reporter=line
  npx playwright test --project=shard-schedule --reporter=line
  ```
  Expected: no new failures. (Some pre-existing flaky tests may show as test.fixme/skipped — that's OK.)

- [ ] **Step 3.6:** Report
  Report:
  - Each project's pass/skip/fail counts
  - Any new failures (should be 0)
  - Wall time per project (for reference, not gating)
  - Status: DONE | DONE_WITH_CONCERNS | BLOCKED

  **Do NOT commit anything in this task.** Verification only.

---

## Task 4: Push branch and create PR
**Classification:** trivial

### Required Docs
- All previous tasks' commits on the worktree branch

### Task Description
Push the branch to origin and create PR #71.

### Steps

- [ ] **Step 4.1:** Push
  ```bash
  cd /root/workspace/memo/.worktrees/ci/e2e-shard-5-projects
  git push -u origin ci/e2e-shard-5-projects
  ```

- [ ] **Step 4.2:** Create PR
  ```bash
  cd /root/workspace/memo
  gh pr create --repo mkosinov/memo \
    --base main \
    --head ci/e2e-shard-5-projects \
    --title "ci(e2e): split tests into 5 project-based shards (services, schedule, records+activity, clients, rest)" \
    --body "## Summary

  Replaces Playwright's alphabetical auto-sharding with 5 explicit project-based shards. Each shard runs in parallel in CI, reducing total e2e wall time from 5m15s (max of 2 shards) to ≤5m (max of 5 smaller shards).

  ## Changes

  - \`playwright.config.ts\`: replaced single \`chromium\` project with 5 named projects (\`shard-services\`, \`shard-schedule\`, \`shard-records\`, \`shard-clients\`, \`shard-rest\`)
  - \`.github/workflows/test.yml\`: changed matrix from \`shard: [1, 2]\` to \`project: [shard-services, ...]\`; updated \`--shard=N/2\` to \`--project=<name>\`

  ## Test distribution

  | Project | Spec files | Approx. LOC |
  |---------|-----------|-------------|
  | shard-services | services-crud | 250 |
  | shard-schedule | schedule* (4 files) | 1171 |
  | shard-records | records, activity-details-modal | 1034 |
  | shard-clients | clients | 621 |
  | shard-rest | everything else (8 files) | 999 |

  ## Verification

  - [x] Each of 16 e2e spec files maps to exactly one project (verified by \`pnpm exec playwright test --list\`)
  - [x] Local end-to-end run of each project passes (no new failures)
  - [x] \`test.fixme()\` tests (6 schedule-column-mode) remain correctly skipped

  ## Out of scope

  - No changes to e2e test code
  - No changes to source code
  - No changes to backend tests
  - No changes to vitest unit tests

  Closes #71"
  ```

- [ ] **Step 4.3:** Report
  Report PR URL and status.

---

## Execution notes

- All 4 tasks are sequential (each depends on previous)
- Tasks 1-2 are mechanical file edits; task 3 is verification; task 4 is publishing
- The implementer should run Task 3 (local verification) before Task 4 (push) to catch issues early
- If Task 3 reveals failures, the implementer should report BLOCKED with details — do not push broken code
