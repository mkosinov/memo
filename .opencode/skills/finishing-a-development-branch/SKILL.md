---
name: finishing-a-development-branch
description: Use when implementation is complete, all tests pass, and you need to finish the work - the default is auto push+PR+auto-merge after green CI, notifying the user before push and contacting them only on error
---

# Finishing a Development Branch

## Overview

Finish development work by **automatically** pushing, opening a PR, and auto-merging
after CI goes green. The user is **notified** before the push (fire-and-continue) and is
**contacted only when something goes wrong**.

**Core principle:** Verify tests → Detect environment → Notify → Push + PR + auto-merge on green CI → Clean up. Contact the user ONLY on error.

**Announce at start:** "I'm using the finishing-a-development-branch skill to complete this work."

## Merge Gate Policy (CI-authoritative)

Decision 2026-09-02 (option "B — Minimum"). Replaces the outage-era "local full run is the merge
gate" policy: **CI is the merge gate, not a local full run.**

- **DEFAULT:** CI is the authoritative merge gate — ALL jobs must be green, including the e2e
  shards. Merge only on green CI.
- **LOCAL pre-push gate:** fast suites only — unit/integration tests + typecheck/lint (per
  project). **NO local e2e as a gate.**
- **Local e2e runs remain allowed as an INVESTIGATION tool** (e.g. flake A/B classification on
  base), never as a merge gate.
- **FALLBACK (outage protocol):** if CI is unavailable (quota/outage — verify with a real run,
  not assumptions), revert to the full local run **including e2e** as the merge gate.

## The Process

### Step 1: Verify Tests

**Before finishing, run the LOCAL pre-push gate (fast suites only) — per the Merge Gate Policy:**
unit/integration tests + typecheck/lint. Do NOT run local e2e as a gate (CI owns e2e; local e2e
is an investigation tool only). The authoritative merge gate is CI.

```bash
# Memo fast suite (unit/integration + typecheck/lint; NO local e2e as a gate):
cd backend && uv run pytest                 # whole backend suite (unit+api+integration+misc)
cd frontend/admin && pnpm run test          # vitest
cd frontend/admin && pnpm run type-check    # tsc --noEmit
cd frontend/admin && pnpm run lint          # ESLint
```

**If tests fail:**
```
Tests failing (<N> failures). Must fix before completing:

[Show failures]

Cannot proceed with merge/PR until tests pass.
```

Stop. Don't proceed to Step 2.

**If tests pass:** Continue to Step 2.

### Step 2: Detect Environment

**Determine workspace state before the auto-flow:**

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
```

This determines the default flow and how cleanup works:

| State | Default flow | Cleanup |
|-------|--------------|---------|
| `GIT_DIR == GIT_COMMON` (normal repo) | Auto push + PR + auto-merge | No worktree to clean up |
| `GIT_DIR != GIT_COMMON`, named branch | Auto push + PR + auto-merge | Provenance-based |
| `GIT_DIR != GIT_COMMON`, detached HEAD | Auto push (as new branch) + PR + auto-merge | No cleanup |

### Step 3: Determine Base Branch

```bash
# Try common base branches
git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null
```

Or ask: "This branch split from main - is that correct?"

### Step 4: Notify (fire-and-continue)

**Do NOT present a menu and do NOT wait for a reply.** Print a SHORT notification and
proceed immediately to Step 5:

```
Финиш: пушу ветку <feature-branch> + создаю PR + авто-мерж после зелёного CI.
```

For detached HEAD, note the new branch name:

```
Финиш: детач-HEAD → пушу как новую ветку <feature-branch> + создаю PR + авто-мерж после зелёного CI.
```

**Don't add explanation** - keep the notification to one line, then continue.

### Step 5: Auto Push + PR Creation (Dispatch 1 — ends at PR_CREATED)

This is the default success-path flow. Run it automatically after the notification.
**Contact the user ONLY on error** (push failure, PR creation error).

**Two-dispatch split (2026-09-21, refines the 2026-09-20 #227 rule):** this dispatch ENDS
right after the PR is created — CI watching and merging belong to the SECOND dispatch
(Step 5.5), which @manager launches after flipping the card to `PR (G7)`. The split point is
deterministic state: this dispatch returns normally, and @manager — alive, blocked on it —
receives the report and re-dispatches. What remains FORBIDDEN is ending a dispatch while
waiting for CI *inside* a subagent run (a finished subagent is never woken by its own
notification — the #227 stall).

**The PR description must carry `Closes #N`** (N = the issue this branch implements): the
closing keyword in the PR description is what auto-closes the issue at merge — and it is the
ONLY legitimate place for it (never in direct-to-main commit messages; those land without a
merge and would close the issue before any IMPL started). Omit the line only when the work
has no issue.

