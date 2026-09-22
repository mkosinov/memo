/**
 * #232 §3.3 — deep-link narrowing param parsing.
 *
 * `/clients?clientId=<uuid>&clientId=<uuid>…` narrows the table by an exact
 * set of client ids. Parsing contract (spec §3.3):
 *  - all values of the param are read (`getAll`);
 *  - each component is validated as a STRICT UUID shape (8-4-4-4-12 hex,
 *    case-insensitive; version/variant digits are not constrained — Postgres
 *    uuids from the producer may hold any hex there);
 *  - invalid components are dropped silently (garbage, spaces, empty);
 *  - repeats dedup (case-insensitive: hex case does not matter);
 *  - nothing valid left → null = "no param": default filters, full table.
 *
 * The URL is the single writer of the narrowing — this function never
 * touches the address, it only reads.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const CLIENT_ID_PARAM = 'clientId';

/**
 * Reads every `clientId` component, validates and dedups them.
 * Returns the canonical (lowercased) ids in first-occurrence order, or
 * `null` when the param carries no valid UUID at all.
 */
export function parseClientIds(searchParams: URLSearchParams): string[] | null {
  const raw = searchParams.getAll(CLIENT_ID_PARAM);
  const seen = new Set<string>();
  for (const value of raw) {
    const canonical = value.toLowerCase();
    if (UUID_RE.test(canonical)) seen.add(canonical);
  }
  return seen.size > 0 ? Array.from(seen) : null;
}

/**
 * #232 §3.5 — narrowing-removal href: a pathname-ready URL with EVERY
 * occurrence of `clientId` dropped and all other query params preserved.
 * Used by the chip ✕ and the reset path (`resetFilters` responsibility):
 * both navigate via `router.replace(url, { scroll: false })` and let the
 * Task 4 sync effect converge the `clientIds` filter — no `setFilters` in
 * the click handlers (the address stays the single writer).
 */
export function buildUrlWithoutClientId(searchParams: URLSearchParams, pathname: string): string {
  const next = new URLSearchParams(searchParams);
  next.delete(CLIENT_ID_PARAM);
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
