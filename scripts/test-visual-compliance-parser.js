#!/usr/bin/env node
/**
 * Unit + fixture test for visual-compliance-parser.js.
 *
 * Run from repo root:  node scripts/test-visual-compliance-parser.js
 * It asserts the parser against the real datatable spec §10 (13 checkboxes),
 * against synthetic lines covering the hint-extraction rules, and against the
 * { applicable, checks } output contract (GH #311, US-1/US-2):
 *   - applicable=false ONLY for the N/A marker section (exact grammar:
 *     the sole content line equal to "N/A" or "- N/A", case-insensitive,
 *     ASCII hyphen only, zero machine hints from the normal parse);
 *   - everything else — hint-bearing checklists, prose-only sections,
 *     missing sections — parses normally with applicable=true.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { parse, extractTargets } = require(path.join(__dirname, 'visual-compliance-parser.js'));

const SPEC = fs.readFileSync(
    path.join(__dirname, '..', 'docs/specs', '2026-08-18-generic-datatable-design.md'),
    'utf8'
);

/** Build a minimal spec document with the given section heading and body. */
function specWith(sectionHeading, body) {
    return [
        '# Design spec',
        '',
        '## Context',
        '',
        'Some context prose.',
        '',
        sectionHeading,
        '',
        body.trimEnd(),
        '',
        '## Later section',
        '',
        'Unrelated prose.',
        '',
    ].join('\n');
}

// --- Fixture assertions: the 13 §10 checkboxes ---------------------------

const parsed = parse(SPEC);
assert.strictEqual(parsed.applicable, true, '§10 checklist section is applicable');
const checks = parsed.checks;
const auto = checks.filter((c) => c.targets.length > 0);
const manual = checks.filter((c) => c.targets.length === 0);

assert.strictEqual(checks.length, 13, 'all 13 checkboxes parsed from §10');
assert.strictEqual(auto.length, 6, `6 automatable — got ${auto.length}`);
assert.strictEqual(manual.length, 7, `7 manual-review — got ${manual.length}`);

function find(prefix) {
    const found = checks.filter((c) => c.description.startsWith(prefix));
    assert.strictEqual(found.length, 1, `exactly one check matches "${prefix}"`);
    return found[0];
}

// 1. Quoted UI string → text target
const colPicker = find('ColumnPicker ("Настроить колонки")');
assert.deepStrictEqual(
    colPicker.targets.map((t) => [t.kind, t.value, t.negated]),
    [['text', 'Настроить колонки', false]]
);

// 2. Two quoted strings on one line → two text targets, AND-semantics
const queryFailure = find('Query failure shows');
assert.deepStrictEqual(
    queryFailure.targets.map((t) => [t.kind, t.value, t.negated]),
    [['text', 'Ошибка загрузки: …', false], ['text', 'Повторить', false]]
);

// 3. Prose-only "initial load" line → NOT a selector, manual review
assert.strictEqual(find('Initial load shows').targets.length, 0);

// 4. Bare backticked ARIA attribute → presence selector
const headers = find('Inactive sortable headers show');
assert.deepStrictEqual(
    headers.targets.map((t) => [t.kind, t.attr, t.value]),
    [['attrPresence', 'aria-sort', null]]
);

// 5. Attribute pairs incl. glob testid → prefix attr selector; no stray text targets
const rowTrigger = find('Row `⋯` trigger has');
assert.deepStrictEqual(
    rowTrigger.targets.map((t) => [t.kind, t.attr, t.value, t.negated]),
    [
        ['attr', 'aria-label', 'Действия', false],
        ['attr', 'aria-haspopup', 'menu', false],
        ['attr', 'role', 'menu', false],
        ['attrPrefix', 'data-testid', 'dropdown-', false]
    ]
);

// 6. Negative-context quoted string → absence check
const records = find('Records: row click opens');
assert.deepStrictEqual(
    records.targets.map((t) => [t.kind, t.value, t.negated]),
    [['text', 'open detail', true]]
);

// 7. Backticked code identifiers / templated keys → not machine hints
for (const prefix of ['All 8 entity pages render', 'Delete via menu opens', 'Column visibility persists', 'Pager controls', 'Sort change resets', 'ColumnPicker: last visible']) {
    assert.strictEqual(find(prefix).targets.length, 0, `"${prefix}" must be manual review`);
}

// --- Synthetic extraction rules -------------------------------------------

function kinds(desc) {
    return extractTargets(desc).map((t) => ({ kind: t.kind, attr: t.attr, value: t.value, negated: t.negated }));
}

