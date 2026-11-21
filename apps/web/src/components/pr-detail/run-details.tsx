import { modelName, type ReviewDto } from '@revo/shared';
import { formatDateTime, formatDuration, formatTokens, formatUsd, shortSha } from '~/lib/format';

/**
 * Spec 11.4 "Run details": model, tokens, cost, duration, files. "Tokens in"
 * is the whole prompt: plain input plus what was written to and read from the
 * prompt cache (each billed at its own rate), so it reconciles with the cost.
 */
export function RunDetails({ review }: { review: ReviewDto }) {
  const promptTokens = review.inputTokens + review.cacheWriteTokens + review.cachedTokens;
  const rows: [string, string][] = [
    ['Model', modelName(review.model)],
    ['Commit', shortSha(review.headSha)],
    ['Trigger', review.trigger === 'manual' ? 'Review again' : 'Automatic'],
    ['Tokens in', formatTokens(promptTokens)],
    ['Tokens out', formatTokens(review.outputTokens)],
    ['Cache write', formatTokens(review.cacheWriteTokens)],
    ['Cache read', formatTokens(review.cachedTokens)],
    ['Cost', formatUsd(review.costUsd)],
    ['Duration', review.durationMs === null ? '—' : formatDuration(review.durationMs)],
    ['Files reviewed', String(review.filesReviewed)],
    ['Files skipped', String(review.filesSkipped)],
    ['Started', formatDateTime(review.createdAt)],
  ];
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className={label === 'Model' || label === 'Started' ? 'col-span-2 min-w-0' : 'min-w-0'}
          >
            <dt className="eyebrow text-[0.625rem]">{label}</dt>
            <dd className="tabular mt-1 truncate font-mono text-[13px] text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      {review.notes.length > 0 ? (
        <ul className="space-y-1.5">
          {review.notes.map((n) => (
            <li key={n} className="rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn-ink">
              {n}
            </li>
          ))}
        </ul>
      ) : null}
      {review.skippedFiles.length > 0 ? (
        <details className="group">
          <summary className="eyebrow cursor-pointer rounded-md py-1 outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            Skipped files ({review.skippedFiles.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {review.skippedFiles.map((f) => (
              <li key={f} className="truncate font-mono text-xs text-muted-foreground" title={f}>
                {f}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
