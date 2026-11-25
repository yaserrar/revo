import path from 'node:path';
import type { NextConfig } from 'next';

// Next runs from apps/web; the monorepo root holds the lockfile and the workspace packages.
const monorepoRoot = path.resolve(process.cwd(), '../..');

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
  // The analytics proxy (/ingest → PostHog) lives in src/proxy.ts, which sends
  // PostHog the visitor's IP. PostHog's API paths end with a slash; don't redirect them.
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
