# GH #209 — e2e env guardrails (SHARD_ID whitelist, db-path conflict, CI zero-spec guard, canon in dev-workflow)

- **Date**: 2026-09-19
- **Branch**: `209-e2e-env-guardrails`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `5d3a22d1` (main) — 7 commits (`4c1592a5..56e5cbc0`), 15 files, +390 / −44
- **Issue**: #209 — e2e env guardrails, живой остаток постмортема (test-infra only: продуктовый код, схема БД и API не затронуты)
- **Spec**: `docs/specs/2026-09-18-e2e-env-guardrails-design.md` (rev2, on main, unchanged by IMPL)
- **Plan**: `docs/plans/2026-09-18-e2e-env-guardrails-plan.md` (6 tasks, on main, unchanged by IMPL)

## Summary of Changes

- **T1 — SHARD_ID whitelist (S1):** `scripts/e2e-shard-start.sh` rejects any `SHARD_ID` outside
  `{1, 2}` at the top of the script (before `ROOT_DIR`, before any stack machinery): exit 1 with the
  pinned error text `SHARD_ID must be 1 or 2 (canonical shards; got '<value>')` — no stack, no junk
  `test_memo_shardrest.db`. New dryrun case in `scripts/e2e-shard-start.dryrun.test.sh` calls the
  script directly (validation fires before `uv`/`pnpm`, no stubs needed) and asserts exit 1 + the
  `must be 1 or 2` substring; existing happy-path cases (shards 1 and 2) unchanged.
- **T2 — dryrun test wired into CI and the local full run (S4):** new `shard-script-checks` job in
  `.github/workflows/test.yml` (ubuntu-latest, parallel to the e2e matrix, no `needs`, same
  pnpm/node setup steps, no browsers) running the dryrun suite; plus an early step in
  `scripts/test-all.sh` (after env checks, before the shard loop — milliseconds on stubs) wrapped in
  a `command -v timeout` precheck so macOS without coreutils skips with a warning instead of failing.
- **T3 — shared test-DB-path helper, 6 call sites migrated (S2):** new
  `frontend/admin/e2e/lib/db-path.ts` — `resolveTestDbPath({ shardId, testDbPath })` computes the
  repo root itself (4 levels up from `e2e/lib/`), returns `<root>/backend/test_memo_shard${id}.db`
  for a shard id, resolves a relative `TEST_DB_PATH` against the repo root (not `process.cwd()`),
  and — the behavioral delta — THROWS when `SHARD_ID` and `TEST_DB_PATH` resolve to different paths,
  with the error naming the `SHARD_ID` value, the derived path, the `TEST_DB_PATH` value and the
  «уберите одну из переменных» fix hint. Migrated all six duplicated resolution sites:
  `globalSetup.ts` (derived path also feeds the `sqlite3` command), `fixtures/db-query.ts`,
  `fixtures/seed-reset.ts`, `fixtures/factories.ts`, `unify-caches.spec.ts`,
  `visual-compliance-checks.spec.ts` (whose reverse priority «TEST_DB_PATH wins» is gone — one
  contract everywhere). Matching paths stay quiet-ok. Dead `node:path` import dropped from
  `factories.ts` in the cleanup commit.
- **T4 — stale comment fix:** `globalSetup.ts` header comment `test_memo_shard{1-5}.db` →
  `test_memo_shard{1,2}.db` (canonical shard set).
- **T5 — CI guard «project resolves 0 spec files» (S3/S4):** both e2e matrix jobs in `test.yml` and
  `update-snapshots.yml` (project `shard-rest`, before the stack start) get a guard step after
  dependency/browser setup: `pnpm exec playwright test --project=<job project> --list` with stdout
  and stderr captured separately (stderr not scanned — config-error traces contain absolute
  `.spec.ts` paths). Non-zero exit → «project not found» message (typo in project/matrix), exit 1;
  zero `.spec.ts` lines in stdout → «test-filter regression / wrong worktree» message pointing at
  the regex in `frontend/admin/playwright.config.ts:118,125`, exit 1. The job fails early and
  clearly, before servers come up.
