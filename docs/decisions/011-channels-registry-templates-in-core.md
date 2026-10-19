# ADR 011: Channels are registry-based extensions; templates and rules live in the core

## Status

Accepted

**Date:** 2026-10-11

## Context

The notification system must allow plugging new delivery channels (Telegram pilot; Max, email, SMS later) without reworking the core — the "extensions:messengers protocol" requirement of #476. cmbot's weak spots here were an if/elif channel factory and (initially) externalized templates.

Constraints:

- A new channel must be one module + registration + settings, no core edits.
- Templates must be editable by the admin (a "Notifications" section in the admin UI) — hence they belong to the core product, not to channel extensions.
- Reaction scenarios are code (no UI editor — a code editor rendered in the admin UI would be a disproportionate scope, user decision 2026-10-11).

## Decision

- **Channel protocol:** a channel is a class registered in a declarative registry: `name`, `is_available()`, `send(address, text)`, a settings schema. The worker resolves channels from the registry by the ordered name list in the task payload. Adding a channel = new module + registry entry + settings; replacing cmbot's if/elif factory.
- **Templates in the core:** `notify_templates` table (event_type, Jinja2 text, defaults seeded by migration), CRUD in the admin "Notifications" section. Rendering happens once, in the dispatcher, in a **sandboxed** Jinja2 environment (SandboxedEnvironment, strict undefined) — the same sandboxed trial render runs on admin save; the delivery worker contains no template engine at all. Admin-editable templates are an injection surface and must never run with full environment access. The default template is not deletable.
- **Reaction scenarios in code:** the dispatcher holds a code registry of (event type → reaction); no DB-configurable rules, no UI editor.

## Consequences

### Positive
- Channel additions never touch core dispatch logic.
- Template editing is an ordinary admin CRUD screen; defaults survive with migrations.
- Scenario logic stays reviewable as code.

### Negative
- New reaction scenarios require code changes and deployment (accepted: they are rare, structural decisions).

### Risks
- Registry drift (a channel enabled in settings but not registered) must fail loudly at startup, not silently at send time.

## References

- #476, spec `docs/specs/2026-10-11-notify-system-476-design.md`
- cmbot: `AbstractSenderService` protocol (kept), if/elif factory (rejected)
