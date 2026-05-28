# SuperAgents Workflow Diagram

> System: **SuperAgents** — @architect (controller) + subagents (implementers + reviewers)
> Version: 3.1
> Date: 2026-05-15

---

## Legend

| Symbol | Meaning |
|--------|---------|
| `G1`–`G7` | Quality Gates |
| **Human** | Requires user decision (pause) |
| auto | Passes automatically |
| `▶` | Automatic transition to next step |
| `→` | Data/control flow |

---

## Full Workflow

```
┌──────────────────────────────────────────────────────────────────┐
│                    @architect (Controller)                        │
│  Model: opencode-go/kimi-k2.6 | Mode: primary | Temp: 0.2        │
│  Role: Orchestrator — NEVER implements code                       │
└──────────────────────────────────────────────────────────────────┘
         │
         │ new feature request
         ▼
╔══════════════════════════════════════════════════════════════╗
║  STEP 1: BRAINSTORMING  (Human Gate G1)                     ║
╚══════════════════════════════════════════════════════════════╝
         │
         │ 1. Read scratchpad — resume or start fresh
         │ 2. Invoke skill `brainstorming`
         │ 3. Explore context → ask clarifying questions
         │ 4. Propose 2-3 approaches → design sections
         │ 5. Save to docs/specs/YYYY-MM-DD-<feature>-design.md
         │ 6. Commit design doc
         │
         ▼  [G1: USER APPROVES DESIGN]
         │
╔══════════════════════════════════════════════════════════════╗
║  STEP 2: WRITING PLANS  (Human Gate G2)                     ║
╚══════════════════════════════════════════════════════════════╝
         │
         │ 1. Invoke skill `writing-plans`
         │ 2. Create implementation plan with classifications
         │    (trivial / small / standard / large)
         │ 3. Save to docs/plans/YYYY-MM-DD-<feature>-plan.md
         │ 4. Self-review for TBD/TODO/vague
         │
         ▼  [G2: USER APPROVES PLAN]
         │
╔══════════════════════════════════════════════════════════════╗
║  STEP 3: GIT WORKTREE  (Auto Gate G3)                       ║
╚══════════════════════════════════════════════════════════════╝
         │
         │ 1. Invoke skill `using-git-worktrees`
         │ 2. git worktree add .worktrees/feat-<name> -b feat-<name>
         │ 3. cd .worktrees/feat-<name>
         │ 4. cd frontend && npm install / cd backend && uv sync / pip install
         │ 5. Run tests → verify clean baseline
         │    npm run test:all  # vitest + playwright (browsers pre-installed in image)
         │
         ▼  [G3: TESTS PASS]  (if fail → ask user)
         │
╔══════════════════════════════════════════════════════════════╗
║  STEP 4: SUBAGENT-DRIVEN DEVELOPMENT  (Auto Gates G4-G6)    ║
║  Sequential tasks — never parallel                           ║
╚══════════════════════════════════════════════════════════════╝
         │
         │ For EACH task in plan (1..N):
         ▼
    ┌────────────┐
    │ 4a. Record │──→ Update scratchpad + GitHub Project board
    │ task start │
    └────────────┘
         │
         ▼
    ┌─────────────────────┐
    │ 4b. Dispatch        │
    │ Implementer         │
    │ (frontend-coder /   │
    │  backend-coder)     │
    │ via task() tool     │
    │                     │
    │ Prompt includes:    │
    │ • Task text (literal│
    │ • Classification    │
    │ • Scene-setting     │
    │ • Worktree path     │
    │ • TDD skill required│
    │ • Visual test rule: │
    │   If diff touches UI│
    │   (.tsx, .css,      │
    │   tailwind.config)  │
    │   → run `test:all`  │
    └──────────┬──────────┘
               │
               ▼
         ┌──────────┐
         │ 4c.      │
         │ Handle   │──→ DONE → 4d
         │ Status   │──→ DONE_WITH_CONCERNS → read concerns → fix or proceed
         │          │──→ BLOCKED/NEEDS_CONTEXT → re-dispatch or escalate
         └──────────┘
               │
               ▼
         ┌──────────────────────────────────────────────┐
         │ 4d. Review Pipeline (depends on classification) │
         └──────────────────────────────────────────────┘
               │
               │ ┌─────────────────────────────────────────┐
               │ │ Trivial: self-review + architect        │
               ├─│   git diff spot-check (≤5 lines)        │
               │ └─────────────────────────────────────────┘
               │
               │ ┌─────────────────────────────────────────┐
               │ │ Small: spec-review only (max 3 loops)   │
               ├─│                                          │
               │ │   git diff BASE..HEAD → embed in prompt  │
               │ │   Dispatch @spec-reviewer                 │
               │ │   If ❌ → re-dispatch implementer         │
               │ └─────────────────────────────────────────┘
               │
               │ ┌─────────────────────────────────────────┐
               │ │ Standard/Large: full two-stage review   │
               ├─│   (each max 3 loops)                     │
               │ │                                          │
               │ │   Stage 1: @spec-reviewer                 │
               │ │     If ❌ → implementer fixes → re-review │
               │ │     If ✅ → Stage 2                       │
               │ │                                          │
               │ │   Stage 2: @code-quality-reviewer         │
               │ │     Reads diff + runs test suite          │
               │ │     UI diff → `npm run test:all`          │
               │ │     Else → `npm run test` (vitest only)   │
               │ │     If ❌ → implementer fixes → re-review │
               │ │     If ✅ → task complete                 │
               │ └─────────────────────────────────────────┘
               │
               ▼
    ┌──────────────────────┐
    │ 4e. Review Loop Limit│──→ Max 3 per reviewer
    │ (circuit breaker)    │──→ If exceeded → STOP → escalate
    └──────────────────────┘
               │
               ▼
    ┌──────────────────────┐
    │ 4f. Next Task        │──→ Auto. Do NOT ask "continue?"
    │ (auto)               │
    └──────────────────────┘
         │
         │ ALL TASKS DONE
         ▼
╔══════════════════════════════════════════════════════════════╗
║  STEP 5: DOCUMENTATION COMMIT  (Auto)                        ║
╚══════════════════════════════════════════════════════════════╝
         │
         │ 1. Gather context (design doc, plan, tasks, tests)
         │ 2. Dispatch @docser via task() tool
         │ 3. @docser updates PLAN.md + CHANGELOG.md
         │ 4. Commit INTO feature branch
         │
         ▼
╔══════════════════════════════════════════════════════════════╗
║  STEP 6: FINISHING  (Human Gate G7)                          ║
╚══════════════════════════════════════════════════════════════╝
         │
         │ 1. Invoke skill `finishing-a-development-branch`
         │ 2. Run final tests
         │    npm run test:all  # vitest + playwright
         │ 3. Present 4 options:
         │
         ▼  [G7: USER CHOOSES]
         │
    ┌──────┴───────────────────────────────────────────────────┐
    │                                                           │
    ▼            ▼              ▼                   ▼           │
┌────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│Option 1│ │ Option 2 │ │ Option 3 │ │ Option 4 │             │
│ Merge  │ │ Push + PR│ │ Keep     │ │ Discard  │             │
│ locally│ │ (default)│ │ branch   │ │ (confirm)│             │
└────────┘ └──────────┘ └──────────┘ └──────────┘             │
```

