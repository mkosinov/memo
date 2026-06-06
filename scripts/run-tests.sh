#!/usr/bin/env bash
# run-tests.sh — Run backend test groups in parallel for faster CI
#
# Usage:
#   ./scripts/run-tests.sh              # Run all groups sequentially
#   ./scripts/run-tests.sh --parallel   # Run all groups in parallel
#   ./scripts/run-tests.sh unit api     # Run specific groups only
#
# Groups: unit, api, integration, misc

set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "$0")/../backend" && pwd)"
PARALLEL=false
GROUPS=()

# Parse args
for arg in "$@"; do
    case "$arg" in
        --parallel|-p) PARALLEL=true ;;
        unit|api|integration|misc) GROUPS+=("$arg") ;;
        *) echo "Unknown arg: $arg"; exit 1 ;;
    esac
done

# Default: all groups
if [ ${#GROUPS[@]} -eq 0 ]; then
    GROUPS=(unit api integration misc)
fi

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

run_group() {
    local group=$1
    echo -e "${BLUE}━━━ Running: $group ━━━${NC}"
    cd "$BACKEND_DIR" && uv run pytest -m "$group" --no-cov -q 2>&1
    local exit_code=$?
    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}✓ $group passed${NC}"
    else
        echo -e "${RED}✗ $group failed (exit $exit_code)${NC}"
    fi
    return $exit_code
}

if $PARALLEL; then
    echo -e "${YELLOW}Running groups in parallel...${NC}"
    PIDS=()
    FAIL=0
    for group in "${GROUPS[@]}"; do
        run_group "$group" &
        PIDS+=($!)
    done
    for pid in "${PIDS[@]}"; do
        wait "$pid" || FAIL=1
    done
    if [ $FAIL -eq 1 ]; then
        echo -e "${RED}Some groups failed!${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}Running groups sequentially...${NC}"
    for group in "${GROUPS[@]}"; do
        run_group "$group" || exit 1
    done
fi

echo -e "${GREEN}━━━ All groups passed ━━━${NC}"
