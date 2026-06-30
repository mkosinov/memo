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

## Test workflow

For a brief overview of how tests are organized, what each test type does, and how to run them (quick vs full pre-push vs hook), see [docs/tests_workflow.md](docs/tests_workflow.md).

Topics covered:
- Test environment (dev vs E2E shard infrastructure)
- Test commands and working directories
- Visual regression baselines and date stability
- E2E test patterns (`openModal` / `openAddTab` via DB lookup)
- DB conventions

## Adding a User Scenario

1. Add scenario to `docs/specs/2026-06-19-current-user-scenarios.md` (and link to E2E)
2. Add E2E in `frontend/admin/e2e/`
3. Reference both in your PR description (PR template has checklist)

## Adding a new feature

1. Create a spec in `docs/specs/YYYY-MM-DD-<feature>-design.md`
2. Spec MUST have a `## User Scenarios` section (Step 1 of v2 strategy)
3. Implementation plan in `docs/plans/YYYY-MM-DD-<feature>-plan.md`
4. Each task in plan that touches a User Scenario has DoD: "E2E test for scenario N passes"