assert.deepStrictEqual(kinds('Row has aria-label="Действия"'), [{ kind: 'attr', attr: 'aria-label', value: 'Действия', negated: false }]);
assert.deepStrictEqual(kinds('shows "Нет записей"'), [{ kind: 'text', attr: null, value: 'Нет записей', negated: false }]);
assert.deepStrictEqual(kinds('no "open detail" menu item'), [{ kind: 'text', attr: null, value: 'open detail', negated: true }]);
assert.deepStrictEqual(kinds('header keeps `aria-sort`'), [{ kind: 'attrPresence', attr: 'aria-sort', value: null, negated: false }]);
assert.deepStrictEqual(kinds('menu has data-testid="dropdown-*"'), [{ kind: 'attrPrefix', attr: 'data-testid', value: 'dropdown-', negated: false }]);
assert.deepStrictEqual(kinds('plain prose about table rows and cells and tabs'), []);
assert.deepStrictEqual(kinds('under `<entity>-columns` keys (`*-column-visibility` gone)'), []);
assert.deepStrictEqual(kinds('Tags still use `window.confirm`'), []);

// Attr value must not leak as a separate text target
assert.strictEqual(extractTargets('aria-label="Действия"').length, 1);

// No section → applicable stays true (only the N/A marker flips it), no crash
{
    const r = parse('# No checks here\n- [ ] whatever\n');
    assert.strictEqual(r.applicable, true, 'missing section is not the N/A case');
    assert.strictEqual(r.checks.length, 0, 'no checks without a section');
}

// --- US-1: hint-bearing section → applicable, automatable checks ---------

{
    const body = [
        '- [ ] Records table carries data-testid="records-table"',
        '- [ ] Filter button exposes aria-label="Фильтры"',
        '- [ ] Empty state shows "Нет записей"',
    ].join('\n');
    const r = parse(specWith('## Visual Compliance Checks', body));
    assert.strictEqual(r.applicable, true, 'US-1: hint-bearing section is applicable');
    assert.strictEqual(r.checks.length, 3, 'US-1: every checklist item parsed');
    assert.deepStrictEqual(
        r.checks[0].targets.map((t) => [t.kind, t.attr, t.value]),
        [['attr', 'data-testid', 'records-table']],
        'US-1: data-testid hint'
    );
    assert.deepStrictEqual(
        r.checks[1].targets.map((t) => [t.kind, t.attr, t.value]),
        [['attr', 'aria-label', 'Фильтры']],
        'US-1: aria-* hint'
    );
    assert.deepStrictEqual(
        r.checks[2].targets.map((t) => [t.kind, t.value]),
        [['text', 'Нет записей']],
        'US-1: quoted UI string hint'
    );
}

// --- US-2: N/A marker → applicable=false, empty checks --------------------

{
    const cases = [
        ['## Visual Compliance Checks', '- N/A'],
        ['## UI Verification', 'N/A'],
        ['## Visual Checks', '- n/a'],
    ];
    for (const [heading, marker] of cases) {
        const r = parse(specWith(heading, marker));
        assert.deepStrictEqual(
            r,
            { applicable: false, checks: [] },
            `US-2: "${marker}" under "${heading}" → exact not-applicable object`
        );
    }
}

// Prose paragraphs and horizontal rules do NOT cancel the marker
{
    const body = [
        'Non-visual feature: no UI surface is introduced,',
        'so visual verification does not apply.',
        '',
        '---',
        '',
        '- N/A',
    ].join('\n');
    const r = parse(specWith('## UI Verification', body));
    assert.deepStrictEqual(r, { applicable: false, checks: [] }, 'US-2: prose and HR keep the marker');
}

// --- Negative cases: the marker grammar is strict --------------------------

// En dash (U+2013) / em dash (U+2014) instead of the ASCII hyphen:
// NOT a marker, and not a bullet either → normal parse, zero checks/hints.
{
    const enDash = parse(specWith('## Visual Compliance Checks', '– N/A'));
    assert.strictEqual(enDash.applicable, true, 'en-dash marker is not accepted');
    assert.strictEqual(enDash.checks.length, 0, 'en-dash line yields no checks, zero machine hints');

    const emDash = parse(specWith('## Visual Compliance Checks', '— N/A'));
    assert.strictEqual(emDash.applicable, true, 'em-dash marker is not accepted');
    assert.strictEqual(emDash.checks.length, 0, 'em-dash line yields no checks, zero machine hints');
}

// A fenced code block inside the section gives no machine hints
{
    const body = [
        '- [ ] Real check with data-testid="real-target"',
        '',
        '```js',
        '- [ ] Ghost check with data-testid="ghost-target"',
        '```',
    ].join('\n');
    const r = parse(specWith('## Visual Compliance Checks', body));
    assert.strictEqual(r.applicable, true, 'code block does not turn into an N/A case');
    assert.strictEqual(r.checks.length, 1, 'code-block lines are not parsed as checks');
    assert.ok(!r.checks.some((c) => c.description.includes('Ghost')), 'ghost item must not leak');
    assert.deepStrictEqual(
        r.checks[0].targets.map((t) => [t.kind, t.attr, t.value]),
        [['attr', 'data-testid', 'real-target']],
        'only the real item keeps its hint'
    );

    const onlyCode = parse(specWith('## Visual Compliance Checks', '```html\n<button data-testid="btn">Go</button>\n```'));
    assert.strictEqual(onlyCode.applicable, true, 'code-block-only section: zero hints, no marker → applicable');
    assert.strictEqual(onlyCode.checks.length, 0, 'code-block-only section: no checks');
}

