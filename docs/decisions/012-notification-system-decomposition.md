# ADR 012: The notification system is decomposed into five leaf tasks under container #476

## Status

Accepted

**Date:** 2026-10-11

## Context

The whole notification system (event journal, dispatcher, queue, worker, channels, binding flow, admin UI) is far too large for a single spec → plan → implementation unit. The user required splitting it into parts small enough for the standard flow each.

## Decision

One container issue #476 ("Система оповещений") with one **architectural spec-contract** that fixes the cross-part seams (event snapshot format, queue payload contract, status events, channel protocol, guarantees) — plus **five leaf issues**, each with its own thin spec + plan and standard design flow:

1. Domain events (journal + transactional write + dispatcher + the "new record" scenario with one-time rendering).
2. Delivery infrastructure (Redis in dev/e2e stacks, arq, settings, off in testing, process skeletons).
3. Delivery worker (queue consumption, channel registry, priority fallback, markup conversion, transport retries, status events, mock channel).
4. Telegram channel via a **user account** (MTProto, phone-number resolution, send-rate limits) — client binding, bot account and webhook are deferred (user decision 2026-10-11).
5. Admin "Notifications" section (deliveries list + manual resend of the stored text, templates CRUD, client consent flag).

Dependencies: parts 1 and 2 are independent; both feed part 3; part 3 feeds parts 4 and 5.

## Consequences

### Positive
- Each part is an independently reviewable, implementable, mergeable unit.
- The cross-part contracts are decided once (the architectural spec + ADRs 008–011), so per-part designs cannot drift apart.

### Negative
- Six design/implementation cycles instead of one; slightly more coordination through the container.

### Risks
- Contract drift if a leaf spec quietly deviates — mitigated by the architectural spec being the single reference and the per-part specs explicitly depending on it.

## References

- #476 and its leaf issues; spec `docs/specs/2026-10-11-notify-system-476-design.md`
