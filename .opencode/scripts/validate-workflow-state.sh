#!/bin/bash
# =============================================================================
# SuperAgents Workflow State Validator
# =============================================================================
# Run this script to verify the current workflow gate status from scratchpad.
# Useful for manual checks and CI-like validation.
#
# USAGE:
#   bash .opencode/scripts/validate-workflow-state.sh
# =============================================================================

set -euo pipefail

SCRATCHPAD=".opencode/scratchpad.md"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

if [ ! -f "$SCRATCHPAD" ]; then
    echo -e "${RED}ERROR:${NC} Scratchpad not found at $SCRATCHPAD"
    exit 1
fi

echo "=== SuperAgents Workflow Gate Status ==="
echo "Reading: $SCRATCHPAD"
echo ""

# --- G1a: Design Concept ---
if grep -iE 'G1a.*(passed|approved)|concept.*approved|design.*approved' "$SCRATCHPAD" > /dev/null; then
    echo -e "  ${GREEN}✓ G1a${NC} — Design Concept Approval"
else
    echo -e "  ${YELLOW}○ G1a${NC} — Design Concept Approval (not recorded)"
fi

# --- G1b: Written Spec ---
if grep -iE 'G1b.*(passed|approved)|written spec.*approved|spec.*approved.*implementation' "$SCRATCHPAD" > /dev/null; then
    echo -e "  ${GREEN}✓ G1b${NC} — Written Spec Approval (HARD BLOCK)"
else
    echo -e "  ${RED}✗ G1b${NC} — Written Spec Approval (MISSING — blocks implementation)"
fi

# --- G2: Plan ---
if grep -iE 'G2.*(passed|approved)|plan.*approved' "$SCRATCHPAD" > /dev/null; then
    echo -e "  ${GREEN}✓ G2${NC}  — Plan Approval"
else
    echo -e "  ${YELLOW}○ G2${NC}  — Plan Approval (not recorded)"
fi

# --- G3: Worktree ---
if grep -iE 'G3.*(passed|done)|worktree.*created|clean baseline' "$SCRATCHPAD" > /dev/null; then
    echo -e "  ${GREEN}✓ G3${NC}  — Clean Baseline / Worktree"
else
    echo -e "  ${YELLOW}○ G3${NC}  — Clean Baseline / Worktree (not recorded)"
fi

# --- G7: Finish ---
if grep -iE 'G7.*(passed|done)|finish.*done' "$SCRATCHPAD" > /dev/null; then
    echo -e "  ${GREEN}✓ G7${NC}  — Finishing"
else
    echo -e "  ${YELLOW}○ G7${NC}  — Finishing (not recorded)"
fi

echo ""
echo "=== Source of Truth Compliance ==="
LATEST_SPEC=$(find docs/specs/ -name "*.md" -type f -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2- || true)
if [ -n "$LATEST_SPEC" ]; then
    echo "  Latest spec: $LATEST_SPEC"
    # Check if spec references user sketches or source docs
    if grep -iE 'sketches/|source of truth|user sketch|main_page_spec' "$LATEST_SPEC" > /dev/null; then
        echo -e "  ${GREEN}✓${NC} Spec references user source documents"
    else
        echo -e "  ${YELLOW}○${NC} Spec does not explicitly reference user source documents"
    fi
else
    echo -e "  ${YELLOW}○${NC} No specs found in docs/specs/"
fi

echo ""
