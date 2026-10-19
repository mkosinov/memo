/**
 * e2e-report-summary.test.ts — Unit tests for the CI flake gate (GH #415, spec §3.5).
 *
 * Contract (docs/specs/2026-10-13-e2e-ci-native-shards-415-design.md §3.5):
 *   - a test is FLAKY when its TEST-level status is "flaky" — Playwright 1.60
 *     marks failed-then-passed-with-retry tests this way (JsonReporter emits
 *     `tests[].status = test.outcome()` ∈ expected/unexpected/flaky/skipped);
 *     result-level statuses (passed/failed/timedOut/interrupted/skipped/
 *     didNotRun) never carry "flaky", but the detection scans them too as
 *     belt-and-braces ("ANY of its results has status flaky");
 *   - ≥1 flaky → exit 1 + FLAKY lines `FLAKY: <suite> — <title>`;
 *   - zero flakes → "Flaky: 0", exit 0;
 *   - missing file / broken JSON / unknown statuses (interrupted, didNotRun,
 *     skipped, timedOut) → exactly ONE warning line, exit 0 (false red is
 *     never allowed — flake absence must not depend on these cases);
 *   - GITHUB_STEP_SUMMARY markdown: table row per flaky + итог "Flaky: N"
 *     ("Flaky: 0" when the list is empty).
 *
 * Fixture is a slice of the REAL Playwright JSON reporter shape, verified
 * against playwright@1.60 lib/runner/index.js (_serializeTestSpec /
 * _serializeTest / _serializeTestResult) and the live
 * frontend/admin/results.json from the Task 1 smoke run (nested describes,
 * specs both on file suites and describe suites, empty results[] for
 * listed-but-never-run tests).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  summarize,
  summarizeFile,
  buildMarkdownSummary,
} from '../../../scripts/e2e-report-summary.mjs';

// --- fixture: slice of the real Playwright JSON reporter shape ------------

/** Result-level object (JsonReporter._serializeTestResult, minimal fields). */
const result = (status: string, retry = 0) => ({
  workerIndex: 0,
  parallelIndex: 0,
  status,
  duration: 123,
  errors: [] as unknown[],
  stdout: [] as unknown[],
  stderr: [] as unknown[],
  retry,
  startTime: '2026-10-19T20:43:43.209Z',
  annotations: [] as unknown[],
});

/** Test-level object (JsonReporter._serializeTest). */
const test = (status: string, results: ReturnType<typeof result>[]) => ({
  timeout: 60_000,
  annotations: [] as unknown[],
  expectedStatus: 'passed',
  projectId: 'e2e',
  projectName: 'e2e',
  results,
  status,
});

/** Spec-level object (JsonReporter._serializeTestSpec). */
const spec = (title: string, ok: boolean, t: ReturnType<typeof test>) => ({
  title,
  ok,
  tags: [] as string[],
  tests: [t],
  id: 'spec-id',
  file: 'fixture.spec.ts',
  line: 1,
  column: 1,
});

const report = (...suites: object[]) => ({
  config: {},
  errors: [] as unknown[],
  stats: { expected: 0, skipped: 0, unexpected: 0, flaky: 0 },
  suites,
});

/** One report covering every outcome at once: passed / flaky / failed /
 *  interrupted (result-level, test-level outcome "skipped" — as outcome()
 *  computes for a lone interrupted result) / listed-but-never-run. */
const fullReport = report(
  {
    title: 'schedule-dnd.spec.ts',
    file: 'schedule-dnd.spec.ts',
    column: 0,
    line: 0,
    specs: [spec('plain passed spec', true, test('expected', [result('passed')]))],
    suites: [
      {
        title: '#120 DnD — базовые сценарии',
        specs: [
          // flaky = failed on attempt 0, passed on retry 1
          spec('drag activity → time updated', true, test('flaky', [result('failed'), result('passed', 1)])),
          spec('passed inside describe', true, test('expected', [result('passed')])),
        ],
      },
    ],
  },
  {
    title: 'payments.spec.ts',
    file: 'payments.spec.ts',
    column: 0,
    line: 0,
    specs: [
      spec('failed payment flow', false, test('unexpected', [result('failed')])),
      spec('interrupted mid-run', true, test('skipped', [result('interrupted')])),
      spec('listed but never ran', true, test('skipped', [])),
    ],
  },
);

