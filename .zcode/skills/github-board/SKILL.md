---
name: github-board
description: Manage GitHub Project board — read the Next Up trajectory, check card statuses, move issue status when starting/finishing work, shift the queue on completion. Invoke whenever the board comes up — session start, the user pastes a board/issue link or picks an issue, workflow finishing.
---

In the container the board is the **@manager's** responsibility, same as the scratchpad. On the host (zcode), the DESIGN session owns its board flips (design-phase §7) — and any other host session that touches the board follows this skill.

**Project:** configure per project — set `PROJECT_ID`/`OWNER`/`NEXT_UP_FIELD` constants in the script (get IDs via `gh api graphql` projectsV2 query).
**Script:** the script lives **in the project repo** (memo: host `.zcode/scripts/gh_board.py`, container `.opencode/scripts/gh_board.py`) — the board is part of the host/container seam and travels via git. Both canon harness folders ship identical copies (`.zcode/scripts/` + `.opencode/scripts/`); adjust the constants in both when seeding a new project.

## Model

The board = the development trajectory (durable, cross-session). The scratchpad = context of the work chosen in the current session. Do not mix them.

- **Status** — lifecycle stage: `Backlog → In Design → Ready to IMPL → In IMPL → PR (G7) → In-main → deployed`
- **Priority** — importance (Critical/High/Medium/Low)
- **Next Up** (1/2/3) — the user's explicit queue: which task to take next. Only the manager changes it, on the user's word.
- **host** — which machine owns the card (single select: `imac` / `macbook` / `hk` / `gcp`). The single ownership source for `In IMPL` / `In Design` cards (2026-09-20, replaced the CLAIM-comment mechanism): stamped automatically on entering those statuses (`status` arg > `GH_BOARD_HOST` env > container label file), cleared automatically on leaving. The auto-impl watcher budgets per host (`HOST_BUDGETS` in the script: imac 2 / macbook 1); an In IMPL card with an empty host blocks no one.
- **gate** — the pending-ask marker (single select: `concept` / `spec` / `plan` / `blocked`): a design gate stop or an IMPL blocker awaiting the user. Set via `gh_board.py gate N <value>`, cleared at the user's answer (`gate N none`) and automatically when the card leaves In IMPL/In Design. Empty = nothing awaits the user. Replaced the `gate:*` issue labels (2026-09-20).

Statuses are coarse positions; inside `In Design` the pending design gate is the **gate field** on the card — one of `concept` / `spec` / `plan`, set at the stop (`gh_board.py gate N <value>`) and cleared at the user's answer. Empty gate + `In Design` = the agent is working, nothing awaits the user. The design card flips only once: `In Design` → `Ready to IMPL` at gate C (fast-track skips `Ready to IMPL` entirely). Single exception: `In IMPL` flips at IMPL dispatch, before G3 evidence exists — a flip placed after the blocking dispatch lands hours late or never (see touchpoint below). (In Review and Staging / QA were removed — never used.)

| Status | Gate | Meaning | Set by |
|---|---|---|---|
| Backlog | — | not in the trajectory | user |
| In Design | A/B/C | design in progress — gates live here; the chip names the pending ask (concept pick / spec OK / plan forces a spec change) | DESIGN session |
| Ready to IMPL | C | gate C passed (auto unless the plan forced a spec change): plan reviewed and pushed — the signal for IMPL start (plan-only start) | DESIGN session |
| In IMPL | G3 | IMPL dispatched (plan-only start); worktree + baseline green follow as the architect's first steps | container manager |
| PR (G7) | G7 | finishing: PR open, CI/merge pending | container |
| In-main | — | merged to main | manager, mandatory |
| deployed | — | released to production | user |

## Commands

