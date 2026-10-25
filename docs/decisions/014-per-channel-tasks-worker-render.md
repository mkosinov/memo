# ADR 014: Per-channel delivery tasks; text assembly in the worker

## Status

Accepted

**Date:** 2026-10-25

Supersedes the following clauses of ADR 009: the render-once-in-dispatcher decision, "no template engine in the worker at all", and the worker walking channels by priority. Everything else in ADR 009 stands.

## Context

ADR 009 shipped the pilot contract: the dispatcher renders the message once at task creation, the queue task carries the ready text plus a channel list, the worker walks channels by priority and only converts neutral markup (Markdown) into the channel's own.

Three facts broke that contract during the design of part 4 (#485, Gate A, user decisions 2026-10-25):

- Templates live in the DB and are admin-edited (ADR 009 context, family spec §3.7, part 5 UI). Once admins edit templates, per-channel style (short vs long, different markup) becomes a real product requirement — render-before-channel-choice locks style decisions ahead of the channel and cannot be rebuilt without changing the task format.
- The neutral markup existed only to bridge early rendering to channel formats. Dropping early rendering removes the bridge entirely: a channel's template is written directly in the channel's format, and values are escaped at substitution per channel format.
- Channel fallback is a decision (which channel next, when to stop), and decisions belong to the dispatcher — the component with DB access. The worker should be transport muscle.

The original ADR 009 requirement — "the queue task carries all information needed to form the notification, because the worker has no access to the local SQLite" — is preserved verbatim in spirit: the task now literally carries the render data and the frozen template.

## Decision

- **Task = one channel.** The scenario creates the task of the first priority channel; on terminal failure of a channel task the dispatcher spawns the task of the next channel (chain). Chain identity: `root_task_id` (first task: own id) + `UNIQUE(root_task_id, channel)` — idempotent spawn under at-least-once report redelivery. Chain outcome (`delivered | not_delivered` + reason) is materialized on the root task by the dispatcher.
- **The task carries render data and the frozen template** (`payload`, `template_id`, `template_body`), the channel, and the address. The `text`/`channels` fields are dropped (system dark behind `NOTIFY_ENABLED`, no live data). The address is frozen on the first task and inherited by chain tasks — never re-resolved.
- **The worker assembles the text** — once per task, transport retries resend the same text — in the existing sandboxed Jinja2 environment, extended with a per-format variant. Escaping is keyed by the task's channel regardless of template origin: telegram values are always HTML-escaped; universal templates (`channel IS NULL`) are plain text sent without a channel parse mode.
- **Channel protocol:** a channel declares an escape mode (`none | html`) and receives the assembled text in `send(address, text)`. The "channel converts neutral markup" clause is retired; the neutral markup and converter are dropped.
- **Reports carry the sent text** (`sent_text` per attempt): admin audit stores exactly what each channel transmitted. Manual resend (part 5) ships the stored sent text, or re-assembles from the frozen data+template when no attempt reached transmission; a resend is a new chain (new root).
- **Re-enqueue discipline:** tasks claimed by the worker (PEL of the consumer group) are not re-enqueued; a channel send pause is not a stall. Otherwise a queue longer than a few tasks under a 30 s pause would double-fire within `NOTIFY_REENQUEUE_AFTER`.

## Preserved from ADR 009 (inviolable)

- The worker never reads or writes the DB and remains portable to a separate machine.
- The dispatcher is the single notification-side DB writer.
- At-least-once delivery on every seam; idempotency discipline is mandatory.
- Manual resend ships the formed text unchanged; template edits affect future tasks only.

## Rejected alternatives

- **Worker reads templates from the DB** — pins the worker to the SQLite file (ADR 009 rejected alternative, unchanged).
- **Template cache synced to the worker via Redis** — invalidation machinery to save a few hundred bytes per task.
- **Keep neutral markup + converter** — a bridge layer that exists only because of early rendering; costs a format, a converter, and locks channel style.
- **Dispatcher renders per-channel texts at task creation** — revisited and rejected at Gate A: it re-freezes style before the chain reaches the channel and re-couples rendering to task creation.

## Consequences

### Positive
- Per-channel style without re-architecture; template edits take effect per spawn (each chain task freezes the template current at its creation).
- The worker loses channel-walk orchestration and gains only rendering — net simpler.
- Exact per-channel sent-text audit in attempts; cheap chain reads for the part 5 admin screen.

### Negative
- The worker gains a template engine (sandboxed Jinja2) — its attack surface grows; mitigated by the same sandboxed environment with strict undefined handling, template authors being admins.
- Task payload grows by the template body (hundreds of bytes).
- `notify_templates` gains a channel dimension (migration + part 5 UI selector).

## References

- #485, spec `docs/specs/2026-10-25-notify-telegram-channel-485-design.md`
- Family spec `docs/specs/2026-10-11-notify-system-476-design.md` (rev.5)
- ADR 009 (superseded clauses listed above), ADR 011 (registry + templates in core), ADR 013 (transport)
- cmbot precedent: `TuserSenderService` / `TelegramUserClient`
