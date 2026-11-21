import 'server-only';
import { randomBytes } from 'node:crypto';
import { Queue, type Job } from 'bullmq';
import {
  QUEUE_PREFIX,
  REVIEW_JOB_NAME,
  REVIEW_QUEUE,
  ReviewJobPayloadSchema,
  reviewJobAddOptions,
  reviewJobIdPrefix,
  type ReviewJobPayload,
} from '@revo/shared';
import { env } from '../config/env';

/** A webhook must answer GitHub within 10 s: an enqueue that takes longer has failed. */
export const ENQUEUE_TIMEOUT_MS = 5_000;

const globalForQueue = globalThis as unknown as { reviewQueue?: Queue };

/**
 * The producer side of the "reviews" queue (Redis db from REDIS_URL, prefix
 * "revo"). Commands fail fast while Redis is unreachable instead of waiting
 * in ioredis' offline queue, so a webhook never hangs on an outage.
 */
export function reviewQueue(): Queue {
  globalForQueue.reviewQueue ??= new Queue(REVIEW_QUEUE, {
    connection: {
      url: env.REDIS_URL,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: ENQUEUE_TIMEOUT_MS,
    },
    prefix: env.REVO_QUEUE_PREFIX ?? QUEUE_PREFIX,
  });
  return globalForQueue.reviewQueue;
}

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Adds a review job (spec 6). Automatic reviews wait REVIEW_DEBOUNCE_SECONDS
 * and replace the job still waiting for the same PR; a push during a running
 * review is kept and runs after it. Every enqueue gets its own job id (the
 * Review row is what makes webhooks idempotent per head SHA). Rejects within
 * {@link ENQUEUE_TIMEOUT_MS} when Redis does not answer.
 */
export async function enqueueReview(payload: ReviewJobPayload): Promise<Job> {
  const data = ReviewJobPayloadSchema.parse(payload);
  const nonce = randomBytes(6).toString('hex');
  return withTimeout(
    reviewQueue().add(
      REVIEW_JOB_NAME,
      data,
      reviewJobAddOptions(data, env.REVIEW_DEBOUNCE_SECONDS * 1000, nonce),
    ),
    ENQUEUE_TIMEOUT_MS,
    'Queueing the review',
  );
}

/** Job states that can be removed (an active job is locked by the worker; it drops itself when the repo is gone). */
const REMOVABLE_STATES = ['waiting', 'delayed', 'prioritized', 'completed', 'failed'] as const;

/**
 * Removes every queued and finished job of these repos (spec 14: uninstalling
 * leaves no trace). Job data holds repo names, PR numbers, SHAs and errors.
 * Returns how many jobs were removed.
 */
export async function purgeRepoJobs(repoGithubIds: readonly number[]): Promise<number> {
  if (repoGithubIds.length === 0) return 0;
  const prefixes = repoGithubIds.map(reviewJobIdPrefix);
  const queue = reviewQueue();
  const jobs = await withTimeout(queue.getJobs([...REMOVABLE_STATES]), ENQUEUE_TIMEOUT_MS, 'Listing jobs');
  const doomed = jobs.filter((job) => job.id && prefixes.some((p) => job.id!.startsWith(p)));
  await Promise.all(doomed.map((job) => job.remove().catch(() => undefined)));
  return doomed.length;
}
