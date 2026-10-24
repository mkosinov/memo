/**
 * client-auth-state.ts — storageState path derivation for the #513 web
 * client session (WEB port of the admin auth-state.ts donor, GH #247
 * T14).
 *
 * ONE expression consumed by BOTH:
 *   - `globalSetup.ts` (writes the file after the seeded client's OTP
 *     login: request code → read code from the test DB → verify →
 *     capture the `memo_client_session` cookie)
 *   - `playwright.config.ts` (project-level `use.storageState` default)
 *
 * Deviation from the donor: the scope is the RUN TAG (SHARD_RUN_TAG),
 * not SHARD_ID — the web project runs a single stack per tag, and
 * parallel web-e2e runs are isolated by tag-suffixed everything (ports,
 * DB, storageState). Standalone runs (no tag) share the 'standalone'
 * file — there is only one stack. The tag is validated by the shared
 * db-path resolver (malformed → loud error, never a silent path part).
 */
import path from 'path';
import { readShardRunTag } from '../lib/db-path';

export function clientAuthStatePath(): string {
  const scope = readShardRunTag() || 'standalone';
  return path.resolve(
    __dirname,
    `../../test-results/.auth/web-client-${scope}.json`,
  );
}
