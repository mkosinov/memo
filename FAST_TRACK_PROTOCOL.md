# Fast Track Protocol (FTP) — Project: Memo

## Purpose
A lightweight protocol for making small UI/code changes **without** the full SuperAgents procedural overhead (no full spec, no brainstorming, no plan doc). Visual verification via Playwright (browserMCP doesn't load in this project's sessions — see "Tooling" below).

---

## When to Use
After accepting a PR, when quick code edits are needed without procedural overhead.

**Use for:** single-component tweaks, polish, copy changes, simple wiring, refactors of small/medium scope.
**Don't use for:** new features requiring user research, breaking API changes, anything that needs real-time product decisions.

---

## Commands
- `/FTP_START <description>` — Initiate a fast-track code edit (code only, no tests/docs/review)
- `/FTP_END` — All edits complete; trigger the full procedural package

---

## Phase 1: Fast Track (Code Only)
The Architect (`@architect`) launches `frontend-coder` or `backend-coder` with the following constraint:
- **ONLY update the code according to the description.**
- No other actions are permitted under any circumstances.
- Edit only the specified code.
- DO NOT update tests.
- DO NOT update documentation.
- DO NOT run linters / formatters.
- DO NOT perform code-quality review.

Multiple `/FTP_START` commands can be issued sequentially or in parallel if edits are independent.

---

## Phase 2: Procedural
The `/FTP_END` command triggers the complete procedural package:
1. `code-quality-reviewer` — Review the final code.
2. `spec-reviewer` — Verify compliance with the specification (if applicable).
3. **Tests** — Run the project's test suite.
4. `docser` — Update documentation based on the changes.
5. Commit / finalize PR.

---

## Current Session Workflow (as of 2026-06-21)

The user is in the loop. The new model is:

1. **User writes a fix request in chat** (description of the change, optionally with screenshot of current state).
2. **Architect records it in TodoWrite** with status `pending` (or adds to existing in_progress item).
3. **Architect dispatches `frontend-coder` (resume existing session `ses_115cb423affezr8RXw8GvqgUVg`)** with the full task text + worktree path.
4. **Coder reports back** with status DONE / DONE_WITH_CONCERNS / BLOCKED.
5. **Architect marks TodoWrite item as `completed`** based on the coder's report, OR re-dispatches with clarifications.
6. **If user wants visual verification** (recommended for any UI change), Architect dispatches **general verifier** (resume `ses_11439f408ffe6vxZg0lBLnyRY5`) with Playwright + Playwright script.
7. **Verifier reports** with checklist + issues.
8. **Architect updates TodoWrite** based on visual report. Re-dispatches coder for any new issues found (max 3 fix loops, then escalate).
9. **At the end of session** (user says "коммитим" or session ends), **Architect makes a WIP checkpoint commit** — one or more commits on the feature branch, **NO push, NO PR update yet**. Phase 2 (review, tests, docser) happens in a later session.

### Why TodoWrite?
The user wants to see at a glance:
- What's been requested but not started (`pending`)
- What's currently being worked on (`in_progress`)
- What was completed and is awaiting visual verification (`completed` — but flagged in chat)
- What's blocked or needs decision (`pending` with comment)

### WIP commits
- One commit per logical chunk (e.g. "fix #31-#34: global provider, InlineEditCell, /clients reuse, header")
- Commit message in format: `wip(admin): <summary>` or `fix(admin): <summary>`
- **Always include in commit body**: list of fix IDs and what each changed
- **NEVER push** in Phase 1
- **NEVER run tests / linters / pre-commit hooks** (they can OOM in this worktree)
- Snapshots and auto-generated artifacts are **excluded** from the commit

### Rollback
Each WIP commit is a checkpoint. To roll back, `git reset --hard <previous-SHA>`. The current `HEAD` is the "latest" — check `git log --oneline -5` for the rollback chain.

---

## Visual Verification (Playwright fallback)

**browserMCP is configured in `~/.config/opencode/opencode.jsonc` (line 36-39) but does NOT load in any session** — confirmed in multiple attempts (controller + subagent). The MCP server connects but `browser_navigate` / `browser_snapshot` / `browser_take_screenshot` / `browser_click` tools are not exposed in the function list.

**Workaround used successfully:** Playwright via Node script with the global installation at `/usr/local/lib/node_modules/@playwright/test/index.mjs` (v1.61.0, chromium-1228).

Pattern:
```javascript
import { chromium } from '/usr/local/lib/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('http://localhost:3001', { waitUntil: 'networkidle' });
// ... interact + screenshot
await browser.close();
```

Screenshots go to `/tmp/opencode/<feature>/` (mkdir first).

**Don't cold-start a new verifier** — resume `ses_11439f408ffe6vxZg0lBLnyRY5` (general agent) so it keeps the Playwright script in context.

---

