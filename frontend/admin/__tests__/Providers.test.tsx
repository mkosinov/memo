import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Providers architecture (SSR fix)', () => {
  const appDir = path.resolve(process.cwd(), 'app');

  it('providers.tsx should exist and have "use client" directive', () => {
    const filePath = path.join(appDir, 'providers.tsx');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain("'use client'");
  });

  it('layout.tsx should not directly import QueryClient or QueryClientProvider', () => {
    const filePath = path.join(appDir, 'layout.tsx');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).not.toContain('QueryClient');
    expect(content).not.toContain('QueryClientProvider');
  });

  it('layout.tsx should import Providers from ./providers', () => {
    const filePath = path.join(appDir, 'layout.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain("import { Providers } from './providers'");
  });

  it('layout.tsx should wrap children in <Providers>', () => {
    const filePath = path.join(appDir, 'layout.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toMatch(/<Providers>/);
    expect(content).toMatch(/<\/Providers>/);
  });

  it('providers.tsx mounts PendingActionsProvider inside QueryClient + UIProvider, above UserSettingsProvider', () => {
    const filePath = path.join(appDir, 'providers.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');

    // Import the provider from the contexts module.
    expect(content).toMatch(
      /import\s*\{[^}]*\bPendingActionsProvider\b[^}]*\}\s*from\s*['"]\.\.\/contexts\/PendingActionsContext['"]/,
    );

    // Capture the body of the `Providers` function's `return` statement.
    // The return body is everything from the first `<` after `return (` up to
    // the matching `);` at the function scope — easiest with the literal
    // closing pattern: `</ErrorBoundary>` (the outermost wrapper).
    const returnMatch = content.match(/return\s*\(([\s\S]*?)<\/ErrorBoundary>\s*\)/);
    expect(
      returnMatch,
      'Could not find the Providers return body in providers.tsx',
    ).not.toBeNull();
    const body = returnMatch![1];

    // Required provider order (outermost inwards):
    //   ErrorBoundary > UIProvider > QueryClientWithErrorReporting
    //   > PendingActionsProvider > UserSettingsProvider > {children}
    // (GH #140 — ClientsProvider unmounted from the global tree; the /clients
    // page mounts it locally.)
    const order = [
      'ErrorBoundary',
      'UIProvider',
      'QueryClientWithErrorReporting',
      'PendingActionsProvider',
      'UserSettingsProvider',
    ];
    let lastIndex = -1;
    for (const tag of order) {
      const openIdx = body.indexOf(`<${tag}`);
      expect(openIdx, `Expected <${tag}> in provider tree`).toBeGreaterThan(lastIndex);
      lastIndex = openIdx;
    }
  });
});