---

## Quality Gates Summary

```
G1 ─── Design Approval ───────── Human ── Brainstorming done
G2 ─── Plan Approval ─────────── Human ── Plan written
G3 ─── Clean Baseline ────────── Auto ─── Tests pass on empty worktree
G4 ─── TDD Compliance ────────── Auto ─── Implementer self-check
G4a ── Architect Spot-Check ──── Auto ─── Diff ≤5 lines (trivial only)
G5 ─── Spec Compliance ───────── Auto ─── Code matches plan (reviewer)
G6 ─── Code Quality + Tests ──── Auto ─── Clean code, tests pass
G6a ── Review Loop Limit ─────── Auto ─── Max 3 iterations → escalate
G6b ── Controller Never Implem.─ Auto ─── Architect did not edit code
G7 ─── Final Tests + Choice ──── Human ── Merge/PR/Keep/Discard
```

---

## Agent Architecture

```
                       ┌─────────────────────┐
                       │    @architect        │
                       │  (primary/controller)│
                       │  kimi-k2.6           │
                       │  temp: 0.2           │
                       │  NEVER implements    │
                       └──────────┬──────────┘
                                  │ dispatches via task()
          ┌───────────────────────┼──────────────────────────┐
          │                       │                          │
          ▼                       ▼                          ▼
┌──────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ @frontend-coder  │  │  @backend-coder      │  │  @debugger           │
│ (implementer)    │  │  (implementer)       │  │  (investigator)      │
│ qwen3.6-plus     │  │  qwen3.6-plus        │  │  qwen3.6-plus        │
│ Next.js + TDD    │  │  FastAPI + TDD       │  │  root cause analysis │
└──────────────────┘  └──────────────────────┘  └──────────────────────┘

          ▼                       ▼
┌──────────────────────┐  ┌──────────────────────┐
│ @spec-reviewer       │  │ @code-quality-reviewer│
│ (read-only)          │  │ (read-only + tests)   │
│ deepseek-v4-flash    │  │ deepseek-v4-flash     │
│ temp: 0.1            │  │ temp: 0.1             │
│ checks: code matches │  │ checks: quality+tests │
│ plan spec            │  │ runs full test suite  │
└──────────────────────┘  └──────────────────────┘

          ▼                       ▼
┌──────────────────────┐  ┌──────────────────────┐
│ @docser              │  │ @deployer            │
│ (scribe, meta docs)  │  │ (devops, manual)     │
│ deepseek-v4-flash    │  │ deepseek-v4-flash    │
│ PLAN.md, CHANGELOG   │  │ production deploy    │
└──────────────────────┘  └──────────────────────┘
```

