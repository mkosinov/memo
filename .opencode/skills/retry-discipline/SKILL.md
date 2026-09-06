---
name: retry-discipline
description: Use when any tool/command fails 2+ times identically — stop retrying, diagnose the root cause instead
---

# Retry Discipline

## Iron Law

**Never run the same failing command more than twice without changing something.** Identical retries waste tokens and indicate you've stopped debugging.

## The 4 Rules

### 1. Stop and Diagnose after 2 identical failures

After the **second** identical failure, STOP. Capture:
- Exit code
- Full stderr (not tailed)
- Environment state (cwd, env vars, file existence)
- Recent changes (git diff, recent commits)

Then form a hypothesis: **"Why is this failing?"** — not **"How can I make it pass this time?"**

Change one variable, then retry. If still fails, you don't have the right hypothesis. Return to root cause analysis.

**Applies to:** `git status`, `git push`, `git rev-parse`, `sqlite`, `vitest`, `pytest`, bash scripts, `opencode mcp list` — anything that returns the same result.

### 2. No unconditional `sleep` as synchronization

`sleep 30` is not a fix — it's a workaround that masks race conditions. The same bug will appear in production under different timing.

Use instead:
- `waitFor`, `findBy` (testing-library)
- Explicit event-based waits (Playwright)
- Polling with condition (≤ 2s between attempts, max 3)

Sleep ≤ 2s OK as a small buffer in test setup.

### 3. Read-only commands don't need retries

`git log`, `git show`, `gh pr checks` (read), `ls`, `cat` — if they fail, the **state is broken**, not flaky.

Don't retry. Diagnose the state:
- Worktree valid? (`git worktree list`)
- File exists? (`ls -la`)
- Branch checked out? (`git branch --show-current`)

### 4. Full output on failure, tail only on success

`tail -5` hides the actual error. Switch to **full output** on the first failure. Use `tail` only after tests pass (for compactness in success logs).

## When You Catch Yourself

| Thought | Reality |
|---------|---------|
| "Let me try one more time" | STOP. What will be different? |
| "Maybe the 3rd will work" | STOP. You have no hypothesis. |
| "It's probably just a flake" | NO. Flakes are rare. Most "flakes" are state issues. |
| "I just need to wait longer" | NO. Use proper async waits, not sleep. |
| "Let me read the docs again" | OK — but if you've read them 3×, you have a different problem. |

## Related Skills

- **systematic-debugging** — root cause analysis for the "why is this failing" question
- **test-driven-development** — for "why is this test failing" patterns
- **verification-before-completion** — confirm fix worked before claiming success
