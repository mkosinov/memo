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

// GH #616: a RELATIVE NEXT_PUBLIC_API_URL (prod bake: '/api' — the API is
// mounted same-origin behind the host nginx, #617 proxies without rewriting)
// means there is no remote image host at all: images are served unoptimized
// straight from the API origin (spec §3.1 — «unoptimized убирает
// remotePatterns, домен не вшит никуда»). An ABSOLUTE base or no base at
// all (dev/e2e fallback) keeps the GH #301 optimizer + remotePatterns
// exactly as before — dev is untouched.
function isRelativeApiBase() {
  const raw = process.env.NEXT_PUBLIC_API_URL || '';
  return raw !== '' && !/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith('//');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // GH #616: standalone emits a self-contained runtime (.next/standalone)
  // for the Docker image — Task 3's Dockerfile copies it and adds public/
  // and .next/static (standalone famously excludes both). NOTE: in this
  // pnpm workspace the standalone tree roots at the WORKSPACE root — the
  // server entry is .next/standalone/frontend/admin/server.js. `next dev`
  // ignores `output`, and the shard e2e stacks run `next dev`, so dev/e2e
  // do not change.
  output: 'standalone',
  // basePath ONLY from the NEXT_PUBLIC_BASE_PATH build arg (prod bake:
  // '/admin'). Unset in dev — no basePath key at all, URLs stay as before.
  ...(process.env.NEXT_PUBLIC_BASE_PATH
    ? { basePath: process.env.NEXT_PUBLIC_BASE_PATH }
    : {}),
  allowedDevOrigins: ['imac.local', 'localhost', '127.0.0.1', '*.local'],
  // Шардовые e2e-сборки (scripts/e2e-shard-start.sh) изолируются через NEXT_DIST_DIR.
  // ВАЖНО: не включать --turbo шарду — Turbopack кладёт кэш вне distDir, изоляция сломается.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  images: isRelativeApiBase()
    ? { unoptimized: true }
    : { remotePatterns: avatarRemotePatterns() },
  // GH #384: never report the page address to third parties (Referer) —
  // table-filter text lands in URLs (#349), and per-link rel="noreferrer"
  // only covers those specific anchors. A page-level policy covers links,
  // subresources, fetch and forms regardless of markup discipline.
  // Docs: headers are checked before the filesystem, so /public files and
  // (non-Cache-Control headers on) /_next/static are covered too.
  headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ];
  },
};

export default nextConfig;
