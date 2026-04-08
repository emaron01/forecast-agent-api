/** @type {import('next').NextConfig} */
const nextConfig = {
  // TypeScript type checking runs in CI separately.
  // Skipping here to keep Render build times within limits.
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Windows dev stability:
  // Next.js/webpack persistent cache can get corrupted (missing *.pack.gz),
  // which triggers `clientModules` crashes in dev. Disable filesystem cache in dev only.
  webpack: (config, { dev }) => {
    if (dev) {
      config.cache = false;
    }
    return config;
  },
};

module.exports = nextConfig;

