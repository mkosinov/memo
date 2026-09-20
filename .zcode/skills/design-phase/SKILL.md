---
name: design-phase
description: DESIGN phase on the host (zcode) in the host/container split topology — scout + issue-actuality check → concept gate A (auto) → spec + 6-reviewer panel → spec gate B (the user's main OK) → plan + plan-reviewer → plan gate C (auto), DoD = push to origin, board = the scripts/gh_board.py script living in memo itself, handoff to the container is «продолжаем траекторию #NNN». Use when the user writes «design #NNN», «продолжаем design», «вернулся #NNN», or asks for a spec/plan for an issue in a host session.
---

# DESIGN phase on the host (split host/container)

## 0. Topology and role

DESIGN (gates A/B/C — restructured 2026-09-18; board: `In Design` → `Ready to IMPL` + the gate field, §2) is this interactive zcode host session. IMPL (G3–G7) is the opencode container (@manager/@architect) — we do not go there. The session merges the manager+architect roles for DESIGN: talks to the user at the gates and dispatches subagents **one level deep** (panel, plan reviewer) — nested dispatch is unnecessary and unavailable (depth limit).

Only what is pushed/flipped crosses the seam (git + board). Workflow canon: `~/dev/superagents/docs/workflow/design-phase.md` (this phase) + `impl-phase.md`; migration plan: `~/dev/superagents/docs/plans/2026-09-05-host-design-container-impl-split-plan.md`.

## 1. Session start (ritual)

1. Card returned from IMPL? First `gh issue view N --comments` (read-only) — a comment is the input: re-run the affected gates, not everything from scratch.
2. Git pre-flight (in `~/dev/memo`): `git fetch origin && git status -sb`
   - behind → `git pull --ff-only`, continue;
   - **diverged (ahead+behind) → STOP**: show the user, reset nothing (precedent — passenger commit cc8bc52).
3. Board: `next-up` (§7) → show the trajectory to the user.
4. The user picks an issue → `status N "In Design" imac` (third arg = the host field value; design runs on the iMac host — the field is the single ownership source for In IMPL/In Design cards). Guard: the issue must not sit in `In IMPL` — one issue lives in one phase at a time.
5. **Scout (pre-design recon) — by dispatch, not by hand.** Right after the issue is picked, dispatch built-in read-only subagents to gather facts (zcode — `Explore`, opencode — `explorer`; a cheap model is these agents' default). Default is **one**; wide scope (many subsystems / dependency issues) — several in parallel, one per zone, in a single Agent-tool message. The prompt: issue number, what the issue claims, what to verify against the live tree (dependencies, consumers, patterns) — plus an **actuality check**: is the gap the issue describes still there, claim-by-claim against live code and recently merged PRs.
   - Back comes a **compact fact sheet**: key files' structure/size vs the issue's claims; every claim confirmed/denied with `file:line`; dependency issues' state (open/closed + a one-line delta); consumer inventory; ready patterns to reuse; ending with the **actuality verdict**: `actual` / `partially stale` / `stale`.
   - **Stale-issue auto-close (2026-09-18, user decision):** verdict `stale` — every load-bearing claim of the issue contradicted by the live tree AND the described gap verifiably gone (already implemented or fully superseded; cite `file:line` and the PR/merge that closed it). The main session FIRST re-verifies 1–2 load-bearing claims itself against the code (scout reports err in paths — #287 lesson); confirmed → comment the evidence on the issue, `gh issue close N --reason "not planned"`, board card → `Not planned`, report in this session. A wrong close is one click to reopen. A doubtful verdict never closes: comment what is off and keep designing. `partially stale` → correct the stale claims in an issue comment and bake the corrections into the concept and spec; the issue body itself is not edited.
   - Until Gate A the main session reads **only scout reports** — as-is, no raw merging. No raw file bodies or grep dumps into its context (`gh issue view` on dependencies goes to the scout too). Rationale: the main session's context is expensive and lives the whole session (Gate A → Gate C); recon garbage in it is dead weight (issue #14: ~10 tool calls and a 577-line file read to produce a ~40-line concept).
   - A spot check during the Gate A dialogue (one grep / one file section) is fine by hand; bulk recon — scout only.
6. **Step-0 report + Gate A.** The design turn's first user-facing message opens with the **step-0 block** — the issue retold for a reader who has not opened it: issue number; 3–5 keywords; the issue as a user scenario (who does what, what changes for them — plain words, no jargon); the problem it solves. Then Gate A (§2): candidate approaches → auto-OK, or the divergence stop. There is no separate interactive question-by-question dialogue.

## 1.5 Session rules (talking to the user)

- A message ending in `?` is a question: answer in text, **no actions** (tools, commits, file edits). Exception: the answer needs data not in context — read-only gathering (read a file, `git log`), then an immediate text answer.
- **Report before answer**: a new message does not cancel an unread work result. First the result as a status block — a **markdown list**, one item per line (bold items on adjacent lines without blank lines collapse into a single rendered line; "Files changed" / "Evidence" items dropped 2026-09-18 by user decision, as in `~/.zcode/AGENTS.md`):
  - **Status:** `DONE | DONE_WITH_CONCERNS | BLOCKED | awaiting user OK`
  - **Open questions** or an explicit "OK to mark this done?"
  Then the answer to the new message. If no dispatches happened since the user's last message and nothing awaits their decision — say "no outstanding tasks" and answer immediately. Edits in the current turn — the final message must summarize them.

## 2. Gates (A and C auto by default; B always the user's; the card sits in `In Design` for the whole design — the `gate` field marks the pending ask; the only design flip is → `Ready to IMPL` at Gate C)

Restructured 2026-09-18 by user decision: the old interactive G1a brainstorm and the plan-approval G2 are replaced by auto gates; the panel-reviewed spec at Gate B is the main human gate. Board statuses (renamed by the user in the web UI the same day; the old `Spec OK (G1b)` option is deleted): `In Design` — ALL design work, gates A/B/C live here; `Ready to IMPL` — plan pushed, the IMPL start signal.

| Gate | Decides | User stop only when | After the gate |
|---|---|---|---|
| A — concept | what we build / deliberately do NOT (scope boundaries) | ≥2 concepts remain divergent after the filter below | auto-OK → the spec is written, no stop. Divergence stop → `gate N concept` |
| B — spec | the spec — after the panel's consolidated report and fixes | always — the user's OK is mandatory | `gate N none`; commit + **push** the spec; the card stays `In Design` |
| C — plan | the plan — after plan-reviewer | the plan forces a spec change | auto-OK: fixes folded in; commit + **push** the plan; card → `Ready to IMPL`. Stop → `gate N plan`. Gate C is the last point where the discussion may still return to Gate A |

### The gate field (the pending ask is a single-select field on the board card, not a label and not a board status; replaced the gate:* issue labels 2026-09-20)

- Exactly one value may sit in the field: `concept` / `spec` / `plan` (a design stop) or `blocked` (an IMPL blocker awaiting the user — set by the container manager); set together with the stop message via `gh_board.py gate N <value>`, cleared (`gate N none`) the moment the user answers (a new stop replaces the old value). Empty + `In Design` = the agent is working, nothing awaits the user. Leaving `In Design`/`In IMPL` via `status` clears the field automatically.
- One writer: only the design session of that issue touches its gate value.
- Read–check–repair: on any session start and on return from IMPL, cross-check (status × gate) against git — the spec on main = Gate B passed, the plan on main = Gate C passed. On mismatch git wins: repair the gate/status and say so out loud.
- `gh_board.py status` matches option names exactly (`In Design`, `Ready to IMPL`); pickers match by prefix. Agents never rename or add board options (2026-09-09 incident).

### Gate A divergence filter (run before any user stop)

1. Eliminate an approach that violates a rule the repo already fixes — name the rule (domain-rules, design-system, the layer invariant, board conventions).
2. Eliminate an approach that re-implements a mechanism the scout found in the live tree — reuse wins (precedent #257).
3. Approaches differing only in internals (file layout, naming, UI micro-layout, refactor shape) are one approach — auto-OK.
4. Approaches are **divergent** — the user picks — when they differ in any of: user-visible behavior; data model (tables, columns, migrations); API contract (endpoints, payloads, semantics); scope (one of them deliberately does NOT build part of the issue); reversibility (breaking or one-way change).
5. Never present more than three; merge near-identical ones first. In doubt — stop for the user: a wasted stop is cheaper than a silently wrong choice.

**Gate B message format** — plain words, no jargon, no unexplained abbreviations; self-contained (understandable without opening any file):
1. step-0 block (skip if already shown at Gate A);
2. chosen concept + why, briefly — stated even when auto-selected;
3. **Behavioral Delta**, from the spec (§3);
4. technical summary of the finished spec — what changes, where, how it is tested;
5. premises of the issue that the recon corrected (if any) — what differs from the issue text and why;
6. panel outcome in one line;
7. remaining assumptions as open questions;
8. spec path.

**Fast-track exception (docs/harness issues):** an issue touching only
documentation (`docs/`) or the harness (`.zcode/`/`.opencode/` — no app
code) may skip the container IMPL session entirely: Gates A/B unchanged,
Gate C collapsed by default — the spec carries a `## Verification` section
(mechanical checks) instead of a plan artifact; keep the plan only for
≥3-task decompositions or verification that needs design (user decides at
Gate B). The host session implements right after the gates; spec/plan (if
any) land in the change PR; the card goes `In IMPL` while the PR is open →
`In-main` on merge and never sits in `Ready to IMPL`; `Closes #N`
belongs in the PR description only; no handoff message. Full details:
superagents canon `docs/workflow/design-phase.md` §Fast-track (v3.10).

## 3. Artifacts

- Spec: `docs/specs/YYYY-MM-DD-<feature>-design.md`. Must include a `## User Scenarios` section — 3–7 user tasks the feature enables, each mapping to an E2E test (anchors the plan's E2E-in-DoD rule; the completeness panelist checks it) — and a `## Behavioral Delta` section — what changes for the user, before → after (written at spec time, so the panel reviews it and Gate B prints it). **Self-contained BEFORE the panel**: the panel does not read GH issues — the scope check against the issue is done by the main session itself, with findings baked into the spec text.
- Fast-track specs additionally carry a `## Verification` section (mechanical checks instead of E2E — see §2 fast-track exception).
- Plan: `docs/plans/YYYY-MM-DD-<feature>-plan.md` per the writing-plans conventions (canon: `~/dev/superagents/.opencode/skills/writing-plans/SKILL.md`):
  - header: Goal / Architecture / Tech Stack; the behavioral delta lives in the spec's `## Behavioral Delta` (memo deviation from the writing-plans canon, 2026-09-18) — a plan task implements a User Scenario, it does not restate behavior;
  - every task anchor: `## Task N: <name>` + `### Classification: trivial|small|standard|large`; after commit, never renumber anchors;
  - every task carries `### Required Docs` (domain-rules for entities, design-system for UI);
  - a task implements a User Scenario (from the spec's `## User Scenarios`) → its DoD line: "E2E test for scenario N passes (RED-GREEN-REFACTOR)";
  - no placeholders ("TBD", "add validation" — that is a plan failure).
- Domain rules changed → `docs/domain-rules/` is committed together with the spec.

## 4. Panel (host port — body from `.opencode/skills/panel-spec-review`)

1. Dispatch: **6 agents in parallel**, in a single Agent-tool message:
   `spec-panel-completeness`, `spec-panel-consistency`, `spec-panel-feasibility`, `spec-panel-simplicity`, `spec-panel-best-practices`, `spec-panel-security` (files in the repo's `.zcode/agents/`, models `omniroute/panel-*`).
2. Each prompt: the **spec path** (+ the previous spec revision's path, if there was one). No `gh issue view`, no network — except best-practices, whose design includes WebSearch/WebFetch.
3. Aggregation: collect the 6 reports → dedupe identical findings → rank **BLOCKER > MAJOR > MINOR** → one consolidated report to the user for the fix decision.
4. **Availability policy (host adaptation, no subagent audit):** a panelist did not return / crashed → **one** rerun; second failure → mark it `skipped` in the consolidated report, verdict on the rest.
5. best-practices returned `Verdict: FAILED` (web research unavailable) → note it in the report and exclude it from the verdict — that is its designed refusal, not a crash.
6. The agent registry is seeded only at session start: `Agent tool: not found` while `.zcode/agents/` files exist → restart the session.

## 5. Gate C — plan review

Dispatch `plan-reviewer` (verifies the plan faithfully and completely expands the approved spec): the prompt carries the spec path + plan path. No spec-changing findings → Gate C auto-OK: fold the fixes into the plan text, commit + push, board → `Ready to IMPL` — no user stop. The closing report lists the plan's tasks, one line each, plus the spec/plan paths. Findings that change the spec (from the reviewer or from writing the plan itself) → STOP: `gate N plan`; what was found, why the spec changes, the proposed fix — the user decides; this is the last point where the discussion can still return to Gate A.

## 6. DESIGN session DoD (the seam contract)

- Only **git and the board** cross the seam. The session does NOT end holding local commits: every passed gate = commit + push to origin/main.
- **No closing keywords in direct-to-main commits.** Spec/plan/harness commit messages must NOT contain `Closes/Fixes/Resolves #N` — GitHub auto-closes the issue the moment the commit lands, though no IMPL has started (2026-09-14: #261 closed by a "Closes #261 on merge" phrase; #48 the same way). Write "to be closed by the IMPL PR" instead. The closing keyword belongs only in the IMPL PR description.
- **Issue bodies declare hard dependencies as a `depends-on: #N, #M` line** — empty for independent tasks; examples only inline in backticks, because any line-start `depends-on:` is parsed as a real declaration (`gh_board.py` `_open_deps`, both harness copies) and the auto-impl pipeline skips the card while a referenced issue is OPEN. The stub ships in the issue template `.github/ISSUE_TEMPLATE/issue.md`.
- **New issues are born attributed and placed**: add the `app:admin|app:web|app:ai` label (attribution for cross-app analysis); an issue belonging to a direction surface (web/ai) is attached as a GitHub sub-issue of its direction/epic umbrella issue (`gh api repos/{owner}/{repo}/issues/<parent>/sub_issues -F sub_issue_id=<db-id>`). Umbrella wrappers never enter the project — the board stays a pure execution queue. Release scope is a milestone; membership changes no board statuses.
- **All decisions are folded into the artifact texts**: review amendments, constraints like "#NNN strictly after #NNN — shared file" go into the spec/plan, not the chat. Git and the board carry no session context across the seam. This is the DESIGN DoD under Scratchpad Discipline v2: DESIGN writes zero scratchpad state, so the pushed spec/plan are the ONLY carrier — fold every decision and dependency in **before the phase closes**.
- After Gate C tell the user: «скажи менеджеру в opencode: продолжаем траекторию #NNN». The container needs nothing else.
- Does NOT cross the seam: `.opencode/scratchpad.md` (the container seeds its section at IMPL start — DESIGN itself writes nothing, v2), worktrees, env. The host **never writes or reads** the scratchpad — there are no container operations during the DESIGN phase at all.

## 7. Board (the script lives in memo, run locally)

```bash
python3 .zcode/scripts/gh_board.py next-up
python3 .zcode/scripts/gh_board.py show 247                # read one card; `show all` = whole board
python3 .zcode/scripts/gh_board.py status 176 "Ready to IMPL"   # leaving In Design/In IMPL clears the host field automatically
python3 .zcode/scripts/gh_board.py set-next-up 176 1   # only on the user's word
```

- The script's golden source is **the memo repo itself** (`.zcode/scripts/gh_board.py`, Project #3 constants baked in). The script is part of the seam: it lives in git, so both the host and the container have it after a pull; the container copy is `.opencode/scripts/gh_board.py`. No extra copies outside the harness folders.
- **No raw-GraphQL fallback.** ALL board interaction — reads and writes — goes through the script; never hand-write `gh api graphql` against the project. Field-definition mutations (`updateProjectV2Field`: adding/renaming status options) are forbidden for agents: the mutation replaces the whole option list and detaches every card's value (2026-09-09: 65/69 cards lost Status this way). A new status is added by the user in the GitHub web UI, which appends safely.
- One writer per issue: DESIGN flips (`In Design` → `Ready to IMPL`; inside the design the pending gate is the `gate` field value, §2; fast-track goes straight to `In IMPL`) — this session; IMPL flips — the container manager. The script adds an issue to the board on first contact.

## 8. Rules

- One issue = one phase at a time; the board is the guard. DESIGN on X + IMPL on Y in parallel — allowed.
- One DESIGN session = one issue.
- Parallel DESIGN sessions (different issues, different host sessions): simultaneous push → `git pull --rebase`.
- Return from IMPL: the card goes to `In Design` + an issue comment — a broken spec restarts the design, a broken plan additionally sets `gate N plan` (decision needed); that is a new DESIGN session's starting point (§1.1).
- DESIGN-phase agents and skills live **in this repo**: `.zcode/agents/` + `.zcode/skills/` — `design-phase` (the phase protocol) and `brainstorming` (standalone explicit-invocation dialogue — «побрейнштормим»; since the 2026-09-18 gate restructure no design gate routes through it) (git = source of truth for the memo port). Superagents canon: bodies — `~/dev/superagents/.opencode/agents/`, reference seed of host ports — `~/dev/superagents/.zcode/agents/`; a canon change is ported by editing the files in `.zcode/agents/` (the port is marked in each file's header). Canon v3.4 (2026-09-06): panel `spec-review-*` → `spec-panel-*`; `spec-reviewer` split into `plan-reviewer` (G2, host) + `code-compliance-reviewer` (G5, container-only). The omniroute model catalog is the local `~/.zcode/v2/config.json` (with keys — never committed).
