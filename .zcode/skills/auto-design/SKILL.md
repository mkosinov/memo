# Skill: auto-design
# Auto-DESIGN watcher protocol (scheduled-automation session)

You are the auto-DESIGN watcher session for the memo repo, started by the
scheduled automation (every 2 hours). Work through ONE cycle of this protocol
per run, exactly as written. The user is usually absent — the session exists
so they can step in and answer when the protocol stops for them.

Base directory for this skill: `.zcode/skills/auto-design/`.
Board commands: `python3 .zcode/scripts/gh_board.py <subcommand>`.

## Step 1 — Pick work

Run `gh_board.py pick-next-design`.

- Output `<N>` → issue `#N` is yours; continue to Step 2.
- Output `NONE (...)` → nothing was taken. Reply in Russian with the exact
  reason from the parentheses, then end the run. Do nothing else: no files,
  no board calls, no agents. Wording:
  - `NONE (design slot busy: #273)` → «Очередь занята: #273 в дизайне»
    (busy — a design exists; this is NOT an empty queue);
  - `NONE (no Backlog cards)` → «Очередь пуста: в Backlog нет карточек»;
  - `NONE (all Backlog cards blocked by depends-on)` → «Очередь пуста
    для наблюдателя: все карточки Backlog заблокированы зависимостями».

## Step 2 — Claim

- Move the board card for `#N` to «In Design (G1a)»:
  `gh_board.py status N "In Design (G1a)"`.
- Leave a one-line comment on the issue: `auto-design: taken by scheduled
  watcher <UTC timestamp>` — so the user can connect the issue to this session.

## Step 3 — Design in unattended mode

Follow the `design-phase` skill (scout with actuality check → step-0 report →
gate A concept → spec + 6-reviewer panel → gate B user OK → plan +
plan-reviewer → gate C auto → push; board is `gh_board.py`), with these
auto-mode rules:

- **Step-0 first**: open the run's user-facing output with the step-0 block —
  issue number, 3-5 keywords, the issue retold as a user scenario, the
  problem it solves (plain words, no jargon, no unexplained abbreviations).
- **Scout**: dispatch the recon scout subagent exactly as design-phase
  prescribes (fact sheet with `file:line`, ending with the actuality
  verdict `actual` / `partially stale` / `stale`).
- **Stale issue → close it yourself**: verdict `stale` → comment the
  evidence on the issue (`file:line` + the merge/PR that closed the gap),
  close the issue as not planned, board card → «Not planned», report in
  this session, end the run. `partially stale` → correct the stale claims
  in an issue comment and bake the corrections into the design; continue.
- **Gate A without the user (default)**: produce the concept yourself from
  the issue body and scout facts — 2-3 approaches considered with
  trade-offs, the chosen approach + why, scope boundaries (what we
  deliberately do NOT build) — then run design-phase's divergence filter.
  Exactly one concept survives → no stop, write the spec. Several
  divergent concepts remain → STOP: post the step-0 block (if not yet
  shown) + the concepts with trade-offs and end the turn. Do NOT write
  the spec before the user picks one.
- **Gate B is the mandatory stop**: after the panel and fixes, post the full
  gate B message per design-phase §2 (chosen concept + why, briefly;
  behavioral delta; a technical summary of the finished spec in plain
  words — understandable without opening any file; the panel outcome in one
  line; remaining assumptions as open questions; the spec path) and end
  the turn. The plan and the push come only after explicit user OK.
- **Gate C**: after gate B OK — write the plan, dispatch plan-reviewer.
  No spec-changing findings → auto-OK: fold fixes, commit + push spec and
  plan, board → «Ready to IMPL (G2)», post the closing report, end the run.
  Spec-changing findings → post what was found / why the spec changes /
  the proposed fix and end the turn (back to gate B; a concept-level
  discovery goes back to gate A).
- **Language**: spec/plan/domain-rules content in Russian; harness/skill
  files in English (project convention).
- **Panel discipline**: dispatch reviewer agents with an explicit tool-call
  budget in the prompt (they tend to time out otherwise).

## Rules

- One design at a time is enforced by the board (`pick-next-design` returns
  `NONE` while any card is In Design). Never bypass it, never run a second
  design in this session.
- Stale auto-close bar: close an issue ONLY when every load-bearing claim
  of the issue is contradicted by the live tree AND the described gap is
  verifiably gone (implemented or fully superseded — cite `file:line` and
  the PR/merge). A doubtful or partially stale issue is never closed by
  the watcher itself: comment, keep the card in «In Design (G1a)», stop
  for the user.
- If the issue turns out unsuitable in another way (duplicate, not a task,
  missing critical info): comment on the issue what is wrong or missing,
  leave the card in «In Design (G1a)», post the same explanation in this
  session, and end. The watcher never closes an issue for anything except
  the `stale` bar above.
- If a dependency or gate blocks mid-design: comment `auto-design blocked:
  <reason>` on the issue, keep the card in «In Design (G1a)», explain in the
  session, and wait for the user.
- The user's manual design sessions always take priority; if the user is
  actively working on the same issue in another session, defer to them.
