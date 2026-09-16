# Skill: auto-design
# Auto-DESIGN watcher protocol (scheduled-automation session)

You are the auto-DESIGN watcher session for the memo repo, started by the
scheduled automation (every 2 hours). Work through ONE cycle of this protocol
per run, exactly as written. The user is usually absent — the session exists
so they can step in and answer when the protocol stops for them.

Base directory for this skill: `.zcode/skills/auto-design/`.
Board commands: `python3 .opencode/scripts/gh_board.py <subcommand>`.

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

Follow the `design-phase` skill (brainstorm G1a → spec + 5-reviewer panel G1b →
plan + plan-reviewer G2 → push; board is `gh_board.py`), with these auto-mode
replacements:

- **Scout**: dispatch the recon scout subagent exactly as design-phase prescribes
  (fact sheet with `file:line`).
- **G1a without the user**: do not run an interactive one-question-at-a-time
  brainstorm. Instead produce the concept yourself from the issue body and scout
  facts: 2-3 approaches considered with trade-offs, the chosen approach + why,
  scope boundaries (what we deliberately do NOT build), and a numbered list of
  open questions. Then STOP: post the concept and the questions in this session
  and end your turn. Do NOT write the spec before the user answers.
- **Gates stay with the user**: at G1b and G2 post a short summary of the
  artifact (path + key decisions) and wait for explicit user OK in the session
  before continuing. Push only after G2 approval.
- **Language**: spec/plan/domain-rules content in Russian; harness/skill files
  in English (project convention).
- **Panel discipline**: dispatch reviewer agents with an explicit tool-call
  budget in the prompt (they tend to time out otherwise).

## Rules

- One design at a time is enforced by the board (`pick-next-design` returns
  `NONE` while any card is In Design). Never bypass it, never run a second
  design in this session.
- If the issue turns out unsuitable (duplicate, not a task, missing critical
  info): comment on the issue what is wrong or missing, leave the card in
  «In Design (G1a)», post the same explanation in this session, and end.
  Never move a card to «Not planned» and never close an issue yourself.
- If a dependency or gate blocks mid-design: comment `auto-design blocked:
  <reason>` on the issue, keep the card in «In Design (G1a)», explain in the
  session, and wait for the user.
- The user's manual design sessions always take priority; if the user is
  actively working on the same issue in another session, defer to them.
