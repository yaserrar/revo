# syntax=docker/dockerfile:1.7
# One-shot migration runner (`prisma migrate deploy` on DATABASE_URL). Compose
# runs it before web and worker start. Build from the repo root:
#   docker build -f packages/db/Dockerfile -t revo-migrate .
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH TURBO_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
WORKDIR /repo

FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2.11.13 prune @revo/db --docker

FROM base AS runtime
COPY --from=prune /repo/out/json/ ./
COPY --from=prune /repo/out/full/packages/db/prisma packages/db/prisma
COPY --from=prune /repo/out/full/packages/db/prisma.config.ts packages/db/prisma.config.ts
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @revo/db \
  && chown -R node:node /repo
USER node
WORKDIR /repo/packages/db
# The prisma CLI directly: the corepack pnpm shim belongs to root and would download again as "node".
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]
