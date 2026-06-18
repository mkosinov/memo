# E2E Sharding: 5 Project-Based Shards Design

**Date:** 2026-06-18
**Issue:** [#71](https://github.com/mkosinov/memo/issues/71)
**Status:** Design — awaiting G1b approval
**Branch:** `ci/e2e-shard-5-projects`
**PR title:** `ci(e2e): split tests into 5 project-based shards (services, schedule, records+activity, clients, rest)`

## Context

Current e2e CI uses Playwright's auto-sharding by alphabetical order of spec files, producing 2 unbalanced shards:
- **shard 1/2** (3m52s): 8 lighter spec files
- **shard 2/2** (5m15s): 8 spec files including the heaviest suites

Total wall time = max(shard 1, shard 2) = **5m15s** — shard 2 dominates the entire run.

After the recent fix to `toHaveCount` API misuse (commit `616bab1`), all tests in shard 2 pass except the long-running schedule column-mode tests are correctly marked `test.fixme()`. The next bottleneck is structural: too many heavy tests in one shard.

## Solution

Replace auto-sharding with **explicit Playwright projects** in `playwright.config.ts`, grouped by domain (not alphabetically). Update GH Actions matrix from `shard: [1, 2]` to `project: [shard-services, shard-schedule, shard-records, shard-clients, shard-rest]`.

5 projects run in parallel in CI. Wall time = slowest single shard.

## Architecture

### Projects

```ts
projects: [
  { name: 'shard-services',  testMatch: /services-crud\.spec\.ts/ },
  { name: 'shard-schedule',  testMatch: /schedule.*\.spec\.ts/ },
  { name: 'shard-records',   testMatch: /(records|activity-details-modal)\.spec\.ts/ },
  { name: 'shard-clients',   testMatch: /clients\.spec\.ts/ },
  { name: 'shard-rest',      testMatch: /^((?!services|schedule|records|activity-details-modal|clients).)*\.spec\.ts$/ },
],
```

### Test file → Project mapping

| Spec file | Lines | Project |
|-----------|-------|---------|
| `activity-card-adaptive.spec.ts` | 154 | shard-rest |
| `activity-details-modal.spec.ts` | 444 | shard-records |
| `clients.spec.ts` | 621 | shard-clients |
| `dayview-column-reorder.spec.ts` | ~50 | shard-rest |
| `locations-crud.spec.ts` | ~80 | shard-rest |
| `masters-crud.spec.ts` | ~100 | shard-rest |
| `masters-submenu.spec.ts` | ~80 | shard-rest |
| `navigation.spec.ts` | 165 | shard-rest |
| `photos-crud.spec.ts` | 170 | shard-rest |
| `records.spec.ts` | 590 | shard-records |
| `schedule.spec.ts` | 177 | shard-schedule |
| `schedule-column-visibility.spec.ts` | 520 | shard-schedule |
| `schedule-day-view.spec.ts` | 295 | shard-schedule |
| `schedule-filters.spec.ts` | 179 | shard-schedule |
| `services-crud.spec.ts` | ~250 | shard-services |
| `tags-crud.spec.ts` | ~150 | shard-rest |

**Total LOC per shard** (approximate):
- `shard-services`: 250
- `shard-schedule`: 1171
- `shard-records`: 1034
- `shard-clients`: 621
- `shard-rest`: ~999

`shard-schedule` is still the heaviest, but isolated. Other heavy shards (records, clients) are no longer combined with it.

### `shard-rest` pattern

Uses **negative lookahead** in regex: `^((?!services|schedule|records|activity-details-modal|clients).)*\.spec\.ts$`. This matches any `.spec.ts` file NOT in the other 4 named projects. New e2e files added to the repo automatically land in `shard-rest` until explicitly added to a named project.

### CI workflow

```yaml
strategy:
  fail-fast: false
  matrix:
    project: [shard-services, shard-schedule, shard-records, shard-clients, shard-rest]
```

Run command:
```bash
pnpm exec playwright test --project=${{ matrix.project }}
```

## Files to change

| File | Change |
|------|--------|
| `frontend/admin/playwright.config.ts` | Replace single `projects: [{name: 'chromium', ...}]` with 5 named projects |
| `.github/workflows/test.yml` | Replace `shard: [1, 2]` matrix with `project: [shard-services, ...]` matrix; update `pnpm exec playwright test --shard=N/2` to `--project=${{ matrix.project }}` |

No source code changes. No test changes.

## Acceptance criteria

- [ ] `playwright.config.ts` has 5 named projects (`shard-services`, `shard-schedule`, `shard-records`, `shard-clients`, `shard-rest`)
- [ ] `.github/workflows/test.yml` matrix uses `project` instead of `shard`
- [ ] Each of the 16 e2e spec files matches exactly one project (verified by `pnpm exec playwright test --list`)
- [ ] All currently-passing e2e tests continue to pass under new sharding
- [ ] `test.fixme()` tests (6 schedule-column-mode tests) remain correctly skipped
- [ ] CI shows 5 e2e jobs (one per project) instead of 2
- [ ] Total e2e CI wall time ≤ 5m (vs current 5m15s)

## Out of scope

- Changes to e2e test code (no fixes, no new tests)
- Changes to backend tests (already split by marker group)
- Changes to frontend unit tests (vitest)
- Changes to other CI jobs
- Re-sharding the `shard-rest` content (intentionally catch-all for new tests)

## Risks

| Risk | Mitigation |
|------|-----------|
| Regex in `shard-rest` might accidentally match a spec from another project | Negative lookahead `(?!)` excludes all 4 named patterns; verified by `--list` |
| New spec file lands in `shard-rest` and makes it the heaviest shard | Acceptable — `shard-rest` is for "everything else"; explicit assignment is preferred for heavy files |
| `webServer` config might conflict per-project on a single CI runner | `webServer` block stays at the top level (not per-project); all 5 projects share one dev server |
| CI matrix changes might break existing required-checks | `e2e-tests` job's required-check status is by job name, not matrix entry — same job, 5 entries instead of 2 |

## Verification

```bash
# Local: verify each spec file lands in exactly one project
cd frontend/admin
for spec in e2e/*.spec.ts; do
  echo "=== $spec ==="
  pnpm exec playwright test --list "$spec" 2>&1 | grep -E "shard-" | sort -u
done

# Local: run one project to verify it works
pnpm exec playwright test --project=shard-services

# CI: check PR shows 5 e2e jobs
gh pr checks <pr-number>  # should show 5 e2e jobs
```

## Related

- `.github/workflows/test.yml` — current sharding config (line ~80)
- `frontend/admin/playwright.config.ts` — current e2e config
- PR #70 — Robustness Bundle (provides context for why this matters)
- Issue #71 — original task
- PR #69 — backend test optimization (precedent for splitting heavy test suites)
