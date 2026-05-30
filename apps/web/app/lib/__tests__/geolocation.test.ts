import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCurrentPosition } from '../geolocation';

describe('geolocation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getCurrentPosition (stub)', () => {
    it('returns null as stub implementation', async () => {
      const result = await getCurrentPosition();
      expect(result).toBeNull();
    });

    it('returns a Promise', () => {
      const result = getCurrentPosition();
      expect(result).toBeInstanceOf(Promise);
    });
  });
});
