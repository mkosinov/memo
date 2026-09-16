/**
 * admin-context.ts — GH #263 T10: an ADMIN-scoped APIRequestContext for
 * master-role scenario specs.
 *
 * `useMasterSession()` swaps the whole context's storageState to the master
 * session, so the `request` fixture authenticates as the seed master
 * (m1). Foreign fixtures (чужой мастер + его активности/записи/оплаты/фото)
 * must be created as ADMIN — the master token matrix has no staff:write /
 * activities:write grants (spec D7), and foreign record/payment/photo
 * factories are scoped writes too.
 *
 * Playwright's per-test `request` fixture is BROWSER-BOUND and has no
 * `.newContext()` — the standalone module-level `request` from
 * '@playwright/test' does (same idiom as cabinet.spec.ts's anonymous
 * context). The helper opens such a context with the project-level ADMIN
 * storageState file that globalSetup logged in (#247 T14). Same-shard
 * file: the session lives in the shard's DB, so admin- and master-scoped
 * factories always hit the same backend state.
 *
 * Usage (spec scope, master session active):
 *   const admin = await adminApiContext();
 *   const foreignMaster = await createTestMaster(admin);
 *   …
 *   await admin.dispose();                    // test finally
 */
import { request as standaloneRequest, type APIRequestContext } from '@playwright/test';
import { resolveAuthStatePath } from './auth-state';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8001';

export async function adminApiContext(): Promise<APIRequestContext> {
  return standaloneRequest.newContext({
    baseURL: BACKEND,
    storageState: resolveAuthStatePath(),
    extraHTTPHeaders: { Origin: BACKEND, 'Sec-Fetch-Site': 'same-origin' },
  });
}
