---
name: domain-rules
description: "Maintain living domain documentation as the single source of truth for business logic, validation, and entity relationships. Use when working with entity fields, validation rules, or business logic."
---

# Skill: domain-rules

Maintain living domain documentation as the single source of truth for business logic, validation, and entity relationships.

**Who uses this skill:**
- **@architect** — keeper: writes, updates, verifies domain rules markdown
- **@frontend-coder / @backend-coder** — follower: reads rules before implementing, reports discrepancies

## When This Activates

Before any work that involves:
- New entity or endpoint
- Changes to validation rules
- Changes to business logic
- Bug fix related to data integrity or validation
- Design spec for a new feature

**Rule: If touching an entity's fields, validation, or business logic — read markdown first, code second.**

## Structure

All domain rules live in `docs/domain-rules/` organized by entity:

```
docs/domain-rules/
├── _overview.md          ← cross-entity relationships, shared enums, global rules
├── services.md
├── locations.md
├── masters.md
├── activities.md
├── records.md
├── clients.md
├── visitors.md
└── payments.md
```

## Markdown Template

Every entity file follows this structure (based on Spectra's layered approach):

```markdown
# {Entity} — Domain Rules

## Description
What this entity is, why it exists, who uses it.

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|

## Cross-field Rules
- Rule 1: `min_age` must be <= `max_age`
- Rule 2: ...

## Invariants (must ALWAYS be true)
- Capacity check: occupied + seats <= capacity
- Status transitions: only allowed paths

## Business Logic

### Backend (invariants, security, financial)
- Capacity enforcement on record creation
- Client resolution by phone (race condition protection)
- Payment amount > 0

### Frontend (UX, auto-fill, optimistic updates)
- Auto-fill duration/capacity when service selected
- Dirty-check on modal close
- Phone search on blur → auto-fill client name

## API Endpoints
| Method | Path | Description | Request Body | Response |
|--------|------|-------------|--------------|----------|

## Relationships
- Service → has many Tariffs
- Activity → belongs to Service, Master, Location
- Record → belongs to Activity, Client
- Visit → belongs to Record, Visitor

## Enums & Constants
| Enum | Values | Usage |
|------|--------|-------|

## Acceptance Criteria
- [ ] Field X is validated as min 1, max 200
- [ ] Status can transition from "pending" to "confirmed"
- [ ] Capacity check prevents overbooking

## Parity Notes
Where backend and frontend implementations must match:
- Backend Pydantic: `ServiceCreate` → matches Zod `ServiceCreateSchema`
- Frontend Zod: `min(15).max(480)` → matches Pydantic `Field(ge=15, le=480)`
```

## Workflow

### 1. Create/Update Markdown

When designing a new feature or discovering a rule:

```
1. Read existing markdown (if any)
2. Update with new fields, rules, relationships
3. Commit: "docs: update {entity} domain rules"
```

### 2. Reference in Dispatch

When dispatching implementer, include:

```
## Domain Rules
Follow docs/domain-rules/{entity}.md for:
- Field validation (types, required, min/max)
- Business logic (auto-fill, capacity check)
- API contract (endpoints, request/response)
```

### 3. Verify in Review

When reviewing PR:

```
1. Read relevant domain-rules markdown
2. Check: does implementation match the rules?
3. If mismatch → update markdown OR request code fix
```

### ⚠️ Discrepancy Protocol (for ALL agents)

When you discover a discrepancy between:
- Domain rules markdown and actual code
- Backend schema and frontend schema
- Business logic in different parts of the codebase

**STOP. Do NOT assume which is correct.**

```
1. Document the discrepancy clearly
2. Ask the user: "Found mismatch between [markdown/code A] and [code B]. Which is correct?"
3. Wait for user decision
4. Update the losing side to match the winning side
5. Commit the fix
```

**Why:** The markdown might be outdated. The code might have a bug. Only the user knows the intended behavior. Never guess.

### 4. Sync After Merge

When PR is merged:

```
1. Check if new entities/rules were added
2. Update markdown if implementation differs from docs
3. Commit: "docs: sync {entity} domain rules with implementation"
```

## What Goes Where

| Concern | Backend | Frontend | Both |
|---------|---------|----------|------|
| Data integrity | ✅ | ❌ | ❌ |
| Financial rules | ✅ | ❌ | ❌ |
| Security/auth | ✅ | ❌ | ❌ |
| Status transitions | ✅ | ❌ | ❌ |
| Form validation | ❌ | ✅ | ✅ (backend as safety net) |
| Auto-fill | ❌ | ✅ | ❌ |
| Dirty-check | ❌ | ✅ | ❌ |
| Optimistic updates | ❌ | ✅ | ❌ |
| Phone/email format | ❌ | ✅ | ✅ (backend sanitizes) |

## Key Principles

1. **Markdown is the contract** — not code, not comments, not someone's head
2. **Architect is the keeper** — I write, update, and verify against these docs
3. **Implementers follow** — they read markdown before coding
4. **Parity through testing** — not through codegen, but through explicit verification
5. **Living document** — updated when rules change, not when code is written
6. **Discrepancy → ask user** — never assume which side is correct, always confirm

## Anti-patterns

- ❌ Writing rules in code comments (scattered, hard to find)
- ❌ Keeping rules in someone's head (lost on context switch)
- ❌ Creating rules after implementation (backwards)
- ❌ Generic "validate everything" rules (be specific: min, max, format)
- ❌ Forgetting edge cases (what happens when X is null? when Y = 0?)
