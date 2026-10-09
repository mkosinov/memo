#!/usr/bin/env bash
# Smoke tests for visual-compliance-check.sh — stage order & early exits (GH #311).
#
# Spec coverage:
#   docs/specs/2026-10-08-visual-compliance-spec-section-311-design.md
#   → «Порядок стадий»: N/A-marker spec must exit 0 with a "not applicable"
#     verdict BEFORE dependency checks, dev-server preflight (curl),
#     Playwright, and report generation.
#   → «Коды возврата»: a spec whose section is missing, empty, or prose-only
#     (zero machine hints) must exit 3 — return the card to design.
#
# Mechanics: no dev server, no network. The dev URL is a dummy
# (http://localhost:9 — discard port, nothing listens there). Every case
# here takes an early-exit path, so the URL must never be contacted; if the
# script under test regresses to curl-first, port 9 answers 000 → exit 2 →
# the affected cases fail (correct RED behaviour).
#
# Uses only `node` (the parser) — deliberately NOT npx/Playwright: those are
# checked AFTER the branch point, so a broken stage order fails these tests
# even in environments where the deps exist.
#
# Cases:
#   1 (US-2): spec with `- N/A` marker section   → exit 0 + "not applicable"
#   2 (US-3): spec without the section           → exit 3
#   3 (US-3): spec with an empty section         → exit 3
#   4 (US-3): spec with a prose-only section     → exit 3
#   5 (rev4): url-hint lines without selector hints → exit 3 (a url="…"
#             navigation hint is NOT a machine-usable hint — the parser
#             emits it in the separate `url` field with zero targets)
#
# Wired into scripts/test-all.sh by a separate task; self-contained here.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SCRIPT="${VISUAL_COMPLIANCE_CHECK_UNDER_TEST:-$SCRIPT_DIR/visual-compliance-check.sh}"

if [ ! -f "$CHECK_SCRIPT" ]; then
    echo "FATAL: script under test not found: $CHECK_SCRIPT" >&2
    exit 1
fi

WORK="$(mktemp -d -t vc-check-smoke-XXXXXX)"
cleanup() {
    rm -rf "$WORK"
}
trap cleanup EXIT

# Dummy dev URL: must NOT be contacted on any early-exit path under test.
DEV_URL="http://localhost:9"

FAIL=0

# run_case <name> <spec-file> — runs the script, captures exit code + output.
run_case() {
    local name="$1" spec="$2"
    local out="$WORK/$name.out"
    set +e
    timeout 30 bash "$CHECK_SCRIPT" "$DEV_URL" "$spec" "$WORK/out-$name" mobile \
        > "$out" 2>&1
    RUN_EXIT=$?
    set -e
    echo "── $name log (exit $RUN_EXIT) ──"
    cat "$out"
    echo "─────────────────"
}

# ── Case 1 (US-2): N/A marker section → exit 0, "not applicable" in output ──
cat > "$WORK/spec-na.md" <<'EOF'
# Design Spec

## Something Else
- [ ] Unrelated item

## Visual Compliance Checks
- N/A

## After
Prose after the section.
EOF

run_case "case1-na" "$WORK/spec-na.md"
if [ "$RUN_EXIT" -eq 0 ] && grep -qi "not applicable" "$WORK/case1-na.out"; then
    echo "PASS Case 1 (US-2): N/A spec → exit 0 + 'not applicable' verdict"
else
    echo "FAIL Case 1 (US-2): expected exit 0 and 'not applicable' in output, got exit $RUN_EXIT"
    FAIL=1
fi
# Early exit must skip report generation entirely.
if [ -e "$WORK/out-case1-na/visual-compliance-report.md" ]; then
    echo "FAIL Case 1 (US-2): report was generated despite N/A early exit"
    FAIL=1
fi

# ── Case 2 (US-3): no section at all → exit 3 ──────────────────────────────
cat > "$WORK/spec-nosection.md" <<'EOF'
# Design Spec

## Solution
Just prose, no visual checks section anywhere.
EOF

run_case "case2-nosection" "$WORK/spec-nosection.md"
if [ "$RUN_EXIT" -eq 3 ]; then
    echo "PASS Case 2 (US-3): spec without section → exit 3"
else
    echo "FAIL Case 2 (US-3): expected exit 3, got $RUN_EXIT"
    FAIL=1
fi

# ── Case 3 (US-3): empty section → exit 3 ──────────────────────────────────
cat > "$WORK/spec-empty.md" <<'EOF'
# Design Spec

## Visual Compliance Checks

## Next Section
Nothing inside the section.
EOF

run_case "case3-empty" "$WORK/spec-empty.md"
if [ "$RUN_EXIT" -eq 3 ]; then
    echo "PASS Case 3 (US-3): empty section → exit 3"
else
    echo "FAIL Case 3 (US-3): expected exit 3, got $RUN_EXIT"
    FAIL=1
fi

# ── Case 4 (US-3): prose-only section (zero machine hints) → exit 3 ────────
cat > "$WORK/spec-prose.md" <<'EOF'
# Design Spec

## Visual Compliance Checks
- [ ] The page looks consistent with the approved design language
- [ ] Animations feel smooth and intentional

## Next Section
EOF

run_case "case4-prose" "$WORK/spec-prose.md"
if [ "$RUN_EXIT" -eq 3 ]; then
    echo "PASS Case 4 (US-3): prose-only section → exit 3"
else
    echo "FAIL Case 4 (US-3): expected exit 3, got $RUN_EXIT"
    FAIL=1
fi

# ── Case 5 (rev4): url hints but zero selector hints → exit 3 ────────────────
# A url="/absolute/path" navigation hint is NOT a machine-usable hint: the
# parser drops it into the separate `url` field and targets stay empty, so
# the section is still a spec gap (code 3). Regression pin for the runner
# change: navigation must not soften the exit-3 verdict. If `url` were ever
# (mis)counted as a hint, the script would run on to deps/server preflight
# against the discard-port URL and exit 2 — this case would catch it.
cat > "$WORK/spec-url-only.md" <<'EOF'
# Design Spec

## Visual Compliance Checks
- [ ] The schedule screen url="/schedule" matches the approved layout
- [ ] Booking flow feels consistent url="/booking"

## Next Section
EOF

run_case "case5-url-only" "$WORK/spec-url-only.md"
if [ "$RUN_EXIT" -eq 3 ]; then
    echo "PASS Case 5 (rev4): url-only hints → exit 3 (url is not a machine hint)"
else
    echo "FAIL Case 5 (rev4): expected exit 3, got $RUN_EXIT"
    FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
    echo "ALL PASS"
    exit 0
else
    echo "SOME FAILED"
    exit 1
fi
