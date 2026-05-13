---
type: skill
scope: reusable
sections: [setup, dev, pr-create, cleanup]
updated: 2026-05-13
---

# Git Flow — Development Workflow for Memo

Reusable skill for agent git operations. Used by @frontend-coder, @backend-coder, @tester.

## Section 1: Setup (Branch + Worktree)

Each task gets its own isolated worktree. Main repo stays on `main`.

1. Update main:
   ```bash
   cd /root/workspace/memo
   git checkout main
   git pull origin main
   ```

2. Verify working tree is clean before creating worktree:
   ```bash
   git status
   # Must show: "nothing to commit, working tree clean"
   # If there are uncommitted changes — STOP and report
   ```

3. Clean up merged worktrees:
   ```bash
   for wt in $(git worktree list --porcelain | grep "^worktree " | sed 's/^worktree //'); do
     if [[ "$wt" == *".worktrees/"* ]]; then
       branch=$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null)
       if [ -n "$branch" ] && git branch -r --merged origin/main | grep -q "origin/$branch"; then
         echo "Removing merged worktree: $wt (branch: $branch)"
         git worktree remove "$wt" 2>/dev/null || git worktree remove -f "$wt"
         git branch -d "$branch" 2>/dev/null || true
       fi
     fi
   done
   ```

4. Create worktree + branch:
   ```bash
   git worktree add .worktrees/<type>-<description> -b <type>/<description>
   cd .worktrees/<type>-<description>
   ```

Naming convention:
| Type | Prefix | Example |
|------|--------|---------|
| Feature | `feat/` | `.worktrees/feat-sidebar-component` |
| Fix | `fix/` | `.worktrees/fix-schedule-drag` |
| Refactor | `refactor/` | `.worktrees/refactor-schedule-context` |
| Docs | `docs/` | `.worktrees/docs-api-spec` |
| Chore | `chore/` | `.worktrees/chore-update-deps` |

Strict rules:
- ❌ NEVER use `git stash`
- ❌ NEVER run `git checkout <branch>` in main repo
- ❌ NEVER edit files outside current `.worktrees/` folder
- ✅ All work inside `.worktrees/`
- ✅ Clean up merged worktrees before new tasks

## Section 2: Development (Commits + Tests)

Inside worktree:
```bash
# Code, test, iterate

# BEFORE adding — always check what changed
git status

# Add ONLY files you intentionally modified
# NEVER use git add . without checking git status first
git add <file1> <file2>

git commit -m "type: description"
```

Commit convention: `type: brief description` (feat, fix, docs, refactor, chore)

## Section 3: PR Creation

```bash
# Push branch
git push -u origin <type>/<description>

# Create PR
gh pr create --title "type: description" --body "What and why"

# Get PR number
gh pr view --json number -q .number
```

## Section 4: Cleanup

After PR is merged or closed:
```bash
cd /root/workspace/memo
git worktree remove .worktrees/<type>-<description>
git branch -d <type>/<description>
```
