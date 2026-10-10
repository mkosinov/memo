#!/usr/bin/env bash
# =============================================================================
# Visual Compliance Gate
# Checks that implemented UI matches the design spec visually
# Run ONCE per phase, after all tasks complete (NOT on every task)
# =============================================================================
#
# Usage:
#   ./visual-compliance-check.sh <dev-server-url> <spec-file> [output-dir] [viewport]
#
# Arguments:
#   dev-server-url   URL of running dev server (e.g. http://localhost:3000)
#   spec-file        Path to design spec markdown file with UI requirements
#   output-dir       Where to save screenshots (default: /tmp/visual-compliance)
#   viewport         "mobile" (390x844) or "desktop" (default: mobile)
#
# Exit codes (single canon of the gate's codes — callers follow this table):
#   0  Green: all automatable checks passed (MANUAL_REVIEW items do not fail
#      the gate), OR the spec's visual checks section is marked N/A
#      (not applicable — the gate exits before dependency, server,
#      Playwright, and report stages)
#   1  Red: one or more automatable checks genuinely failed
#   2  Infrastructure/usage failure: bad arguments, missing dependency,
#      spec file not found, parser crash, or dev server unreachable
#   3  Spec gap (return the card to design): the visual checks section is
#      missing, empty, or contains no machine-usable hints — the spec
#      section must be (re)designed in the design phase, not patched here
#
# Stage order: arguments → spec file exists → parse → branch
#   (N/A → print verdict, exit 0 immediately) →
#   (no section / empty / zero machine hints → exit 3) →
#   (applicable with hints → deps → server pre-flight → Playwright → report)
#
# Parsing policy (see visual-compliance-parser.js):
#   Checkbox prose is NEVER used as a CSS selector or raw text locator.
#   A check is automatable only when its line carries an explicit
#   machine-usable hint (quoted UI string, data-testid, aria-label/role
#   attribute, `aria-sort`-style mention). Lines without a hint are reported
#   as MANUAL_REVIEW and do not affect the exit code.
#   checks.json shape (parser contract): { "applicable": bool, "checks": [...] }
#   — applicable=false ⇔ the section carries the N/A marker.
#
# Example:
#   ./visual-compliance-check.sh http://localhost:3000 docs/specs/schedule-design.md /tmp/vc-schedule mobile
#
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Argument Parsing ---------------------------------------------------------

