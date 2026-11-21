import { SEVERITY_LABELS, type ScoreBreakdownRow } from '@revo/shared';
import { SeverityChip } from '~/components/revo/chips';
import { SEVERITY_CLASSES } from '~/components/revo/tone';
import { cn } from '~/lib/utils';

const PLURAL = { blocker: 'blockers', major: 'majors', minor: 'minors' } as const;

/**
 * The explainable score as an equation (100 − 12 × 2 − 4 × 1 = 72) and the
 * same table as the PR comment (spec 10).
 */
export function ScoreBreakdown({ rows, score }: { rows: ScoreBreakdownRow[]; score: number }) {
  const lost = rows.filter((r) => r.points !== 0);
  return (
    <div className="space-y-6">
      <p className="flex flex-wrap items-end gap-x-2 gap-y-4 sm:gap-x-3">
        <span className="sr-only">
          {`100 ${lost
            .map(
              (r) => `minus ${-r.points} for ${r.count} ${r.count === 1 ? r.severity : PLURAL[r.severity]}`,
            )
            .join(' ')} equals ${score}`}
        </span>
        <Term value="100" caption="start" />
        {lost.map((r) => (
          <span key={r.severity} className="contents">
            <Operator>−</Operator>
            <Term
              value={String(-r.points)}
              caption={`${r.count} ${r.count === 1 ? r.severity : PLURAL[r.severity]}`}
              tone={r.severity}
            />
          </span>
        ))}
        <Operator>=</Operator>
        <Term value={String(score)} caption="score" strong />
      </p>
      <table className="w-full text-sm">
        <caption className="sr-only">Score breakdown</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="eyebrow pb-2.5 text-left font-medium">
              Severity
            </th>
            <th scope="col" className="eyebrow pb-2.5 text-right font-medium">
              Count
            </th>
            <th scope="col" className="eyebrow pb-2.5 text-right font-medium">
              Points
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.severity} className="border-b border-border last:border-0">
              <th scope="row" className="py-2.5 text-left font-normal">
                <SeverityChip severity={r.severity} />
                <span className="sr-only">{SEVERITY_LABELS[r.severity]}</span>
              </th>
              <td className="tabular py-2.5 text-right font-mono text-xs">{r.count}</td>
              <td
                className={cn(
                  'tabular py-2.5 text-right font-mono text-xs',
                  r.points < 0 ? 'text-bad-ink' : 'text-muted-foreground',
                )}
              >
                {r.points < 0 ? `−${-r.points}` : '0'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.find((r) => r.severity === 'minor' && r.count * 4 > -r.points && r.points !== 0) ? (
        <p className="font-mono text-[0.6875rem] text-muted-foreground">
          Minors cost 12 points at most in total.
        </p>
      ) : null}
    </div>
  );
}

function Operator({ children }: { children: string }) {
  return (
    <span aria-hidden="true" className="display pb-5 text-2xl text-muted-foreground sm:text-3xl">
      {children}
    </span>
  );
}

function Term({
  value,
  caption,
  tone,
  strong = false,
}: {
  value: string;
  caption: string;
  tone?: ScoreBreakdownRow['severity'];
  strong?: boolean;
}) {
  return (
    <span aria-hidden="true" className="inline-flex flex-col items-start gap-1.5">
      <span
        className={cn(
          'display tabular text-[2.1rem] leading-none sm:text-[2.6rem]',
          tone && SEVERITY_CLASSES[tone].ink,
          strong && 'underline decoration-accent-brand decoration-2 underline-offset-[6px]',
        )}
      >
        {value}
      </span>
      <span className="eyebrow text-[0.625rem]">{caption}</span>
    </span>
  );
}
