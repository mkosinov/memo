# Fast Track Protocol (FasTP) — Project: Memo

## When to Use

After accepting a PR, when quick code edits are needed **without** the full SuperAgents procedural overhead (no full spec, no brainstorming, no plan doc).

**Use for:**
- Small/medium UI tweaks, polish, copy changes
- Simple wiring of existing components
- Refactors of small/medium scope
- Single-file fixes (style, layout, type)
- Visual regression fixes (after identify + plan)

**Don't use for:**
- New features requiring user research
- Breaking API changes
- Anything needing real-time product decisions
- Backend schema or migration changes (use full protocol)

---

## Commands
- `/FTP_START <description>` — Initiate a fast-track code edit (code only, no tests/docs/review)
- `/FTP_END` — All edits complete; trigger the full procedural package

> **Note:** In the current session model, user submits fix requests **in chat directly** (no slash commands). `/FTP_START` / `/FTP_END` remain as legacy aliases for compatibility.

---

## Session Workflow

The Architect (`@architect`) is the **orchestrator**. The user is in the loop for visual verification (default) or out of the loop (autonomous mode — see below).

```
1. User writes fix request in chat (with optional screenshot of current state)
        ↓
2. Architect records in TodoWrite (status: pending)
        ↓
3. Architect dispatches `frontend-coder` or `backend-coder`
   (RESUME existing session if one matches — see "Subagent Session Reuse")
        ↓
4. Coder reports back: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
        ↓
5. Architect updates TodoWrite based on coder's report:
   - DONE → mark as completed
   - DONE_WITH_CONCERNS → re-dispatch with specific clarifications
   - BLOCKED / NEEDS_CONTEXT → assess, re-dispatch or escalate to user
        ↓
6. **If UI change** → visual verification (mandatory after EVERY code change in Phase 1)
   - See "Visual Verification" below
        ↓
7. If visual issues found → re-dispatch coder with specific issues → loop (max 3 fix iterations)
        ↓
8. At session end or on user request: WIP commit (see "WIP Commit Policy")
```

### Why TodoWrite?
User wants to see at a glance:
- What's been requested but not started (`pending`)
- What's currently being worked on (`in_progress`)
- What was completed and awaits visual verification (`completed` — flagged in chat)
- What's blocked or needs decision (`pending` with comment)

---

## Operation Modes

The Architect operates in one of two modes per session. The mode determines **who does visual verification** (everything else is identical).

| Mode | Who is in the loop | Who verifies UI | How detected |
|---|---|---|---|
| **Autonomous** (man out of the loop) | Architect alone | Architect dispatches `general` subagent with Playwright (see "Visual Verification") | User explicitly said "ухожу / автономно / I'm leaving" **OR** sustained absence of user replies |
| **Man in the loop (MITL)** | User + Architect | **User themselves** — takes screenshots and writes report in chat | User is responding in real-time |

**Mode declaration:** in scratchpad as a single line: `Mode: autonomous | mitl`. This is the single source of truth. Mode changes only when user explicitly switches ("ухожу" / "вернулся").

**Key principle:** in both modes, the **Architect remains orchestrator** — dispatches coder, marks TodoWrite, makes WIP commits. The only difference is **who provides visual feedback** (subagent vs user).

---

## Phase 1: Fast Track (Code Only)

The Architect launches `frontend-coder` or `backend-coder` with these constraints:

- **ONLY update the code according to the description.**
- No other actions are permitted.
- Edit only the specified code.
- DO NOT update tests.
- DO NOT update documentation (except the protocol doc itself, with user approval).
- DO NOT run linters / formatters / pre-commit hooks.
- DO NOT perform code-quality review or spec review.

### Coder report format (required)
Coder MUST report back with one of:
- **DONE** — implemented as requested, no concerns
- **DONE_WITH_CONCERNS** — implemented, but has observations (e.g. file getting large, design issue noticed)
- **BLOCKED** — cannot proceed (missing info, technical blocker)
- **NEEDS_CONTEXT** — needs clarification before proceeding

Plus: list of files changed, what implemented, self-review findings, open questions.

### Visual verification is MANDATORY in Phase 1
After **every** coder dispatch that touches UI (`.tsx`, `.css`, Tailwind config, etc.):
- Architect triggers visual verification (see "Visual Verification")
- Skip only for: type-only changes, doc-only changes, backend-only changes, trivial single-line style fixes (e.g. hex color swap)

**Why mandatory:** catching visual issues early is cheaper than fixing accumulated regressions at end of session.

Multiple `/FTP_START` commands can be issued sequentially or in parallel if edits are independent.

---

## Phase 2: Procedural

The `/FTP_END` command triggers the complete procedural package:

1. **Visual verification final pass** (whole branch, all changes since last Phase 2)
2. `code-quality-reviewer` — review the final code
3. `spec-reviewer` — verify compliance with spec (if applicable)
4. **Tests** — run project's test suite, fix breakages
5. `docser` — update CHANGELOG, project docs, status
6. Commit (final, not WIP) / open or update PR

---

## Visual Verification

**Mandatory after every UI code change in Phase 1.** Max 3 fix iterations per issue, then escalate to scratchpad and move on.

### Tool preference (highest to lowest)

1. **browserMCP** — PRIMARY. Tools: `browser_navigate`, `browser_snapshot`, `browser_take_screenshot`, `browser_click`, `browser_close`, etc.
2. **Playwright via Node script** — FALLBACK only when browserMCP unavailable.

### Algorithm for verifier subagent