```bash
# Push branch (pre-push hook is disabled — CI runs on GitHub Actions)
if ! git push -u origin <feature-branch>; then
  echo "❌ Push failed for <feature-branch>."
  # STOP — report to user, preserve worktree for fixes. Do NOT continue.
  exit 1
fi

# Create PR
if ! gh pr create --title "<title>" --body "$(cat <<'EOF'
## Summary
<2-3 bullets of what changed>

Closes #N

## Test Plan
- [x] CI checks pass (GitHub Actions)
EOF
)"; then
  echo "❌ PR creation failed."
  # STOP — report to user with the push state. Preserve worktree.
  exit 1
fi

# Get PR URL for reporting
PR_URL=$(gh pr view --json url -q .url)
echo "PR created: $PR_URL"

# END OF DISPATCH 1 — return to @manager immediately, do NOT watch CI here. Report:
#   PR_CREATED: <PR_URL> branch=<feature-branch> worktree=<worktree path or "repo">
# @manager flips the card to PR (G7) and re-dispatches for Step 5.5 (CI watch + merge).
```

**On push/PR error — STOP and contact the user:** report the failure, preserve the worktree
(user may need to push fixes) and let the user decide the next action.

### Step 5.1: Explicit User-Requested Fallbacks (NOT the default)

The default flow above always applies unless the **user explicitly asks** for one of these
alternatives. These are no longer offered as a menu — only run them on explicit request.

#### Fallback: Merge Locally (only if user explicitly asks)

```bash
# Get main repo root for CWD safety
MAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
cd "$MAIN_ROOT"

# Merge first — verify success before removing anything
git checkout <base-branch>
git pull
git merge <feature-branch>

# Verify tests on merged result
<test command>

# Only after merge succeeds: cleanup worktree (Step 6), then delete branch
git branch -d <feature-branch>
```

#### Fallback: Keep As-Is (only if user explicitly asks)

Report: "Keeping branch <name>. Worktree preserved at <path>."

**Don't cleanup worktree.**

#### Fallback: Discard (only if user explicitly asks)

**Confirm first:**
```
This will permanently delete:
- Branch <name>
- All commits: <commit-list>
- Worktree at <path>

Type 'discard' to confirm.
```

Wait for exact confirmation.

If confirmed:
```bash
MAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
cd "$MAIN_ROOT"
```

Then: Cleanup worktree (Step 6), then force-delete branch:
```bash
git branch -D <feature-branch>
```

### Step 5.5: Second Dispatch — CI Watch + Merge (Dispatch 2)

Launched by @manager right after the `PR_CREATED` return (the card is at `PR (G7)` by then).
Fresh dispatch — the CI watch (5–45 min incl. e2e shards) and the merge run inside it, and the
merge completes in the SAME dispatch (2026-09-20, #227 incident: a finished subagent is never
re-woken by its own PTY notification — nobody re-dispatches it and the post-merge handoff
stalls; observed: PR merged 1 min after green, board flipped 30 min later only after a user
prompt). If you are running out of context mid-watch, complete the merge in this dispatch
rather than yield.