- **T6 — canon in the `dev-workflow` skill (S3/S4, deliberately not automated):**
  `.opencode/skills/dev-workflow/SKILL.md` gains (a) the «Visual snapshot regeneration» drill —
  manual `update-snapshots.yml` workflow_dispatch (shard 2) → download `updated-snapshots-shard-rest`
  artifact → copy PNGs into `frontend/admin/e2e/**/*-snapshots/` → commit; local regeneration only
  for iterations with `SHARD_ID` from `{1, 2}`; cross-reference to the full canon
  `docs/tests_workflow.md` (no parallel canon created); (b) the stack-reuse protocol — a listening
  port is not identity; check the owning process's env (`SHARD_ID`, `DATABASE_URL`,
  `NEXT_DIST_DIR`) before reuse, otherwise kill and start fresh; (c) a fresh-worktree checklist in
  the worktree section (`uv sync --extra dev` before pytest; `corepack enable && pnpm install` for
  the frontend; Playwright browsers via cross-reference to the existing check-first section).

## Behavioral Delta (spec §Behavioral Delta — condensed)

| Situation | Before | After |
|---|---|---|
| `SHARD_ID=rest` in `e2e-shard-start.sh` | Silently accepted; junk DB name `test_memo_shardrest.db`; obscure late failure | Instant exit 1 with `must be 1 or 2`, no stack started |
| `SHARD_ID` + conflicting `TEST_DB_PATH` in the TS layer | Silently ignored — inconsistently in 6 places (`visual-compliance-checks` had the reverse priority) | Loud error naming both variables, one contract in all 6 places; matching paths quiet-ok |
| testMatch regression (0 spec files in a project) | Job «green at zero» or obscure fail after servers start | Guard step fails the job early with the class message + pointer to the config regex |
| Snapshot regeneration | Drill existed only in session heads (10 failed attempts on 10.08) | Drill + local path in `dev-workflow` (cross-linked to `docs/tests_workflow.md`) |
| Stack reuse | «Port responds» = safe to work | Protocol: port ≠ identity; check owner-process env, else kill and restart |
| Fresh worktree | Backend test deps not mentioned (`pytest: No such file`) | Checklist in the skill: `uv sync --extra dev` before pytest |

## Tasks (plan)

| # | Task | Classification | Status |
|---|------|----------------|--------|
| T1 | SHARD_ID whitelist + dryrun case | small | ✅ (`4c1592a5`) |
| T2 | dryrun test → CI job `shard-script-checks` + `test-all.sh` | trivial | ✅ (`770b498b`) |
| T3 | `e2e/lib/db-path.ts` helper + 6-site migration + vitest | standard | ✅ (`d84845a5`, cleanup `fa01864b`) |
| T4 | globalSetup header comment `1-5` → `{1,2}` | trivial | ✅ (`4fe85659`) |
| T5 | CI guard 0-spec-files (test.yml ×2 + update-snapshots.yml) | small | ✅ (`372275d4`) |
| T6 | dev-workflow SKILL.md canon (regen drill, reuse protocol, worktree checklist) | small | ✅ (`56e5cbc0`) |

## Test Results

- **Dryrun suite:** `scripts/e2e-shard-start.dryrun.test.sh` — **7/7 green** (incl. the new
  whitelist case; happy-path shards 1/2 unaffected).
- **Frontend vitest (full `pnpm test` in `frontend/admin`):** **2170 passed / 0 failed** —
  new `__tests__/db-path.test.ts` (8 cases: conflict throws naming both vars, same-path quiet-ok in
  absolute and relative forms, shard-only, testDbPath-only, relative resolved against repo root
  regardless of cwd, neither-set default) + `__tests__/seed-reset.test.ts` updated to the new
  contract (the old «shard wins, TEST_DB_PATH ignored» assertion replaced by conflict→throw).
