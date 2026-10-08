#!/usr/bin/env node
/**
 * Visual Compliance parser — extracts checkbox checks from a design spec's
 * "Visual Compliance Checks" (or "UI Verification" / "Visual Checks") section
 * and resolves machine-usable targets for each checkbox.
 *
 * SAFETY RULE: checkbox prose is NEVER turned into a CSS selector or a raw
 * text locator. A check is automatable only when its line contains an
 * explicit machine-usable hint:
 *   - an attribute pair: data-testid="…", aria-label="…", aria-haspopup="…",
 *     role="…", class="…" (trailing `*` becomes a prefix match)
 *   - a bare backticked ARIA/data attribute mention: `aria-sort`
 *   - a quoted UI string: "Нет записей"
 * A quoted string in a negative context ("no …", "without …") becomes an
 * absence check. Lines without any hint produce zero targets → the runner
 * classifies them as MANUAL_REVIEW instead of failing the gate.
 *
 * CLI: node visual-compliance-parser.js <spec-file> <output.json>
 *  - writes { "applicable": bool, "checks": [{ description, targets:
 *    [{kind, attr, value, negated}], status }] }
 *  - exit 0 on success (even with 0 checks), 2 on usage error
 *
 * APPLICABILITY (GH #311): applicable=false ONLY for the N/A marker section.
 * Marker grammar (verbatim from the spec canon): the marker line is the sole
 * content line of the section and, after trimming, equals "N/A" or "- N/A"
 * (ASCII hyphen only — en/em dashes and other renderings are NOT accepted),
 * case-insensitive. Prose paragraphs and horizontal rules do not cancel the
 * marker; any other checklist line does. The rule applies only when the
 * normal parse produced zero machine hints, and for all three section names.
 * Everything else — including a prose-only section with zero hints — is
 * applicable=true with the checks as parsed.
 */

const fs = require('fs');

const SECTION_RE =
    /^##\s+(?:\d+\.\s*|§\s*\d+\s*)*(Visual Compliance Checks|UI Verification|Visual Checks)\b/i;
