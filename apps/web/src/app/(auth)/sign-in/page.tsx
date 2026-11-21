import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { GithubMark } from '~/components/brand/github-mark';
import { Wordmark } from '~/components/brand/wordmark';
import { CategoryChip, SeverityChip } from '~/components/revo/chips';
import { ScoreDial } from '~/components/revo/score-dial';
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
        </div>
      </section>

      <aside aria-label="Example review comment" className="relative">
        <div className="rounded-[2rem] border border-border bg-card p-6 shadow-elevated sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="eyebrow">northwind-labs/storefront · #241</p>
              <p className="mt-2 truncate text-sm font-medium">Apply promo codes at checkout</p>
            </div>
            <span className="shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground">
              58 → 72
            </span>
          </div>
          <div className="mt-8 flex justify-center">
            <ScoreDial score={72} size="lg" />
          </div>
          <p className="mt-5 mb-7 text-center font-mono text-[0.6875rem] text-muted-foreground">
            100 − 24 <span className="text-sev-major-ink">2 major</span> − 4{' '}
            <span className="text-ink-soft">1 minor</span> = <span className="text-foreground">72</span>
          </p>
          <div className="space-y-4 border-t border-border pt-6">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityChip severity="major" />
              <CategoryChip category="bug" />
              <span className="font-mono text-xs text-muted-foreground">src/lib/pricing.ts · line 44</span>
              <span className="eyebrow ml-auto hidden sm:inline">1 of 3</span>
            </div>
            <p className="display text-2xl leading-tight">Discount applied after tax</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              A $20 code on a $100 cart with 20% tax charges $100 instead of $96. Subtract the promo before
              computing tax.
            </p>
          </div>
          <p className="mt-6 border-t border-border pt-4 font-mono text-[0.6875rem] text-muted-foreground">
            Reviewed 9 files · Claude Sonnet 5.5 · 41 s · $0.18
          </p>
        </div>
      </aside>
    </main>
  );
}
