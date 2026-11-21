import { githubErrorStatus, isGithubRateLimit } from '@revo/github';
import { isReviewEngineError, REVIEW_ENGINE_ERROR_MESSAGES, usageCostUsd } from '@revo/review';
import type { SpentUsage } from './store';

export type Failure = {
  /** Short, user-facing text stored on the review (never code or secrets). */
  message: string;
  /** False when another attempt cannot succeed (bad key, refusal, GitHub 404/422…). */
  retryable: boolean;
  /** Tokens billed before the failure. */
  spent: SpentUsage | null;
};

/**
 * GitHub errors worth retrying: rate limits and server errors. A 403 that is
 * not a rate limit (the App may not do this) fails the same way every time.
 */
function githubRetryable(err: unknown, status: number): boolean {
  return status >= 500 || isGithubRateLimit(err);
}

/** Turns any error of a review attempt into a stored message and a retry decision. */
export function describeFailure(err: unknown, model: string): Failure {
  if (isReviewEngineError(err)) {
    const usage = err.usage;
    return {
      message: REVIEW_ENGINE_ERROR_MESSAGES[err.code],
      retryable: err.retryable,
      spent: usage
        ? {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cachedTokens: usage.cacheReadTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
            costUsd: usageCostUsd(model, usage),
          }
        : null,
    };
  }
  const status = githubErrorStatus(err);
  if (status !== null) {
    return {
      message: `GitHub answered ${status} to a request.`,
      retryable: githubRetryable(err, status),
      spent: null,
    };
  }
  return { message: 'Unexpected error while reviewing.', retryable: true, spent: null };
}
