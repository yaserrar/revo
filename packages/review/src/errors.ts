import { addUsage, roundUsd, usageCostUsd, ZERO_USAGE, type CallUsage } from './pricing';

/**
 * Why an engine call failed. The worker maps these to the review's error
 * message and decides whether BullMQ should retry:
 * - `refusal`: the model (and its fallback) declined the content. Not retried.
 * - `max_tokens`: the answer did not fit in the output limit. Not retried.
 * - `invalid_output`: the answer failed validation twice. Retried.
 * - `rate_limited`, `unavailable`: Claude API busy or down (after the SDK's own retries). Retried.
 * - `auth`: missing or rejected API key. Not retried.
 * - `bad_request`: the API rejected the request (e.g. prompt too long). Not retried.
 */
export const REVIEW_ENGINE_ERROR_CODES = [
  'refusal',
  'max_tokens',
  'invalid_output',
  'rate_limited',
  'unavailable',
  'auth',
  'bad_request',
] as const;
export type ReviewEngineErrorCode = (typeof REVIEW_ENGINE_ERROR_CODES)[number];

const RETRYABLE: Record<ReviewEngineErrorCode, boolean> = {
  refusal: false,
  max_tokens: false,
  invalid_output: true,
  rate_limited: true,
  unavailable: true,
  auth: false,
  bad_request: false,
};

/** Short, user-facing text for the dashboard and the check run. Never contains code or secrets. */
export const REVIEW_ENGINE_ERROR_MESSAGES: Record<ReviewEngineErrorCode, string> = {
  refusal: 'Claude declined to review this change.',
  max_tokens: 'The review did not fit in the output limit.',
  invalid_output: 'Claude returned an answer that could not be read, twice.',
  rate_limited: 'The Claude API is rate limiting requests.',
  unavailable: 'The Claude API could not be reached.',
  auth: 'The Claude API key is missing or was rejected.',
  bad_request: 'The Claude API rejected the review request.',
};

export class ReviewEngineError extends Error {
  readonly code: ReviewEngineErrorCode;
  readonly retryable: boolean;
  /** Which pass failed. */
  readonly pass: 'find' | 'verify';
  /** Tokens already spent before the failure (they are billed), across every pass that ran. */
  readonly usage: CallUsage | null;
  /** What went wrong, for logs (the message adds the user-facing text). */
  readonly detail: string;

  constructor(
    code: ReviewEngineErrorCode,
    pass: 'find' | 'verify',
    detail: string,
    { usage = null, cause }: { usage?: CallUsage | null; cause?: unknown } = {},
  ) {
    super(`${REVIEW_ENGINE_ERROR_MESSAGES[code]} (${pass}: ${detail})`, { cause });
    this.name = 'ReviewEngineError';
    this.code = code;
    this.retryable = RETRYABLE[code];
    this.pass = pass;
    this.usage = usage;
    this.detail = detail;
  }
}

/**
 * The same failure, also carrying `earlier` usage: a pass that finished (and
 * was billed) before this one failed. `costUsd` is summed per pass, so a
 * fallback model's exact cost is kept.
 */
export function withEarlierUsage(
  err: ReviewEngineError,
  earlier: CallUsage,
  model: string,
): ReviewEngineError {
  const failed = err.usage ?? ZERO_USAGE;
  const usage: CallUsage = {
    ...addUsage(earlier, failed),
    costUsd: roundUsd(usageCostUsd(model, earlier) + usageCostUsd(model, failed)),
  };
  return new ReviewEngineError(err.code, err.pass, err.detail, { usage, cause: err });
}

export function isReviewEngineError(err: unknown): err is ReviewEngineError {
  return err instanceof ReviewEngineError;
}
