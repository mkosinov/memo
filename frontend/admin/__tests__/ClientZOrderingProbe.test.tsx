import { describe, expect, it } from 'vitest';

describe('ClientZOrderingProbe (CI shard probe, #245)', () => {
  it('runs in some shard', () => {
    expect(1 + 1).toBe(2);
  });
});