## Dev Server Notes
- Backend (uvicorn): `:8000`, started in worktree via `setsid nohup .venv/bin/uvicorn src.main:app --host 0.0.0.0 --port 8000 > /tmp/v6-be.log 2>&1 < /dev/null & disown`
- Frontend admin (Next.js): `:3001` (worktree), `:3000` (main). Started via `setsid nohup pnpm exec next dev -p 3001 -H 0.0.0.0 > /tmp/v6-admin.log 2>&1 < /dev/null & disown`
- **No auth wall** — `/` redirects to `/schedule` (200). No login required.
- DB seeded at `backend/memo.db` (241KB, 2026-06-21). Has Анна Иванова (client `c1`) with visits `vis1`/`vis2` for week of 1.06.2026.
- Pre-push hooks can OOM in this worktree — use `git push --no-verify` if needed (but Phase 1 doesn't push anyway).

---

## Open Subagent Sessions (for reuse)
| Session ID | Type | Last used for | Reuse for |
|---|---|---|---|
| `ses_115cb423affezr8RXw8GvqgUVg` | `frontend-coder` | Task #34 (RecordHeader name) | All FasTP coder tasks in this session |
| `ses_11439f408ffe6vxZg0lBLnyRY5` | `general` | Task #34 verify | All visual verify tasks in this session |
| `ses_1158e8daaffezBJ8JKl6uaHav0` | `general` | Task #8/#9 (DB re-seed) | Backup general |
| `ses_114adc552ffeKMopCvyDFxVY4F` | `general` | StatusPicker verify | Backup general |

**Always resume**, don't cold-start. Reusing a session avoids re-loading context (the coder already knows 30+ fixes of conventions).

---

## Forbidden in Phase 1
- Running `code-quality-reviewer`, `spec-reviewer`, or `docser`
- Modifying tests
- Updating README / API docs
- Running pre-commit hooks
- **Pushing to remote** (wait for Phase 2)
- Starting new subagent sessions when a suitable one already exists
- Cold-starting Playwright (use the existing verifier session)

---

## Example Session
```
# User: "make the 'Add visitor' button look like a real button"
# Architect:
  1. TodoWrite: "Restyle 'Добавить посетителя' to outlined brand button" — pending
  2. Dispatch frontend-coder (ses_115cb423affezr8RXw8GvqgUVg) with full task
  3. Coder reports DONE
  4. TodoWrite: mark as completed
  5. Dispatch general verifier (ses_11439f408ffe6vxZg0lBLnyRY5) with Playwright
  6. Verifier reports all good
  7. TodoWrite: confirmed visually

# End of session:
  8. WIP commit: "fix(admin): restyle add-visitor button (task #N)"
  9. Update scratchpad with SHA + status
  10. Wait for "коммитим" or next fix
```

---

## Pending Fixes Queue (low/medium priority, not in active work)

These were identified during the last 4 verify rounds (2026-06-21) and pre-existing issues. Add to TodoWrite as `pending` if user picks them up.

### LOW (cosmetic / small)
- **Имя column truncation** in `RecordVisitsTable` — names truncate to "Анна Ивано…" because column is `flex-1 min-w-0`. Full value in DOM. Fix: widen column or remove `truncate` on input.
- **Footer not in initial viewport** — when ClientTab content is tall, `mt-auto` puts footer at end of scrollable content. Could be made sticky.
- **RecordHeader name duplication** in /clients — header shows client name; left panel also shows it. Cosmetic.
- **Tariff select shows "— тариф —"** for both visit rows in seed (visits don't have `tariff_id`). Seed data issue, not code.
- **BookingFilters.tsx** — `''` not assignable to `VisitStatus` (pre-existing TS error).
- **StatusPicker.test.tsx** — same type issue (pre-existing TS error).
- **Per-visitor tariff editing** (Wave 5 deviation, user: "потом когда-нибудь").

### MEDIUM
- **5 `/clients` integration tests will fail after #33 refactor** — `ClientRecordTab.test.tsx` (api/layout/interactions/integration) + `ClientRecordTab.integration.test.tsx`. They expect old atom imports / old layout. Phase 2 work.
- **7 e2e visual-regression snapshots** are untracked in worktree (`modal-*.png`, `records-*.png`, `schedule-*.png`, `menubar-*.png`). Will need to be regenerated + committed in Phase 2.
- **ActivityDetailsModal.test.tsx** — vitest worker timeout (fork pool config issue, pre-existing).

### HIGH (Phase 2 only)
- **Push 2 WIP commits to PR #101** (`ac18de3` + `f26ebde`). Requires Phase 2 review pass first.

---

## Rollback SHA chain
- `5e99ef1` — Wave 6 end (before all FasTP work in this session)
- `ac18de3` — WIP batch (30 FasTP fixes: modal, status, table compound, layout)
- `f26ebde` — Post-verify fixes (#31-#34): global ClientsProvider, InlineEditCell sync, /clients atom reuse, RecordHeader name ← **current HEAD**
