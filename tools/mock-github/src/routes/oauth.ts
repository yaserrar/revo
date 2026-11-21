import type { MockRoute } from '../router';
import type { MockState } from '../state';

/** GitHub's web OAuth flow (github.com/login/oauth/*), auto-approved. */
export function oauthRoutes(state: MockState): MockRoute[] {
  return [
    {
      method: 'GET',
      path: '/login/oauth/authorize',
      handler: ({ url }) => {
        const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
        redirect.searchParams.set('code', state.issueCode());
        const st = url.searchParams.get('state');
        if (st) redirect.searchParams.set('state', st);
        return { status: 302, headers: { location: redirect.toString() } };
      },
    },
    {
      method: 'POST',
      path: '/login/oauth/access_token',
      handler: ({ body }) => {
        const tokens =
          body.grant_type === 'refresh_token'
            ? state.refresh(body.refresh_token ?? '')
            : state.exchangeCode(body.code ?? '');
        if (!tokens)
          return { json: { error: 'bad_verification_code', error_description: 'The code is invalid.' } };
        return { json: tokens };
      },
    },
    {
      // Test hook: choose which demo user the next sign-in returns.
      method: 'POST',
      path: '/__mock/user',
      handler: ({ body }) => {
        if (!body.login || !state.userByLogin(body.login))
          return { status: 400, json: { message: 'Unknown login' } };
        state.nextLogin = body.login;
        return { json: { login: state.nextLogin } };
      },
    },
  ];
}
