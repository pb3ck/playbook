import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* Pure static export — every route is statically rendered, the
     playbook is client-only after mount. No SSR-at-request-time, so
     this drops onto Vercel / Cloudflare Pages / Caddy / nginx /
     anything that serves a directory of static files. */
  output: 'export',
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ['motion'],
  },
  images: {
    /* `next/image` requires a loader for static export; the playbook
       doesn't use it, so leaving it unoptimized is fine. */
    unoptimized: true,
  },
  /* Trailing slash on every route — friendlier for static hosts that
     serve `path/index.html` for `path/`. */
  trailingSlash: true,
};

export default nextConfig;