```bash
# gh pr checks --watch blocks until all checks conclude, then:
#   exit 0 = all passed, exit 1 = some failed
# CI is the authoritative merge gate — wait for ALL jobs (including the e2e shards) to go green.
if gh pr checks --watch; then
  echo "✅ All CI checks passed. Auto-merging..."
  # NOTE: run `gh pr merge --squash` WITHOUT --delete-branch. When finishing from inside a
  # git worktree, --delete-branch tries to delete the LOCAL branch, which is checked out in the
  # worktree ("branch is already checked out at ...") — the merge API call succeeds but the
  # local cleanup fails, leaving a broken state. Likewise `git checkout <base-branch>` + `git pull`
  # cannot run from inside the worktree (<base-branch> is checked out in the main working copy).
  # So: merge ONLY here; do ALL branch/main/worktree cleanup as a separate step from the main
  # working copy root (Step 6).
  if ! gh pr merge --squash --subject "<title>" --body "Auto-merged: all CI checks passed."; then
    echo "❌ Merge command failed."
    echo "PR: $PR_URL — report to user. Preserve worktree."
    # STOP — do NOT clean up worktree.
    exit 1
  fi
  echo "✅ PR merged on GitHub. Branch/main/worktree cleanup runs from the main working copy (Step 6)."
else
  echo "❌ CI checks failed (red). NOT auto-merging."
  echo "PR: $PR_URL — report to user. Preserve worktree for fixes."
  # STOP — do NOT clean up worktree.
  exit 1
fi
```

**On success (all CI green + merged):** proceed to Step 6 — from the **main working copy
root**: pull main (fast-forward to the merge commit), delete the remote branch, remove the
worktree, then delete the local branch — then Step 7 (`## Board Update Needed` to @manager;
the In-main flip, issue close and `merged` scratchpad line are @manager's).

**On red CI / merge error — STOP and contact the user:** report NEEDS_APPROVAL with the PR
URL; preserve the worktree; do NOT auto-merge, do NOT clean up.

**General waiting rule (any subagent, any phase):** if you must yield while something is
still running, return an explicit `WAITING:` report listing the run id + what triggers the
next action, so @manager re-dispatches on completion or watches it itself. Never rely on your
own future wake-up. @manager-side counterpart: an intermediate "awaiting X" return from any
subagent → @manager immediately sets its OWN watch/timer on X (Awaiting-Handoff Rule,
`.opencode/agents/manager.md`).

### Step 5.6: Suggest Post-Merge Reflection

After the PR is created (default flow) or the branch is merged locally (fallback), **suggest to user** running reflection analysis. This is not auto-run — human decides.

```bash
# Extract wave name from branch (e.g., "Wave 4.5" from "Wave 4.5 старт" or PR title)
WAVE_NAME=$(git log -1 --format='%s' | grep -oE 'Wave [0-9.]+' | head -1)
[ -z "$WAVE_NAME" ] && WAVE_NAME="<ask user>"

# Suggest to user:
echo "Wave complete. Recommended next step:"
echo "  reflect.sh wave --name=\"$WAVE_NAME\""
echo "Or run /reflect in the next session for in-session analysis."
```

**Why not auto-run:** Retrospection principle. Reflection after the fact is more useful than pre-block. User reviews proposals at their own pace.

**For the default PR flow:** Suggestion is forward-looking — when the PR is merged, run `/reflect` or `reflect.sh wave`. Don't run it now (wave isn't on main yet).

### Step 6: Cleanup Workspace

**Runs on the default success path (after auto-merge) and for the explicit "merge locally" / "discard" fallbacks.** The "keep as-is" fallback and any error path always preserve the worktree.

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
WORKTREE_PATH=$(git rev-parse --show-toplevel)
```

**If `GIT_DIR == GIT_COMMON`:** Normal repo, no worktree to clean up. Done.

**If worktree path is under `.worktrees/`, `worktrees/`, or `~/.config/worktrees/`:** We own cleanup.

All post-merge cleanup runs from the **main working copy root** (where `<base-branch>` is
checked out). You cannot switch branches or delete the feature branch from inside the worktree
— the feature branch is checked out there; `<base-branch>` (e.g. main) is checked out in the
main copy. So `cd` to the main root first, then run the full sequence below.

For the **default auto-merge flow** (Step 5 ran `gh pr merge --squash` WITHOUT `--delete-branch`),
the remote branch is dangling and local main is stale — Step 6 pulls main and deletes the remote
branch before removing the worktree and the local branch:

```bash
MAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
cd "$MAIN_ROOT"

