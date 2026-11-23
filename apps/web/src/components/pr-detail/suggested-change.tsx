import type { FindingDto } from '@revo/shared';
import { cn } from '~/lib/utils';

type Line = { kind: 'del' | 'add'; text: string };

/** The flagged lines (from the stored snippet) and their replacement, as diff lines; null when unknown. */
export function changeLines(
  f: Pick<FindingDto, 'replacement' | 'snippet' | 'snippetStartLine' | 'lineStart' | 'lineEnd'>,
): Line[] | null {
  if (f.replacement === null || !f.snippet || f.lineStart < f.snippetStartLine) return null;
  const old = f.snippet
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .slice(f.lineStart - f.snippetStartLine, f.lineEnd - f.snippetStartLine + 1);
  if (old.length !== f.lineEnd - f.lineStart + 1) return null;
  const added = f.replacement === '' ? [] : f.replacement.split('\n');
  return [
    ...old.map((text) => ({ kind: 'del' as const, text })),
    ...added.map((text) => ({ kind: 'add' as const, text })),
  ];
}

/**
 * The exact change Revo offered as a GitHub suggested change ("Apply
 * suggestion" on the inline comment): removed lines, then added ones.
 */
export function SuggestedChange({ finding }: { finding: FindingDto }) {
  const lines = changeLines(finding);
  if (!lines) return null;
  return (
    <figure className="mt-4 min-w-0">
      <figcaption className="mb-2 font-mono text-[0.6875rem] text-muted-foreground">
        {finding.posted ? 'One click on GitHub: Apply suggestion' : 'Exact change'}
      </figcaption>
      <div
        role="region"
        aria-label="Suggested change"
        tabIndex={0}
        className="overflow-x-auto rounded-xl border border-border bg-code focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <pre className="min-w-fit py-2 font-mono text-[0.8125rem] leading-6">
          {lines.map((l, i) => (
            <div
              key={i}
              className={cn(
                'flex px-3',
                l.kind === 'del' ? 'bg-diff-del text-diff-del-ink' : 'bg-diff-add text-diff-add-ink',
              )}
            >
              <span className="w-5 shrink-0 select-none" aria-hidden="true">
                {l.kind === 'del' ? '−' : '+'}
              </span>
              <span className="sr-only">{l.kind === 'del' ? 'Removed: ' : 'Added: '}</span>
              <code className="whitespace-pre">{l.text || ' '}</code>
            </div>
          ))}
        </pre>
      </div>
    </figure>
  );
}
