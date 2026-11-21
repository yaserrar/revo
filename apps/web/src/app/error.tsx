'use client';

import { ErrorState } from '~/components/shared/error-state';

export default function RootError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="page-frame grid min-h-dvh place-content-center">
      <ErrorState
        title="Something went wrong"
        message="The page could not be shown. Try again."
        onRetry={reset}
      />
    </main>
  );
}