# Default auto-merge flow — post-merge main update + remote branch cleanup.
# (The "merge locally" / "discard" fallbacks in Step 5.1 merge/delete the branch in their own
#  block — skip these two lines for those fallbacks.)
git pull origin <base-branch>
# NOTE: spec/plan doc commits are pushed to main at G1b/G2 approval time, so this pull is
# normally a clean fast-forward. If it FAILS because local main has diverged (unpushed doc
# commits from an older workflow), STOP and contact the user — do NOT `reset --hard` silently
# (risks losing unpushed commits).
git push origin --delete <feature-branch>   # delete the dangling remote branch

# Worktree + local branch removal (default flow AND fallbacks).
# Remove the worktree BEFORE deleting the local branch — the branch is checked out there.
git worktree remove "$WORKTREE_PATH"
git worktree prune  # Self-healing: clean up any stale registrations
git branch -d <feature-branch>               # local branch safe to delete once the worktree is gone
```

**Order matters:** remove the worktree first (frees the checked-out branch), then delete the local branch.

**Otherwise:** The host environment (harness) owns this workspace. Do NOT remove it.

### Step 7: Report Board-Update Facts to @manager (mandatory)

After a successful merge, the architect does NOT touch the GH Project board — board updates are @manager's decision and responsibility. The architect's only duty: include this block in the DONE report so the manager has the facts:

```
## Board Update Needed
- Issue: #N (or "no issue — FasTP fix without issue")
- Next Up: was 1|2|3|not in queue
```


## Quick Reference

| Flow | Trigger | Merge | Push | Keep Worktree | Cleanup Branch |
|------|---------|-------|------|---------------|----------------|
| **Auto push + PR + auto-merge** (default) | success path | yes (after CI green) | yes | - (after merge) | yes |
| Merge locally (fallback) | user asks explicitly | yes | - | - | yes |
| Keep as-is (fallback) | user asks explicitly | - | - | yes | - |
| Discard (fallback) | user asks explicitly | - | - | - | yes (force) |
| Error (push/PR/CI/merge) | anything goes wrong | no | maybe | yes (preserved) | no |

## Red Flags

**Never:**
- Proceed with failing tests
- Merge on red / failing CI
- Merge without verifying tests on result
- Auto-merge when any error occurred — STOP and contact the user instead
- Clean up a worktree on any error path (user may need it for fixes)
- Delete work without confirmation
- Force-push without explicit request
- Remove a worktree before confirming merge success
- Clean up worktrees you didn't create (provenance check)
- Run `git worktree remove` from inside the worktree
- `reset --hard` local main on a divergent pull — unpushed DESIGN-phase doc commits should not
  exist (they are pushed at G1b/G2); if they do, stop and ask the user

**Always:**
- Verify tests before finishing
- Detect environment before the auto-flow
- Notify before push (one line, fire-and-continue — do NOT wait for a reply)
- Contact the user ONLY on error (push failure, PR error, red CI, merge error)
- End Dispatch 1 at `PR_CREATED`; keep CI watch + merge inside Dispatch 2 — never end a dispatch mid-watch (Step 5.5)
- Get typed confirmation before the discard fallback
- Clean up worktree only on the default merge success path and the explicit merge-locally / discard fallbacks
- `cd` to main repo root before worktree removal
- Run `git worktree prune` after removal
- Delete remote and local branches from the main working copy root only — never use `gh pr merge --delete-branch` from inside a worktree (the local branch is checked out there)
