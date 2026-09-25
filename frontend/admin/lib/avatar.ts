/**
 * Avatar URL derivation for next/image (GH #301 T3).
 *
 * The backend serves card portraits under a RELATIVE path
 * (`/api/v1/files/avatar/…`, GH #262 public static mount), while the app and
 * the API live on separate ports/hosts with no Next rewrite. The next/image
 * optimizer therefore cannot resolve a relative src — it fetches it from the
 * app origin and 404s. `toAvatarSrc` absolutizes relative avatar paths
 * against the SAME base derivation the shared api-client uses
 * (`NEXT_PUBLIC_API_URL`, else `http://<window host>:8000`), so both the
 * browser and the server-side optimizer reach the backend. Already-absolute
 * URLs (free-form admin-entered «Аватар URL» hosts, data:/protocol-relative
 * schemes) pass through unchanged.
 */

/** True for anything that is already its own origin: `scheme:…` or `//host`.
 * A leading `/` alone (site-relative path) is NOT absolute. */
function isAbsoluteUrl(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//');
}

/** The API base — mirrors `API_BASE` in packages/api-client/src/client.ts. */
function apiBase(): string {
  return (
    process.env.NEXT_PUBLIC_API_URL ||
    (typeof window !== 'undefined'
      ? `http://${window.location.hostname}:8000`
      : 'http://localhost:8000')
  );
}

/** Absolutize a served avatar path for next/image; absolute srcs pass through. */
export function toAvatarSrc(url: string): string {
  if (isAbsoluteUrl(url)) return url;
  return `${apiBase().replace(/\/+$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
}
