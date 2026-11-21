/**
 * Revo worker: consumes the "reviews" queue (spec section 4). Validates the
 * environment, checks Postgres and Redis, then processes review jobs with
 * WORKER_CONCURRENCY in parallel, and prunes the webhook log every 6 hours.
 * SIGINT/SIGTERM stop taking jobs, let the running ones finish, and close
 * every connection.
 */
import { createPrismaClient, pruneWebhookDeliveries } from '@revo/db';
import { createGithubApp } from '@revo/github';
import { REVIEW_QUEUE } from '@revo/shared';
import { createEngine } from './engines';
import { githubConfig, loadEnv } from './env';
import { startHeartbeat } from './heartbeat';
import { createLogger } from './logger';
import { bullConnection } from './redis';
import { createReviewWorker } from './worker';

const PRUNE_EVERY_MS = 6 * 3600_000;

async function main() {
  const env = loadEnv();
  const log = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
  const prisma = createPrismaClient({ connectionString: env.DATABASE_URL });
  await prisma.$queryRaw`SELECT 1`;

  const github = githubConfig(env);
  const worker = createReviewWorker(
    {
      prisma,
      github: createGithubApp(github),
      engine: createEngine(env, log),
      log,
      appUrl: env.APP_URL,
    },
    {
      connection: bullConnection(env.REDIS_URL),
      prefix: env.REVO_QUEUE_PREFIX,
      concurrency: env.WORKER_CONCURRENCY,
    },
  );
  await worker.waitUntilReady();
  if (env.REVO_ENGINE === 'fake' && env.NODE_ENV === 'production')
    log.warn('REVO_TEST_MODE: the fake engine simulates reviews, nothing is done by Claude');
  log.info(
    {
      engine: env.REVO_ENGINE,
      queue: REVIEW_QUEUE,
      prefix: env.REVO_QUEUE_PREFIX,
      concurrency: env.WORKER_CONCURRENCY,
      githubApi: github.apiUrl,
    },
    'worker ready',
  );

  const stopHeartbeat = startHeartbeat(async () => {
    if (!worker.isRunning()) return false;
    await prisma.$queryRaw`SELECT 1`;
    return true;
  });

  // Retention (spec 14): the webhook log keeps 30 days. Several workers pruning at once is harmless.
  const prune = () =>
    pruneWebhookDeliveries(prisma)
      .then((count) => count > 0 && log.info({ count }, 'old webhook deliveries pruned'))
      .catch((err: unknown) =>
        log.warn({ err: err instanceof Error ? err.message : String(err) }, 'webhook prune failed'),
      );
  void prune();
  const pruneTimer = setInterval(() => void prune(), PRUNE_EVERY_MS);
  pruneTimer.unref();

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    stopHeartbeat();
    clearInterval(pruneTimer);
    log.info({ signal }, 'worker stopping; waiting for running reviews');
    await worker.close();
    await prisma.$disconnect();
    log.info('worker stopped');
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
