import { Worker, type Job } from 'bullmq';
import { REVIEW_QUEUE, ReviewJobPayloadSchema, type ReviewJobPayload } from '@revo/shared';
import { runReviewJob, type ReviewDeps, type ReviewJobResult } from './review/job';

/**
 * The BullMQ consumer of the "reviews" queue. One job = one review attempt;
 * retries and backoff come from the job options (REVIEW_JOB_OPTIONS).
 */
export function createReviewWorker(
  deps: ReviewDeps,
  opts: { connection: { url: string; maxRetriesPerRequest: null }; prefix: string; concurrency: number },
): Worker<ReviewJobPayload, ReviewJobResult> {
  const worker = new Worker<ReviewJobPayload, ReviewJobResult>(
    REVIEW_QUEUE,
    async (job: Job<ReviewJobPayload, ReviewJobResult>) => {
      const payload = ReviewJobPayloadSchema.parse(job.data);
      const log = deps.log.child({ jobId: job.id, repo: payload.repoFullName, pr: payload.prNumber });
      return runReviewJob(
        payload,
        { attemptsMade: job.attemptsMade, attempts: job.opts.attempts ?? 1 },
        { ...deps, log },
      );
    },
    { connection: opts.connection, prefix: opts.prefix, concurrency: opts.concurrency },
  );
  worker.on('failed', (job, err) =>
    deps.log.warn({ jobId: job?.id, attemptsMade: job?.attemptsMade, err: err.message }, 'job failed'),
  );
  worker.on('error', (err) => deps.log.error({ err: errorText(err) }, 'worker error'));
  return worker;
}

/** Connection errors (Redis not running) have an empty message and only a code such as ECONNREFUSED. */
function errorText(err: Error & { code?: string }): string {
  if (err.message) return err.message;
  return `${err.code ?? err.name}: cannot reach Redis (REDIS_URL); is it running?`;
}
