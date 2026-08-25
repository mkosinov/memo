#!/usr/bin/env node
/**
 * Unit + fixture test for visual-compliance-parser.js.
 *
 * Run from repo root:  node scripts/test-visual-compliance-parser.js
 * It asserts the parser against the real datatable spec §10 (13 checkboxes)
 * and against synthetic lines covering the hint-extraction rules.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { parse, extractTargets } = require(path.join(__dirname, 'visual-compliance-parser.js'));

const SPEC = fs.readFileSync(
    path.join(__dirname, '..', 'docs/specs', '2026-08-18-generic-datatable-design.md'),
    'utf8'
);

// --- Fixture assertions: the 13 §10 checkboxes ---------------------------

const checks = parse(SPEC);
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

// No section → empty list, no crash
assert.strictEqual(parse('# No checks here\n- [ ] whatever\n').length, 0);

console.log('OK: visual-compliance-parser tests passed (13 §10 checks: 6 automatable, 7 manual)');