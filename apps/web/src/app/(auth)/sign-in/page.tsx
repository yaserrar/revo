import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { GithubMark } from '~/components/brand/github-mark';
import { Wordmark } from '~/components/brand/wordmark';
import { ExampleReview } from '~/components/marketing/example-review';
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
    <main className="page-frame grid min-h-dvh items-center gap-14 py-12 lg:grid-cols-[1.05fr_1fr] lg:gap-20">
      <section className="max-w-xl">
        <Wordmark />
        <h1 className="display mt-10 text-[3.25rem] leading-[0.98] text-balance sm:text-7xl">
          Reviews that <em className="text-accent-brand-ink">prove</em> their point.
        </h1>
        <ul className="mt-8 space-y-3 text-[15px] leading-relaxed text-muted-foreground">
          <li className="flex gap-3">
            <span className="eyebrow pt-1.5 text-foreground">01</span>Reads every pull request with Claude,
            then tries to disprove each finding.
          </li>
          <li className="flex gap-3">
            <span className="eyebrow pt-1.5 text-foreground">02</span>Posts at most five problems, with a
            score out of 100 that a fixed formula explains.
          </li>
          <li className="flex gap-3">
            <span className="eyebrow pt-1.5 text-foreground">03</span>Shows its own precision and what every
            review cost.
          </li>
        </ul>
        <div className="mt-10 flex flex-col items-start gap-3">
          {githubSignInEnabled ? (
            <form action={signInWithGithub}>
              <Button type="submit" size="lg" className="gap-2.5 pr-6">
                <GithubMark className="size-[18px]" />
                Sign in with GitHub
              </Button>
            </form>
          ) : (
            <p className="rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn-ink">
              GitHub sign-in is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.
            </p>
          )}
          {error ? (
            <p role="alert" className="text-sm text-bad-ink">
              {error}
            </p>
          ) : null}
          {notice && !error ? (
            <p role="status" className="text-sm text-warn-ink">
              {notice}
            </p>
          ) : null}
          <p className="font-mono text-[0.6875rem] text-muted-foreground">
            Read-only access to your profile. Repos come from the Revo GitHub App.
          </p>
          <p className="text-xs text-muted-foreground">
            <Link href="/privacy" className="underline-offset-4 hover:text-foreground hover:underline">
              Privacy
            </Link>
            {' · '}
            <Link href="/terms" className="underline-offset-4 hover:text-foreground hover:underline">
              Terms
            </Link>
          </p>
        </div>
      </section>

      <ExampleReview />
    </main>
  );
}
