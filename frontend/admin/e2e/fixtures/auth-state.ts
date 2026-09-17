/**
 * auth-state.ts — Shared storageState path derivation for the e2e auth
 * harness (GH #247 T14, master session GH #263 T8).
 *
 * ONE expression consumed by BOTH:
 *   - `globalSetup.ts` (writes the files after the seeded logins)
 *   - `playwright.config.ts` (project-level `use.storageState` default)
 *   - `fixtures/master-session.ts` (opt-in master override for S-specs)
 *
 * The filename is SHARD-SCOPED: `scripts/test-all.sh` runs shards 1+2 in
 * PARALLEL with separate DBs/backends, and Playwright reads the storageState
 * file live at context creation — a single shared file would hand one
 * shard's foreign-DB token to the other shard and mass-401. Sessions live
 * in the per-shard DB, so the token must be issued against (and pinned to)
 * the same shard. Standalone runs (no SHARD_ID) share the `standalone`
 * file — there is only one stack.
 *
 * GH #263 T8: a SECOND file holds the seeded demo master's session
 * (`masterAuthStatePath()`) — globalSetup logs the master in alongside the
 * admin, and master-role specs opt in via `useMasterSession()`
 * (fixtures/master-session.ts). Separate files keep the two roles from
 * ever sharing a cookie, and master specs never touch the admin token.
 *
 * Call-time vs module-load: both usages are supported. `globalSetup.ts`
 * calls it inside its function (SHARD_ID is set by the time the run
 * starts); `playwright.config.ts` calls it at module scope — fine, because
 * the config is loaded by the playwright process AFTER the shard script
 * exported its env (same mechanism the config's existing SHARD_PORT /
 * webServer conditional relies on). Either way the value resolves to the
 * caller's own process env, so the two consumers always agree.
 */
import path from 'path';

function shardScopedAuthStatePath(filePrefix: string): string {
  const shardId = process.env.SHARD_ID ?? 'standalone';
  return path.resolve(
    __dirname,
    `../../../test-results/.auth/${filePrefix}-${shardId}.json`,
  );
}

export function resolveAuthStatePath(): string {
  return shardScopedAuthStatePath('admin');
}

/**
 * GH #263 T8: path of the MASTER storageState file — the shard-scoped
 * sibling of the admin file. `globalSetup.ts` writes it after logging the
 * seeded demo master in (#247 §3.11); `useMasterSession()` points the
 * Playwright `storageState` at it.
 */
export function masterAuthStatePath(): string {
  return shardScopedAuthStatePath('master');
}
