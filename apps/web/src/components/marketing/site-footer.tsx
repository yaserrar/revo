import Link from 'next/link';
import { Wordmark } from '~/components/brand/wordmark';
import { DEPLOY_GUIDE_URL, SOURCE_URL } from '~/constants/site';

const linkClass =
  'rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

/** Footer of the public pages: landing, privacy, terms. */
export function SiteFooter({ signedIn }: { signedIn: boolean }) {
  return (
    <footer className="border-t border-border">
      <div className="page-frame flex flex-col gap-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            aria-label="Revo, home"
            className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Wordmark />
          </Link>
          <span className="font-mono text-[0.6875rem]">MIT · {new Date().getFullYear()}</span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
          <a href={SOURCE_URL} target="_blank" rel="noreferrer" className={linkClass}>
            GitHub
          </a>
          <a href={DEPLOY_GUIDE_URL} target="_blank" rel="noreferrer" className={linkClass}>
            Self-hosting
          </a>
          <Link href="/privacy" className={linkClass}>
            Privacy
          </Link>
          <Link href="/terms" className={linkClass}>
            Terms
          </Link>
          <Link href={signedIn ? '/overview' : '/sign-in'} className={linkClass}>
            {signedIn ? 'Dashboard' : 'Sign in'}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
