#!/bin/bash
# =============================================================================
# SuperAgents G1b Gate Pre-Commit Hook
# =============================================================================
# Enforces that NO implementation commits (plans, code, UI) can be made
# unless the scratchpad explicitly records G1b (written spec approval).
#
# This prevents the failure mode where:
#   - Design spec is written but user never reviewed the written file
#   - Implementation starts based on an unapproved spec
#
# INSTALL: cp .opencode/scripts/pre-commit-g1b-gate.sh .git/hooks/pre-commit
# CAUTION (2026-09-05): incompatible with the host/container phase split — in split mode
# G1b approval happens in a HOST design session and is never recorded in this container's
# scratchpad; the hook would block legitimate IMPL commits. Install only for
# single-environment (in-container) trajectories.

# BYPASS:  git commit --no-verify (emergency only)
# =============================================================================

set -euo pipefail

SCRATCHPAD=".opencode/scratchpad.md"

# Get list of staged files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$STAGED_FILES" ]; then
    exit 0
fi

# Determine if this commit touches implementation files
IMPLEMENTATION=false

# Plans trigger implementation phase
if echo "$STAGED_FILES" | grep -qE '^docs/plans/'; then
    IMPLEMENTATION=true
fi

# Code files = implementation
if echo "$STAGED_FILES" | grep -qE '\.(tsx|ts|jsx|js|py|css|scss|html|sql|prisma|jsonc?|yaml|yml)$'; then
    IMPLEMENTATION=true
fi

# Test files added after plan phase = implementation
if echo "$STAGED_FILES" | grep -qE '\.(test|spec)\.(tsx|ts|jsx|js|py)$'; then
    IMPLEMENTATION=true
fi

if [ "$IMPLEMENTATION" = "false" ]; then
    # This commit is docs-only (specs, README, etc.) — allowed without G1b
    exit 0
fi

# --- GATE CHECK ---
# Resolve scratchpad path — check current dir first, then main worktree
# (in a git worktree, the scratchpad lives in the main repo, not the worktree)
SCRATCHPAD_PATH=""
if [ -f "$SCRATCHPAD" ]; then
    SCRATCHPAD_PATH="$SCRATCHPAD"
else
    MAIN_WORKTREE=$(git worktree list --porcelain 2>/dev/null | grep '^worktree' | head -1 | sed 's/^worktree //')
    if [ -n "$MAIN_WORKTREE" ] && [ -f "$MAIN_WORKTREE/$SCRATCHPAD" ]; then
        SCRATCHPAD_PATH="$MAIN_WORKTREE/$SCRATCHPAD"
    fi
fi

if [ -z "$SCRATCHPAD_PATH" ]; then
    cat <<'EOF' >&2

================================================================================
  COMMIT BLOCKED: Implementation files staged, but no scratchpad found.

  Paths checked: .opencode/scratchpad.md (and main worktree)

  The scratchpad is required to verify workflow gate status (G1b).
  If this is the very first commit of a new project, bypass with:
      git commit --no-verify
================================================================================

EOF
    exit 1
fi

# Check for G1b approval markers in scratchpad
# Accepts: "G1b passed", "G1b: PASSED", "written spec approved", etc.
if grep -iE 'G1b.*(passed|approved)|written spec.*approved|spec.*approved.*implementation|Step 1.*G1b.*done' "$SCRATCHPAD_PATH" > /dev/null; then
    exit 0
fi

cat <<'EOF' >&2

================================================================================
  COMMIT BLOCKED: Implementation detected without G1b approval.

  You are attempting to commit implementation files (plans, code, or tests)
  but the scratchpad does not record explicit written spec approval.

  WORKFLOW REQUIRED BEFORE IMPLEMENTATION:
    1. Brainstorm → present design concept → get user approval  (G1a)
    2. Write design spec to docs/specs/YYYY-MM-DD-<feature>-design.md
    3. Commit the spec file
    4. Ask user to review the WRITTEN spec file and approve it
    5. User must confirm: "I have reviewed the spec and approve it"
    6. Update scratchpad: record "G1b passed" or "Written spec approved"
    7. ONLY THEN proceed to Step 2 (writing plans) and implementation

  CRITICAL: Chat-based "looks good" is NOT enough. G1b requires explicit
  approval of the WRITTEN spec file as committed to git.

  To bypass this gate (NOT recommended — defeats the safeguard):
      git commit --no-verify
================================================================================

EOF

exit 1
