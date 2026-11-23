import { createServer, type Server } from 'node:http';
import { MockAppState } from './app-state';
import { createRouter, type MockRoute } from './router';
import { anthropicRoutes } from './routes/anthropic';
import { manifestRoutes } from './routes/manifest';
import { appRoutes } from './routes/app';
import { appDebugRoutes } from './routes/app-debug';
import { oauthRoutes } from './routes/oauth';
import { userRoutes } from './routes/user';
import { MockState } from './state';

export type { MockHandler, MockRequest, MockResponse, MockRoute } from './router';
export { MockState } from './state';
export {
  MOCK_APP_ID,
  MOCK_APP_SLUG,
  MockAppState,
  mockUserId,
  type MockCheckRun,
  type MockFileChange,
  type MockIssueComment,
  type MockPull,
  type MockReviewComment,
} from './app-state';
export { unifiedPatch } from './line-diff';

/**
 * A small stand-in for github.com and api.github.com, for local runs and tests.
 * Point GITHUB_OAUTH_BASE_URL and GITHUB_API_URL at it (never in production).
 * Add routes for more endpoints in src/routes/*.
 */
export function createMockGithubServer({
  baseUrl,
  extraRoutes = [],
}: {
  baseUrl: string;
  extraRoutes?: MockRoute[];
}): {
  server: Server;
  state: MockState;
  /** GitHub App side: installations, PRs, checks, comments, reviews (agent B). */
  app: MockAppState;
} {
  const state = new MockState(baseUrl);
  const app = new MockAppState(baseUrl);
  const routes: MockRoute[] = [
    { method: 'GET', path: '/health', handler: () => ({ json: { ok: true } }) },
    ...oauthRoutes(state),
    ...userRoutes(state, app),
    ...appRoutes(app),
    ...appDebugRoutes(app),
    ...anthropicRoutes(),
    ...manifestRoutes(),
    ...extraRoutes,
  ];
  return {
    server: createServer(createRouter(routes, (method, path) => app.takeFailure(method, path))),
    state,
    app,
  };
}
