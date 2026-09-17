/**
 * master-session.ts — GH #263 T8: opt-in helper for master-role e2e specs
 * (S1–S6, S8; the specs themselves land in T9/T10).
 *
 * Swaps the project-level default (admin storageState, GH #247 T14) for the
 * SHARD-SCOPED master session file that globalSetup creates after logging
 * the seeded demo master in (#247 §3.11: +79990000002/master12345).
 *
 * MUST be called at spec-file / describe scope — it wraps `test.use`,
 * which is only legal before any test runs:
 *
 *   import { useMasterSession } from './fixtures/master-session';
 *   useMasterSession();
 *
 * Admin projects and login-flow specs (#247) are unaffected: they keep the
 * project default or their explicit empty storageState override.
 */
import { test } from './test';
import { masterAuthStatePath } from './auth-state';

export function useMasterSession(): void {
  test.use({ storageState: masterAuthStatePath() });
}
