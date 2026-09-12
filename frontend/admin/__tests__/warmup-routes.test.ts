// @vitest-environment node
//
// This suite parses the shell script's WARMUP_ROUTES array (Node fs) and
// compares it against the TS WARMUP_ROUTES export, so editing either list
// without the other causes a real, detectable test failure.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { WARMUP_ROUTES } from '../e2e/fixtures/warmup-routes';

const SHELL_SCRIPT_PATH = path.resolve(__dirname, '../../../scripts/e2e-shard-start.sh');

function parseShellWarmupRoutes(): string[] {
  const content = fs.readFileSync(SHELL_SCRIPT_PATH, 'utf-8');
  const blockMatch = content.match(/WARMUP_ROUTES=\(([\s\S]*?)\)/);
  if (!blockMatch) {
    throw new Error(`Could not find WARMUP_ROUTES=( ... ) block in ${SHELL_SCRIPT_PATH}`);
  }
  const block = blockMatch[1];
  const routes: string[] = [];
  const routeRegex = /"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = routeRegex.exec(block)) !== null) {
    routes.push(match[1]);
  }
  return routes;
}

describe('WARMUP_ROUTES', () => {
  it('matches the WARMUP_ROUTES array parsed from scripts/e2e-shard-start.sh (same routes, same order)', () => {
    const shellRoutes = parseShellWarmupRoutes();
    expect(shellRoutes).toEqual([...WARMUP_ROUTES]);
  });

  it('has exactly 10 routes, all starting with "/"', () => {
    expect(WARMUP_ROUTES).toHaveLength(10);
    for (const route of WARMUP_ROUTES) {
      expect(route.startsWith('/')).toBe(true);
    }
  });
});
