---
name: auto-design
description: Auto-DESIGN watcher protocol for the memo repo — the single source of truth the scheduled automation "auto DESIGN" runs by. One run = one issue driven through scout + actuality check → gates A/B/C (spec + panel + plan) or the fast-track, with user stops exactly where the protocol says. Use when the scheduled automation fires or when the user asks for a watcher design cycle.
---

# Skill: auto-design
# Auto-DESIGN watcher protocol (scheduled-automation session)

You are the auto-DESIGN watcher session for the memo repo, started by the
scheduled automation (every 2 hours). Work through ONE cycle per run: take
ONE issue, drive it to the first user stop (or to completion), end the turn.
The user is usually absent — ask everything in ONE message in this session
and end the turn; the cycle continues here when they answer.

Base directory for this skill: `.zcode/skills/auto-design/`.
Board mechanics (statuses, the gate field, commands, script-only rule) are canonical in `.zcode/skills/github-board/SKILL.md` — obey it. Operational line: `python3 .zcode/scripts/gh_board.py <subcommand>`; design statuses: `In Design` (all design work, gates A/B/C), `Ready to IMPL` (plan pushed, the IMPL start signal).

## Step 1 — Pick

- `pick-next-design` returned a number → work it.
- `NONE (design slot busy: …)` — NORMAL (cards accumulate in design): choose the next FREE Backlog card yourself — Priority first (Critical → Low, unset last), then the older issue number; avoid file overlap with designs in flight. None free → say «свободных карточек нет» and end.
- `NONE (no Backlog cards)` → «Очередь пуста: в Backlog нет карточек», end. `NONE (all Backlog cards blocked by depends-on)` → «Очередь пуста для наблюдателя: все карточки Backlog заблокированы зависимостями», end.

## Step 2 — Claim

- Git pre-flight: `git fetch origin && git status -sb`; behind → `git pull --ff-only`; diverged (ahead+behind) → STOP, report, reset nothing.
- `gh_board.py status N "In Design" imac` (third arg = the host field value — this watcher runs on the iMac host; the field is the single ownership source for In IMPL/In Design cards); one-line issue comment: `auto-design: taken <UTC>`.

## Step 3 — Scout + actuality + step-0 report

- Dispatch the read-only scout (Explore). Prompt: issue number, its claims, what to verify against the live tree (dependencies, consumers, ready patterns) + an actuality check: does the described gap still exist, claim by claim, incl. recently merged PRs. The main session reads only the scout's report — no raw files into its context.
- The report ends with the verdict: `actual` / `partially stale` / `stale`.
- Right after the scout — the run's FIRST user-facing message (step-0 block). Its FIRST LINE is the ZCode session title the user copies from here (the model cannot rename the session itself): issue number + a short plain-language phrase naming the essence, e.g. «296 лишний запрос отмененного поиска». Then: the issue retold as a user scenario (who does what, what changes for them — plain words, no jargon); the problem it solves. No keywords list — dropped 2026-10-08 by user decision (the title line replaced it).
- Verdict `stale` → FIRST re-verify 1–2 load-bearing claims yourself against the code (scout reports err in paths). Confirmed → evidence comment (`file:line` + the merge that closed the gap), `gh issue close N --reason "not planned"`, card → `Not planned`, report, end the run. Not confirmed / doubt → do NOT close: comment what is off, `gate N concept`, stop message, end the turn.
- Verdict `partially stale` → correct the stale claims in an issue comment and bake the corrections into the concept and spec.

## Step 4 — Gate A: concept + flow classification

- From the issue + scout facts: 2–3 approaches with trade-offs + scope boundaries (what we deliberately do NOT build).
- Classify the flow (user decision 2026-10-08): STANDARD (spec + panel → Gate B → plan → Gate C) or FAST-TRACK (no spec, no plan, no panel — the agreed concept is the only artifact). FAST-TRACK fits when the agreed concept fully determines the change — a mechanical operation with no open questions of mechanism, contract, or user-visible behavior (e.g., re-recording test assets, docs fixes, mirror edits of harness copies). In doubt → STANDARD.
- Filter: eliminate an approach violating a rule the repo already fixes (domain-rules, design-system, the UI→service→data layer invariant, board conventions — name the rule); eliminate re-implementation of a mechanism the scout found live; internals-only differences (file layout, naming, UI micro-layout) = one concept.
- Divergence (user stop): approaches differ in user-visible behavior / data model / API contract / scope / reversibility. Max three presented, merge near-identical ones. In doubt — stop.
- One concept survives + STANDARD → write the spec immediately, no stop.
- FAST-TRACK → stop ONCE here, single concept or not: `gate N concept`, message (step-0 if not yet shown + the concept + the flow classification with the reason + open questions if any), end the turn. The user's agreement on the concept covers the classification. No implementation before that OK.
- Divergence → `gate N concept`, message (step-0 if not yet shown + approaches with trade-offs + the flow recommendation + open questions), end the turn. No spec before the user picks.

## Step 5 — Spec + panel (STANDARD flow)

