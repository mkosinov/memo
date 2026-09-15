import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// #262 §5.4 — pre-hydration bootstrap. The root layout must carry an inline
// <script> in <head> that reads localStorage["memo-theme"] and sets
// document.documentElement.dataset.theme BEFORE React hydrates, so a dark-theme
// reload shows no light flash. Asserting the source string keeps this a pure
// unit check (no server-render of the whole Providers tree).
const layoutSource = readFileSync(
  join(__dirname, '..', 'app', 'layout.tsx'),
  'utf-8',
);

describe('app/layout.tsx theme bootstrap (#262 §5.4)', () => {
  it('contains an inline dangerouslySetInnerHTML script', () => {
    expect(layoutSource).toContain('dangerouslySetInnerHTML');
    expect(layoutSource).toMatch(/<script/);
  });

  it('places the bootstrap script inside <head>', () => {
    const headOpen = layoutSource.indexOf('<head>');
    const headClose = layoutSource.indexOf('</head>');
    const scriptPos = layoutSource.indexOf('dangerouslySetInnerHTML');
    expect(headOpen).toBeGreaterThan(-1);
    expect(headClose).toBeGreaterThan(headOpen);
    expect(scriptPos).toBeGreaterThan(headOpen);
    expect(scriptPos).toBeLessThan(headClose);
  });

  it('reads the same localStorage key "memo-theme"', () => {
    expect(layoutSource).toContain('memo-theme');
  });

  it('sets data-theme from localStorage in the script source', () => {
    expect(layoutSource).toMatch(/documentElement\.(dataset\.theme|setAttribute\(\s*['"]data-theme['"])/);
    expect(layoutSource).toMatch(/localStorage/);
  });
});
