import type { MockResponse, MockRoute } from '../router';

/**
 * A Claude API that always fails, for testing how Revo handles a failed
 * review ("Revo couldn't review this PR"). Point the worker at it with
 * ANTHROPIC_BASE_URL=http://localhost:4830/anthropic and REVO_ENGINE=claude.
 * POST /__mock/anthropic { status } picks the failure: 401 (bad key, not
 * retried, default), 429 (rate limited) or 529/500 (unavailable, retried).
 * It never answers a review, so no code is ever "reviewed" here.
 *
 * GET /anthropic/v1/models answers the web app's key check (ANTHROPIC_BASE_URL
 * of the web app): keys starting with "sk-ant-mock-" are accepted, any other
 * key gets a 401, as Anthropic answers an unknown key.
 */
export const MOCK_VALID_KEY_PREFIX = 'sk-ant-mock-';

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
      method: 'GET',
      path: '/anthropic/v1/models',
      handler: ({ headers, token }): MockResponse => {
        const key = (typeof headers['x-api-key'] === 'string' ? headers['x-api-key'] : null) ?? token;
        if (!key?.startsWith(MOCK_VALID_KEY_PREFIX))
          return {
            status: 401,
            headers: { 'x-should-retry': 'false', 'request-id': 'req_mock' },
            json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
          };
        return {
          headers: { 'request-id': 'req_mock' },
          json: {
            data: [
              {
                type: 'model',
                id: 'claude-sonnet-5-5',
                display_name: 'Claude Sonnet 5.5',
                created_at: '2026-01-01T00:00:00Z',
              },
            ],
            has_more: false,
            first_id: 'claude-sonnet-5-5',
            last_id: 'claude-sonnet-5-5',
          },
        };
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
