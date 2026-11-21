import { splitFullName } from '@revo/shared';
import { cn } from '~/lib/utils';
import type { TrendsDto } from '~/types/trends';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The 10 files with the most confirmed findings, ranked, with a severity-split rule. */
export function TopFiles({ files }: { files: TrendsDto['topFiles'] }) {
  const max = Math.max(1, ...files.map((f) => f.findings));
  return (
    <ol className="grid lg:grid-flow-col lg:grid-cols-2 lg:grid-rows-5 lg:gap-x-12">
      {files.map((f, i) => {
        const minors = f.findings - f.blockers - f.majors;
        return (
          <li
            key={`${f.repoFullName}:${f.file}`}
            className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-border py-3 last:border-0 lg:[&:nth-child(5)]:border-0"
          >
            <span
              className={cn(
                'display tabular text-2xl leading-none',
                i < 3 ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="truncate font-mono text-[13px]" title={f.file}>
                {f.file}
              </p>
              <div
                className="mt-2 flex h-1.5 gap-px overflow-hidden rounded-full"
                aria-hidden="true"
                style={{ width: `${(f.findings / max) * 100}%` }}
              >
                {f.blockers > 0 ? <span className="bg-sev-blocker" style={{ flexGrow: f.blockers }} /> : null}
                {f.majors > 0 ? <span className="bg-sev-major" style={{ flexGrow: f.majors }} /> : null}
                {minors > 0 ? <span className="bg-sev-minor" style={{ flexGrow: minors }} /> : null}
              </div>
              <p className="mt-1.5 truncate font-mono text-[0.6875rem] text-muted-foreground">
                {splitFullName(f.repoFullName).name}
                {f.blockers > 0 ? ` · ${plural(f.blockers, 'blocker')}` : ''}
                {f.majors > 0 ? ` · ${plural(f.majors, 'major')}` : ''}
                {minors > 0 ? ` · ${plural(minors, 'minor')}` : ''}
              </p>
            </div>
            <span
              className="display tabular text-[1.75rem] leading-none"
              aria-label={plural(f.findings, 'finding')}
            >
              {f.findings}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