- **Type check:** `tsc --noEmit` clean.
- **Guard simulations (local negative checks): 3/3** — nonexistent project → non-zero exit;
  zero-spec detection logic distinguishes «project not found» from «0 spec files in stdout».
- **Visual compliance gate:** N/A — test-infra only, no UI diff.
- **Both workflows green in the change-PR** (`test.yml` incl. `shard-script-checks`, and
  `update-snapshots.yml`): verified in CI at PR time — the plan's through-DoD, handled by the
  orchestrator at finishing (same pattern as the «AC8 CI pending at finishing» clause of #201).

## Acceptance Criteria

| Spec scenario | Status |
|---|---|
| S1 — `SHARD_ID` outside {1,2} rejected at script entry, dryrun-pinned | ✅ (`4c1592a5`) |
| S2 — loud `SHARD_ID × TEST_DB_PATH` conflict in all 6 TS sites via shared helper | ✅ (`d84845a5`) |
| S3 — CI guard fails a 0-spec project early and clearly | ✅ (`372275d4`; workflow greenness at PR CI) |
| S4 — canonical runs keep working; dryrun wired into CI + test-all; canon recorded | ✅ (`770b498b`, `56e5cbc0`; CI at PR) |

## Key Files Changed

- Scripts: `scripts/e2e-shard-start.sh`, `scripts/e2e-shard-start.dryrun.test.sh`, `scripts/test-all.sh`.
- CI: `.github/workflows/test.yml`, `.github/workflows/update-snapshots.yml`.
- E2E TS layer: `frontend/admin/e2e/lib/db-path.ts` (new), `frontend/admin/e2e/globalSetup.ts`,
  `frontend/admin/e2e/fixtures/{db-query,factories,seed-reset}.ts`,
  `frontend/admin/e2e/unify-caches.spec.ts`, `frontend/admin/e2e/visual-compliance-checks.spec.ts`.
- Tests: `frontend/admin/__tests__/db-path.test.ts` (new), `frontend/admin/__tests__/seed-reset.test.ts`.
- Harness docs: `.opencode/skills/dev-workflow/SKILL.md`.
- No production code, no DB schema, no migrations, no `packages/api-client`, no backend.

## Docs Impact

- Spec + plan live on main and were not touched on this branch.
- `CHANGELOG.md` `[Unreleased] — 2026-09-19` bullet added (this status commit).
- `PLAN.md` — completion blockquote + Priorities table row added.
- Test-run canon stays in `docs/tests_workflow.md` (untouched); the NEW canon (snapshot regen
  drill, stack-reuse protocol, worktree checklist) lives in
  `.opencode/skills/dev-workflow/SKILL.md` by design — deliberately NOT duplicated into
  `tests_workflow.md` (cross-referenced instead, per spec).

## Known Non-Blocking Observations

- CI verification of both workflows happens at PR time (local coverage: dryrun 7/7, guard
  simulations 3/3; the `shard-script-checks` job also proves the `/root/.npm-global/bin/pnpm`
  guard is runner-env-safe — spec open question 4).
- The `test-all.sh` dryrun step's macOS skip path (no `timeout` binary) is untested locally
  (linux env) — precheck logic is a one-liner.
- The guard catches «zero spec files» only; cross-project test leakage is a different error class,
  deliberately out of scope (spec §Что сознательно НЕ строим).
- No pidfile/`--detach` for `e2e-shard-start.sh` — harm neutralized by the #277 cleanup ladder and
  the CI-drill canon (spec scope boundary).

## References

- **GitHub Issue**: #209 (postmortem follow-up)
- **Design Spec**: `docs/specs/2026-09-18-e2e-env-guardrails-design.md` (rev2, on main)
- **Plan**: `docs/plans/2026-09-18-e2e-env-guardrails-plan.md` (on main)
- **Test canon**: `docs/tests_workflow.md`; new ops canon: `.opencode/skills/dev-workflow/SKILL.md`
- **PR**: _(to be added after PR creation)_
