# syntax=docker/dockerfile:1.7
# Revo web: dashboard, GitHub webhook and sign-in (Next.js standalone).
# Build from the repo root:  docker build -f apps/web/Dockerfile -t revo-web .
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1
RUN apk add --no-cache libc6-compat && corepack enable && corepack prepare pnpm@10.34.9 --activate
WORKDIR /repo

# 1. Keep only the workspace packages the web app needs, with a pruned lockfile.
FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2.11.13 prune @revo/web --docker

# 2. Install from manifests only, so this layer is cached until dependencies change.
FROM base AS deps
COPY --from=prune /repo/out/json/ ./
# Inputs of the postinstall scripts (iconsax Bulk patch, prisma generate).
COPY --from=prune /repo/out/full/apps/web/scripts apps/web/scripts
COPY --from=prune /repo/out/full/packages/db/prisma packages/db/prisma
COPY --from=prune /repo/out/full/packages/db/prisma.config.ts packages/db/prisma.config.ts
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# 3. Build. Secrets are runtime-only; DATABASE_URL is a placeholder for prisma generate.
FROM deps AS build
COPY --from=prune /repo/out/full/ ./
COPY tsconfig.base.json ./
ENV NEXT_OUTPUT=standalone DATABASE_URL=postgresql://build@localhost:5432/build
RUN pnpm --filter @revo/db db:generate && pnpm --filter @revo/web exec next build

# 4. Runtime: the traced standalone server only, as a non-root user.
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 revo && adduser -S -u 1001 -G revo revo
COPY --from=build --chown=revo:revo /repo/apps/web/.next/standalone ./
COPY --from=build --chown=revo:revo /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=revo:revo /repo/apps/web/public ./apps/web/public
USER revo
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
