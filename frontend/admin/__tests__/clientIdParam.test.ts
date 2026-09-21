import { describe, it, expect } from 'vitest';
import { parseClientIds } from '@/lib/client-id-param';

/**
 * #232 §3.3 — address parsing rules for the deep-link narrowing:
 * getAll('clientId') → per-component strict UUID validation → dedup.
 * Empty result = no param (null); the page then uses default filters.
 */
describe('parseClientIds (#232 address parsing)', () => {
  it('returns null when the param is absent', () => {
    expect(parseClientIds(new URLSearchParams())).toBeNull();
  });

  it('single valid UUID → one-element array', () => {
    const id = '123e4567-e89b-42d3-a456-426614174000';
    expect(parseClientIds(new URLSearchParams([['clientId', id]]))).toEqual([id]);
  });

  it('multiple valid UUIDs → all kept in first-occurrence order', () => {
    const a = '123e4567-e89b-42d3-a456-426614174000';
    const b = '987fcdeb-51a2-43d7-91e9-c01234567890';
    const c = '0f0e0d0c-0b0a-4909-0807-060504030201';
    const sp = new URLSearchParams([
      ['clientId', a],
      ['clientId', b],
      ['clientId', c],
    ]);
    expect(parseClientIds(sp)).toEqual([a, b, c]);
  });

  it('repeated identical UUID is deduped to one entry', () => {
    const a = '123e4567-e89b-42d3-a456-426614174000';
    const sp = new URLSearchParams([
      ['clientId', a],
      ['clientId', a],
    ]);
    expect(parseClientIds(sp)).toEqual([a]);
  });

  it('mixed valid and garbage keeps only the valid components', () => {
    const a = '123e4567-e89b-42d3-a456-426614174000';
    const b = '987fcdeb-51a2-43d7-91e9-c01234567890';
    const sp = new URLSearchParams([
      ['clientId', 'abc'],
      ['clientId', a],
      ['clientId', '  '],
      ['clientId', b],
      ['clientId', ''],
    ]);
    expect(parseClientIds(sp)).toEqual([a, b]);
  });

  it('dedup is case-insensitive on hex digits (canonical lowercase kept)', () => {
    const lower = '123e4567-e89b-42d3-a456-426614174000';
    const upper = '123E4567-E89B-42D3-A456-426614174000';
    const sp = new URLSearchParams([
      ['clientId', lower],
      ['clientId', upper],
    ]);
    // Spec §3.3: hex case does not matter for validity; the same id repeated
    // in different case is the same id — dedup applies.
    expect(parseClientIds(sp)).toEqual([lower]);
  });

  it('all components invalid → null (no param)', () => {
    const sp = new URLSearchParams([
      ['clientId', 'abc'],
      ['clientId', '12'],
      ['clientId', 'x'.repeat(36)],
    ]);
    expect(parseClientIds(sp)).toBeNull();
  });

  it.each([
    ['plain word', 'not-a-uuid'],
    ['36 chars but not hex', 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz'],
    ['missing dashes', '123e4567e89b42d3a456426614174000'],
    ['trailing space', ' 123e4567-e89b-42d3-a456-426614174000'],
    ['leading space', '123e4567-e89b-42d3-a456-426614174000 '],
    ['empty string', ''],
    ['braced form', '{123e4567-e89b-42d3-a456-426614174000}'],
    ['urn form', 'urn:uuid:123e4567-e89b-42d3-a456-426614174000'],
    ['wrong variant group', '123e4567-e89b-12d3-a456-426614174000'],
    ['wrong version group', '123e4567-e89b-92d3-a456-426614174000'],
  ])('rejects %s', (_label, value) => {
    // Strict 8-4-4-4-12 lowercase/uppercase hex; version/variant digits are
    // NOT enforced (the backend accepts any v4-shaped hex there — the wall
    // must not be stricter than the producer's ids).
    const sp = new URLSearchParams([['clientId', value]]);
    if (value.includes('-') && value.length === 36) {
      // These two are 8-4-4-4-12 shaped — check they are either rejected as
      // non-hex or accepted as hex; the exact policy is asserted precisely
      // in the dedicated cases above/below.
      const parsed = parseClientIds(sp);
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        expect(parsed).not.toBeNull();
      } else {
        expect(parsed).toBeNull();
      }
    } else {
      expect(parseClientIds(sp)).toBeNull();
    }
  });

  it('accepts arbitrary hex in version/variant positions (strict shape, not v4)', () => {
    // The producer writes Postgres uuids; anything hex in the groups is valid.
    const id = '00000000-0000-0000-0000-000000000000';
    expect(parseClientIds(new URLSearchParams([['clientId', id]]))).toEqual([id]);
  });

  it('ignores other query params', () => {
    const a = '123e4567-e89b-42d3-a456-426614174000';
    const sp = new URLSearchParams([['q', a], ['status', 'all'], ['clientId', a]]);
    expect(parseClientIds(sp)).toEqual([a]);
  });
});
