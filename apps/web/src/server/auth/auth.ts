import 'server-only';
import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import { env, githubSignInEnabled } from '../config/env';
import { logger } from '../config/logger';
import { refreshRepoAccess } from './repo-access';
import { upsertGithubUser, type GithubProfile } from './users';

/**
 * Auth.js v5 with GitHub OAuth (the GitHub App's client id/secret).
 * Sessions are encrypted JWT cookies: no session tables. The GitHub user
 * token is stored encrypted on User for the hourly repo-access refresh.
 * GITHUB_OAUTH_BASE_URL / GITHUB_API_URL point at a mock outside production.
 */
const github = GitHub({
  clientId: env.GITHUB_CLIENT_ID,
  clientSecret: env.GITHUB_CLIENT_SECRET,
  issuer: `${env.GITHUB_OAUTH_BASE_URL}/login/oauth`,
  // GitHub App user tokens ignore scopes; access comes from the app's permissions.
  authorization: { url: `${env.GITHUB_OAUTH_BASE_URL}/login/oauth/authorize`, params: { scope: '' } },
  token: `${env.GITHUB_OAUTH_BASE_URL}/login/oauth/access_token`,
  userinfo: {
    url: `${env.GITHUB_API_URL}/user`,
    async request({ tokens }: { tokens: { access_token?: string } }) {
      const res = await fetch(`${env.GITHUB_API_URL}/user`, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          'User-Agent': 'Revo',
          Accept: 'application/vnd.github+json',
        },
      });
      if (!res.ok) throw new Error(`GitHub /user failed with ${res.status}`);
      return res.json();
    },
  },
});

/** The message of the error Auth.js wrapped (never tokens: only the error text). */
function authCause(error: Error): string | undefined {
  const cause: unknown = (error as { cause?: unknown }).cause;
  const inner = cause instanceof Error ? cause : (cause as { err?: unknown } | undefined)?.err;
  return inner instanceof Error ? `${inner.name}: ${inner.message}` : undefined;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: env.AUTH_SECRET,
  session: { strategy: 'jwt', maxAge: 30 * 24 * 3600 },
  pages: { signIn: '/sign-in', error: '/sign-in' },
  providers: githubSignInEnabled ? [github] : [],
  logger: {
    // Auth.js wraps the real failure (token exchange, checks, callbacks) in `cause`.
    error: (error) =>
      logger.error({ err: error.message, name: error.name, cause: authCause(error) }, 'auth error'),
    warn: (code) => logger.warn({ code }, 'auth warning'),
  },
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.provider === 'github' && profile && account.access_token) {
        const user = await upsertGithubUser(profile as unknown as GithubProfile, {
          access_token: account.access_token,
          refresh_token: account.refresh_token,
          expires_in: account.expires_at ? account.expires_at - Math.floor(Date.now() / 1000) : undefined,
          refresh_token_expires_in:
            typeof account.refresh_token_expires_in === 'number'
              ? account.refresh_token_expires_in
              : undefined,
        });
        token.uid = user.id;
        token.login = user.login;
        // Spec 11: access is checked through the GitHub API at sign-in.
        await refreshRepoAccess(user.id).catch((err: unknown) =>
          logger.warn(
            { userId: user.id, err: err instanceof Error ? err.message : String(err) },
            'repo access check failed at sign-in',
          ),
        );
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.uid === 'string') session.user.id = token.uid;
      if (typeof token.login === 'string') session.user.login = token.login;
      return session;
    },
  },
});
