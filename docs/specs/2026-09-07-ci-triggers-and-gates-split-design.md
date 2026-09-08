# GH #245 — CI: split Smoke/Tests by purpose and redistribute test gates (delete CI smoke, full Tests on PR + dispatch, G3 becomes a CI fact-check)

- **Issue:** #245 `chore(ci): развести Smoke и Tests по триггерам + concurrency-отмена — сейчас полный дубль на каждый push и PR`
- **Status:** DESIGN phase, G1a passed 2026-09-07 (concept approved after 5 dialogue rounds). Panel round 1 (revision 0): completeness SOUND_WITH_CONCERNS, feasibility + best-practices NEEDS_REVISION, consistency + simplicity crashed twice on provider errors (429/502) → skipped in round 1, re-dispatched against revision 1. User gate decisions: A → fix the vitest matrix in scope (D10); B → accept docs-only PR cost (§3). Panel round 2 (revision 1): consistency + simplicity both SOUND_WITH_CONCERNS; their findings folded into revision 2 (D6 pinned to the real `test` script, D11 permissions lockdown cut, line-ref and wording fixes). All reviewer claims fact-checked against the live tree before folding.
- **Scope:** `.github/workflows/` (test.yml triggers+concurrency+permissions+new job+matrix rework, smoke.yml deleted), container harness (`.opencode/agents/architect.md` G3, `.opencode/skills/finishing-a-development-branch/SKILL.md` G7), docs (`docs/tests_workflow.md`), stale comment in `scripts/git-hooks/pre-push`. No application code, no domain entities, no domain-rules changes.
- **Grounding:** scout fact sheet 2026-09-07 (run stats window 2026-08-08 → 2026-09-07, live tree at commit `fea1ca4`) + host spot checks during the G1a dialogue (git hooks, push composition, harness gate files) + panel-round verifications (smoke.yml admin-scoped commands, vitest group-5 fall-through). All issue claims verified: confirmed except "public since 2026-09-07" (not verifiable via API; repo is PUBLIC today).

---

## 1. Context & Problem

### 1.1 Current CI (live-tree facts)

- Two workflows with **identical triggers** (push to main + pull_request): `smoke.yml:3-7` and `test.yml:3-7`. Neither has `workflow_dispatch`, `schedule`, `paths` filters, or a `concurrency` block (grep over `.github/` finds no `concurrency:` anywhere).
- **smoke.yml jobs:** `backend-smoke` (pytest `-m "unit or api"`, smoke.yml:11-22), `frontend-smoke` (lint + type-check + vitest, all **admin-scoped**: `working-directory: frontend/admin`, `pnpm run lint` / `pnpm run type-check` / `pnpm run test`, smoke.yml:25-40). **This is the only place in CI that runs lint and type-check.**
- **test.yml jobs:** `backend-tests` matrix (unit / api / integration / misc, test.yml:10-37), `backend-coverage` (serialized via `needs: backend-tests`, test.yml:39-59), `frontend-tests` matrix groups 1–5 (**vitest only**, no lint/type-check, test.yml:61-99). Groups 1–4 list test files **by hand**; group 5 inverts them (`--exclude='**/Client*.test.tsx' --exclude='**/CustomSelect.test.tsx' --exclude='**/RecordsTable.test.tsx' --exclude='**/ClientsIntegration.test.tsx'`, test.yml:78-92). Fall-through hole (verified): a NEW test file whose name matches none of the exclude globs does run in group 5, but a new `Client*.test.tsx`-named file is excluded from group 5 and absent from groups 1–4 → **silently runs nowhere**; the lists also drift silently as tests are added. `skip-tracker` (warning-only, never fails the build, test.yml:101-115), `e2e-tests` shards `shard-schedule` + `shard-rest` (test.yml:117-204).
- `update-snapshots.yml`: manual dispatch only, ubuntu-latest (font-stack constraint — untouched by this spec).

### 1.2 Run statistics (30 days, 2026-08-08 → 2026-09-07)

