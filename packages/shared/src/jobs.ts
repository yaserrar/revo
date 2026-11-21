import { z } from 'zod';
import { REVIEW_TRIGGERS } from './constants';

/** BullMQ queue that carries review jobs from apps/web to apps/worker. */
export const REVIEW_QUEUE = 'reviews';

/** BullMQ key prefix so Revo never collides with other apps on the same Redis. */
export const QUEUE_PREFIX = 'revo';

export const ReviewJobPayloadSchema = z.object({
  installationGithubId: z.number().int().positive(),
  repoGithubId: z.number().int().positive(),
  /** owner/name, for logs and API calls. */
  repoFullName: z.string().min(3),
  prNumber: z.number().int().positive(),
  headSha: z.string().regex(/^[0-9a-f]{7,64}$/i, 'headSha must be a git SHA'),
  trigger: z.enum(REVIEW_TRIGGERS),
  /** Revo user id for manual "Review again". */
  requestedByUserId: z.string().optional(),
  /** X-GitHub-Delivery of the webhook that caused the job (auto trigger). */
  deliveryId: z.string().optional(),
  /** ISO time the job was enqueued. */
  enqueuedAt: z.string(),
});
export type ReviewJobPayload = z.infer<typeof ReviewJobPayloadSchema>;

/** Name given to every job in the queue. */
export const REVIEW_JOB_NAME = 'review';

/**
 * Debounce key, one per PR (spec 6). Used as BullMQ's
 * `deduplication: { id, replace: true, keepLastIfActive: true }` together with
 * `delay`: a new push replaces the job still waiting for that PR, and a push
 * during a running review is kept and runs when it finishes.
 * BullMQ ids may not contain ":".
 */
export function reviewDebounceKey(repoGithubId: number, prNumber: number): string {
  return `pr-${repoGithubId}-${prNumber}`;
}

/**
 * Job id: the commit plus a nonce unique to each enqueue, so a commit can be
 * queued again after its earlier job finished (BullMQ ignores an add whose id
 * still exists, even a completed one kept for history). Idempotency per head
 * SHA (spec 6) is the Review row: the webhook and the worker check it.
 * BullMQ ids may not contain ":". All ids of a repo start with `review-<repo>-`.
 */
export function reviewJobId(
  p: Pick<ReviewJobPayload, 'repoGithubId' | 'prNumber' | 'headSha' | 'trigger'>,
  nonce: string,
): string {
  return `review-${p.repoGithubId}-${p.prNumber}-${p.headSha.toLowerCase()}-${p.trigger}-${nonce}`;
}

/** Prefix of every job id of a repo (to purge them when the repo or its installation goes away). */
export function reviewJobIdPrefix(repoGithubId: number): string {
  return `review-${repoGithubId}-`;
}

/** Default job options: 1 try + 2 retries with exponential backoff (spec 7.9). */
export const REVIEW_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 15_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 1_000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

/**
 * Options for `queue.add(REVIEW_JOB_NAME, payload, opts)`. Automatic reviews
 * wait `debounceMs` and replace a job still delayed for the same PR; while a
 * review of that PR runs, the newest push is kept and starts after it
 * (`keepLastIfActive`). Manual reviews run now. `nonce` is unique per enqueue.
 */
export function reviewJobAddOptions(payload: ReviewJobPayload, debounceMs: number, nonce: string) {
  const jobId = reviewJobId(payload, nonce);
  if (payload.trigger === 'manual') return { ...REVIEW_JOB_OPTIONS, jobId };
  return {
    ...REVIEW_JOB_OPTIONS,
    jobId,
    delay: debounceMs,
    deduplication: {
      id: reviewDebounceKey(payload.repoGithubId, payload.prNumber),
      replace: true,
      keepLastIfActive: true,
    },
  };
}
