import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { GithubMark } from '~/components/brand/github-mark';
import { Wordmark } from '~/components/brand/wordmark';
import { Button } from '~/components/ui/button';
import { safeCallbackPath } from '~/lib/safe-callback';
import { signIn } from '~/server/auth/auth';
import { needsGithubSignIn } from '~/server/auth/repo-access';
import { getSessionUser } from '~/server/auth/session';
import { env, githubSignInEnabled } from '~/server/config/env';

export const metadata: Metadata = { title: 'Sign in' };

const ERRORS: Record<string, string> = {
  AccessDenied: 'GitHub did not grant access. Try again, or ask an organisation owner.',
  Configuration: 'Sign-in is misconfigured on the server.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const callbackUrl = safeCallbackPath(params.callbackUrl, env.APP_URL);
  const user = await getSessionUser();
  // Signed in with a usable GitHub authorization: nothing to do here.
  const reauth = user ? await needsGithubSignIn(user.id) : false;
  if (user && !reauth) redirect(callbackUrl);
  const error =
    typeof params.error === 'string' ? (ERRORS[params.error] ?? 'Sign-in failed. Try again.') : null;
  const notice = reauth ? 'Your GitHub authorization ended. Sign in again to see your repos.' : null;

  async function signInWithGithub() {
    'use server';
    await signIn('github', { redirectTo: callbackUrl });
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-sm rounded-[2rem] border border-border bg-card p-8 text-center shadow-elevated">
        <Link
          href="/"
          aria-label="Revo, home"
          className="inline-flex rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Wordmark />
        </Link>
        <h1 className="display mt-6 text-4xl leading-tight">Sign in to Revo</h1>
        <p className="mt-2 text-sm text-muted-foreground">With your GitHub account.</p>
        {githubSignInEnabled ? (
          <form action={signInWithGithub} className="mt-8">
            <Button type="submit" size="lg" className="w-full gap-2.5">
              <GithubMark className="size-[18px]" />
              Sign in with GitHub
            </Button>
          </form>
        ) : (
          <p className="mt-8 rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3 text-left text-sm text-warn-ink">
            GitHub sign-in is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.
          </p>
        )}
        {error ? (
          <p role="alert" className="mt-4 text-sm text-bad-ink">
            {error}
          </p>
        ) : null}
        {notice && !error ? (
          <p role="status" className="mt-4 text-sm text-warn-ink">
            {notice}
          </p>
        ) : null}
        <p className="mt-6 font-mono text-[0.6875rem] leading-relaxed text-muted-foreground">
          Read-only access to your profile. Repos come from the Revo GitHub App.
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          <Link href="/" className="underline-offset-4 hover:text-foreground hover:underline">
            Home
          </Link>
          {' · '}
          <Link href="/privacy" className="underline-offset-4 hover:text-foreground hover:underline">
            Privacy
          </Link>
          {' · '}
          <Link href="/terms" className="underline-offset-4 hover:text-foreground hover:underline">
            Terms
          </Link>
        </p>
      </div>
    </main>
  );
}