- 98 Smoke runs + 98 Tests runs (76 push-to-main + 22 pull_request each, same timestamps — every event ran both).
- Wall clock: Smoke median 3.6 min (~281 min/30d); Tests median 12.5 min (~1923 min/30d). Tests is dominated by e2e `shard-rest` (median 12.5 min, ~65% of a run's cost); the duplicated unit/api re-run is only ~108 min/30d (~5%).
- Queue wait median **0 min** — no observable queuing; stale runs waste free minutes, not developer time.
- Tests failed 47/98 (48%) vs Smoke 16/98 (16%) — with `retries: 1` already enabled in CI (`frontend/admin/playwright.config.ts:47`). Flake elimination is tracked separately in #246.
- Pushes to main: **106 of 128 commits are docs-only** (specs/plans/harness markdown — DESIGN-phase pushes). All code reaches main exclusively via squash-merged PRs (25 in 30d, zero direct merge commits). Full CI ran on every docs push for nothing.

### 1.3 Local gates (container harness, current)

- **G3** (`architect.md` Step 0, plan-only start): worktree from fresh main + "run the project's baseline tests" — a local full-suite run to prove clean state; red → BLOCKED.
- **G6** (`code-quality-reviewer.md:29-36`): mandatory local run of the full suite **by change scope** — backend → whole pytest; frontend logic-only → vitest; frontend UI → `test:all` (vitest + playwright visual). Any failure = Critical, approval forbidden. **Review-budget caveat** (canon impl-phase "Task classification & review budget"): only Standard/Large tasks get this reviewer — Trivial (≤5 lines, no logic) gets self-review, Small (1 file, <50 lines) gets spec-review; neither mandatorily runs the local suite.
- **G4.5**: visual compliance (`visual-compliance-check.sh`), UI phases only, soft block.
- **G7 pre-push** (`finishing-a-development-branch/SKILL.md:25-26,34-42`): "fast suites only — unit/integration tests + typecheck/lint. NO local e2e as a gate… The authoritative merge gate is CI." The fast suite for memo = backend whole pytest (~141 s / 1138 tests) + frontend vitest (~1–3 min) + type-check + lint (policy: finishing SKILL.md:25; timings: `dev-workflow/SKILL.md:102-104` — whose `test:unit` command name is stale, fixed by D6). This composition is a **strict superset of CI smoke** (it also covers backend integration).
- **Local git hook** `scripts/git-hooks/pre-push`: deliberately disabled no-op (`exit 0`) — its comment says tests moved to CI. Its role is covered by the G7 agent discipline; we do not re-enable it.
- Branch protection: none on main (404), merge queue off, auto-merge off, nothing consumes check names.

### 1.4 Problem

Every push (86% docs) and every PR runs both workflows; unit/api/vitest run twice per event; a 12.5-min e2e-heavy Tests run gates nothing that smoke + the local G7 gate haven't already checked; stale runs accumulate with no cancellation. The user's actual pains (G1a triage): long wait for a green signal, e2e flake noise, untidy duplication.

## 2. Decisions

**D1 — test.yml triggers become `pull_request` + `workflow_dispatch`.** The push trigger is removed entirely. Consequence: docs-only pushes to main start **zero** workflows — no `paths` filters are needed (there is simply no push trigger). The dispatch block is pinned as `workflow_dispatch: {}` — no inputs, any branch selectable in the GitHub UI (dispatch is repo-internal: forks cannot trigger it). Job set is unchanged except D4 and D10.

**D2 — smoke.yml is deleted.** Its checks are fully covered elsewhere (see §5 coverage map): backend unit/api by the test.yml matrix and by the G7 fast suite, vitest by `frontend-tests`, lint + type-check by D4.

**D3 — concurrency with cancel-in-progress on test.yml.** Canonical pattern:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.head_ref || github.run_id }}
  cancel-in-progress: true