const CHECK_RE = /^\s*[-*]\s*(?:\[[ xX]?\]\s*)?(.+)/;
const FENCE_RE = /^\s*```/;
const NA_MARKER_RE = /^(?:- )?n\/a$/i;
const ATTR_RE = /([a-z][a-z0-9_-]*)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/gi;
const BACKTICK_ATTR_RE = /`(aria|data)-[a-z0-9-]+`/gi;
const QUOTE_RE = /"([^"\n]{1,120})"|'([^'\n]{1,120})'/g;
const ALLOWED_ATTRS = /^(data-|aria-|role|class|id|name)$/i;
const NEGATION_RE = /(^|[^a-zа-я0-9])(no|not|without|never|absent|don'?t|doesn'?t|не|без)\s*$/i;

/** Data/ARIA attributes (any suffix) plus the plain UI attrs we trust. */
function isAllowedAttr(a) {
    return /^(data-|aria-)/i.test(a) || ['role', 'class', 'id', 'name'].includes(a);
}

/** True if the words right before position `idx` deny the hinted thing. */
function withinNegation(desc, idx) {
    const pre = desc.slice(Math.max(0, idx - 60), idx);
    return NEGATION_RE.test(pre);
}

/**
 * Extract machine-usable verification targets from a checkbox description.
 * Returns [] when the line is pure prose (→ MANUAL_REVIEW).
 */
function extractTargets(desc) {
    const targets = [];
    const consumed = []; // [start, end) spans of attribute values already used

    // 1) attribute pairs: aria-label="…", data-testid="…", role="…", class="…"
    ATTR_RE.lastIndex = 0;
    let m;
    while ((m = ATTR_RE.exec(desc)) !== null) {
        const attr = m[1].toLowerCase();
        if (!isAllowedAttr(attr)) continue;
        const raw = m[2].slice(1, -1);
        const negated = withinNegation(desc, m.index);
        if (raw.includes('*')) {
            const prefix = raw.split('*')[0];
            if (prefix) {
                targets.push({ kind: 'attrPrefix', attr, value: prefix, negated });
            }
        } else if (raw.length > 0) {
            targets.push({ kind: 'attr', attr, value: raw, negated });
        }
        consumed.push([m.index, m.index + m[0].length]);
    }

    // 2) bare backticked ARIA/data attribute mentions: `aria-sort`
    BACKTICK_ATTR_RE.lastIndex = 0;
    while ((m = BACKTICK_ATTR_RE.exec(desc)) !== null) {
        const attr = m[0].slice(1, -1).toLowerCase();
        if (!targets.some((t) => t.kind === 'attrPresence' && t.attr === attr)) {
            targets.push({ kind: 'attrPresence', attr, value: null, negated: withinNegation(desc, m.index) });
        }
    }

    // 3) quoted UI strings not already consumed as attribute values
    QUOTE_RE.lastIndex = 0;
    while ((m = QUOTE_RE.exec(desc)) !== null) {
        const value = (m[1] !== undefined ? m[1] : m[2]).trim();
        if (value.length === 0) continue;
        const isAttrValue = consumed.some(([s, e]) => m.index >= s && m.index < e);
        if (isAttrValue) continue;
        targets.push({ kind: 'text', attr: null, value, negated: withinNegation(desc, m.index) });
    }

    return targets;
}

/** Parse the spec's visual checks section into a { applicable, checks } result. */
function parse(content) {
    const lines = content.split('\n');
    let startIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (SECTION_RE.test(lines[i])) {
            startIdx = i;
            break;
        }
    }

    const checks = [];
    let naMarkerLines = 0; // body lines equal to "N/A" / "- N/A" (marker grammar)
    let naMarkerItems = 0; // marker lines that also parsed as checklist items
    let itemLines = 0; // every line parsed as a checklist item (pre-dedup)
    if (startIdx !== -1) {
        // Collect checklist items until the next H2 section.
        // ### subsections inside the section do NOT terminate it.
        // Fenced code blocks are skipped: their lines are not checks and
        // never yield machine hints.
        let inFence = false;
        for (let j = startIdx + 1; j < lines.length; j++) {
            const line = lines[j];
            if (/^##\s/.test(line)) break;
            if (FENCE_RE.test(line)) {
                inFence = !inFence;
                continue;
            }
            if (inFence) continue;
            if (/^\s*[-*_]{3,}\s*$/.test(line)) continue; // horizontal rule
            if (/^\s*\*\*/.test(line)) continue; // bold paragraph, not a bullet
            const isMarker = NA_MARKER_RE.test(line.trim());
            if (isMarker) naMarkerLines++;
            const match = line.match(CHECK_RE);
            if (match) {
                const desc = match[1].trim();
                if (desc && !/^#{1,6}\s/.test(desc)) {
                    itemLines++;
                    if (isMarker) naMarkerItems++;
                    checks.push({ description: desc, targets: extractTargets(desc), status: 'pending' });
                }
            }
        }
    }

    const unique = [];
    const seen = new Set();
    for (const c of checks) {
        if (seen.has(c.description)) continue;
        seen.add(c.description);
        unique.push(c);
    }

    // Not applicable ONLY via the N/A marker: the section exists, the normal
    // parse gave zero machine hints, and the marker line is the sole
    // checklist content line (bare "N/A" → 0 items; "- N/A" → exactly itself).
    const hasMachineHints = checks.some((c) => c.targets.length > 0);
    const isNaMarkerSection =
        startIdx !== -1 && !hasMachineHints && naMarkerLines === 1 && itemLines === naMarkerItems;

    return { applicable: !isNaMarkerSection, checks: isNaMarkerSection ? [] : unique };
}

function main() {
    const [, , specFile, outFile] = process.argv;
    if (!specFile || !outFile) {
        console.error('Usage: node visual-compliance-parser.js <spec-file> <output.json>');
        process.exit(2);
    }
    const result = parse(fs.readFileSync(specFile, 'utf8'));
    fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
    if (result.applicable) {
        console.log('Parsed ' + result.checks.length + ' visual checks from spec');
    } else {
        console.log('Spec section marked N/A — not applicable');
    }
}

module.exports = { parse, extractTargets };
if (require.main === module) main();