/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  // NEXT_DIST_DIR (#513): the web e2e stack compiles into its own
  // dist-e2e-<tag> dir (the admin NEXT_DIST_DIR/.next-shard-* isolation,
  // GH #264) so a parallel `next dev` (dev.sh / playground) never shares
  // build state with an e2e run. Unset → the default 'dist'.
  distDir: process.env.NEXT_DIST_DIR || 'dist',
  allowedDevOrigins: ['imac.local'],
};

export default nextConfig;
