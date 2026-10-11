# ADR 009: Delivery worker is DB-free — full snapshot down, status events back

## Status

Accepted

**Date:** 2026-10-11

## Context

The delivery worker (renders the message, walks channels by priority, sends) must be able to run on a separate machine from the main SQLite file. The user explicitly required: the queue task carries **all information needed to form the notification**, because the worker has no access to the local SQLite.

Constraints:

- SQLite is a file: any process reading/writing shared tables is pinned to one machine/volume.
- Templates were decided to live in the core product (DB + admin UI), statuses must be durable and visible in the admin UI.
- The same isolation requirement applies to writing results back: the worker cannot write delivery statuses into the DB either.

## Decision

- **Downward (dispatcher → worker):** the queue payload is a complete snapshot — the **already-rendered message text** (rendering happens once, in the dispatcher, at task creation: template + event snapshot in a sandboxed Jinja2 environment), the ordered channel list with addresses, the task id. The worker never reads the DB and never renders (no template engine in the worker at all — its injection surface is minimal). A channel converts the neutral markup (Markdown) into its own.
- **Upward (worker → dispatcher):** after each channel attempt and at the final outcome the worker publishes a lightweight status event to a second queue category; the event dispatcher (which has DB access) is the single writer of statuses/attempts into the DB.
- Manual resend ships the **stored rendered text** unchanged (user decision 2026-10-11: a delivery retry is a retry of the formed text; editing the template affects future tasks only); channel addresses are re-resolved at resend time.

Rejected alternatives:

- **Thin task (id only), worker re-reads the DB** — pins the worker to the DB file; also racy (the record may change between enqueue and send).
- **Worker writes statuses directly to the DB** (cmbot-style, simplest) — breaks the no-DB rule until a PostgreSQL migration; cmbot's simplicity came from all processes sharing one networked DB.
- **Polling arq job results** — one final value with a TTL (default ~1 h); needs a polling consumer anyway, loses per-channel attempt visibility.

## Consequences

### Positive
- The worker can move to another machine with zero code change.
- Each channel attempt is visible live (push, not polling); statuses survive dispatcher downtime by accumulating in the queue.
- Dispatcher stays the only notification-side writer to the DB (besides the API's manual resend endpoint).

### Negative
- A second queue category and a consumer loop in the dispatcher process.
- At-least-once semantics: a rare duplicate message to the client is possible (crash after send, before the status event) — accepted as better than loss.

### Risks
- Idempotency discipline is mandatory on both ends ((event, scenario) uniqueness for task creation; idempotent status application).

## References

- #476, spec `docs/specs/2026-10-11-notify-system-476-design.md`
- cmbot precedent: RQ job result + direct DB writes from the worker (possible there due to a shared networked DB)