- Spec `docs/specs/YYYY-MM-DD-<feature>-design.md`, content in Russian. Required sections: `## User Scenarios` (3–7, each mapping to an E2E test) and `## Behavioral Delta` (what changes for the user, before → after). Self-contained: the panel does not read issues — the scope check against the issue is the main session's, folded into the text.
- Panel (container runner on zen free models, D-flow since 2026-09-26): save the spec to `/tmp/panel-<N>/spec.md` (+ `prev-spec.md` if a revision exists); then `docker exec opencode mkdir -p /root/workspace/panel-in` and `docker cp /tmp/panel-<N> opencode:/root/workspace/panel-in/<run-id>`. Run in the background (a full panel takes up to ~25 min): `docker exec opencode bash /root/workspace/memo/.opencode/scripts/panel_review.sh <run-id> /root/workspace/panel-in/<run-id> spec-panel-completeness spec-panel-consistency spec-panel-feasibility spec-panel-simplicity spec-panel-best-practices spec-panel-security` — one summary line per agent (rc / seconds / report path). Fetch reports: `docker cp opencode:/root/workspace/panel-out/<run-id> /tmp/panel-out-<run-id>`; read each `<agent>.md` in full — the final report sits at the end, agent chatter may open the file. `rc != 0` or a report under 300 bytes → one rerun of that agent alone (same script, only that agent as the argument); second failure → mark it `skipped`, verdict on the rest. best-practices `Verdict: FAILED` (no network) is its designed refusal — exclude it from the verdict. Container unreachable → fallback: the 6 host agents (`.zcode/agents/`) in one parallel dispatch, each prompt = the spec path + a hard tool-call budget; `Agent tool: not found` with agent files present → tell the user the app needs a restart, end.
- Aggregate: dedupe, rank BLOCKER > MAJOR > MINOR; verify each finding against the code before fixing (reviewers err in paths); fold fixes into the spec. Changed domain-rules are committed together with the spec.

## Step 6 — Gate B: spec OK (mandatory stop, STANDARD flow)

Message — in Russian, no jargon, no unexplained abbreviations, self-contained (understandable without opening any file): step-0 block (if not shown) → chosen concept + why, briefly, also when auto-selected → Behavioral Delta from the spec → technical summary of the spec (what changes, where, how it is tested) → premises of the issue corrected by recon (if any) → panel outcome in one line → remaining assumptions as open questions → spec path.
Then `gate N spec` and end the turn. Push NOTHING before the explicit OK.

## Step 7 — After OK

- Clear the gate: `gh_board.py gate N none`. Commit + push the spec (+ domain-rules). Commit message WITHOUT Closes/Fixes/Resolves (closing keywords belong to the IMPL PR only).
- Plan `docs/plans/YYYY-MM-DD-<feature>-plan.md`, in Russian. Header Goal / Architecture / Tech Stack; do NOT restate the Behavioral Delta (it lives in the spec); every task maps to a User Scenario; anchor `## Task N` + classification trivial|small|standard|large + Required Docs; no placeholders.
- Review: the same container runner — put `plan.md` and `spec.md` into the input dir, then `docker exec opencode bash /root/workspace/memo/.opencode/scripts/panel_review.sh <run-id> /root/workspace/panel-in/<run-id> plan-reviewer`; the report lands at `/root/workspace/panel-out/<run-id>/plan-reviewer.md`. Container unreachable → host agent `plan-reviewer` (`.zcode/agents/`, prompt = the spec and plan paths).

## Step 8 — Gate C: plan (auto)

- No spec-changing findings → auto-OK: fold fixes into the plan, commit + push, card → `Ready to IMPL`, gate empty. Closing message: the plan's tasks one line each, spec/plan paths, «скажи менеджеру в opencode: продолжаем траекторию #N». End the run.
- Findings that change the spec (the reviewer's or your own while writing the plan) → STOP: `gate N plan`, message (what was found / why the spec changes / the proposed fix), end the turn. This is the last point where the discussion may return to Gate A.

## Fast-track (no spec, no plan, no panel; user decision 2026-10-08)

Entry: classified at Gate A and agreed with the user there (the ONE stop of this flow) — the concept fully determines the change: mechanical, no new mechanisms, contracts, or user-visible behavior. On OK: record the agreed concept as a short issue comment — that comment replaces the spec.

Then implement in THIS session, open a PR (`Closes #N` in the PR description only). Merge by the repo merge gate (AGENTS.md — green CI is the only trigger, `--auto` banned): red CI → no merge, report and stop. Card `In Design` → `In IMPL` when implementation starts → `In-main` after the actual merge (next run if CI is still spinning); the card never sits in `Ready to IMPL`. Do NOT run `gh_board.py merged` on the host — the scratchpad file lives in the container and the command fails on the host.

Mid-flight forks are NOT yours to decide silently: any new decision — mechanism, contract, user-visible behavior, a needed workflow/CI change — → stop, `gate N concept`, message (the fork + options + recommendation), end the turn; on the answer continue in this session. If the work turns out to need spec-grade design (a ≥3-task decomposition or verification that needs design), reclassify as a normal design: spec → panel → Gate B → plan → Gate C → `Ready to IMPL` (container IMPL).

## Rules

- One design per run. The user's manual session on the same issue always wins — defer to it.
- The design card moves only forward: `In Design` → `Ready to IMPL` (fast-track: `In Design` → `In IMPL` → `In-main`). Return from IMPL is another session's job: broken spec → `In Design`, broken plan → `In Design` + `gate N plan`.
- Gate field: max one value; a new stop replaces the old value (`gh_board.py gate N <value>`); the user's answer clears it (`gate N none`). Leaving In Design/In IMPL via `status` clears it automatically.
- Close an issue ONLY on the Step-3 stale bar. Duplicate / not a task / missing critical info → comment + `gate N concept` + stop, no closing.
- Blocked mid-design → comment `auto-design blocked: <reason>` on the issue, card stays, explain in the session, wait for the user.
- Spec/plan/domain-rules content in Russian; harness files in English.
