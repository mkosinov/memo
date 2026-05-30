/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  distDir: 'dist',
  allowedDevOrigins: ['imac.local'],
};

export default nextConfig;
