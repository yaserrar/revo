# syntax=docker/dockerfile:1.7
# Revo worker: BullMQ consumer of the "reviews" queue (tsup bundle + prod deps).
# Build from the repo root:  docker build -f apps/worker/Dockerfile -t revo-worker .
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH TURBO_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
WORKDIR /repo

# 1. Keep only the workspace packages the worker needs, with a pruned lockfile.
FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2.11.13 prune @revo/worker --docker

# 2. Install, bundle (the @revo/* packages are inlined by tsup), then collect
#    the production dependencies the bundle imports into /out.
FROM base AS build
COPY --from=prune /repo/out/json/ ./
COPY --from=prune /repo/out/full/packages/db/prisma packages/db/prisma
COPY --from=prune /repo/out/full/packages/db/prisma.config.ts packages/db/prisma.config.ts
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ ./
COPY tsconfig.base.json ./
ENV DATABASE_URL=postgresql://build@localhost:5432/build
RUN pnpm --filter @revo/db db:generate \
  && pnpm --filter @revo/worker build \
  && pnpm --filter @revo/worker deploy --prod --legacy --ignore-scripts --config.auto-install-peers=false /out \
  && rm -rf /out/src /out/test /out/dist \
  && cp -r apps/worker/dist /out/dist

# 3. Runtime, as a non-root user.
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S -g 1001 revo && adduser -S -u 1001 -G revo revo
COPY --from=build --chown=revo:revo /out ./
USER revo
# The worker touches /tmp/revo-worker.heartbeat every 15 s while BullMQ runs and Postgres answers.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD sh -c 'test $(( $(date +%s) - $(stat -c %Y /tmp/revo-worker.heartbeat) )) -lt 60'
# SIGTERM lets running reviews finish (see stop_grace_period in docker-compose.yml).
STOPSIGNAL SIGTERM
CMD ["node", "--enable-source-maps", "dist/index.js"]