// Section heading is H2 `##` only — `###` must not open a section
{
    const r = parse(specWith('### Visual Compliance Checks', '- [ ] item with data-testid="x"'));
    assert.strictEqual(r.applicable, true, 'H3 heading is not a section');
    assert.strictEqual(r.checks.length, 0, 'H3 heading must not yield checks');
}

// Another checklist line cancels the marker (only checklist lines do)
{
    const body = [
        '- N/A',
        '- Verify the logs manually in the admin panel',
    ].join('\n');
    const r = parse(specWith('## Visual Checks', body));
    assert.strictEqual(r.applicable, true, 'a second checklist line cancels the marker');
    assert.strictEqual(r.checks.length, 2, 'both lines parse as normal checks');
    assert.ok(r.checks.every((c) => c.targets.length === 0), 'zero machine hints, still applicable=true');
}

// Marker rule applies only when the normal parse gave zero machine hints
{
    const body = [
        '- N/A',
        '- Toolbar carries data-testid="toolbar"',
    ].join('\n');
    const r = parse(specWith('## UI Verification', body));
    assert.strictEqual(r.applicable, true, 'machine hints present → marker rule does not apply');
    assert.strictEqual(r.checks.length, 2, 'N/A line parses as a plain manual check here');
}

// --- rev4: url="…" navigation hint (GH #311, user decision 2026-10-09) -----
// A check line may carry a navigation hint token url="/absolute/path" in any
// position. It lands in a separate top-level `url` field of the check object,
// is NEVER a target, and by itself neither automates the check nor counts as
// a machine hint (selector hints only).

// Existing fixture lines carry no url tokens → no `url` key at all
assert.ok(
    checks.every((c) => !('url' in c)),
    'checks without a url hint must not carry a url field'
);

// 1) url + selector hint: both land on the check, selector stays the only target
{
    const body = '- [ ] Bookings table carries data-testid="bookings-table" url="/bookings"';
    const r = parse(specWith('## Visual Compliance Checks', body));
    assert.strictEqual(r.applicable, true, 'rev4: url-bearing section is applicable');
    assert.strictEqual(r.checks.length, 1);
    assert.strictEqual(r.checks[0].url, '/bookings', 'rev4: url hint lands in its own field');
    assert.deepStrictEqual(
        r.checks[0].targets.map((t) => [t.kind, t.attr, t.value]),
        [['attr', 'data-testid', 'bookings-table']],
        'rev4: url hint does not interfere with selector targets'
    );
}

// 2) url only: stays MANUAL_REVIEW (empty targets), url still extracted
{
    const r = parse(specWith('## UI Verification', '- [ ] Guest landing hero block url="/"'));
    assert.strictEqual(r.checks.length, 1);
    assert.strictEqual(r.checks[0].url, '/', 'rev4: root url extracted');
    assert.deepStrictEqual(r.checks[0].targets, [], 'rev4: url alone is NOT a machine hint');
}

// 3) value without a leading slash is softly ignored — no url field, and the
//    quoted value must not leak as a text target either
{
    const r = parse(specWith('## Visual Checks', '- [ ] Plain prose line url="bookings" without hints'));
    assert.strictEqual(r.checks.length, 1);
    assert.ok(!('url' in r.checks[0]), 'rev4: slash-less url token is silently dropped');
    assert.deepStrictEqual(r.checks[0].targets, [], 'rev4: dropped url value must not leak as text');
}

// 4) first occurrence wins when two url tokens are present
{
    const r = parse(specWith('## Visual Compliance Checks', '- [ ] Nav row url="/first" and url="/second" both appear'));
    assert.strictEqual(r.checks[0].url, '/first', 'rev4: first url token wins');
    assert.deepStrictEqual(r.checks[0].targets, [], 'rev4: second token value must not leak as text');
}

// Soft-ignore is per token (like other hints): an invalid token does not
// suppress a later valid one
{
    const r = parse(specWith('## UI Verification', '- [ ] Mixed url="no-slash" then url="/valid"'));
    assert.strictEqual(r.checks[0].url, '/valid', 'rev4: invalid token ignored, next valid wins');
}

// Synthetic: a url token never becomes a target of any kind
assert.deepStrictEqual(extractTargets('screen reachable via url="/bookings"'), []);

// --- CLI contract: serialize exactly { applicable, checks } ----------------

{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-parser-'));
    const specFile = path.join(dir, 'spec.md');
    const outFile = path.join(dir, 'checks.json');
    fs.writeFileSync(specFile, specWith('## UI Verification', '- N/A'));
    try {
        const stdout = execFileSync(
            process.execPath,
            [path.join(__dirname, 'visual-compliance-parser.js'), specFile, outFile],
            { encoding: 'utf8' }
        );
        const shape = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        assert.deepStrictEqual(shape, { applicable: false, checks: [] }, 'CLI writes exactly {applicable, checks}');
        assert.ok(/not applicable/i.test(stdout), 'CLI reports the N/A verdict');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

console.log('OK: visual-compliance-parser tests passed (13 §10 checks: 6 automatable, 7 manual; applicable/N/A contract green)');
