// GH #301 T3: next/image avatar optimization (spec §4.3). The backend serves
// card portraits at /api/v1/files/avatar/… from a separate host/port, so the
// optimizer needs remotePatterns. The host derivation mirrors the shared
// api-client (packages/api-client/src/client.ts): NEXT_PUBLIC_API_URL wins;
// without it the client falls back to http://<window host>:8000, which is not
// enumerable server-side — localhost/127.0.0.1:8000 are pre-allowed for dev,
// and a production deploy MUST set NEXT_PUBLIC_API_URL (Next loads .env*
// before evaluating this config, so .env.local works too).
//
// `sharp` is intentionally NOT added: Next 14 bundles a squoosh fallback
// (image-optimizer.js falls back with a one-time warning, not an error) —
// verified live: the dev optimizer on :3010 returns 200 with real decoded
// pixels for a remote-pattern avatar URL. Revisit only if a future Next
// major drops squoosh (Next 15+ makes sharp mandatory for prod start).
function avatarRemotePatterns() {
  const patterns = [
    { protocol: 'http', hostname: 'localhost', port: '8000' },
    { protocol: 'http', hostname: '127.0.0.1', port: '8000' },
  ];
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
        patterns.push({
          protocol: u.protocol.replace(':', ''),
          hostname: u.hostname,
          ...(u.port ? { port: u.port } : {}),
        });
      } else if (u.port && u.port !== '8000') {
        // Dev/test with a non-default backend port (e.g. :8010/:8001).
        patterns.push({ protocol: u.protocol.replace(':', ''), hostname: u.hostname, port: u.port });
      }
    } catch {
      // Malformed NEXT_PUBLIC_API_URL — keep the dev fallbacks only.
    }
  }
  return patterns;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['imac.local', 'localhost', '127.0.0.1', '*.local'],
  // Шардовые e2e-сборки (scripts/e2e-shard-start.sh) изолируются через NEXT_DIST_DIR.
  // ВАЖНО: не включать --turbo шарду — Turbopack кладёт кэш вне distDir, изоляция сломается.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  images: {
    remotePatterns: avatarRemotePatterns(),
  },
};

export default nextConfig;
