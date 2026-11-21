import { ArrowRight, Hierarchy } from 'iconsax-react';
import { ScoreDial } from '~/components/revo/score-dial';
import { Button } from '~/components/ui/button';

/** Shown when the user can see no repo yet (spec 3.1): install the GitHub App first. */
export function InstallCta({ installUrl }: { installUrl: string | null }) {
  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-border bg-card shadow-card">
      <div className="grid items-center gap-10 p-6 sm:p-10 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="max-w-lg">
          <p className="eyebrow">Step 1 of 2 · Install</p>
          <h2 className="display mt-4 text-4xl leading-[1.05] text-balance sm:text-5xl">
            Install Revo on the repos it should read.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
            Pick an account and the repositories on GitHub. Revo reviews the next pull request opened there,
            posts one comment with a score, and the result shows up here.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {installUrl ? (
              <Button asChild variant="accent" size="lg">
                <a href={installUrl}>
                  <Hierarchy className="size-[18px]" />
                  Install on GitHub
                  <ArrowRight className="size-4" />
                </a>
              </Button>
            ) : (
              <p className="rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn-ink">
                Set GITHUB_APP_SLUG to show the install link.
              </p>
            )}
            <span className="font-mono text-[0.6875rem] text-muted-foreground">
              Access to your repos is checked on GitHub every hour.
            </span>
          </div>
        </div>
        <div className="hidden justify-self-center md:block" aria-hidden="true">
          <ScoreDial score={null} size="lg" label="Waiting" animate={false} />
        </div>
      </div>
    </section>
  );
}
