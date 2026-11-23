'use client';

import { Magicpen } from 'iconsax-react';
import { motion } from 'motion/react';
import { languageForPath, SEVERITY_LABELS, type FindingDto } from '@revo/shared';
import { CategoryChip, SeverityChip } from '~/components/revo/chips';
import { CodeSnippet } from '~/components/revo/code-snippet';
import { SEVERITY_CLASSES } from '~/components/revo/tone';
import { formatLines, formatPercent } from '~/lib/format';
import { cn } from '~/lib/utils';
import { FeedbackBar } from './feedback-bar';
import { FindingStatusChip } from './finding-status';
import { Markdown } from './markdown';
import { SuggestedChange } from './suggested-change';

/** One confirmed finding: what, where, why, how to fix, the code, and feedback. */
export function FindingCard({
  finding,
  position,
  reviewId,
  login,
}: {
  finding: FindingDto;
  position: number;
  reviewId: string;
  login: string;
}) {
  const f = finding;
  return (
    <motion.article
      id={`finding-${f.id}`}
      aria-labelledby={`finding-${f.id}-title`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(position, 5) * 0.05, ease: [0.22, 1, 0.36, 1] }}
      className="relative min-w-0 scroll-mt-28 overflow-hidden rounded-3xl border border-border bg-card shadow-card"
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-[3px]', SEVERITY_CLASSES[f.severity].dot)}
      />
      <header className="px-5 pt-5 sm:px-7 sm:pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="display tabular mr-1 text-2xl leading-none text-muted-foreground"
            aria-hidden="true"
          >
            {String(position + 1).padStart(2, '0')}
          </span>
          <SeverityChip severity={f.severity} />
          <CategoryChip category={f.category} />
          <FindingStatusChip finding={f} />
          {f.originalSeverity && f.originalSeverity !== f.severity ? (
            <span className="font-mono text-[0.6875rem] text-muted-foreground">
              lowered from {SEVERITY_LABELS[f.originalSeverity].toLowerCase()} by verification
            </span>
          ) : null}
          <span className="ml-auto font-mono text-[0.6875rem] text-muted-foreground" title="Model confidence">
            {formatPercent(f.confidence)} sure
          </span>
        </div>
        <h3
          id={`finding-${f.id}-title`}
          className="display mt-4 text-[1.75rem] leading-tight text-balance sm:text-[2rem]"
        >
          {f.title}
        </h3>
        <p className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 font-mono text-xs text-muted-foreground">
          <span className="min-w-0 truncate text-ink-soft">{f.file}</span>
          <span aria-hidden="true">·</span>
          <span>{formatLines(f.lineStart, f.lineEnd)}</span>
          {f.posted ? (
            <>
              <span aria-hidden="true">·</span>
              <span>posted inline on GitHub</span>
            </>
          ) : null}
        </p>
      </header>

      <div className="space-y-5 px-5 pt-4 pb-6 sm:px-7">
        <Markdown
          source={f.explanation}
          lang={languageForPath(f.file)}
          className="max-w-[68ch] text-pretty text-foreground"
        />
        {f.snippet ? (
          <CodeSnippet
            code={f.snippet}
            path={f.file}
            startLine={f.snippetStartLine}
            highlight={{ from: f.lineStart, to: f.lineEnd }}
          />
        ) : null}
        {f.suggestion ? (
          <section aria-label="Suggested fix" className="rounded-2xl bg-accent-brand-soft/50 p-4 sm:p-5">
            <p className="eyebrow mb-3 flex items-center gap-1.5 text-accent-brand-ink">
              <Magicpen className="size-3.5" />
              Suggested fix
            </p>
            <Markdown source={f.suggestion} lang={languageForPath(f.file)} />
            <SuggestedChange finding={f} />
          </section>
        ) : null}
      </div>

      <footer className="border-t border-border bg-paper-sunken/60 px-5 py-4 sm:px-7">
        <FeedbackBar finding={f} reviewId={reviewId} login={login} />
      </footer>
    </motion.article>
  );
}
