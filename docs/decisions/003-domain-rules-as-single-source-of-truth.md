# ADR 003: Domain Rules as single source of truth

## Status

Accepted

**Date:** 2026-05-28

## Context

We need a way to document business logic, validation rules, and entity relationships that is:
- Readable by humans (developers, stakeholders)
- Readable by AI agents (for context transfer)
- Maintainable (easy to update when rules change)
- Discoverable (easy to find relevant rules)

**Alternatives considered:**
- Code comments — scattered, hard to find, not discoverable by agents
- Wiki/Notion — external to codebase, can get out of sync
- OpenAPI/Swagger — only covers API, not business logic
- JSON Schema — only covers validation, not relationships or invariants

## Decision

Use **Markdown files in `docs/domain-rules/`** as the single source of truth for business logic.

**Structure:**
```
docs/domain-rules/
├── _overview.md          ← cross-entity relationships, shared enums, naming conventions
├── services.md
├── masters.md
├── locations.md
├── activities.md
├── records.md
├── clients.md
├── visitors.md
└── payments.md
```

**Each file contains:**
- Description (what, why, who)
- Fields (type, required, min/max, default)
- Cross-field rules (e.g., `min_age <= max_age`)
- Invariants (must ALWAYS be true)
- Business logic (backend vs frontend)
- API endpoints
- Relationships
- Enums & constants
- Acceptance criteria
- Parity notes (backend ↔ frontend)

**Workflow:**
1. Architect writes/updates domain rules before dispatching implementer
2. Implementer reads domain rules before coding
3. Reviewer checks implementation against domain rules
4. Discrepancy → ask user which is correct (markdown or code)

## Consequences

### Positive
- Single source of truth — no scattered documentation
- Discoverable — agents can read before coding
- Maintainable — Markdown is easy to edit
- Version controlled — changes tracked in git
- Human-readable — no special tools needed

### Negative
- Manual sync — need to update markdown when code changes (mitigated by review process)
- Can get outdated — if not maintained (mitigated by discrepancy protocol)
- No automated validation — markdown is not executable (mitigated by acceptance criteria)

### Risks
- Markdown drifts from code — need discipline to keep in sync
- Too much detail — can become overwhelming (mitigated by structured template)

## References

- Domain rules skill: `.opencode/skills/domain-rules/SKILL.md`
- Example: `docs/domain-rules/records.md`