```
Step 1: Try a browserMCP tool (e.g. browser_navigate)
  ├─ Works → continue with browserMCP
  └─ Tool not exposed / MCP not connected / timeout → Step 2

Step 2: Fallback to Playwright
  - Use /usr/local/lib/node_modules/@playwright/test/index.mjs
  - In report, MUST explicitly state:
    * "Playwright fallback used"
    * Reason (e.g. "browserMCP tools not loaded in subagent session")
```

### Verifier report — mandatory fields

```markdown
## Visual Verification Report

### Mode
- autonomous | mitl

### Tool used
- **Primary:** browserMCP
- **Fallback:** Playwright via Node script (if used)
  - Path: /usr/local/lib/node_modules/@playwright/test/index.mjs
  - Reason: <why fallback was needed>

### Setup
- Dev server health: <OK/error>
- Activity/page opened: <yes/no>
- Console errors: <list or "none">

### Screenshots
- /tmp/opencode/<feature>/<name>.png

### Checklist
- [✅/❌/⚠️] <item> — <short description>

### Issues found
1. <HIGH/MED/LOW>: description + screenshot path

### Recommendation
- <"all good, proceed" | "fixes needed: ...">
```

### Subagent for verification
In **autonomous** mode: dispatch `general` subagent, **RESUME** existing session if one exists. Reusing keeps Playwright script in context and avoids cold-start overhead.

In **MITL** mode: no verifier subagent — user does it themselves.

---

## WIP Commit Policy

WIP commits are **local-only checkpoints** during Phase 1. They are NOT pushed to remote and do NOT trigger tests/linters.

### When to commit
- After a logical chunk of fixes is complete (e.g. "fix #31-#34: provider, sync, /clients, header")
- NOT after every single fix (too granular)
- At end of session before "Phase 2" transition

### Commit message format
```
<type>(<scope>): <summary>

<body — list of fix IDs and what each changed>

WIP — awaiting Phase 2.
```
- Types: `wip` (generic batch), `fix` (specific bug/issue), `feat` (new behavior), `docs` (doc only), `chore` (refactor/maintenance)
- Scope: usually `admin` (frontend) or backend
- Body: enumerate changes — "Why" not "What" (the diff shows "What")

### Exclusions from WIP commit
- E2E visual-regression snapshots (auto-generated, refresh in Phase 2)
- Any other auto-generated artifacts (build output, coverage reports)
- Secrets, `.env` files

### Never do in Phase 1
- **Push to remote** (wait for Phase 2)
- **Run tests** (can OOM, slow)
- **Run linters / formatters** (can OOM)
- **Bypass pre-commit hooks with --no-verify** (Phase 1 doesn't push anyway)
- **Merge to main / update PR** (Phase 2)

---

## Subagent Session Reuse

**Always RESUME existing sessions** when a suitable one exists. Cold-starting wastes context, tokens, and time.

### How to reuse
- Track open sessions in **scratchpad** (`.opencode/scratchpad.md`) under section "Open Subagent Sessions"
- Include: session ID, subagent type, last task, intended reuse area
- Pass `task_id` to the `task` tool to resume

### Scratchpad entry format
```markdown
## Open Subagent Sessions
| Session ID | Type | Last used for | Reuse for |
| `ses_xxx...` | frontend-coder | Task #N (description) | All FasTP coder tasks |
| `ses_yyy...` | general | Task #N (description) | All visual verify tasks |
```

**Important:** Concrete session IDs live in **scratchpad** (state). This protocol describes the **approach** (reuse over cold-start). The two should not be mixed.

### When cold-start is appropriate
- New task is genuinely outside scope of existing sessions
- Existing session has been marked closed/done
- Task requires a **different subagent type** than what's available

---

## Example Session (MITL mode)

```
# User: "Add a 'Notes' field to the modal"
# Architect:
  1. TodoWrite: "Add Notes field to ClientRecordTab" — pending
  2. Dispatch frontend-coder (resume ses_115cb423affezr8RXw8GvqgUVg) with full task
  3. Coder reports DONE
  4. TodoWrite: mark as completed
  5. User takes screenshot, writes report in chat
  6. Report says: "field shows up, but label is misaligned"
  7. Re-dispatch coder with "fix label alignment, mb-2 → mb-1"
  8. User verifies again, all good
  9. WIP commit: "feat(admin): add Notes field to ClientRecordTab"
  10. Update scratchpad
  11. Wait for next fix OR "коммитим Phase 2"
```

## Example Session (Autonomous mode)

Same as above, but step 5-8 are replaced:
```
  5. Dispatch general verifier (resume ses_xxx...) with Playwright
  6. Verifier reports: "field shows, label misaligned (LOW)"
  7. Re-dispatch coder with fix
  8. Re-dispatch verifier (resume SAME ses_xxx... session) — script already in context
  9. Verifier reports: all good
  10. WIP commit (same as MITL)
```

---

## Forbidden in Phase 1

- Running `code-quality-reviewer`, `spec-reviewer`, or `docser`
- Modifying tests
- Updating README / API docs / CHANGELOG (those are Phase 2 / docser)
- Running pre-commit hooks (with or without `--no-verify`)
- **Pushing to remote** — wait for Phase 2
- **Cold-starting a subagent session** when a suitable one already exists
- **Cold-starting Playwright** when a verifier session already has the script in context
- Editing the protocol doc (`FAST_TRACK_PROTOCOL.md`) without first showing the plan and getting user approval — meta-documents need approval before changes
