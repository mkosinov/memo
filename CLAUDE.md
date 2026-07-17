# Memo — working agreement

This project uses a gated workflow adapted from the opencode SuperAgents process
(`/root/workspace/superagents`, `docs/harness/WORKFLOW.md`). This file captures the
**process discipline** that lives in the repo and is shared across harnesses. The
orchestration mechanics (which agent/model does what) are harness-local and not
specified here.

## Gates (stop points that are the user's to clear)

- **G1 — Design approved.** A spec exists in `docs/specs/YYYY-MM-DD-<slug>-<issue>-design.md`
  and the user has approved it. Do not start a plan before G1.
- **G2 — Plan approved.** An implementation plan exists in
  `docs/plans/YYYY-MM-DD-<slug>-<issue>.md` and the user has approved it. Do not start
  coding before G2.
- **G3 — Clean baseline.** Work happens in a git worktree; the baseline test run is
  captured before any change, so pre-existing failures aren't blamed on this work.
- **G7 — Finish.** After the work is green, present the choice: merge locally / push+PR /
  keep branch / discard. The user decides.

Between G2 and G7 the execution path is free. Gather your own context, implement,
verify — don't ask "продолжить?" between tasks.

## Artifacts & conventions

- **Specs** → `docs/specs/`. Sections, IN/OUT scope, user-scenarios→E2E, open risks.
  See `docs/specs/2026-07-16-client-stats-records-131-design.md` as the reference shape.
- **Plans** → `docs/plans/`. Tasks with `- [ ]` checkboxes, per-task file lists and the
  spec section each implements. See `docs/plans/2026-07-16-client-stats-records-131.md`.
- **Commits**: `type(#issue): summary` (e.g. `refactor(#138): ...`, `docs(#139): ...`).
- **Issues**: findings/tasks carry a Definition of Done; cross-link related issues.

## Engineering rules

- **TDD**: failing test first, then implement to green. No behavior change without a test.
- **UI diffs** (`.tsx`, `.css`, `tailwind.config`) → run `npm run test:all` (vitest +
  Playwright). Non-UI → `npm run test` is enough.
- **Circuit breaker**: 3 failed attempts on the same problem → stop and escalate to the
  user with what was tried. Don't loop.
- **Verify before done**: exercise the affected flow, not just tests (`/verify`, `/code-review`).

## Layout

- `frontend/admin` — Next.js 14 admin app (the main frontend surface).
- `frontend/web` — public site.
- `packages/api-client` — fetch + zod schemas (API boundary).
- `packages/domain` — domain rules (schedule, statuses) — single source of truth.
- `backend/` — FastAPI + SQLAlchemy.
- Domain rules documented in `docs/domain-rules/`.
