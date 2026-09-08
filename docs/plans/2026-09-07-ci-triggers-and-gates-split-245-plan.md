# CI Triggers & Gates Split (#245) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split CI by purpose — full Tests runs on PR + manual dispatch only (nothing on push), CI smoke is deleted with its lint/type-check checks moved into a new `frontend-checks` job, PR concurrency cancels stale runs, the vitest matrix drops hand-maintained file lists for native sharding, G3 replaces its local baseline run with a CI fact-check, and G7 pins memo's fast-suite commands.

**Architecture:** One GitHub Actions workflow (`test.yml`) on `pull_request` + `workflow_dispatch` with per-branch concurrency cancel; `smoke.yml` deleted. Local gates (container harness prompt files) shift: G3 = facts from `gh pr list` (latest merged PR's check rollup + staleness guard) instead of a local test run; G7 = the pinned fast suite (a strict superset of the old CI smoke). Docs and the disabled pre-push hook comment are re-synced. No application code changes; the implementation PR itself is the live test bed.

**Tech Stack:** GitHub Actions (YAML), `gh` CLI (read-only queries), container harness prompt files (markdown), docs.

**Spec (binding):** `docs/specs/2026-09-07-ci-triggers-and-gates-split-design.md` — §2 decisions D1–D10, §3 NOT-built (incl. cut `permissions` lockdown), §4 accepted risks, §5 coverage map, §6 files touched, §7 constraints, `## User Scenarios` S1–S7 (numbered 1–7 in the spec).

**Worktree:** create after G2 via `./.opencode/scripts/create-worktree.sh chore/ci-triggers-split-245`.

**Test commands** — this plan has no unit-test surface; verification is structural + live:
- YAML sanity: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/test.yml'))"` (and `actionlint .github/workflows/test.yml` if available).
- Live observation: `gh run list --limit 10`, `gh run watch <id>`, `gh pr checks`, `gh workflow run 'Tests' --ref <branch>`.
- Fast suite (only if a harness sanity check is wanted): `cd backend && uv run pytest -q` (whole suite, ~141 s).

---

## Behavioral Delta

How this behaves, mapped to spec user scenarios:

- **Пуш в main ничего не запускает (S1)** — прямые пуши (включая docs и merge-коммиты) не порождают прогонов; `smoke.yml` в репо больше нет.
- **PR с кодом = полный прогон с проверкой типов и линта (S2)** — на PR гоняются все джобы, включая новую `frontend-checks` (lint + type-check в admin-скоупе).
- **Новый коммит в PR отменяет устаревший прогон (S3)** — серия коммитов не копит очередь: живёт только прогон последнего коммита ветки.
- **Кнопка полного прогона (S4)** — `workflow_dispatch` запускает полный Tests на выбранной ветке; второе нажатие не отменяет идущий прогон.
- **G3 отчитывается фактами, а не прогоном (S5)** — Step 0 архитектора несёт номер последнего смерженного PR, SHA его головы, статус чеков и результат staleness-гарда; локальные тесты на этом шаге не гоняются.
- **G7 гоняет закреплённый быстрый сьют (S6)** — перед пушем ветки четыре memo-команды: весь pytest, vitest, type-check, lint (e2e локально — только расследование, не гейт).
- **Новый vitest-файл сразу в CI (S7)** — тестовые файлы распределяются по шардам автоматически; править матрицу при добавлении тестов не нужно (включая новые `Client*`-именные файлы, которые раньше молча терялись).

---

## File Structure (decisions locked)

| File | Action | Responsibility |
|---|---|---|
| `.github/workflows/test.yml` | MODIFY (T1, T2, T3) | triggers + concurrency (D1/D3); `frontend-checks` job (D4); shard matrix (D10) |
| `.github/workflows/smoke.yml` | DELETE (T4) | its checks live in test.yml + G7 (D2) |
| `.opencode/agents/architect.md` | MODIFY (T5) | G3 CI fact-check at `:312` (DESIGN Step 3) and `:331` (IMPL Step 0); wording cleanups `:178`, `~:321` (D5) |
| `.opencode/skills/finishing-a-development-branch/SKILL.md` | MODIFY (T6) | Step 1 example block → pinned memo fast suite (D6) |
| `.opencode/skills/dev-workflow/SKILL.md` | MODIFY (T6) | stale `test:unit` → `pnpm run test` (`:76`, `:103`) (D6) |
| `docs/tests_workflow.md` | MODIFY (T7) | full re-sync: trigger scheme, coverage table, hook history, stale lines 74–79 / 171; TL;DR row 15 reframed (D8) |
| `scripts/git-hooks/pre-push` | MODIFY (T7) | comment refresh only; hook stays a no-op (D9) |

**Commits:** per-task, prefix `chore(#245):`. Single PR at the end (opened in T8).

**Ordering invariants:**
- T1–T3 edit the same file (`test.yml`) — do them in order, one commit each.
- Do not merge the PR before T8's observations are recorded: the PR lifecycle is the test bed for S2/S3/S7.
- Nothing here touches application code; the container's G5/G6 gates (fast suite) must stay green trivially — the harness edits are G3/G7 texts only.

---

## Task 1: test.yml — triggers and concurrency

### Classification: small
### Required Docs
- `docs/specs/2026-09-07-ci-triggers-and-gates-split-design.md` §2 D1, D3; §3 (why no paths filters); §4 risks 1–2
- No domain-rules (no entities touched)

### Files
- MODIFY `.github/workflows/test.yml` (`on:` block, new top-level `concurrency:`)

### Steps
- [ ] Replace the `on:` block (currently push + pull_request, test.yml:3-7) with:
```yaml
on:
  pull_request:
    branches: [main]
  workflow_dispatch: {}
```
  No inputs on dispatch. The `branches: [main]` filter is retained from the current config — D1 narrows triggers, it does not widen PR targets (plan-review note: a bare `pull_request:` would additionally run Tests on hypothetical non-main-base PRs; nothing needs that).
- [ ] Add immediately after `on:`:
```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.head_ref || github.run_id }}
  cancel-in-progress: true
```
  Semantics (do not deviate): PR runs group by source branch (new commit cancels the branch's stale run); dispatch runs get a unique group each (never cancel each other).
- [ ] YAML sanity: parse test.yml (`yaml.safe_load` or `actionlint`).

### DoD
- Push trigger gone; `pull_request` + `workflow_dispatch` + concurrency present; YAML parses.
- S3/S4 mechanics land live in T8 (this plan's own PR); no automated test exists for YAML config.

---

## Task 2: test.yml — `frontend-checks` job

### Classification: small
### Required Docs
- Spec §2 D4 (verbatim admin-scoped steps; no vitest in this job), §7 constraint "no coverage degradation, same scope"

### Files
- MODIFY `.github/workflows/test.yml` (new job `frontend-checks`, parallel to the matrix)

### Steps
- [ ] Add the job (commands copied verbatim from smoke.yml's `frontend-smoke`, smoke.yml:25-40 — admin scope is deliberate; root `pnpm lint` is a different, unproven surface):
```yaml
  frontend-checks:
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
```
- [ ] **No vitest step** — vitest runs in `frontend-tests`; adding it here reintroduces the duplication the issue exists to remove.
- [ ] Do NOT add a `permissions:` block (spec §3: cut — would silently break `skip-tracker`'s issues API reads).

### DoD
- Job present, admin-scoped, exactly lint + type-check; YAML parses; job appears green in T8's PR run (S2).

---

## Task 3: test.yml — frontend-tests switches to native sharding

### Classification: small
### Required Docs
- Spec §1.1 (the fall-through hole), §2 D10 (replace the whole `if/elif` body), §4 risk 7 (shard skew is accepted)

### Files
- MODIFY `.github/workflows/test.yml` (`frontend-tests` job)

### Steps
- [ ] Keep the matrix key as-is (`group: [1, 2, 3, 4, 5]`).
- [ ] Replace the entire `Run vitest (group N)` step — the whole `if/elif` file-list body (step at test.yml:85-99) — with:
```yaml
      - name: Run vitest (shard ${{ matrix.group }}/5)
        run: npx vitest run --shard=${{ matrix.group }}/5
        env:
          NODE_OPTIONS: --max-old-space-size=4096
```
  Merely adding `--shard` while keeping any part of the lists would leave the hole open — the hand lists must be gone.
- [ ] YAML sanity check.

### DoD
- No hardcoded test-file lists remain in test.yml; each leg runs one `--shard=N/5` line.
- S7 verified live in T8 (a throwaway new test file — including a `Client*`-named one — appears in some shard's log with zero matrix edits).

---

## Task 4: delete smoke.yml

### Classification: trivial
### Required Docs
- Spec §2 D2, §5 (coverage map — where each smoke check now lives)

### Files
- DELETE `.github/workflows/smoke.yml`

### Steps
- [ ] `git rm .github/workflows/smoke.yml`.

### DoD
- No smoke.yml in the tree; on this plan's PR (pull_request events read the workflow set from the PR ref) no smoke run appears — recorded in T8 (S1 partial: structural half; the push half records after merge).

---

## Task 5: G3 → CI fact-check in architect.md

### Classification: standard
### Required Docs
- Spec §2 D5 (the procedure, verbatim below), §4 risk 4
- `.opencode/skills/finishing-a-development-branch/SKILL.md` (merge-locally option the staleness guard covers)

### Files
- MODIFY `.opencode/agents/architect.md` (IMPL Step 0 item 5 at `:331`; DESIGN Step 3 item 3 at `:312`; wording at `:178` and `~:321`)

### Steps
- [ ] Replace IMPL Step 0 item 5 ("Run the project's baseline tests to verify clean state. FAIL → report BLOCKED… PASS → proceed to Step 4.") with:
```
5. CI fact-check (no local test run; main's code is CI-verified at PR time):
   - `gh pr list --state merged --limit 10 --json number,headRefOid,statusCheckRollup,mergedAt,mergeCommit`
     → pick the entry with the max `mergedAt` (the list is creation-ordered, not merge-ordered).
   - Green = every check in `statusCheckRollup` has conclusion `SUCCESS`. Any FAILURE/non-success,
     or an empty rollup → report BLOCKED (PR number, head SHA, offending checks). Do NOT fix.
   - Staleness guard: `git log --name-only <mergeCommit>..origin/main` — if any changed file is
     outside `docs/**`, `**.md`, `.zcode/**`, `.opencode/**`, unverified code landed on main
     (e.g. the finishing skill's merge-locally option) → report BLOCKED with that file list.
   - No merged PR at all → proceed with an explicit warning in the report.
   - PASS → proceed to Step 4; the report carries PR number, head SHA, rollup status, staleness result.
```
- [ ] Apply the same replacement text to DESIGN Step 3 item 3 (`:312`, "Run the project's baseline tests to verify clean state.") — renumbered as that section's item, same wording, but **without** the IMPL-specific "PASS → proceed to Step 4" tail (there is no Step 4 in DESIGN Step 3).
- [ ] Reconcile DESIGN Step 3's own outcome items (`:313-314`) to the fact-check — they still speak of tests: item 4 ("If tests FAIL → report BLOCKED with the failure summary") → "If the fact-check is red or stale → report BLOCKED with the facts"; item 5 ("If PASS → report DONE with worktree path, branch name, baseline result") → "If green → report DONE with worktree path, branch name, fact-check result (PR number, head SHA, rollup status)".
- [ ] Wording cleanups: `:178` — drop the "(except the DESIGN baseline check)" exception from the NEVER-run-tests rule (the exception no longer exists); `~:321` — IMPL entry condition "worktree exists, baseline green, plan approved" → "worktree exists, CI fact-check green, plan approved".
- [ ] Grep the file for remaining "baseline" and "tests FAIL" mentions; each must either refer to the new fact-check or be reworded — no orphaned local-run references.

### DoD
- Both step sites carry the fact-check procedure verbatim; no residual "run the project's baseline tests" wording.
- S5's full process verification (report format in a real IMPL session) is post-merge by nature; structural DoD here = file content as specified.

---

## Task 6: G7 pinned fast suite + dev-workflow command fix

### Classification: small
### Required Docs
- Spec §2 D6 (`test:unit` does not exist — `test` is the vitest runner; pnpm throughout)

### Files
- MODIFY `.opencode/skills/finishing-a-development-branch/SKILL.md` (Step 1 example block, `:40-43`)
- MODIFY `.opencode/skills/dev-workflow/SKILL.md` (`:76`, `:103`)

### Steps
- [ ] In finishing SKILL Step 1, replace the generic code block (`npm test / cargo test / pytest / go test ./...`) entirely with:
```bash
# Memo fast suite (unit/integration + typecheck/lint; NO local e2e as a gate):
cd backend && uv run pytest                 # whole backend suite (unit+api+integration+misc)
cd frontend/admin && pnpm run test          # vitest
cd frontend/admin && pnpm run type-check    # tsc --noEmit
cd frontend/admin && pnpm run lint          # ESLint
```
  Keep the surrounding policy text unchanged (fast suites only; local e2e is an investigation tool; the authoritative merge gate is CI).
- [ ] In dev-workflow SKILL, fix the stale command at `:76` and the table row at `:103`: `npm run test:unit` → `pnpm run test` (the script is named `test`; `test:unit` does not exist). Nothing else in that file changes.
- [ ] Grep both files for `test:unit` — zero matches must remain.

### DoD
- Four pinned commands present; policy text intact; `test:unit` gone from the harness (S6 structural; process verification post-merge).

---

## Task 7: docs re-sync + pre-push hook comment

### Classification: small
### Required Docs
- Spec §2 D8, D9; §5 coverage map (the table to embed); §1.3 (hook history)

### Files
- MODIFY `docs/tests_workflow.md`
- MODIFY `scripts/git-hooks/pre-push` (comment only)

### Steps
- [ ] `docs/tests_workflow.md`, full re-sync:
  - TL;DR: row 15 "Full pre-push suite" → "Full local suite (on demand)" — the `pnpm test:all` command stays, the pre-push framing goes (the hook is a no-op; the pre-push gate is the finishing skill's fast suite).
  - Hook section (lines 74–79): state plainly — the hook is installed by postinstall but is a disabled no-op; local pre-push checking is done by the container harness at G7 (fast suite), full local runs are on demand.
  - Line 171 "CI on GitHub re-runs the same suite on push" → CI runs the full suite on pull_request + manual dispatch; pushes to main (incl. merges) start nothing; docs-only pushes run zero workflows.
  - Add the spec's §5 coverage table (test type × G6 / G4.5 / G7 / CI) and the trigger scheme summary.
- [ ] `scripts/git-hooks/pre-push` — replace the stale header comment (tests moved to "test.yml + smoke.yml on push and PR") with:
```
# Pre-push hook: DISABLED (no-op).
# CI runs on pull_request + manual dispatch (test.yml); pushes to main start nothing.
# The local pre-push gate is the finishing-a-development-branch skill (G7 fast suite).
# To run the full local test suite manually:
#   VISUAL_COMPLIANCE=0 bash scripts/test-all.sh
```
  The `exit 0` stays; no behavioral change to the hook.

### DoD
- No stale claims remain: grep the doc for "on push", "pre-push suite", "auto-installed" — every hit is either updated or intentionally retained with corrected framing.

---

## Task 8: live verification round on the implementation PR

### Classification: small
### Required Docs
- Spec §8 (S1–S7 verification recipes)

### Files
- none (observation + recording; findings go into the PR description)

### Steps
- [ ] Open the single PR from the worktree branch to main. The PR event reads workflows from the PR ref — so this PR immediately runs the NEW config: full Tests runs, **no smoke run appears** (S1-structural + S2).
- [ ] Confirm the run contains `frontend-checks` (green) and 5 vitest shards; shard logs show a roughly even file split (S2).
- [ ] Throwaway S7 probe: add a commit with a new dummy vitest file (name it `ClientZOrderingProbe.test.tsx` — a `Client*` name, the old hole's shape) containing one trivial passing test; push → confirm the new run executes it in some shard; then revert that commit in a follow-up push (S7 + the revert push doubles as the S3 observation: the previous run must show `cancelled`).
- [ ] After merge: press dispatch **twice** in quick succession (`gh workflow run 'Tests' --ref main` twice) and cancel the second run immediately once both are visible (saves ~12.5 free minutes) — both runs must coexist, the first must not turn `cancelled` (S4, non-cancellation half observed, not inferred); `gh run list --event push` shows no runs for the merge commit; the next docs-only push to main (any DESIGN/docser commit) starts zero workflows (S1-live).
- [ ] Record all observations in the PR description before finishing.

### DoD
- E2E for scenario 2 passes (PR run with `frontend-checks`); scenario 3 passes (cancelled run observed); scenario 7 passes (probe file ran in a shard); scenario 4 passes (dispatch run); scenario 1 passes (no push runs; confirmed live on the first post-merge docs push).
- Scenarios 5/6 are structural (T5/T6 file content) + process verification deferred to the next IMPL session's reports.
