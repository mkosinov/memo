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
});
