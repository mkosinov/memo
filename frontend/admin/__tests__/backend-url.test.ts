/**
 * backend-url.test.ts — Unit tests for the backend base-URL guard (GH #387).
 *
 * Contract (postmortem #387/#463 — loud error over silent default):
 *   - BACKEND_URL or NEXT_PUBLIC_API_URL unset/empty → throw carrying the
 *     canonical standalone recipe (no silent default port to piggyback a
 *     foreign stack on);
 *   - the two HOSTS differ (localhost vs 127.0.0.1 counts) → throw
 *     (SameSite=Lax cookie is issued for the backend host and would be
 *     dropped on cross-site API calls);
 *   - same host, any ports → resolve quietly to BACKEND_URL;
 *   - a non-URL value → loud error, not a silent wrong request target.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { resolveBackendUrl } from '../e2e/lib/backend-url';

describe('resolveBackendUrl (GH #387 single contract)', () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    delete process.env.BACKEND_URL;
    delete process.env.NEXT_PUBLIC_API_URL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('throws when BACKEND_URL is unset — error names the var and carries the recipe', () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://127.0.0.1:8000';
    let message = '';
    try {
      resolveBackendUrl();
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('BACKEND_URL');
    expect(message).toContain('playwright test');
  });

  it('throws when NEXT_PUBLIC_API_URL is unset (bundle pin is part of the invocation)', () => {
    process.env.BACKEND_URL = 'http://127.0.0.1:8000';
    expect(() => resolveBackendUrl()).toThrowError(/NEXT_PUBLIC_API_URL/);
  });

  it('empty-string values count as unset', () => {
    process.env.BACKEND_URL = '';
    process.env.NEXT_PUBLIC_API_URL = '';
    expect(() => resolveBackendUrl()).toThrowError(/BACKEND_URL/);
  });

  it('throws when hosts differ — localhost vs 127.0.0.1 is a cookie-split', () => {
    process.env.BACKEND_URL = 'http://127.0.0.1:8000';
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:8000';
    expect(() => resolveBackendUrl()).toThrowError(/SameSite/);
  });

  it('same host, different ports → resolves (ports are exempt from the site definition)', () => {
    process.env.BACKEND_URL = 'http://127.0.0.1:8021';
    process.env.NEXT_PUBLIC_API_URL = 'http://127.0.0.1:8021';
    expect(resolveBackendUrl()).toBe('http://127.0.0.1:8021');
  });

  it('a non-URL value → loud error, never a silent wrong request target', () => {
    process.env.BACKEND_URL = '127.0.0.1:8000';
    process.env.NEXT_PUBLIC_API_URL = 'http://127.0.0.1:8000';
    expect(() => resolveBackendUrl()).toThrowError(/not a valid absolute URL/);
  });
});
