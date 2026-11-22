import path from 'node:path';
import type { NextConfig } from 'next';

// Next runs from apps/web; the monorepo root holds the lockfile and the workspace packages.
const monorepoRoot = path.resolve(process.cwd(), '../..');

// PostHog region: the ingestion and assets hosts behind /ingest (see src/instrumentation-client.ts).
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
const POSTHOG_ASSETS = POSTHOG_HOST.replace('.i.posthog.com', '-assets.i.posthog.com');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // The Docker image sets NEXT_OUTPUT=standalone; local `next start` uses the regular output.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@revo/shared', '@revo/db', '@revo/review', '@revo/github'],
  serverExternalPackages: ['pino', 'bullmq', 'ioredis', 'pg', '@prisma/client', '@prisma/adapter-pg'],
  poweredByHeader: false,
  images: { remotePatterns: [{ protocol: 'https', hostname: 'avatars.githubusercontent.com' }] },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // Analytics through Revo's own domain, so ad blockers don't drop them.
  async rewrites() {
    return [
      { source: '/ingest/static/:path*', destination: `${POSTHOG_ASSETS}/static/:path*` },
      { source: '/ingest/array/:path*', destination: `${POSTHOG_ASSETS}/array/:path*` },
      { source: '/ingest/:path*', destination: `${POSTHOG_HOST}/:path*` },
    ];
  },
  // PostHog's API paths end with a slash; don't redirect them.
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
