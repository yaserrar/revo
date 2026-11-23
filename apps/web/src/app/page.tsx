import { Add, ArrowRight, Coin1, ExportSquare, Flash, MessageText1, ShieldTick } from 'iconsax-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';
import { GithubMark } from '~/components/brand/github-mark';
import { ExampleReview } from '~/components/marketing/example-review';
import { LandingHeader } from '~/components/marketing/landing-header';
import { SiteFooter } from '~/components/marketing/site-footer';
import { ScoreDial } from '~/components/revo/score-dial';
import { Button } from '~/components/ui/button';
import { DEPLOY_GUIDE_URL, SOURCE_URL } from '~/constants/site';
import { signInWithGithub } from '~/server/auth/actions';
import { getSessionUser } from '~/server/auth/session';
import { env } from '~/server/config/env';
import { installUrlFor } from '~/server/modules/repos/install-url';

export const metadata: Metadata = {
  title: { absolute: 'Revo · AI code review that proves its point' },
  description:
    'Revo reviews every pull request with Claude, tries to disprove each problem before posting it, and explains its score out of 100. Open source.',
  // The only public page worth indexing; the dashboard stays out of search engines.
  robots: { index: true, follow: true },
};

const STEPS = [
  {
    n: '01',
    title: 'Read',
    body: 'On every push, Revo reads the changed files and the code they import, starting with what changed since its last review.',
  },
  {
    n: '02',
    title: 'Disprove',
    body: 'A second pass argues against each problem found. Anything it cannot confirm is dropped and never posted.',
  },
  {
    n: '03',
    title: 'Score',
    body: 'Confirmed problems cost points by severity. The GitHub check fails on any blocker, or under your threshold.',
  },
] as const;

const PENALTIES = [
  {
    label: 'Blocker',
    points: '−30',
    note: 'each, and the check fails',
    ink: 'text-sev-blocker-ink',
    dot: 'bg-sev-blocker',
  },
  { label: 'Major', points: '−12', note: 'each', ink: 'text-sev-major-ink', dot: 'bg-sev-major' },
  { label: 'Minor', points: '−4', note: 'each, at most −12', ink: 'text-sev-minor-ink', dot: 'bg-sev-minor' },
] as const;

const EXAMPLE_SCORES = [
  { score: 100, label: 'Good to merge' },
  { score: 76, label: 'Needs a look' },
  { score: 46, label: 'Changes needed' },
] as const;

const TRAITS: { icon: ComponentType<{ className?: string }>; title: string; body: string }[] = [
  {
    icon: MessageText1,
    title: 'Few comments',
    body: 'At most five verified problems per pull request by default, inline on the line that needs the fix.',
  },
  {
    icon: ShieldTick,
    title: 'Precision, measured',
    body: 'Mark each finding useful or wrong. The dashboard shows how often Revo was right.',
  },
  {
    icon: Coin1,
    title: 'Cost on every review',
    body: 'Tokens and dollars for each run, with a monthly budget per repository.',
  },
  {
    icon: Flash,
    title: 'Large pull requests',
    body: 'Up to 10,000 changed lines per review, and new pushes are read first.',
  },
];

