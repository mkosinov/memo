/**
 * auth-state.ts — Shared storageState path derivation for the e2e auth
 * harness (GH #247 T14).
 *
 * ONE expression consumed by BOTH:
 *   - `globalSetup.ts` (writes the file after the seeded-admin login)
 *   - `playwright.config.ts` (project-level `use.storageState` default)
 *
 * The filename is SHARD-SCOPED: `scripts/test-all.sh` runs shards 1+2 in
 * PARALLEL with separate DBs/backends, and Playwright reads the storageState
 * file live at context creation — a single shared file would hand one
 * shard's foreign-DB token to the other shard and mass-401. Sessions live
 * in the per-shard DB, so the token must be issued against (and pinned to)
 * the same shard. Standalone runs (no SHARD_ID) share the `standalone`
 * file — there is only one stack.
 *
 * Call AT USE TIME, never at module load: SHARD_ID is set by the shard
 * script / test runner and the config + globalSetup may be evaluated in
 * different processes (both inherit the shard env — same mechanism the
 * config's webServer conditional relies on).
 */
import path from 'path';

export function resolveAuthStatePath(): string {
  const shardId = process.env.SHARD_ID ?? 'standalone';
  return path.resolve(
    __dirname,
    `../../../test-results/.auth/admin-${shardId}.json`,
  );
}
