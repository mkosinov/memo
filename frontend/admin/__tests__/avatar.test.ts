import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toAvatarSrc } from '../lib/avatar';

/**
 * GH #301 T3 (Blocker 1+2 fix): avatars must flow through the next/image
 * optimizer (spec §4.3 — a 5 MB portrait must arrive compressed at a 28–64 px
 * cell). The backend serves RELATIVE URLs (`/api/v1/files/avatar/…`), so the
 * helper absolutizes them against the SAME API base derivation the shared
 * api-client uses (NEXT_PUBLIC_API_URL, else http://<window host>:8000).
 * Already-absolute URLs (admin-entered external hosts) pass through as-is.
 */

describe('toAvatarSrc', () => {
  const ORIG_ENV = process.env.NEXT_PUBLIC_API_URL;

  afterEach(() => {
    process.env.NEXT_PUBLIC_API_URL = ORIG_ENV;
    vi.unstubAllGlobals();
  });

  it('prefixes a relative served avatar path with the env-derived API base', () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://127.0.0.1:8010';
    expect(toAvatarSrc('/api/v1/files/avatar/x.png')).toBe(
      'http://127.0.0.1:8010/api/v1/files/avatar/x.png',
    );
  });

  it('falls back to the window-hostname derivation when the env is unset (browser)', () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    vi.stubGlobal('window', { location: { hostname: 'studio.example.com' } });
    expect(toAvatarSrc('/api/v1/files/avatar/x.png')).toBe(
      'http://studio.example.com:8000/api/v1/files/avatar/x.png',
    );
  });

  it('falls back to localhost:8000 outside the browser when the env is unset', () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    vi.stubGlobal('window', undefined);
    expect(toAvatarSrc('/api/v1/files/avatar/x.png')).toBe(
      'http://localhost:8000/api/v1/files/avatar/x.png',
    );
  });

  it('passes an already-absolute URL through unchanged (admin-entered host)', () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://127.0.0.1:8010';
    expect(toAvatarSrc('https://cdn.example.com/a.jpg')).toBe(
      'https://cdn.example.com/a.jpg',
    );
    // Same host, different scheme/port — still untouched.
    expect(toAvatarSrc('http://127.0.0.1:9999/api/v1/files/avatar/y.png')).toBe(
      'http://127.0.0.1:9999/api/v1/files/avatar/y.png',
    );
  });

  it('tolerates protocol-relative and other schemes as absolute', () => {
    expect(toAvatarSrc('//cdn.example.com/a.webp')).toBe('//cdn.example.com/a.webp');
    expect(toAvatarSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });

  it('preserves a bare slash-prefixed path only by absolutizing, never double-prefixing', () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://127.0.0.1:8010/';
    expect(toAvatarSrc('/api/v1/files/avatar/z.png')).toBe(
      'http://127.0.0.1:8010/api/v1/files/avatar/z.png',
    );
  });
});