---

## Task Classification & Token Budget

```
                    ┌──────────┐
                    │   TASK   │
                    └────┬─────┘
                         │
           ┌─────────────┼─────────────┐
           │             │             │
           ▼             ▼             ▼
    ┌──────────┐  ┌──────────┐  ┌──────────┐
    │ Trivial  │  │  Small   │  │Standard  │
    │ ≤5 lines │  │ 1 file   │  │Multi-file│
    │ no logic │  │ <50 lines│  │ has logic│
    │ text only│  │ no state │  │ state    │
    └────┬─────┘  └────┬─────┘  └────┬─────┘
         │             │             │
         ▼             ▼             ▼
    ┌──────────┐  ┌──────────┐  ┌──────────────┐
    │Self-     │  │Spec      │  │Spec + Quality│
    │review    │  │review    │  │review (two-  │
    │~4K tokens│  │~18K tok  │  │stage) ~36K   │
    └──────────┘  └──────────┘  └──────────────┘
                                           │
                                           ▼
                                    ┌──────────┐
                                    │  Large   │
                                    │ >200 str │
                                    │ arch chg │
                                    └────┬─────┘
                                         │
                                         ▼
                                    ┌──────────────┐
                                    │Full two-stage│
                                    │+ final review│
                                    │~60K+ tokens  │
                                    └──────────────┘
```

---

## Worktree Lifecycle

```
Project Root (/root/workspace/memo/)
│
├── .worktrees/
│   └── feat-admin-schedule/       ← isolated worktree
│       ├── frontend/              ← Next.js app
│       │   ├── package.json       ← frontend dependencies
│       │   └── node_modules/
│       ├── backend/               ← FastAPI app
│       │   └── pyproject.toml     ← backend dependencies
│       ├── docs/                  ← docs directory (shared via git)
│       └── ...
│
├── frontend/                      ← main branch (stale during dev)
├── backend/
└── docs/
```

