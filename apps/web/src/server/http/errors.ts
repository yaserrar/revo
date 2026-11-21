import 'server-only';
import type { ApiErrorCode } from '@revo/shared';

/** Throw from services; route() turns it into `{ message, code, details? }` with this status. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'VALIDATION_ERROR', message, details);
export const unauthorized = () => new HttpError(401, 'UNAUTHORIZED', 'Sign in to continue.');
export const forbidden = (message = 'You do not have access to this.') =>
  new HttpError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (message: string) => new HttpError(409, 'CONFLICT', message);
export const unprocessable = (message: string, details?: unknown) =>
  new HttpError(422, 'UNPROCESSABLE', message, details);
export const rateLimited = (retryAfterSec: number) =>
  new HttpError(429, 'RATE_LIMITED', 'Too many requests. Try again in a moment.', { retryAfterSec });
export const budgetReached = (details?: unknown) =>
  new HttpError(402, 'BUDGET_REACHED', 'The monthly budget for this repo is reached.', details);
