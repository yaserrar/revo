import { cn } from '~/lib/utils';

/** The Revo mark: an open dial with a closing tick, in the accent colour. */
export function RevoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('size-5 text-accent-brand', className)}>
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="2.5"
      />
      <path
        d="M12 3a9 9 0 1 1-8.66 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
    </svg>
  );
}

/** Mark + serif wordmark. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-foreground', className)}>
      <RevoMark />
      <span className="display text-[1.55rem] leading-none italic">Revo</span>
    </span>
  );
}