const warningLines = (lines: string[]) =>
  lines.filter((l) => l.startsWith('ПРЕДУПРЕЖДЕНИЕ'));

// --- summarize: status contract ---------------------------------------------

describe('summarize(results) — контракт статусов (GH #415 §3.5)', () => {
  it('green run (passed only): flaky list empty, exit 0, exactly one line "Flaky: 0", no warning', () => {
    const green = report(
      {
        title: 'green.spec.ts',
        specs: [spec('top-level passed', true, test('expected', [result('passed')]))],
        suites: [
          { title: 'describe', specs: [spec('nested passed', true, test('expected', [result('passed')]))] },
        ],
      },
    );

    const summary = summarize(green);

    expect(summary.flaky).toEqual([]);
    expect(summary.exitCode).toBe(0);
    expect(summary.lines).toEqual(['Flaky: 0']);
  });

  it('flaky present: exactly one flaky entry with FILE-level suite + spec title, exit 1, FLAKY line formed precisely', () => {
    const summary = summarize(fullReport);

    // passed / failed / interrupted / never-ran specs are NOT flagged —
    // only the single flaky test, reported under its file suite even though
    // the spec sits inside a describe block.
    expect(summary.flaky).toEqual([
      { suite: 'schedule-dnd.spec.ts', title: 'drag activity → time updated' },
    ]);
    expect(summary.exitCode).toBe(1);
    expect(summary.lines).toContain('FLAKY: schedule-dnd.spec.ts — drag activity → time updated');
    expect(summary.lines).toContain('Flaky: 1');
    // "flaky" is a KNOWN status — must not trigger the unknown-status warning
    // (isolate the flaky+passed suite: fullReport also carries interrupted /
    // never-ran specs, which DO warn by contract)
    const flakyOnly = summarize(report(fullReport.suites[0]));
    expect(warningLines(flakyOnly.lines)).toEqual([]);
  });

  it('failed present but no flaky: exit 0, no FLAKY lines, "Flaky: 0" (failed is a known status — no warning)', () => {
    const failedOnly = report({
      title: 'payments.spec.ts',
      specs: [spec('failed payment flow', false, test('unexpected', [result('failed')]))],
    });

    const summary = summarize(failedOnly);

    expect(summary.flaky).toEqual([]);
    expect(summary.exitCode).toBe(0);
    expect(summary.lines).toEqual(['Flaky: 0']);
  });

  it('unknown statuses (interrupted result, skipped never-ran tests): exactly ONE warning line, exit 0', () => {
    const summary = summarize(fullReport);
    // fullReport has a flaky test; strip it to isolate the unknown-status branch
    const noFlaky = report(
      {
        title: 'payments.spec.ts',
        specs: [
          spec('interrupted mid-run', true, test('skipped', [result('interrupted')])),
          spec('listed but never ran', true, test('skipped', [])),
        ],
      },
    );
    const summaryNoFlaky = summarize(noFlaky);

    for (const s of [summary, summaryNoFlaky]) {
      const warnings = warningLines(s.lines);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('interrupted');
      expect(warnings[0]).toContain('skipped');
    }
    expect(summaryNoFlaky.exitCode).toBe(0);
    expect(summaryNoFlaky.flaky).toEqual([]);
    expect(summaryNoFlaky.lines).toContain('Flaky: 0');
    expect(summaryNoFlaky.lines.every((l) => !l.startsWith('FLAKY:'))).toBe(true);
  });

  it('timedOut / didNotRun result statuses also land in the single warning line, not the flaky list', () => {
    const weird = report({
      title: 'weird.spec.ts',
      specs: [
        spec('timed out test', false, test('unexpected', [result('timedOut')])),
        spec('did not run test', true, test('skipped', [result('didNotRun')])),
      ],
    });

    const summary = summarize(weird);

    expect(summary.flaky).toEqual([]);
    expect(summary.exitCode).toBe(0);
    expect(warningLines(summary.lines)).toHaveLength(1);
    expect(warningLines(summary.lines)[0]).toContain('timedOut');
    expect(warningLines(summary.lines)[0]).toContain('didNotRun');
  });

  it('belt-and-braces: a result carrying status "flaky" is detected even with a non-flaky test-level status', () => {
    const hypothetical = report({
      title: 'future.spec.ts',
      specs: [spec('result-level flaky', true, test('expected', [result('passed'), result('flaky', 1)]))],
    });

    const summary = summarize(hypothetical);

    expect(summary.flaky).toEqual([{ suite: 'future.spec.ts', title: 'result-level flaky' }]);
    expect(summary.exitCode).toBe(1);
    // still a known status — no unknown-status warning
    expect(warningLines(summary.lines)).toEqual([]);
  });

  it('defensive: report without suites / null suites behaves as zero flakes, exit 0', () => {
    const empty = summarize({ config: {}, errors: [], stats: {} });
    expect(empty.flaky).toEqual([]);
    expect(empty.exitCode).toBe(0);
    expect(empty.lines).toEqual(['Flaky: 0']);
  });
});

