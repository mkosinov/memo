import { describe, it, expect } from 'vitest';
import { markForcedNavigation, isForcedNavigation } from '@/lib/forcedNavigation';

describe('#397 §5.3 forcedNavigation flag', () => {
  it('is cleared by default', () => {
    expect(isForcedNavigation()).toBe(false);
  });

  it('reads back true after markForcedNavigation()', () => {
    markForcedNavigation();
    expect(isForcedNavigation()).toBe(true);
  });
});
