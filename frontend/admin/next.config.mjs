/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['imac.local', 'localhost', '*.local'],
  // Шардовые e2e-сборки (scripts/e2e-shard-start.sh) изолируются через NEXT_DIST_DIR.
  // ВАЖНО: не включать --turbo шарду — Turbopack кладёт кэш вне distDir, изоляция сломается.
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