function SectionHead({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="max-w-2xl">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="display mt-4 text-4xl leading-[1.05] text-balance sm:text-5xl">{title}</h2>
      {children ? <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">{children}</p> : null}
    </div>
  );
}

export default async function LandingPage() {
  const signedIn = Boolean(await getSessionUser());
  const installUrl = installUrlFor(env.GITHUB_APP_SLUG);
  const freeReviews = env.FREE_REVIEWS_PER_MONTH;

  return (
    <>
      <LandingHeader signedIn={signedIn} />
      <main>
        {/* Hero */}
        <section className="page-frame grid items-center gap-14 pt-32 pb-20 sm:pt-40 lg:grid-cols-[1.05fr_1fr] lg:gap-20 lg:pb-28">
          <div className="max-w-xl">
            <p className="eyebrow">Open-source AI code review for GitHub</p>
            <h1 className="display mt-6 text-[3.25rem] leading-[0.98] text-balance sm:text-7xl">
              Code review that <em className="text-accent-brand-ink">proves</em> its point.
            </h1>
            <p className="mt-7 text-[15px] leading-relaxed text-muted-foreground sm:text-base">
              Revo reads every pull request with Claude, then tries to disprove each problem it found. What
              survives is posted on GitHub, with a score out of 100 that a fixed formula explains.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              {signedIn ? (
                <Button asChild size="lg" className="gap-2.5 pr-6">
                  <Link href="/overview">Open dashboard</Link>
                </Button>
              ) : (
                <form action={signInWithGithub}>
                  <Button type="submit" size="lg" className="gap-2.5 pr-6">
                    <GithubMark className="size-[18px]" />
                    Sign in with GitHub
                  </Button>
                </form>
              )}
              {installUrl ? (
                <Button asChild size="lg" variant="accent" className="gap-2">
                  <a href={installUrl}>
                    <Add className="size-[18px]" />
                    Install on GitHub
                  </a>
                </Button>
              ) : (
                <Button asChild size="lg" variant="outline" className="gap-2">
                  <a href={SOURCE_URL} target="_blank" rel="noreferrer">
                    View the source
                    <ExportSquare className="size-4" />
                  </a>
                </Button>
              )}
            </div>
            <p className="mt-6 max-w-md text-sm leading-relaxed text-ink-soft">
              Free for {freeReviews} reviews a month per account on Claude Haiku and Sonnet. Bring your own
              Anthropic API key for unlimited reviews on every model.
            </p>
            <p className="mt-3 font-mono text-[0.6875rem] text-muted-foreground">
              <a
                href={SOURCE_URL}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-4 hover:text-foreground hover:underline"
              >
                Source on GitHub
              </a>{' '}
              · MIT licensed · Self-host with Docker · Powered by Claude
            </p>
          </div>
          <ExampleReview />
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-28 border-t border-border">
          <div className="page-frame py-20 lg:py-24">
            <SectionHead eyebrow="How it works" title="Two passes, then a score.">
              Most AI reviewers post everything they suspect. Revo posts only what holds up to a second look.
            </SectionHead>
            <ol className="mt-12 grid gap-4 md:grid-cols-3">
              {STEPS.map((s) => (
                <li key={s.n} className="rounded-[1.5rem] border border-border bg-card p-6 shadow-card">
                  <span className="display text-5xl text-accent-brand-ink">{s.n}</span>
                  <h3 className="mt-6 text-base font-medium">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Score */}
        <section id="score" className="scroll-mt-28 border-t border-border">
          <div className="page-frame grid items-center gap-12 py-20 lg:grid-cols-2 lg:gap-20 lg:py-24">
            <div>
              <SectionHead eyebrow="The score" title="A number you can check by hand.">
                Every pull request starts at 100. Each confirmed problem takes off a fixed amount, and the
                comment shows the sum.
              </SectionHead>
              <dl className="mt-10 divide-y divide-border border-y border-border">
                {PENALTIES.map((p) => (
                  <div key={p.label} className="flex items-baseline gap-4 py-4">
                    <dt className="flex w-24 shrink-0 items-center gap-2 text-sm font-medium">
                      <span aria-hidden className={`size-2 rounded-full ${p.dot}`} />
                      {p.label}
                    </dt>
                    <dd className="flex min-w-0 items-baseline gap-3">
                      <span className={`display text-3xl tabular ${p.ink}`}>{p.points}</span>
                      <span className="text-sm text-muted-foreground">{p.note}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="rounded-[2rem] border border-border bg-card p-6 shadow-elevated sm:p-8">
              <ul className="grid grid-cols-3 gap-2 sm:gap-4">
                {EXAMPLE_SCORES.map(({ score, label }) => (
                  <li key={score} className="flex flex-col items-center">
                    {/* The medium dial needs about 140 px: phones get the small one and a caption. */}
                    <ScoreDial score={score} size="md" className="hidden sm:inline-grid" />
                    <ScoreDial score={score} size="sm" className="sm:hidden" />
                    <span className="mt-2 text-center text-xs text-muted-foreground sm:hidden">{label}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-7 border-t border-border pt-5 text-center font-mono text-[0.6875rem] leading-relaxed text-muted-foreground">
                90 and up: good to merge · 70 to 89: needs a look · under 70: changes needed
              </p>
            </div>
          </div>
        </section>

        {/* Traits */}
        <section className="border-t border-border">
          <div className="page-frame py-20 lg:py-24">
            <SectionHead eyebrow="Why Revo" title="Built to be trusted, not to be loud." />
            <ul className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {TRAITS.map(({ icon: Icon, title, body }) => (
                <li key={title}>
                  <span className="grid size-10 place-items-center rounded-full bg-accent-brand-soft text-accent-brand-ink">
                    <Icon className="size-5" />
                  </span>
                  <h3 className="mt-5 text-base font-medium">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Open source */}
        <section id="open-source" className="scroll-mt-28 page-frame pb-20 lg:pb-28">
          <div className="rounded-[2rem] border border-border bg-card px-6 py-12 text-center shadow-elevated sm:px-12 sm:py-16">
            <p className="eyebrow">Open source</p>
            <h2 className="display mx-auto mt-4 max-w-2xl text-4xl leading-[1.05] text-balance sm:text-5xl">
              Run it on your own server.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
              MIT licensed. A GitHub App, Postgres, Redis and a Claude API key, started with Docker Compose.
              Your code goes only to GitHub and Claude.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg" className="gap-2.5 pr-6">
                <a href={SOURCE_URL} target="_blank" rel="noreferrer">
                  <GithubMark className="size-[18px]" />
                  Star on GitHub
                </a>
              </Button>
              <Button asChild size="lg" variant="outline" className="gap-2">
                <a href={DEPLOY_GUIDE_URL} target="_blank" rel="noreferrer">
                  Read the deploy guide
                  <ArrowRight className="size-4" />
                </a>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter signedIn={signedIn} />
    </>
  );
}
