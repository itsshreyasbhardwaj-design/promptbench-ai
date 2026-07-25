import type { NextConfig } from 'next';

/**
 * Security headers applied to every response.
 *
 * `Content-Security-Policy` is intentionally omitted here and set in
 * `src/middleware.ts` instead, because it needs a per-request nonce.
 */
const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
] as const;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Fail the production build on type errors rather than shipping them.
  // Linting runs as its own CI step (`pnpm lint`) since Next 16 no longer
  // invokes ESLint during `next build`.
  typescript: { ignoreBuildErrors: false },

  // `postgres` reaches for node:net, node:tls and node:fs. It must stay an
  // external server dependency rather than being bundled, or any route that
  // transitively imports the DB layer fails to resolve those built-ins.
  serverExternalPackages: ['postgres'],

  experimental: {
    // Tree-shake barrel imports from these packages to keep client bundles small.
    optimizePackageImports: ['lucide-react', 'recharts', 'motion', 'date-fns'],
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [...securityHeaders],
      },
    ];
  },
};

export default nextConfig;
