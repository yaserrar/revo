import type { ReactNode } from 'react';
import { LandingHeader } from './landing-header';
import { SiteFooter } from './site-footer';

/** Last change of the privacy policy and the terms. */
export const LEGAL_UPDATED = 'November 22, 2026';

/** A section of a legal page: a numbered heading and plain paragraphs or lists. */
export function LegalSection({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={`legal-${n}`}
      className="grid gap-4 border-t border-border py-9 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-10"
    >
      <div>
        <p className="eyebrow">{n}</p>
        <h2 id={`legal-${n}`} className="display mt-2 text-2xl leading-tight">
          {title}
        </h2>
      </div>
      <div className="min-w-0 space-y-4 text-[15px] leading-relaxed text-ink-soft [&_a]:font-medium [&_a]:text-accent-brand-ink [&_a]:underline-offset-4 [&_a:hover]:underline [&_li]:pl-1 [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

/** Shell of /privacy and /terms: the landing header, a title, the sections, the footer. */
export function LegalPage({
  eyebrow,
  title,
  intro,
  signedIn,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: ReactNode;
  signedIn: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <LandingHeader signedIn={signedIn} />
      <main className="page-frame pt-32 pb-16 sm:pt-40 lg:pb-24">
        <article className="mx-auto max-w-4xl">
          <header className="max-w-2xl pb-10">
            <p className="eyebrow">{eyebrow}</p>
            <h1 className="display mt-5 text-5xl leading-[1] text-balance sm:text-6xl">{title}</h1>
            <p className="mt-6 text-[15px] leading-relaxed text-muted-foreground">{intro}</p>
            <p className="mt-4 font-mono text-[0.6875rem] text-muted-foreground">
              Last updated {LEGAL_UPDATED}
            </p>
          </header>
          {children}
        </article>
      </main>
      <SiteFooter signedIn={signedIn} />
    </>
  );
}

/** How to reach the operator: CONTACT_EMAIL when set, otherwise the project's GitHub issues. */
export function ContactLine({ email, issuesUrl }: { email: string | undefined; issuesUrl: string }) {
  return email ? (
    <p>
      Write to <a href={`mailto:${email}`}>{email}</a>.
    </p>
  ) : (
    <p>
      Open an issue on <a href={issuesUrl}>GitHub</a>. Do not post secrets or private code there.
    </p>
  );
}
