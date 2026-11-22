import Link from 'next/link';
import { GithubMark } from '~/components/brand/github-mark';
import { Wordmark } from '~/components/brand/wordmark';
import { ThemeToggle } from '~/components/layout/theme-toggle';
import { Button } from '~/components/ui/button';
import { SOURCE_URL } from '~/constants/site';

const SECTIONS = [
  { href: '/#how', label: 'How it works' },
  { href: '/#score', label: 'Score' },
  { href: '/#open-source', label: 'Open source' },
] as const;

/** The landing page's floating pill, in the dashboard nav's shape. */
export function LandingHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-3 z-40 flex justify-center px-3 sm:top-4">
      <nav
        aria-label="Main"
        className="pointer-events-auto flex h-14 w-full max-w-[60rem] items-center gap-1 rounded-full border border-border/70 bg-glass pr-2 pl-4 shadow-float backdrop-blur-xl backdrop-saturate-150"
      >
        <Link
          href="/"
          aria-label="Revo, home"
          className="mr-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Wordmark />
        </Link>
        <ul className="mx-auto hidden items-center gap-0.5 md:flex">
          {SECTIONS.map((s) => (
            <li key={s.href}>
              <a
                href={s.href}
                className="flex h-9 items-center rounded-full px-3.5 text-[13px] font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <Button asChild variant="ghost" size="icon" className="hidden sm:inline-flex">
            <a href={SOURCE_URL} target="_blank" rel="noreferrer" aria-label="Revo on GitHub">
              <GithubMark className="size-[18px]" />
            </a>
          </Button>
          <ThemeToggle />
          <Button asChild size="sm" className="ml-1">
            <Link href={signedIn ? '/overview' : '/sign-in'}>{signedIn ? 'Open dashboard' : 'Sign in'}</Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}