```

Semantics: on `pull_request`, `head_ref` (source branch) isolates groups per branch — a new commit pushed to an open PR cancels that PR's obsolete run; quick successive pushes to the same PR cancel each other, which is the intended behavior (the container pushes series of commits). On `workflow_dispatch`, `head_ref` is empty → each dispatch gets a unique group (`run_id`): pressing the button twice runs twice, never cancelling the in-flight run. Consumers of cancelled runs' artifacts: none found.

**D4 — new job `frontend-checks` (lint + type-check) in test.yml.** ubuntu-latest, `defaults.run.working-directory: frontend/admin`, pnpm install, then the two steps carried over **verbatim** from `frontend-smoke` (smoke.yml:36-37): `pnpm run lint` and `pnpm run type-check`. Admin scoping is deliberate: it is the exact surface smoke checked — root-level `pnpm lint` (Turbo) is a different, unproven-equivalent surface, and the §7 constraint is *no coverage degradation*. **No vitest in this job** — vitest already runs in `frontend-tests` groups; adding it would reintroduce the duplication this issue exists to remove. Runs in parallel with the matrix (~2–3 min, no wall-clock impact). This restores the deterministic type/lint check that CI smoke owned (vitest does not type-check — esbuild strips types — so without this job a skipped G7 step would let type errors reach main silently).

**D5 — G3 replaces the local baseline test run with a CI fact-check.** In `architect.md`, the baseline items (plan-only start Step 0 item 5, architect.md:331; and DESIGN Step 3 item 3, architect.md:312 — the same replacement text in both places) become this procedure:

1. `gh pr list --state merged --limit 10 --json number,headRefOid,statusCheckRollup,mergedAt,mergeCommit` → pick the entry with the **max `mergedAt`** (the list is creation-ordered, not merge-ordered — a long-lived PR merged today must not lose to a short-lived one merged yesterday).
2. **Green** = every check in `statusCheckRollup` has conclusion `SUCCESS`. **Any** `FAILURE`/non-success conclusion, or an **empty** rollup → BLOCKED, reporting the PR number, head SHA, and the offending checks.
3. **Staleness guard:** `git log --name-only <mergeCommit>..origin/main` — if any changed file falls outside docs/harness paths (`docs/**`, `**.md`, `.zcode/**`, `.opencode/**`), code landed on main after the verified merge (e.g. the finishing skill's merge-locally option) → the green fact does not cover main HEAD → BLOCKED with that file list. Docs-only commits after the merge do not invalidate the fact.
4. **No merged PR found at all** → proceed with an explicit warning in the report (practically unreachable: 244+ merged PRs; blocking here would deadlock G3 forever with no benefit).

The report carries the facts (PR number, head SHA, rollup status, staleness result); no local suite is executed. This removes a ~2–5 min local full-suite run per IMPL session and the spurious BLOCKED loops it caused on local flakes. Residual wording cleanup in the same file: `architect.md:178` drops the "(except the DESIGN baseline check)" exception; the IMPL entry condition "worktree exists, baseline green" (architect.md:~321) becomes "worktree exists, CI fact-check green".

**D6 — G7 fast suite gets a pinned memo-specific command list.** In `finishing-a-development-branch/SKILL.md` Step 1, the generic example block (`npm test / cargo test / pytest / go test ./...`) is **replaced entirely** by memo's concrete fast suite (pnpm throughout; note `test:unit` does not exist as a script — `test` is the vitest runner): `cd backend && uv run pytest` (whole suite) • `cd frontend/admin && pnpm run test` • `cd frontend/admin && pnpm run type-check` • `cd frontend/admin && pnpm run lint`. The same stale `test:unit` reference in `dev-workflow/SKILL.md:76,103` is fixed to `pnpm run test` in the same change. Policy text is unchanged (fast suites only; no local e2e as a gate; CI owns e2e). This makes "smoke moved into G7" explicit and reviewable.

**D7 — G6 and G4.5 are unchanged.**

**D8 — docs/tests_workflow.md is fully re-synced** with the new reality — not just the trigger scheme, §5 table, and hook history, but every stale claim in the file: the TL;DR "Full pre-push suite" row (line 15 — reframed to the on-demand full suite; the `pnpm test:all` command itself is real and stays), the "Auto-installed via pnpm install (postinstall)" hook section (lines 74–79 — already false today: the live hook is a disabled no-op), and "CI on GitHub re-runs the same suite on push" (line 171).

**D9 — stale comment in `scripts/git-hooks/pre-push` is refreshed** to state the new reality (CI runs on PR; local fast suite runs at G7) instead of "test.yml + smoke.yml on push and PR". The hook itself stays a no-op.

**D10 — frontend-tests matrix switches from hardcoded file lists to vitest native sharding.** The matrix key stays `group: [1..5]`, but the entire hand-listed `if/elif` step body is **replaced** by a single line per leg: `npx vitest run --shard=${{ matrix.group }}/5` (env `NODE_OPTIONS: --max-old-space-size=4096` kept). Merely adding `--shard` while leaving the lists would keep the fall-through hole open. Automatic file sharding closes the §1.1 hole permanently: every test file — including new ones — lands in exactly one shard with zero list maintenance. Trade-off: shards split by file set, so a heavy file can skew one leg (frontend legs ran 0.4–3.1 min; even a doubled worst leg stays far under the e2e wall clock of ~12.5 min, so the run's critical path does not move).

## 3. Deliberately NOT built

- **No nightly schedule** — nothing to verify overnight that PR runs haven't (user decision).
- **No post-merge run on main** — a merged PR's tree is exactly what Tests verified; the drift scenario (second code PR merged without re-run) does not occur in this sequential solo process, and the one real code-without-PR path (the finishing skill's merge-locally option) is caught by the G3 staleness guard (D5.3). Accepted risk, §4.
- **No `paths`/`paths-ignore` filters** — pointless once no workflow has a push trigger. A docs-only **PR** still runs the full Tests — accepted (user decision B): docs travel to main by direct push in this process, PRs are code by definition, and the rare docs-PR costs one free 12.5-min run. If push triggers are ever reintroduced, `paths-ignore` for docs/harness is the documented tool to reach for.
- **No branch protection / required checks / merge queue** — solo repo, no merge concurrency.
- **No re-enable of the local git pre-push hook** — replaced by G7 agent discipline (its disable-reason, "CI runs everything on push", disappears, but the hook stays off by user decision — the blocking local full run is a tax on every container push).
- **No e2e retry changes** — `retries: 1` already active.
- **No `permissions:` lockdown on test.yml** — considered in round 1, cut in round 2 (simplicity review): `skip-tracker` reads the issues API (`scripts/check_skipped_tests.py:219`), so a restrictive block would need `issues: read` as well and would break **silently** (`continue-on-error: true`); no stated pain demands the change and the inherited defaults work today.
- **No flake elimination work** — out of scope; backlog issue #246 collects the facts (48% red Tests runs, dominated by `shard-rest`).
- **No superagents canon changes** (`~/dev/superagents`) — D5/D6 land as memo-deltas in this repo's `.opencode/` copies, consistent with the port discipline.

## 4. Accepted risks

1. **Main has no post-merge verification.** A theoretically broken merge (code drift between a PR's green run and its merge) is detected only by the next PR or the dispatch button — and the G3 staleness guard (D5.3) catches it at the next IMPL start. Accepted: code merges one PR at a time; docs commits cannot drift code.
2. **No CI "pulse".** Workflow-file or runner-environment rot surfaces at the next PR, not at the nearest push. Accepted by user.
3. **lint/type-check live in one deterministic home (CI PR job) + one disciplinary home (G7).** If both miss on the same change, nothing else catches type errors (vitest ignores types). Accepted: D4 restores the deterministic check; the residual hole is agent discipline at G7, same class as today.
4. **G3 without a local baseline** cannot distinguish "red main" from "broken local environment" anymore — an environment problem will surface mid-TDD as a confusing RED. Mitigation: the D5 fact-check usually proves main green, pointing investigations at the local env.
5. **Cancelled runs lose coverage artifacts** (PR superseded by a newer commit). Dispatch runs never cancel each other (D3). No consumers found; accepted.
6. **Flake exposure drops (~98 → ~25 e2e runs/month) but flakes themselves remain.** Tracked by #246.
7. **Shard skew (D10):** one heavy test file can unbalance a frontend leg; bounded well under the e2e critical path. Accepted.

## 5. Test coverage map (after this change)

| Test type | G6 quality¹ | G4.5 visual² | G7 pre-push³ | CI Tests⁴ |
|---|---|---|---|---|
| backend unit | ✅ | — | ✅ | ✅ |
| backend api | ✅ | — | ✅ | ✅ |
| backend integration | ✅ | — | ✅ | ✅ |
| backend misc | ✅ | — | ✅ | ✅ |
| backend coverage (report) | — | — | — | ✅ |
| frontend vitest | ✅ | — | ✅ | ✅ (sharded, D10 — every file covered, no hand lists) |
| lint (ESLint, admin scope) | — | — | ✅ | ✅ (`frontend-checks`, D4) |
| type-check (tsc, admin) | ~⁵ | — | ✅ | ✅ (`frontend-checks`, D4) |
| e2e Playwright (2 shards) | — | — | forbidden⁶ | ✅ |
| visual compliance | ✅ (UI) | ✅ | — | ✅ (inside e2e) |

¹ G6: whole pytest / whole vitest by language; UI changes add playwright-visual (`test:all`). Mandatory only for Standard/Large tasks (review budget).
² G4.5: UI phases only, `visual-compliance-check.sh`, soft block.
³ G7: fast suite before every branch push — pinned memo commands (D6). Policy, not mechanism — CI is the deterministic backstop.
⁴ CI Tests = test.yml: `pull_request` + `workflow_dispatch`; concurrency cancels obsolete PR runs, never dispatch runs (D3).
⁵ Type-check is deliberately **not duplicated at G6**: its deterministic homes are the CI `frontend-checks` job (D4) and the G7 fast suite; frontend coders additionally keep `tsc --noEmit` green in their checklist (`frontend-coder.md:129`).
⁶ Harness policy: local e2e is an investigation tool, never a gate; CI owns e2e.

CI smoke's composition is therefore covered twice: deterministically on PR (test.yml matrix + `frontend-checks`) and disciplinarily before every push (G7 fast suite, a strict superset — it adds backend integration).

## 6. Files touched

| File | Change |
|---|---|
| `.github/workflows/test.yml` | triggers → `pull_request` + `workflow_dispatch: {}` (D1); add `concurrency` (D3); add `frontend-checks` job (D4); `frontend-tests` `if/elif` file lists → single `--shard=N/5` invocation (D10) |
| `.github/workflows/smoke.yml` | **deleted** (D2) |
| `.opencode/agents/architect.md` | baseline items at `:312` (DESIGN Step 3) and `:331` (IMPL Step 0) → CI fact-check procedure (D5, same text both places); residual wording cleanup (`:178`, `~:321`) |
| `.opencode/skills/finishing-a-development-branch/SKILL.md` | Step 1 generic example block → pinned memo fast-suite commands (D6, full replacement) |
| `.opencode/skills/dev-workflow/SKILL.md` | stale `test:unit` command (`:76`, `:103`) → `pnpm run test` (D6) |
| `docs/tests_workflow.md` | full re-sync: trigger scheme, §5 table, hook history, stale claims at lines 74–79 and 171; TL;DR row 15 reframed (D8) |
| `scripts/git-hooks/pre-push` | comment refresh only (D9; hook stays a no-op) |

## 7. Constraints

- `update-snapshots.yml` must remain untouched (ubuntu-latest font stack for snapshot regeneration).
- Public repo → self-hosted runners forbidden (fork/PR code execution).
- Test coverage must not degrade vs today: every check CI smoke performed stays performed somewhere deterministic with **the same scope** — lint/type-check copied verbatim from the admin-scoped `frontend-smoke` steps (D4); the rest was already covered by the test.yml matrix and the G7 fast suite.

## 8. User Scenarios

1. **Push to main starts nothing; smoke.yml is gone.** Direct docs pushes trigger zero workflows; the repo has no smoke.yml and no push-triggered runs. Verify (E2E): `gh run list` after this spec's own commit shows no new runs; repo tree has no smoke.yml; subsequent merges produce no runs.
2. **Code PR runs the full Tests.** Open a PR touching backend/frontend → all test.yml jobs run, including `frontend-checks` (lint + type-check, admin scope). Verify: the PR's check runs.
3. **A newer PR commit cancels the stale run.** Push a second commit to an open PR → the previous run for that PR turns `cancelled`. Verify: `gh run list` for the branch.
4. **Manual dispatch runs full Tests on demand, without cancelling.** `gh workflow run` (or the UI button) on a chosen branch → complete run (~12.5 min); a second dispatch while one is running does not cancel it. Verify: the dispatched runs.
5. **G3 checks facts instead of running tests.** Architect's Step 0 report contains the latest **merged** PR's number, head SHA, green rollup, and staleness result; no local suite executed. Verify: harness file content (D5) + the next IMPL session's Step 0 report.
6. **G7 runs the pinned fast suite before push.** Finishing a branch runs the four memo commands (D6); local e2e not run as a gate. Verify: harness file content + the next finishing run's `## Test Results`.
7. **A new vitest file runs in CI with zero matrix edits.** Add a new test file (including a `Client*`-named one) on a branch → the PR run executes it in some shard. Verify (E2E): a throwaway test in a scratch PR appears in a shard's run log.
