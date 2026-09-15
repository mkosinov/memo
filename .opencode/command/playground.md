---
description: Raise/stop/restart the user playground (backend :8101 + admin :3100) from the dedicated worktree — isolated from IMPL/e2e sessions
---

> Reference copy of the harness canon `/root/workspace/superagents/.opencode/command/playground.md`
> (that one marks project-specific values for adaptation). This memo copy carries concrete values.

Handle a user playground request. First action: call `get-session` and print the returned id. Then dispatch a `tester` subagent with the spec below (verbatim key parts). If the tester subagent is unavailable, you may execute the spec yourself with pty/bash tools.

**Argument handling** (`$ARGUMENTS`, case-insensitive):
- empty or `up` (default) → guarantee latest main: `git -C /root/workspace/worktrees/playground fetch origin` first; if backend health AND admin respond AND worktree HEAD == origin/main → report "already up" with URLs and stop; otherwise run STOP (if running), then `git -C /root/workspace/worktrees/playground reset --hard origin/main`, then START.
- `restart` or `update` → run STOP, then `git -C /root/workspace/worktrees/playground fetch origin && git -C /root/workspace/worktrees/playground reset --hard origin/main`, then START.
- `stop` → run STOP only.

## Playground spec (canonical — established 2026-09-08)

Isolated playground serving merged main: dedicated worktree with its OWN `.next`, `node_modules`, `.venv`, `memo.db` copy, on host-published ports. Must never conflict with dev.sh (:8000/:3000/:3001), e2e shards (:8001-8002/:3002-3003), or IMPL worktrees.

- Worktree: `/root/workspace/worktrees/playground`, branch `feat/playground` (create with `git -C /root/workspace/memo worktree add -b feat/playground /root/workspace/worktrees/playground origin/main` if missing).
- Backend: **:8101**, Admin: **:3100** (both published to the host by the container; :8100 is NOT published — never use it).

### STOP
1. If scratchpad has playground PTY ids, `pty_kill` them (cleanup=true).
2. Fallback if ids unknown: find PIDs listening on :8101/:3100 via `lsof -ti :8101` / `lsof -ti :3100` and kill those exact PIDs. NEVER pkill by pattern, NEVER touch other ports.

### START
1. Worktree prep (copy-if-absent applies ONLY to gitignored files; deps ALWAYS re-sync):
   - Copy gitignored files from main root if absent in worktree: `backend/.env.dev`, `backend/memo.db` (seeded DB — never re-seed, never delete the original).
   - `cd /root/workspace/worktrees/playground/backend && uv sync` (retry with `uv sync --extra dev` if uvicorn missing) — MANDATORY on every START, idempotent, but required after `reset --hard` (backend deps on main change, e.g. #266).
   - `cd /root/workspace/worktrees/playground/frontend/admin && CI=true pnpm install` — same rule (frontend deps on main change, e.g. #275).
2. Start via TWO `pty_spawn` sessions (no `timeoutSeconds`, titles "Playground backend :8101" / "Playground admin :3100"):
   - Backend, from `/root/workspace/worktrees/playground/backend`:
     `ENV_FILE=.env.dev PYTHONPATH=src uv run uvicorn src.main:app --host 0.0.0.0 --port 8101`
   - Admin, from `/root/workspace/worktrees/playground/frontend/admin`:
     `CI=true NEXT_PUBLIC_API_URL=http://localhost:8101 pnpm exec next dev -p 3100 -H 0.0.0.0`
   (`NEXT_PUBLIC_API_URL` MUST be set at server start — it bakes into the client bundle.)
3. Verify (mandatory):
   - `curl -s http://localhost:8101/api/v1/health` → `{"status":"ok","db":"connected"}`.
   - `curl -s -o /dev/null -w '%{http_code}' http://localhost:3100/schedule` → 200 (first compile up to ~90 s, retry).
   - Baked-URL proof: fetch `/schedule` HTML chunks and grep for `localhost:8101` (must be present) and for `:8100`/`:8000` (must be absent).
   - Isolation: playground listens ONLY on :8101 + :3100.
4. Rules: no tests, no commits, no pattern-kills, do not touch IMPL worktrees or other sessions' processes.

### Report to user
Status | URLs (admin `http://localhost:3100`, API docs `http://localhost:8101/docs`) | PTY ids + PIDs | any warnings. Record PTY ids + PIDs in your scratchpad section for later STOP.