```bash
python3 .opencode/scripts/gh_board.py next-up                    # show the trajectory (queue 1→3)
python3 .opencode/scripts/gh_board.py show 176                    # read one card: status + queue position
python3 .opencode/scripts/gh_board.py show all                    # the whole board as a table
python3 .opencode/scripts/gh_board.py set-next-up 176 1          # put an issue in the queue (1|2|3); "none" — remove
python3 .opencode/scripts/gh_board.py shift                      # after Next Up 1 completes: clear it, shift 2→1, 3→2
python3 .opencode/scripts/gh_board.py status 176 "In IMPL"       # move a card's status; optional 3rd arg = host value (imac/macbook/hk/gcp)
python3 .opencode/scripts/gh_board.py host 176                    # read the card's host field (empty when unset)
python3 .opencode/scripts/gh_board.py gate 176 spec                # pending-ask marker: concept|spec|plan|blocked; none — clear
python3 .opencode/scripts/gh_board.py merged 176 177 "short title" # v2: append the "Recently merged" scratchpad line
```

An issue is automatically added to the board on the first set/status call if it wasn't there.

## Workflow touchpoints

| Moment | Action | Who |
|---|---|---|
| **Session start, no active workflow** | `gh_board.py next-up` → show the user the trajectory, ask what to take | manager, automatic |
| **Card status check (pre-flight, triage, "can X run in parallel?")** | `gh_board.py show N` (or `show all`) | manager |
| **User picked a task** | `status N "In Design" imac` (host arg: design runs on the iMac host; in-container callers resolve their host from the label file automatically) | whoever runs DESIGN — manager in-container; host DESIGN session after the split |
| **Design stop / gate passed (A/B/C)** | stop → `gate N concept|spec|plan`; user answered → `gate N none`; gate C passed → `status N "Ready to IMPL"` (clears gate automatically) | whoever runs DESIGN |
| **New issue created (gh issue create)** | add the card in the same breath: `status N "Backlog"` — the user tracks work in the project board and does not see card-less issues; discuss Next Up only when it is upcoming work | manager |
| **User changes the trajectory** | `set-next-up` per their words | manager |
| **Plan-only IMPL entry (split): user says «продолжаем траекторию #N», card at `Ready to IMPL`** | verify card + plan on fetched main → `status N "In IMPL"` → dispatch IMPL (plan-only start, no worktree yet — architect's first action). Flip BEFORE the dispatch: the dispatch blocks for the whole marathon (2026-09-13: #262 sat on `Ready to IMPL` through a 15-hour run) | manager, container |
| **IMPL blocked: spec/plan invalid (return path)** | architect reports BLOCKED → user decides → issue comment + `status N` back to `In Design` (broken plan additionally sets `gate N plan`); scratchpad (v2): section removed if the worktree is discarded, kept while a kept worktree lives — the durable record is the issue comment; worktree keep-vs-discard — user decides | manager, after user decision |
| **Finishing: PR created** | `status N "PR (G7)"` at the architect's `PR_CREATED` report (finishing Dispatch 1 ends right after PR creation) → immediately re-dispatch the architect for CI watch + merge; `In-main` flip at its DONE | manager |
| **Workflow finished, PR merged** | `status N "In-main"`; if the issue was Next Up 1 → `shift`; close the issue if still open (`gh issue close N --reason completed` — the PR's `Closes #N` normally auto-closed it at merge; tolerate "already closed"); then `merged N <pr> "<short title>"` (v2 — appends the `## Recently merged` line) and remove your scratchpad section | manager, mandatory finishing step (architect reports `## Board Update Needed`) |

## Rules

- ALL board interaction — reads AND writes — goes through this script only. NEVER hand-write `gh api graphql` against the project: reads waste calls and have historically gone wrong (wrong owner type, nonexistent fields), and field-definition mutations destroy data.
- Changing the status option list (adding/renaming statuses) is **user-only, via the GitHub web UI**. The agent never runs `updateProjectV2Field`: the mutation replaces the whole option list and detaches every card's value (2026-09-09: 65/69 cards lost Status this way). Need a new status → ask the user to add it in the web UI.
- Next Up — max 3 positions, no duplicates (the script frees an occupied position automatically).
- Every new issue gets its board card (Status=Backlog) immediately at creation — the board mirrors ALL open issues; an off-board issue is invisible to the user (2026-09-14: 28 open issues had silently accumulated off-board this way).
- Don't move Status on every micro-task — only when the whole task's stage changes.
- FasTP fixes without an issue: don't touch the board. FasTP on an issue: Status In IMPL → In-main as usual.
