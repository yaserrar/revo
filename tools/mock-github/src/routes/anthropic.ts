import type { MockRoute } from '../router';

/**
 * A Claude API that always fails, for testing how Revo handles a failed
 * review ("Revo couldn't review this PR"). Point the worker at it with
 * ANTHROPIC_BASE_URL=http://localhost:4830/anthropic and REVO_ENGINE=claude.
 * POST /__mock/anthropic { status } picks the failure: 401 (bad key, not
 * retried, default), 429 (rate limited) or 529/500 (unavailable, retried).
 * It never answers a review, so no code is ever "reviewed" here.
 */

const ERROR_TYPES: Record<number, string> = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  429: 'rate_limit_error',
  500: 'api_error',
  529: 'overloaded_error',
};

export function anthropicRoutes(): MockRoute[] {
  let status = 401;
  return [
    {
      method: 'POST',
      path: '/__mock/anthropic',
      handler: ({ body }) => {
        const next = Number(body.status);
        if (!ERROR_TYPES[next])
          return {
            status: 422,
            json: { message: `status must be one of ${Object.keys(ERROR_TYPES).join(', ')}` },
          };
        status = next;
        return { json: { status } };
      },
    },
    {
      method: 'POST',
      path: '/anthropic/v1/messages',
      handler: () => ({
        status,
        // Tell the SDK not to retry by itself, so tests see BullMQ's retries only.
        headers: { 'x-should-retry': 'false', 'request-id': 'req_mock' },
        json: { type: 'error', error: { type: ERROR_TYPES[status], message: 'Mock Claude API failure' } },
      }),
    },
  ];
}
