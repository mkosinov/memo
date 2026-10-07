# memo — repo rules for coding agents

Non-obvious conventions a fresh session must know. Keep short; details live in the files referenced below.

## Git: Merge Gate (user decision 2026-09-27, after PR #399)

- **Green CI is the ONLY merge trigger to `main`.** `gh pr checks --watch` blocks until every check concludes (incl. both e2e shards) — merge only on its exit 0, with `gh pr merge <PR> --squash --delete-branch`. Red CI → no merge, report and stop.
- **`gh pr merge --auto` is BANNED** in any harness file, agent, workflow, or ad-hoc command. This repo has NO branch protection and `allow_auto_merge=false`; gh's `--auto` falls back to an instant direct merge when the PR is immediately mergeable (a CLEAN merge-state status — non-required checks don't block), so `--auto` bypasses CI entirely. Incident: PR #399 (fast-track #384) landed on main 10 s after PR creation, 17 min before CI finished.
- In the container pipeline the CI-watch + merge dispatch is owned by **@manager** (re-dispatch of `finishing-a-development-branch` Step 5.5 after the card flips to `PR (G7)`); the architect returns right after `gh pr create` and must not watch CI.

## Harness seam

- Board management only via `.zcode/scripts/gh_board.py` (identical copy ships in `.opencode/scripts/`; change both or edit one and copy over). Every new issue gets its board card in the same breath: `python3 .zcode/scripts/gh_board.py status N "Backlog"` right after `gh issue create` — the board mirrors ALL open issues; containers (issues with sub-issues) get Hold instead. The reconcile mirror sweep is the safety net, not a license to skip.
- Harness files (skills, agents, scripts) are English; specs, plans, and domain rules are Russian.
- Design pipeline protocol: `.zcode/skills/auto-design/SKILL.md` (watcher) and `.zcode/skills/design-phase/SKILL.md` (host DESIGN phase); container merge/finish flow: `.opencode/skills/finishing-a-development-branch/SKILL.md`.