// --- summarizeFile: file branches -------------------------------------------

describe('summarizeFile(path) — файловые ветки', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'e2e-report-summary-'));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('missing file: one warning line, exit 0, no flakes', () => {
    const summary = summarizeFile(path.join(tmpDir, 'no-such-results.json'));

    expect(summary.flaky).toEqual([]);
    expect(summary.exitCode).toBe(0);
    expect(warningLines(summary.lines)).toHaveLength(1);
    expect(summary.lines).toContain('Flaky: 0');
  });

  it('broken JSON: one warning line, exit 0, no flakes', () => {
    const broken = path.join(tmpDir, 'broken.json');
    writeFileSync(broken, '{ "suites": [ oops', 'utf8');

    const summary = summarizeFile(broken);

    expect(summary.flaky).toEqual([]);
    expect(summary.exitCode).toBe(0);
    expect(warningLines(summary.lines)).toHaveLength(1);
    expect(summary.lines).toContain('Flaky: 0');
  });

  it('valid file delegates to summarize (flaky present → exit 1)', () => {
    const valid = path.join(tmpDir, 'valid.json');
    writeFileSync(valid, JSON.stringify(fullReport), 'utf8');

    const summary = summarizeFile(valid);

    expect(summary.flaky).toHaveLength(1);
    expect(summary.exitCode).toBe(1);
  });
});

// --- buildMarkdownSummary: GITHUB_STEP_SUMMARY content ----------------------

describe('buildMarkdownSummary(flaky, warning) — Markdown для Step Summary', () => {
  it('empty flaky list: states "Flaky: 0" and renders no table', () => {
    const md = buildMarkdownSummary([], null);

    expect(md).toContain('Flaky: 0');
    expect(md).not.toContain('|');
  });

  it('flaky list: one table row per flaky + итог "Flaky: N"; warning quoted when present', () => {
    const md = buildMarkdownSummary(
      [{ suite: 'schedule-dnd.spec.ts', title: 'drag activity → time updated' }],
      'ПРЕДУПРЕЖДЕНИЕ: незнакомые статусы тестов в отчёте (interrupted ×1)',
    );

    expect(md).toContain('| schedule-dnd.spec.ts | drag activity → time updated |');
    expect(md).toContain('Flaky: 1');
    expect(md).toContain('interrupted');
  });

  it('escapes pipe characters so table rows cannot break', () => {
    const md = buildMarkdownSummary([{ suite: 'a|b.spec.ts', title: 'x | y' }], null);

    expect(md).not.toMatch(/\| a\|b/);
    expect(md).toContain('a\\|b.spec.ts');
  });
});