if [ $# -lt 2 ]; then
    echo "Usage: $0 <dev-server-url> <spec-file> [output-dir] [viewport]"
    echo "  viewport: mobile (default) | desktop"
    exit 2
fi

DEV_URL="$1"
SPEC_FILE="$2"
OUTPUT_DIR="${3:-/tmp/visual-compliance}"
VIEWPORT="${4:-mobile}"

# Derive phase name from spec filename (e.g. "schedule-design.md" -> "schedule")
PHASE_NAME=$(basename "$SPEC_FILE" .md | sed 's/-design//g' | sed 's/-spec//g')
PHASE_DIR="$OUTPUT_DIR/$PHASE_NAME"
REPORT_FILE="$OUTPUT_DIR/visual-compliance-report.md"

# --- Spec File Check -----------------------------------------------------------

if [ ! -f "$SPEC_FILE" ]; then
    echo "ERROR: Spec file not found: $SPEC_FILE" >&2
    exit 2
fi

# --- Extract Checks from Spec -------------------------------------------------
# The spec file should contain a "## Visual Compliance Checks" section
# with checkboxes describing UI elements to verify.
#
# Example:
#   ## Visual Compliance Checks
#   - [ ] "Сегодня" tab is visible on main page
#   - [ ] "Завтра" tab is visible on main page
#   - [ ] "Календарь" tab opens date picker overlay
#   - [ ] Filter pills are visible below tabs
#
# Each check gets a list of machine-usable `targets` (quoted UI strings,
# data-testid/aria-label/role attributes). Prose-only lines get zero targets
# and are reported as MANUAL_REVIEW. See visual-compliance-parser.js.
#
# The parser writes { "applicable": bool, "checks": [...] }:
#   applicable=false        ⇔ section carries the N/A marker → gate not applicable
#   checks=[] (applicable)  ⇔ section missing or empty
#   zero machine hints      ⇔ prose-only section (no check has a non-empty
#                             targets array) — needs design, not automation.

echo ""
echo "--- Parsing spec for visual checks..."

mkdir -p "$PHASE_DIR"
CHECKS_FILE="$PHASE_DIR/checks.json"

# Overwrite at the START of every run: a stale checks.json from a previous
# run must never survive this one (especially not past a parser failure).
: > "$CHECKS_FILE"

# A parser failure is an infrastructure failure (exit 2), never silently
# ignored and never mistaken for a spec gap.
set +e
node "$SCRIPT_DIR/visual-compliance-parser.js" "$SPEC_FILE" "$CHECKS_FILE"
PARSE_EXIT=$?
set -e
if [ "$PARSE_EXIT" -ne 0 ]; then
    echo "ERROR: Spec parser failed (exit $PARSE_EXIT). Infrastructure failure — no checks were evaluated." >&2
    exit 2
fi

# Read the parser verdict: applicability, check count, machine-hint count.
# Paths go to node as process arguments, never interpolated into JS source.
PARSE_SUMMARY=$(node -e '
const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const checks = Array.isArray(j.checks) ? j.checks : [];
const hints = checks.filter((c) => Array.isArray(c.targets) && c.targets.length > 0).length;
console.log((j.applicable ? "true" : "false") + " " + checks.length + " " + hints);
' "$CHECKS_FILE") || { echo "ERROR: Failed to read parser output: $CHECKS_FILE" >&2; exit 2; }
read -r APPLICABLE CHECKS_COUNT MACHINE_HINTS <<< "$PARSE_SUMMARY"

# --- Branch: applicability verdict (before deps / server / Playwright) --------

if [ "$APPLICABLE" != "true" ]; then
    echo ""
    echo "Spec section marked N/A — visual compliance gate not applicable, skipped."
    exit 0
fi

if [ "$CHECKS_COUNT" -eq 0 ] || [ "$MACHINE_HINTS" -eq 0 ]; then
    echo "" >&2
    if [ "$CHECKS_COUNT" -eq 0 ]; then
        echo "ERROR (exit 3): Spec '$SPEC_FILE' has no visual checks section (or the section is empty)." >&2
    else
        echo "ERROR (exit 3): Spec '$SPEC_FILE' has $CHECKS_COUNT visual check(s) but none carries a machine-usable hint (data-testid / aria-label / quoted UI text)." >&2
    fi
    echo "The design spec's visual checks section must be redesigned in the design phase:" >&2
    echo "return the implementation card to design (In Design). Do not patch the spec from implementation." >&2
    exit 3
fi

echo "Found $CHECKS_COUNT visual checks ($MACHINE_HINTS with machine-usable hints)"

# --- Dependencies Check -------------------------------------------------------

if ! command -v npx &>/dev/null; then
    echo "ERROR: npx not found. Install Node.js + npm." >&2
    exit 2
fi

if ! npx playwright --version &>/dev/null 2>&1; then
    echo "ERROR: Playwright not found. Install: npm install -D @playwright/test" >&2
    exit 2
fi

# --- Setup --------------------------------------------------------------------

mkdir -p "$PHASE_DIR/screenshots"
mkdir -p "$PHASE_DIR/logs"

echo "=================================================================="
echo "  Visual Compliance Gate"
echo "  Phase:    $PHASE_NAME"
echo "  URL:      $DEV_URL"
echo "  Spec:     $SPEC_FILE"
echo "  Output:   $PHASE_DIR"
echo "  Viewport: $VIEWPORT"
echo "=================================================================="

# --- Viewport Config ----------------------------------------------------------

if [ "$VIEWPORT" = "desktop" ]; then
    VIEWPORT_WIDTH=1280
    VIEWPORT_HEIGHT=720
    DEVICE=""
else
    VIEWPORT_WIDTH=390
    VIEWPORT_HEIGHT=844
    DEVICE="iPhone 14"  # Playwright device descriptor for mobile
fi

# --- Dev Server Pre-flight ----------------------------------------------------
# Fail fast (5s) instead of hanging in Playwright if the server is down.

if command -v curl &>/dev/null; then
    HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$DEV_URL" 2>/dev/null || true)
    if [ -z "$HTTP_CODE" ] || [ "$HTTP_CODE" = "000" ]; then
        echo "ERROR: Dev server not reachable at $DEV_URL (5s curl timeout). Start the dev server and re-run." >&2
        exit 2
    fi
    echo "Dev server reachable (HTTP $HTTP_CODE)"
fi

# --- Playwright Script --------------------------------------------------------

PLAYWRIGHT_SCRIPT="$PHASE_DIR/run-checks.js"

cat > "$PLAYWRIGHT_SCRIPT" << 'PLAYWRIGHT_EOF'
// Use @playwright/test (installed globally via Dockerfile npm install -g @playwright/test).
// The bare 'playwright' package is nested under @playwright/test/node_modules/ and not
// resolvable via NODE_PATH. @playwright/test re-exports the full Playwright API.
const { chromium } = require('@playwright/test');
const fs = require('fs');

(async () => {
    const args = process.argv.slice(2);
    const devUrl = args[0];
    const checksFile = args[1];
    const phaseDir = args[2];
    const viewportType = args[3] || 'mobile';

    // Parser contract (GH #311): checks.json is an OBJECT
    // { "applicable": bool, "checks": [...] } — the runner consumes .checks.
    // rev4: a check may carry an optional top-level `url` (absolute path) —
    // a navigation hint, never a target (does not make a check automatable);
    // it only tells the runner which page to evaluate the check on.
    const payload = JSON.parse(fs.readFileSync(checksFile, 'utf8'));
    const checks = Array.isArray(payload) ? payload : payload.checks;
    const results = {
        phase: require('path').basename(phaseDir),
        url: devUrl,
        viewport: viewportType,
        timestamp: new Date().toISOString(),
        screenshots: [],
        checks: [],
        summary: { total: 0, passed: 0, failed: 0, manual_review: 0 }
    };

    // Build a locator from a parsed target. NEVER feeds prose into a selector:
    // kind 'text' uses getByText (substring match), attr kinds use attribute
    // selectors with escaped values only.
    function cssEscapeValue(v) {
        return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    function locatorFor(page, t) {
        if (t.kind === 'text') {
            return page.getByText(t.value, { exact: false });
        }
        const attr = String(t.attr).replace(/[^a-z0-9_-]/gi, '\\$&');
        if (t.kind === 'attrPresence') {
            return page.locator('[' + attr + ']');
        }
        if (t.kind === 'attrPrefix') {
            return page.locator('[' + attr + '^="' + cssEscapeValue(t.value) + '"]');
        }
        return page.locator('[' + attr + '="' + cssEscapeValue(t.value) + '"]');
    }

    function targetLabel(t) {
        let label;
        if (t.kind === 'text') label = 'text=' + JSON.stringify(t.value);
        else if (t.kind === 'attrPresence') label = '[' + t.attr + ']';
        else if (t.kind === 'attrPrefix') label = '[' + t.attr + '^="' + t.value + '"]';
        else label = '[' + t.attr + '="' + t.value + '"]';
        return t.negated ? label + ' (must be absent)' : label;
    }

    // Launch browser
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(
        viewportType === 'mobile'
            ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' }
            : { viewport: { width: 1280, height: 720 } }
    );
    const page = await context.newPage();

    // Helper: screenshot a state
    async function captureScreenshot(name, fullPage = false) {
        const path = `${phaseDir}/screenshots/${name}.png`;
        await page.screenshot({ path, fullPage });
        results.screenshots.push({ name, path, fullPage });
        console.log(`  Screenshot: ${path}`);
        return path;
    }

    try {
        // 1. Capture initial page load
        console.log('Navigating to ' + devUrl);
        await page.goto(devUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(1000); // let animations settle
        await captureScreenshot('01-initial-load', true);
        // Navigation cache (rev4): the effective URL the page is on now.
        // Checks without a `url` hint evaluate on the root, as before.
        let lastUrl = devUrl;

        // 2. Run target checks
        for (const check of checks) {
            console.log(`\nCheck: ${check.description}`);
            results.summary.total++;

            const targets = check.targets || [];

            // Prose-only checkbox: no machine-usable hint — manual review.
            if (targets.length === 0) {
                results.checks.push({
                    description: check.description,
                    selector: '-',
                    status: 'manual_review',
                    details: 'No machine-usable hint (quoted UI string, data-testid, aria-label/role) in checkbox prose — manual review required',
                    screenshot: null
                });
                results.summary.manual_review++;
                console.log('  Result: MANUAL_REVIEW — no machine-usable hint, skipping automation');
                continue;
            }

            let status = 'failed';
            let evidence = [];
            let screenshotPath = null;

            try {
                // Per-check navigation (rev4): url="/absolute/path" hint makes
                // the check evaluate on that page instead of the root. Only
                // automatable checks reach here — MANUAL_REVIEW items
                // continue()d above and are never navigated. goto fires only
                // when the effective URL changed (navigation cache); a goto
                // failure lands in the catch below → this check FAILED, the
                // run continues (exit 1 at the end, as for any failed check).
                const effectiveUrl = check.url ? new URL(check.url, devUrl).href : devUrl;
                if (effectiveUrl !== lastUrl) {
                    console.log('  Navigating to ' + effectiveUrl + ' (url hint)');
                    await page.goto(effectiveUrl, { waitUntil: 'networkidle', timeout: 30000 });
                    await page.waitForTimeout(1000); // let animations settle
                    lastUrl = effectiveUrl;
                }

                const perTarget = [];
                for (const t of targets) {
                    const loc = locatorFor(page, t);
                    const count = await loc.count();
                    const label = targetLabel(t);
                    let ok;
                    let detail;
                    if (t.negated) {
                        // Absence check ("no … item"): found = failure.
                        if (count === 0) { ok = true; detail = 'absent (0 matches) — OK'; }
                        else { ok = false; detail = 'FOUND ' + count + ' match(es) — expected absent'; }
                    } else if (count > 0) {
                        const visible = await loc.first().isVisible();
                        ok = visible;
                        detail = 'found ' + count + ' element(s)' + (visible ? ' (visible)' : ' (NOT visible)');
                    } else {
                        ok = false;
                        detail = 'not found (0 matches)';
                    }
                    perTarget.push({ label, detail, ok });
                }

                status = perTarget.every((r) => r.ok) ? 'passed' : 'failed';
                if (status === 'passed') {
                    evidence = perTarget.map((r) => `${r.label}: ${r.detail}`);
                } else {
                    evidence = perTarget.filter((r) => !r.ok).map((r) => `${r.label}: ${r.detail}`);
                }
                screenshotPath = await captureScreenshot(`check-${results.checks.length + 1}-${status}`, false);
            } catch (err) {
                status = 'failed';
                evidence = [`Error: ${err.message}`];
                screenshotPath = await captureScreenshot(`check-${results.checks.length + 1}-error`, false);
            }

            results.checks.push({
                description: check.description,
                selector: targets.map(targetLabel).join('; ') || '-',
                status,
                details: evidence.join('; '),
                screenshot: screenshotPath
            });

            if (status === 'passed') results.summary.passed++;
            else results.summary.failed++;

            console.log(`  Result: ${status.toUpperCase()} — ${evidence.join('; ')}`);
        }

        // 3. Capture final page state
        await captureScreenshot('zz-final-state', true);

    } catch (err) {
        console.error('Fatal error during checks:', err);
        results.fatalError = err.message;
    } finally {
        await browser.close();
    }

    // Save JSON results
    fs.writeFileSync(`${phaseDir}/results.json`, JSON.stringify(results, null, 2));

    // Exit code: 1 if any automatable check failed, else 0 (MANUAL_REVIEW
    // items neither fail nor pass the gate).
    const exitCode = results.summary.failed > 0 ? 1 : 0;
    process.exit(exitCode);
})();
PLAYWRIGHT_EOF

# --- Run Checks ---------------------------------------------------------------

echo ""
echo "--- Running Playwright checks..."

# Guard (#374): `playwright install` prunes "unused" browser builds from the
# SHARED global cache (~/.cache/ms-playwright). An unconditional install can
# delete the chromium build a concurrent e2e run is executing on this machine
# (incident in #301 IMPL: chromium-1223 removed mid-suite). Ask the SAME
# Playwright installation that runs the checks below (global @playwright/test
# resolved via NODE_PATH) for the expected chromium executable and skip the
# install when it already exists. A broken partial download is NOT detected
# (accepted trade-off: the run then fails loudly with an explicit error).
CHROMIUM_PATH=$(NODE_PATH=/usr/local/lib/node_modules node -e '
const { chromium } = require("@playwright/test");
try { process.stdout.write(chromium.executablePath() || ""); }
catch (e) { process.stdout.write(""); }
' 2>/dev/null || true)
if [ -n "$CHROMIUM_PATH" ] && [ -f "$CHROMIUM_PATH" ]; then
    echo "--- Chromium already present, skipping playwright install: $CHROMIUM_PATH"
else
    set +e
    npx playwright install chromium 2>/dev/null
    set -e
fi

# NODE_PATH makes the globally-installed @playwright/test resolvable by require().
# @playwright/test is installed in /usr/local/lib/node_modules by the Dockerfile,
# and Node's require() does not search global modules unless NODE_PATH is set.
# set +e: the runner exits 1 when checks fail — capture it, still write the report.
set +e
NODE_PATH=/usr/local/lib/node_modules node "$PLAYWRIGHT_SCRIPT" "$DEV_URL" "$CHECKS_FILE" "$PHASE_DIR" "$VIEWPORT"
EXIT_CODE=$?
set -e

# --- Generate Markdown Report -------------------------------------------------

echo ""
echo "--- Generating report..."

# Paths are passed as process arguments (argv), never interpolated into the
# JS source (node -e hygiene).
node -e '
const fs = require("fs");
const resultsFile = process.argv[1];
const phaseDir = process.argv[2];
const reportFile = process.argv[3];
const results = JSON.parse(fs.readFileSync(resultsFile, "utf8"));

let md = "# Visual Compliance Report\n\n";
md += "**Phase:** " + results.phase + "  \n";
md += "**URL:** " + results.url + "  \n";
md += "**Viewport:** " + results.viewport + "  \n";
md += "**Timestamp:** " + results.timestamp + "  \n\n";

md += "## Summary\n\n";
md += "| Metric | Count |\n";
md += "|--------|-------|\n";
md += "| Total Checks | " + results.summary.total + " |\n";
md += "| Passed | " + results.summary.passed + " |\n";
md += "| Failed | " + results.summary.failed + " |\n";
md += "| Manual Review | " + results.summary.manual_review + " |\n\n";

if (results.summary.failed === 0) {
    md += "\u2705 **ALL AUTOMATABLE CHECKS PASSED**\n\n";
    if (results.summary.manual_review > 0) {
        md += "\u26a0 **" + results.summary.manual_review + " check(s) require MANUAL REVIEW** \u2014 human sign-off needed for those items.\n\n";
    }
} else {
    md += "\u274c **" + results.summary.failed + " AUTOMATABLE CHECK(S) FAILED**\n\n";
}

if (results.fatalError) {
    md += "**Fatal Error:** " + results.fatalError + "\n\n";
}

md += "## Screenshots\n\n";
md += "| Name | File |\n";
md += "|------|------|\n";
for (const ss of results.screenshots) {
    md += "| " + ss.name + " | " + ss.path + " |\n";
}
md += "\n";

md += "## Element Checks\n\n";
md += "| # | Description | Selector/Text Used | Status | Details | Screenshot |\n";
md += "|---|-------------|--------------------|--------|---------|------------|\n";
let i = 1;
for (const check of results.checks) {
    const statusEmoji = check.status === "passed" ? "\u2705" : (check.status === "failed" ? "\u274c" : "\u26a0");
    md += "| " + i + " | " + check.description + " | " + (check.selector || "-") + " | " + statusEmoji + " " + check.status.toUpperCase() + " | " + (check.details || "-") + " | " + (check.screenshot ? check.screenshot.replace(phaseDir + "/", "") : "-") + " |\n";
    i++;
}
md += "\n";

md += "## Next Steps\n\n";
if (results.summary.failed > 0) {
    md += "**Visual compliance FAILED.**\n\n";
    md += "Options:\n";
    md += "1. **Fix and re-run:** Address the failing checks, then re-run this gate.\n";
    md += "2. **Override and proceed:** User explicitly approves overriding the failure and continuing to Step 5 (Documentation Commit).\n";
    md += "3. **Abort:** Stop and reassess the implementation plan.\n\n";
    md += "**Screenshots saved to:** \`" + phaseDir + "/screenshots/\`\n";
} else {
    md += "**Visual compliance PASSED.** Proceed to Step 5 (Documentation Commit).\n";
    if (results.summary.manual_review > 0) {
        md += "\n**Note:** " + results.summary.manual_review + " check(s) are marked MANUAL_REVIEW \u2014 obtain human sign-off for those items as part of the gate review.\n";
    }
}

fs.writeFileSync(reportFile, md);
console.log("Report written to: " + reportFile);
' "$PHASE_DIR/results.json" "$PHASE_DIR" "$REPORT_FILE"

# --- Final Output -------------------------------------------------------------

echo ""
echo "=================================================================="
echo "  Visual Compliance Gate Complete"
echo "=================================================================="
echo "  Phase dir:    $PHASE_DIR"
echo "  Screenshots:  $PHASE_DIR/screenshots/"
echo "  Results:      $PHASE_DIR/results.json"
echo "  Report:       $REPORT_FILE"
echo ""

if [ $EXIT_CODE -eq 0 ]; then
    SUMMARY_LINE=$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1])); console.log(r.summary.passed+" passed, "+r.summary.manual_review+" manual review")' "$PHASE_DIR/results.json")
    echo "  Result: ALL AUTOMATABLE CHECKS PASSED ($SUMMARY_LINE)"
else
    SUMMARY_LINE=$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1])); console.log(r.summary.passed+" passed, "+r.summary.failed+" failed, "+r.summary.manual_review+" manual review")' "$PHASE_DIR/results.json")
    echo "  Result: $CHECKS_COUNT checks, $SUMMARY_LINE"
    echo ""
    echo "  SOFT BLOCK: Do NOT proceed to Step 5 until resolved or user overrides."
fi

echo "=================================================================="

exit $EXIT_CODE