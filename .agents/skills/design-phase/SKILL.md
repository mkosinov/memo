---
name: design-phase
description: Design a Memo GitHub issue in a Codex session, from codebase reconnaissance through reviewed spec and implementation plan. Use when the user selects an issue for design or asks to resume its design; this skill does not implement application changes.
metadata:
  short-description: Design Memo issues in Codex
---

# Memo issue design in Codex

Produce a reviewed, self-contained specification and implementation plan before application code is written. This skill is the complete Codex workflow; follow the gates below without loading another harness's workflow instructions.

## Tools and boundaries

- Use `functions.exec` / `tools.exec_command` for repository commands and `collaboration.spawn_agent` / `collaboration.wait_agent` for bounded read-only reviews. Agents share the workspace; tell reviewers not to edit files.
- Use the repository board CLI for every board read or write: `python3 .zcode/scripts/gh_board.py`. Never issue handwritten GraphQL for the project board.
- DESIGN produces specs, plans, and necessary domain-rule updates. Do not implement application behavior during a standard design.
- Standard issue status flow is `Backlog → In Design → Ready to IMPL`. The board's `gate` field records a pending user decision (`concept`, `spec`, or `plan`); host is `imac` while this Codex session owns DESIGN. One issue can occupy only one phase at a time.
- Specs, plans, and domain rules are written in Russian. Skill and other harness files are written in English.

## Start a design

1. Run `git fetch origin && git status -sb`. If the branch is behind, run `git pull --ff-only`. If it is diverged, stop and report; never reset or rebase the user's work. Preserve all pre-existing modifications. If an update would overwrite local work, stop and explain the overlap.
2. Read the selected issue, its open dependencies, and its board card. Read the full board when the user asks what to pick or when queue order matters. Confirm the issue is open, eligible, and not already `In IMPL`.
3. Claim a user-selected issue with `python3 .zcode/scripts/gh_board.py status N "In Design" imac`. Read it back with `show N`. At a user stop, set `gate N concept|spec|plan`; when the user answers, clear it with `gate N none`. At Gate C completion, set status to `Ready to IMPL`. Do not change priority.
4. Dispatch one read-only `explorer` subagent for pre-design reconnaissance. Prompt it with the issue's claims, dependencies, recent merges, and what to verify in the live tree. Request a compact fact sheet with `file:line` evidence, actual consumers, current reusable patterns, dependency status, and a final verdict: `actual`, `partially stale`, or `stale`. For a wide issue, split independent zones across scouts, at most three concurrently. Do not bulk-read implementation files in the parent session before the scout report; use the report to decide what needs a spot check.

If the scout says `stale`, independently recheck one or two load-bearing claims. Close the issue as not planned only when every essential claim is contradicted and the gap is verifiably gone; add concise evidence to the issue and set the board to `Not planned`. If any doubt remains, do not close it. For `partially stale`, correct the premise in an issue comment and carry the correction into the design.

## Gate A: concept and scope

After the scout, begin the design report with a short session-title line (`#N <plain-language essence>`), then retell the issue as a user scenario and state the problem it solves. Do not use unexplained repository jargon.

Identify the concepts that satisfy the issue and state what each deliberately excludes. Remove concepts that violate established product rules or duplicate a mechanism already in the tree. Treat differences limited to naming, file layout, or internal refactoring as one concept. Classify as **STANDARD** if the design has meaningful behavior, data-model, API, security, migration, or test decisions; use **FAST-TRACK** only for fully determined mechanical work with no open behavior or contract choices.

Proceed without stopping when one concept clearly follows from the issue and repository evidence. Stop with `gate N concept` and ask the user to choose when viable concepts differ in user-visible behavior, data model, API contract, scope, or reversibility. Present at most three choices, with trade-offs and a recommendation. Do not silently choose across such a boundary.

## STANDARD: specification and Gate B

Write a Russian spec at `docs/specs/YYYY-MM-DD-<feature>-design.md`. It must stand alone: reviewers read the spec, not the GitHub issue. Include:

