import { MOCK_APP_ID, type MockAppState } from '../app-state';
import type { MockRoute } from '../router';
import type { MockState } from '../state';

const unauthorized = { status: 401, json: { message: 'Bad credentials' } };

/**
 * REST endpoints called with a user-to-server token (api.github.com/user/*).
 * Installations and repos come from the App state, so an installation added
 * through /__mock/installations is visible to its members.
 */
export function userRoutes(state: MockState, app: MockAppState): MockRoute[] {
  const avatar = (login: string) => `${state.baseUrl}/avatars/${login}.svg`;
  return [
    {
      method: 'GET',
      path: '/user',
      handler: ({ token }) => {
        const user = state.userForToken(token);
        if (!user) return unauthorized;
        return {
          json: {
            id: user.githubId,
            login: user.login,
            name: user.name,
            email: null,
            avatar_url: avatar(user.login),
            type: 'User',
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/user/emails',
      handler: ({ token }) => {
        const user = state.userForToken(token);
        return user
          ? { json: [{ email: `${user.login}@northwind.test`, primary: true, verified: true }] }
          : unauthorized;
      },
    },
    {
      method: 'GET',
      path: '/user/installations',
      handler: ({ token }) => {
        const user = state.userForToken(token);
        if (!user) return unauthorized;
        const installations = app.installationsVisibleTo(user).map((i) => ({
          id: i.id,
          app_id: MOCK_APP_ID,
          account: { ...i.account, avatar_url: avatar(i.account.login) },
        }));
        return { json: { total_count: installations.length, installations } };
      },
    },
    {
      method: 'GET',
      path: '/user/installations/:id/repositories',
      handler: ({ token, params }) => {
        const user = state.userForToken(token);
        if (!user) return unauthorized;
        const id = Number(params.id);
        if (!app.installations.has(id)) return { status: 404, json: { message: 'Not Found' } };
        const repositories = app.reposVisibleTo(user, id).map((r) => ({
          id: r.id,
          name: r.name,
          full_name: r.fullName,
          private: r.private,
          owner: { login: r.fullName.split('/')[0] },
          permissions: app.permissionsOf(user, id),
        }));
        return { json: { total_count: repositories.length, repositories } };
      },
    },
    {
      method: 'GET',
      path: '/avatars/:file',
      handler: ({ params }) => {
        const login = (params.file ?? '').replace(/\.svg$/, '');
        const initials = login
          .split(/[-_]/)
          .map((p) => p[0]?.toUpperCase() ?? '')
          .join('')
          .slice(0, 2);
        const hue = [...login].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
        const svg =
          `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
          `<rect width="96" height="96" fill="hsl(${hue} 32% 46%)"/>` +
          `<text x="48" y="58" font-family="Georgia, serif" font-size="36" fill="white" text-anchor="middle">${initials}</text></svg>`;
        return {
          headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' },
          text: svg,
        };
      },
    },
  ];
}
