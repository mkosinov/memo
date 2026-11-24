---
name: zen-model-watch
description: Health watch for the opencode zen free models that the memo spec panel (spec-panel-*) and plan-reviewer ride. Daily check via the scheduled automation, model-remap proposals matched to each reviewer role's strengths, and single-model diagnosis when a panel agent returns an empty report mid-design. Use when the user mentions free models, a dead reviewer model, empty panel reports, «проверь free модели», «проверь модель X», «смени модель ревьюера», or when the daily 06:00 automation fires.
---

# zen-model-watch — free-model watch for the memo review panel

## What this guards

The spec panel (7 `spec-panel-*` agents) and `plan-reviewer` run in the opencode container on the built-in zen provider, free tier (`opencode/*`, catalog cost 0). opencode reshuffles free models often; a vanished model silently breaks every reviewer riding it (2026-11-23: `glm-5.3-flash-free` vanished, 4 roles fell over). Flow: check → interpret → propose → user OK → apply. Never swap models silently.

## Tool

`~/dev/opencode/helpers/check-zen-models.py` (host python3; talks to the container via docker exec):

- default run — enumerate free models, probe each serially (timeout 100 s per model), diff vs snapshot `~/.zcode/state/zen-free-models.json`, print one JSON object: `verdict` (FIRST_RUN / NO_CHANGES / CHANGED), `free` (catalog metadata incl. context limits), `failed` (probe failures), `changes` (appeared / vanished / died / recovered). FIRST_RUN = no snapshot yet — it establishes the baseline, no proposal.
- `--model opencode/<id>` — probe one model, snapshot untouched (mid-day diagnosis).
- `--no-probe` — catalog diff only, no LLM calls.

Hard-won constraints (do not relearn):
- Probes must run inside a memo clone (`/root/workspace/panel-memo`): the container's default agent is `manager`, which resolves only within a memo clone — from any other cwd every run dies with «Unexpected server error».
- The probe rides the minimal `model-probe` agent (model always overridden via `-m`; the agent's own `model:` field is mandatory — an agent definition without `model:` hangs `opencode run`).
- Probes are serial on purpose: parallel bursts (11 at once) trip free-tier limits and everything times out.

## Daily cycle (automation, 06:00)

1. Run the script (default mode).
2. `NO_CHANGES` → report one line in the user's language («N free-моделей живы, изменений нет»), end of turn.
3. `CHANGED` → read the live mapping (below) → propose per §Proposal. A role's model dead or failed → reassignment for that role is mandatory; catalog-only churn (models appeared/vanished that no role rides) → mention in one line, no swaps.

## Live role→model mapping

Never trust examples in any file — read origin/main:

```bash
for a in plan-reviewer spec-panel-best-practices spec-panel-completeness spec-panel-consistency spec-panel-feasibility spec-panel-security spec-panel-simplicity spec-panel-test-design; do
  printf '%s: ' "$a"; git -C ~/dev/memo show "origin/main:.opencode/agents/$a.md" | grep '^model:'
done
```

## Matching models to roles (the intellectual part)

Hard rules:
1. Only probe-verified alive models (this run, today's snapshot, or a fresh `--model` probe).
2. A role keeps its model unless the model died/failed or the user asks for a swap — no churn.
3. Prefer distinct model families across roles (independent verdicts); sharing one model between roles is acceptable and precedented when the pool is small.
4. Panel veterans (`deepseek-v4.1-flash-free`, `mimo-v2.6-flash-free`, `nemotron-*`, `big-pickle`) outrank unknown newcomers; a newcomer starts on a less critical role and is watched on its first real panel.
5. A model that produced empty/garbage reports twice is deprioritized until it proves otherwise.

Strength signals (free-tier data is thin — reason from these, never invent benchmarks):
- context limit (catalog metadata) — bigger helps `plan-reviewer` and completeness (whole-spec reading);
- probe latency — fast models fit the many small parallel panel roles; slow-but-alive fits deep single review;
- family lineage + release date (catalog metadata); optional WebSearch for the underlying model's reputation;
- explicit user feedback overrides everything.

Role needs, one line each: security — careful threat reasoning; best-practices — web research + synthesis; completeness — recall and edge cases; consistency — cross-referencing precision; feasibility — code comprehension; simplicity — judgment and restraint; test-design — test reasoning; plan-reviewer — deepest plan-vs-spec verification.

## Proposal — always stops for the user's OK

One message in the user's language: a table role → current model (alive / dead / slow) → proposed → one-line why (family / latency / context); spares listed; an honest note that probes verify aliveness, not review quality — the first real panel is the quality test. Then END OF TURN. Apply only after explicit OK.

## Apply (after the user's OK)

1. Canon first: edit the same `model:` lines in `~/dev/superagents/.opencode/agents/<role>.md`; commit, no push.
2. Memo: same edits in `~/dev/memo/.opencode/agents/<role>.md`; commit + push to main (harness commit straight to main per precedent; CI is dispatch-only). No closing keywords in the message.
3. The panel clone syncs from origin/main at the next panel run — nothing else to do. The container's global config (default agent `manager`) is intentional — never edit it.

## Mid-day single-model diagnosis (design phase hit an empty report)

1. `--model opencode/<suspect>` → alive: transient failure; follow the panel availability policy (one rerun of that agent), report.
2. Dead or failed → find the roles riding it (mapping above) → §Proposal scoped to those roles, stop for OK. Meanwhile mark the agent `skipped` per the availability policy so the design phase is not blocked.

## Session hygiene — the watch session must stay lightweight

Automation fires land in the session where the automation was CREATED (verified 2026-11-24), so the bound session is re-read in full on every daily run. Keep it cheap:

- This skill carries the whole protocol — nothing else needs to live in the watch session. A daily run = script + one line; do not accumulate design discussions, remap dialogues, or reports in it.
- When the bound session has grown (long proposal dialogues, absorbed work, or the session was created from a heavy conversation): **re-anchor** — from a FRESH lightweight session, delete the old automation (`CronDelete`, it is «Проверка free-моделей opencode — ежедневно в 6:00») and create a new one (same 06:00 cron, prompt = the pointer text below), so the fires bind to the fresh session. Re-anchoring is lossless: this skill is the single source of the protocol.
- The current automation prompt text (pointer, keep verbatim): «Ты — наблюдатель free-моделей opencode, на которых работают панельные ревьюеры memo (spec-panel-* и plan-reviewer). Один запуск = один цикл проверки, затем конец хода. Протокол — целиком в скилле .zcode/skills/zen-model-watch/SKILL.md: прочитай его первым действием и работай строго по нему. Этот текст — только указатель, собственных правил он не добавляет; при изменении протокола правится скилл, не здесь. Пользователь обычно отсутствует: без изменений в списке моделей — одна строка отчёта и конец хода; при изменениях — разбор и предложение новой связки одним сообщением, затем конец хода (ответ пользователя продолжит цикл в этой же сессии). Если файл скилла недоступен — сообщи об этом и закончи ход.»
- Same pathology applies to any long-lived automation (the auto-DESIGN watcher re-reads its session every 2 h) — re-anchor those the same way when they grow.
