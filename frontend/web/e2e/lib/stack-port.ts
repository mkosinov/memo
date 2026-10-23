/**
 * stack-port.ts — the web dev-server port for a web-e2e run.
 *
 * WEB_PORT is exported by the web-e2e stack (scripts/e2e-stack.sh /
 * scripts/test-e2e.sh) from the dynamic 28000-32700 window
 * (dev-workflow port canon). The standalone fallback (3007) is chosen
 * OFF every reserved range: 3002-3005 (admin shards), 3006/8005 (the
 * enabled notify e2e pair), 3100/3101 (playground — NEVER touch), and
 * legacy 3000/8000 (#499 dev pair) — the admin standalone lesson
 * (default :3002 silently reused a live shard's server, GH #387).
 *
 * The host is ALWAYS 127.0.0.1: the `memo_client_session` cookie is
 * SameSite=Lax, so the page origin and the API origin must share the
 * host (localhost ≠ 127.0.0.1 — the admin config's GH #247 T14 note).
 */
export const WEB_PORT_DEFAULT = '3007';

export function resolveWebPort(): string {
  return process.env.WEB_PORT || WEB_PORT_DEFAULT;
}
