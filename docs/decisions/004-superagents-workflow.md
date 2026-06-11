# ADR 004: SuperAgents workflow for development

## Status

Accepted

**Date:** 2026-05-15

## Context

We need a structured workflow for AI-assisted development that:
- Ensures quality (tests, reviews)
- Maintains context across sessions
- Separates concerns (architect vs implementer vs reviewer)
- Scales to multiple features in parallel

**Alternatives considered:**
- Single agent does everything — context pollution, no separation of concerns
- Manual development — slow, error-prone
- Traditional CI/CD — doesn't address AI-specific challenges (context transfer, quality gates)

## Decision

Use **SuperAgents workflow** with the following roles:

| Role | Responsibility |
|------|---------------|
| **@architect** | Entry point, brainstorming, planning, dispatch, quality gates |
| **@frontend-coder** | Implements frontend tasks (Next.js, TypeScript, Tailwind) |
| **@backend-coder** | Implements backend tasks (FastAPI, SQLite, Pydantic) |
| **@spec-reviewer** | Reviews implementation against spec |
| **@code-quality-reviewer** | Reviews code quality, tests, maintainability |
| **@docser** | Commits documentation after feature complete |

**Workflow steps:**
1. **Brainstorming** — explore context, ask questions, propose approaches, get approval
2. **Writing Plans** — create bite-sized tasks with Required Docs, self-review
3. **Git Worktree** — isolated workspace per feature
4. **Subagent-Driven Development** — dispatch implementer per task, review based on classification
5. **Visual Compliance** — verify UI matches design spec
6. **Documentation Commit** — @docser commits meta docs
7. **Finishing Branch** — merge, PR, or keep

**Key principles:**
- Controller never implements (architect delegates, doesn't code)
- TDD (RED-GREEN-REFACTOR) for every task
- Review based on task classification (trivial/small/standard/large)
- Required Docs in every task (context transfer mechanism)
- Scratchpad for session state (architect only)

## Consequences

### Positive
- Separation of concerns — each role has clear responsibility
- Quality gates — tests, reviews, visual compliance
- Context transfer — Required Docs ensures implementer knows conventions
- Parallel work — multiple worktrees, no conflicts
- Traceability — every decision documented (specs, plans, ADRs)

### Negative
- Overhead — multiple agents, reviews, gates (but ensures quality)
- Token usage — each agent has context (mitigated by hybrid diff approach)
- Learning curve — team needs to learn workflow (mitigated by skills)

### Risks
- Workflow rigidity — can be slow for simple changes (mitigated by task classification)
- Context loss — if scratchpad not updated (mitigated by protocol)
- Review fatigue — too many reviews (mitigated by classification: trivial = no review)

## References

- Architect agent: `.opencode/agents/architect.md`
- SuperAgents framework: `/root/workspace/superagents/`
- Skills: `.opencode/skills/`
