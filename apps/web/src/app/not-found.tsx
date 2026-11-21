import Link from 'next/link';
import { Wordmark } from '~/components/brand/wordmark';
import { Button } from '~/components/ui/button';

export default function NotFound() {
  return (
    <main className="page-frame grid min-h-dvh place-content-center justify-items-center gap-6 text-center">
      <Wordmark />
      <p className="display text-[7rem] leading-none text-muted-foreground">404</p>
      <p className="max-w-sm text-muted-foreground">
        This page does not exist, or you do not have access to it.
      </p>
      <Button asChild variant="outline">
        <Link href="/">Back to the overview</Link>
      </Button>
    </main>
  );
}
