import type { Category, Finding } from '@revo/shared';
import type { Expected } from './cases';

/** Lines of tolerance when matching a finding to an expected bug. */
export const LINE_TOLERANCE = 3;

/** V1 targets (spec 15). */
export const TARGETS = { bugsFound: 8, maxFalseAlarms: 1, maxAvgCostUsd: 0.3 } as const;

export function matches(
  finding: Pick<Finding, 'file' | 'lineStart' | 'lineEnd'>,
  expected: Expected,
): boolean {
  return (
    finding.file === expected.file &&
    finding.lineStart <= expected.lineEnd + LINE_TOLERANCE &&
    expected.lineStart <= finding.lineEnd + LINE_TOLERANCE
  );
}

export type ResultFinding = Pick<
  Finding,
  'file' | 'lineStart' | 'lineEnd' | 'category' | 'severity' | 'title' | 'confidence'
> & { reason?: string };

export type CaseResult = {
  id: string;
  expected: Expected[];
  /** Confirmed findings (what Revo would post). */
  findings: ResultFinding[];
  /** Rejected by pass 2, for analysis. */
  rejected?: ResultFinding[];
  costUsd: number;
  durationMs: number;
  /** Context size estimate and the real prompt tokens of pass 1, to check the estimate. */
  estimatedTokens?: number;
  promptTokens?: number;
  /** Set when the review failed. */
  error?: string;
};

export type EvalSummary = {
  cases: number;
  failed: number;
  bugCases: number;
  bugsFound: number;
  recall: number;
  findings: number;
  /** Findings that hit an expected bug (file, lines and category), at most one per bug. */
  correctFindings: number;
  /** Further findings on a bug already hit (they lower precision). */
  duplicateFindings: number;
  precision: number;
  /** Bugs missed that a finding did point at, but under another category. */
  locationOnlyMatches: number;
  cleanCases: number;
  falseAlarms: number;
  totalCostUsd: number;
  /** Over the cases that completed (a failed case's partial cost is in the total only). */
  avgCostUsd: number;
  avgDurationMs: number;
  /**
   * Targets of spec 15. `complete` is false when any case failed: then recall
   * and false alarms are not met either, because the failed cases were not measured.
   */
  meetsTargets: { recall: boolean; falseAlarms: boolean; cost: boolean; complete: boolean };
};

export type CaseVerdict = 'found' | 'missed' | 'clean' | 'false-alarm' | 'failed';

/** A finding hits an expected bug at its file and lines (± tolerance) with the same category (spec 15). */
export function hits(finding: ResultFinding, expected: Expected): boolean {
  return matches(finding, expected) && sameCategory(finding.category, expected.category);
}

export function caseVerdict(r: CaseResult): CaseVerdict {
  if (r.error) return 'failed';
  if (r.expected.length === 0) return r.findings.length === 0 ? 'clean' : 'false-alarm';
  return r.expected.some((e) => r.findings.some((f) => hits(f, e))) ? 'found' : 'missed';
}

/** Per case: findings credited to an expected bug (first one per bug) and the duplicates. */
function credit(r: CaseResult): { correct: number; duplicates: number } {
  const claimed = new Set<number>();
  let correct = 0;
  let duplicates = 0;
  for (const f of r.findings) {
    const bugs = r.expected.flatMap((e, i) => (hits(f, e) ? [i] : []));
    if (bugs.length === 0) continue;
    const fresh = bugs.find((i) => !claimed.has(i));
    if (fresh === undefined) duplicates++;
    else {
      claimed.add(fresh);
      correct++;
    }
  }
  return { correct, duplicates };
}

export function summarize(results: readonly CaseResult[]): EvalSummary {
  const completed = results.filter((r) => !r.error);
  const failed = results.length - completed.length;
  const bugCases = results.filter((r) => r.expected.length > 0);
  const cleanCases = results.filter((r) => r.expected.length === 0);
  const found = bugCases.filter((r) => caseVerdict(r) === 'found');
  const findings = results.reduce((sum, r) => sum + r.findings.length, 0);
  const credited = results.map(credit);
  const correct = credited.reduce((sum, c) => sum + c.correct, 0);
  const duplicates = credited.reduce((sum, c) => sum + c.duplicates, 0);
  const locationOnlyMatches = bugCases.filter(
    (r) => caseVerdict(r) === 'missed' && r.expected.some((e) => r.findings.some((f) => matches(f, e))),
  ).length;
  const totalCostUsd = results.reduce((s, r) => s + r.costUsd, 0);
  const done = completed.length || 1;
  const avgCostUsd = completed.reduce((s, r) => s + r.costUsd, 0) / done;
  const falseAlarms = cleanCases.reduce((sum, r) => sum + r.findings.length, 0);
  const cleanFailed = cleanCases.some((r) => r.error);
  return {
    cases: results.length,
    failed,
    bugCases: bugCases.length,
    bugsFound: found.length,
    recall: bugCases.length ? found.length / bugCases.length : 1,
    findings,
    correctFindings: correct,
    duplicateFindings: duplicates,
    precision: findings ? correct / findings : 1,
    locationOnlyMatches,
    cleanCases: cleanCases.length,
    falseAlarms,
    totalCostUsd,
    avgCostUsd,
    avgDurationMs: completed.reduce((s, r) => s + r.durationMs, 0) / done,
    meetsTargets: {
      // Scaled to the set's size: 8 of 10 bugs.
      recall: found.length >= Math.ceil((TARGETS.bugsFound / 10) * bugCases.length),
      falseAlarms: !cleanFailed && falseAlarms <= TARGETS.maxFalseAlarms,
      cost: completed.length > 0 && avgCostUsd < TARGETS.maxAvgCostUsd,
      complete: failed === 0,
    },
  };
}

/** `bug` and `data` overlap (races and timezones are both); count either as a category match. */
function sameCategory(a: Category, b: Category): boolean {
  const group = (c: Category) => (c === 'data' ? 'bug' : c);
  return group(a) === group(b);
}
