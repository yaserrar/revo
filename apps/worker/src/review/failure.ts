import { githubErrorStatus, isGithubRateLimit } from '@revo/github';
import {
  isReviewEngineError,
  REVIEW_ENGINE_ERROR_MESSAGES,
  SUBSCRIPTION_ERROR_MESSAGES,
  usageCostUsd,
} from '@revo/review';
import { accountKeyRefusedText } from '@revo/shared';
import { AccountKeyError } from './ai-access';
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

/**
 * Turns any error of a review attempt into a stored message and a retry
 * decision. `accountKeyOf` names the account when the review ran on its own
 * API key: a rejected key then says whose key to update. `subscription`: the
 * review ran on the local Claude subscription, so sign-in and usage-limit
 * failures are about Claude Code, not an API key.
 */
export function describeFailure(
  err: unknown,
  model: string,
  ctx: { accountKeyOf?: string; subscription?: boolean } = {},
): Failure {
  if (err instanceof AccountKeyError) return { message: err.message, retryable: false, spent: null };
  if (isReviewEngineError(err)) {
    const usage = err.usage;
    return {
      message:
        err.code === 'auth' && ctx.accountKeyOf
          ? accountKeyRefusedText(ctx.accountKeyOf)
          : ((ctx.subscription ? SUBSCRIPTION_ERROR_MESSAGES[err.code] : undefined) ??
            REVIEW_ENGINE_ERROR_MESSAGES[err.code]),
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