- Context and corrected issue premises.
- Chosen concept, explicit boundaries, invariants, and data/API/security contracts.
- `## User Scenarios`: 3–7 user tasks, each mapped to a named E2E scenario.
- `## Behavioral Delta`: plain-language before → after behavior.
- Migration, failure, rollback, and compatibility behavior when relevant.
- `## Tests`: contract, regression, and end-to-end coverage for every scenario.
- `## Visual Compliance Checks`: verifiable checklist items for UI work. For non-visual work the only checklist content is `N/A` or `- N/A` (ASCII hyphen); do not use an em dash as the marker. At least one item for a visual feature must have a machine-usable hint on a statically reachable element. Parse-check with `node scripts/visual-compliance-parser.js <spec> /tmp/vc-checks.json`; fix a missing/invalid section before review.

Update affected `docs/domain-rules/` in the same design change. Self-check every issue acceptance criterion against the spec before dispatching reviewers.

### Codex spec panel

Run seven independent, read-only reviewer perspectives: completeness, consistency with the live code and domain rules, feasibility, simplicity, current best practices, security, and test design. Use `collaboration.spawn_agent`; with the four-agent thread limit, run them in batches of at most three child agents. Give each reviewer the spec path and its specific lens. The spec must contain all issue context they need; reviewers do not fetch or read the issue. No reviewer may edit files.

Aggregate reports by deduplicating findings and ranking `BLOCKER > MAJOR > MINOR`. Verify every finding against the repository before changing the spec; reviewers can misread paths or infer behavior incorrectly. If a reviewer fails or returns no usable report, retry it once; then mark that perspective skipped and disclose the gap. Fold accepted fixes into the spec and rerun affected reviewers when the change is substantive.

Gate B is always a user stop. Present a self-contained summary: user scenario, chosen concept and why, behavioral delta, scope and migration, test coverage, material recon corrections, panel result, remaining assumptions, and spec path. Set `gate N spec` and wait for the user's explicit approval. Do not commit or push the spec before approval.

After approval, clear the gate. Commit and push the approved spec plus domain-rule changes to `main`. Do not put `Closes`, `Fixes`, or `Resolves #N` in a design commit; the implementation PR owns issue closure.

## Plan and Gate C

After Gate B, write `docs/plans/YYYY-MM-DD-<feature>-plan.md` in Russian. Use a Goal / Architecture / Tech Stack header. Do not restate the spec's Behavioral Delta. Every task must map to a User Scenario, have a stable `## Task N: ...` anchor, a `trivial|small|standard|large` classification, `Required Docs`, and a concrete definition of done. No placeholders. Classification uses objective criteria: >5 files touched or any full-suite verification → not below standard. Every `large` task — and any `standard` task touching >5 files or needing full-suite verification — carries `### Dispatch:`: numbered executor-assigned subtasks (2–4 for standard / 3–5 for large), each `name — executor — verification`, with full-suite verification only on `@tester` lines; trivial/small stay single-dispatch.

Dispatch a read-only plan reviewer subagent with both spec and plan paths. Ask it to check full scenario coverage, task dependencies/order, file targets against live code, required documentation, tests, and whether any finding changes approved behavior or scope. Fold in plan-only corrections. If the plan or review reveals a necessary spec change, set `gate N plan`, explain the issue and proposed correction, and wait for the user before continuing. Otherwise commit and push the plan, clear the gate, and move the board to `Ready to IMPL`.

Close DESIGN with the task list, spec and plan paths, and the handoff instruction: «продолжаем траекторию #N» in OpenCode. Do not start IMPL in this skill.

## FAST-TRACK

FAST-TRACK is limited to docs-only or harness-only work with no application code and no unresolved behavior or contract decision. It uses Gate A to confirm the exact mechanical change, then performs the work in the same Codex task; it does not create a plan or run the spec panel. If investigation finds a design choice, a three-task decomposition, or verification needing design, switch to STANDARD before editing. For fast-track, record the agreed scope in the change itself, use a PR, and follow the repository's green-CI-only merge gate. Never use `gh pr merge --auto`.

## Completion rules

- Every passed STANDARD design gate is recorded in pushed Git artifacts. The board and those artifacts are the durable handoff; chat context is not.
- Never silently expand scope or resolve a new user-visible, data-model, API, or security choice during planning. Return to Gate A or stop at Gate C as appropriate.
- Only use issue-closing language in the eventual implementation PR, never in design artifacts or commits.