**Lifecycle:**
1. `git worktree add .worktrees/feat-<name> -b feat-<name>` — creation
2. `cd frontend && npm install` — dependency installation (one-time)
3. Implementation + commits in worktree
4. `git worktree remove .worktrees/feat-<name>` — removal after merge

---

## Scratchpad Resume Protocol

```
@architect starts → read .opencode/scratchpad.md
                    │
                    ├── workflow in progress → resume from last step
                    │
                    └── no workflow → start fresh

Scratchpad updated AFTER every:
  • Brainstorming done
  • Plan approved
  • Worktree created
  • Each task started/done/reviewed
  • Finishing complete
```

---

## Reference Implementation

This document is a project-specific copy of the SuperAgents workflow.

**Source of truth:** `/root/workspace/superagents/` (reusable framework)

| Element | Project File | Framework Source |
|---------|-------------|------------------|
| @architect agent | `.opencode/agents/architect.md` | `superagents/agents/architect.md` |
| @frontend-coder | `.opencode/agents/frontend-coder.md` | `superagents/agents/frontend-coder.md` |
| @backend-coder | `.opencode/agents/backend-coder.md` | `superagents/agents/backend-coder.md` |
| Reviewers | `.opencode/agents/*-reviewer.md` | `superagents/agents/*-reviewer.md` |
| Skills | `.opencode/skills/**/SKILL.md` | `superagents/skills/**/SKILL.md` |
| Reviewer templates | `.opencode/skills/reviewers/*.md` | `superagents/templates/reviewers/*.md` |

**Rule:** When the framework changes, sync FROM `superagents/` TO project files. The system executes project files, not this document.

**Container restart required** after any `.opencode/agents/*.md` or `.opencode/skills/**/SKILL.md` changes.

**New project setup:** See `superagents/docs/setup/new-project-setup.md`

---

## Key Principles

1. **Controller Never Implements** — @architect plans and delegates, never edits code
2. **Two-Stage Review** — spec compliance → code quality, never one without the other
3. **Sequential Tasks** — one implementer at a time, no parallel dispatch
4. **Human Gates** — G1 (design), G2 (plan), G7 (finish) require user approval
5. **Circuit Breaker** — max 3 review loops per reviewer, then escalate
6. **Diff in Prompt** — reviewers receive git diff embedded, never read files
7. **TDD Required** — RED-GREEN-REFACTOR for every implementation task
8. **No Temporary Tool Installation** — global tool installation in worktree is FORBIDDEN. All dependencies must be in `/root/docker/opencode/Dockerfile`. If a task requires a new tool → escalate to @infra for Dockerfile rebuild.

---

## Workflow Change Protocol

> **Golden source:** `/root/workspace/superagents/` — reusable framework repo.
> **Project copy:** `/root/workspace/memo/.opencode/agents/` and `.opencode/skills/` — local execution files.

### Rule: Framework-First Changes

If a workflow change is **generic** (applies to any project using SuperAgents):

1. **Update golden source FIRST** — edit files in `/root/workspace/superagents/`
2. **Commit in superagents** — `git add -A && git commit -m "workflow: ..."`
3. **Sync to project** — copy relevant files to `memo/.opencode/`
4. **Commit in memo** — separate commit referencing the change

If a change is **project-specific** (only applies to memo):

1. Edit directly in `memo/.opencode/` or `memo/docs/harness/`
2. No need to sync to superagents/

### How to tell generic vs project-specific

| Generic (superagents) | Project-specific (memo) |
|----------------------|------------------------|
| Workflow steps, gates, review pipeline | Project name, design system paths |
| Task classification rules | Mock data references |
| Agent roles and responsibilities | Model assignments (specific to memo) |
| TDD rules, circuit breaker | Tech stack versions (Next.js 14, etc.) |
| Skill definitions | Permission lists in agent frontmatter |

### @infra responsibility

When workflow files change in either repo, verify sync status:
- `diff /root/workspace/superagents/agents/architect.md /root/workspace/memo/.opencode/agents/architect.md`
- Report discrepancies to user
