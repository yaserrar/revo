/**
 * Scoring, kept deliberately simple.
 *
 * A posted finding MATCHES an expected bug when it is in the same file and its
 * lines overlap the bug's lines widened by LINE_TOLERANCE on each side (the
 * bug's main location or any `alsoAt`). Category and wording are not compared:
 * the question is "did Revo point at the bug", and a reader checks the titles
 * in the report. Each bug is credited once; another finding on it is a duplicate.
 *
 * Every posted finding gets one label:
 * - hit: first finding on an expected bug
 * - duplicate: another finding on a bug already hit
 * - known-false-positive: matches bench/known-false-positives.json (counted as a false alarm)
 * - false-alarm: blocker or major finding on a clean case
 * - nit: minor finding on a clean case (accepted: "no findings or minor nits")
 * - extra: unexpected finding on a bug case (reported, not scored: it may be real)
 *
 * Rejected findings (dropped by pass 2) are matched too, to show bugs that
 * pass 1 found and pass 2 threw away.
 */
import type { Category, Severity } from '@revo/shared';
import type { Expected, KnownFalsePositive, Location } from './cases';

export const LINE_TOLERANCE = 5;

export type BenchFinding = {
  file: string;
  lineStart: number;
  lineEnd: number;
  severity: Severity;
  category: Category;
  title: string;
  explanation: string;
  confidence: number;
  /** Pass 2's reason (kept or rejected). */
  reason: string;
};

export type FindingLabel = 'hit' | 'duplicate' | 'known-false-positive' | 'false-alarm' | 'nit' | 'extra';

export type CaseScore = {
  /** Expected bug ids hit by a posted finding. */
  caught: string[];
  missed: string[];
  /** Missed bugs that a finding rejected in pass 2 pointed at. */
  droppedInPass2: string[];
  /** One label per posted finding, in order. */
  labels: FindingLabel[];
};

export function atLocation(f: Pick<BenchFinding, 'file' | 'lineStart' | 'lineEnd'>, loc: Location): boolean {
  return (
    f.file === loc.file &&
    f.lineStart <= loc.lineEnd + LINE_TOLERANCE &&
    loc.lineStart <= f.lineEnd + LINE_TOLERANCE
  );
}

export function matchesExpected(
  f: Pick<BenchFinding, 'file' | 'lineStart' | 'lineEnd'>,
  e: Expected,
): boolean {
  return [e, ...e.alsoAt].some((loc) => atLocation(f, loc));
}

export function isKnownFalsePositive(
  f: Pick<BenchFinding, 'file' | 'title' | 'explanation'>,
  known: KnownFalsePositive,
): boolean {
  if (f.file !== known.file) return false;
  const text = `${f.title}\n${f.explanation}`.toLowerCase();
  return known.keywords.some((k) => text.includes(k.toLowerCase()));
}

export function scoreCase(
  expected: readonly Expected[],
  posted: readonly BenchFinding[],
  rejected: readonly BenchFinding[],
  known: readonly KnownFalsePositive[],
): CaseScore {
  const caught = new Set<string>();
  const labels = posted.map((f): FindingLabel => {
    const bugs = expected.filter((e) => matchesExpected(f, e));
    if (bugs.length > 0) {
      const fresh = bugs.find((e) => !caught.has(e.id));
      if (!fresh) return 'duplicate';
      caught.add(fresh.id);
      return 'hit';
    }
    if (known.some((k) => isKnownFalsePositive(f, k))) return 'known-false-positive';
    if (expected.length > 0) return 'extra';
    return f.severity === 'minor' ? 'nit' : 'false-alarm';
  });
  const missed = expected.filter((e) => !caught.has(e.id)).map((e) => e.id);
  const droppedInPass2 = expected
    .filter((e) => missed.includes(e.id) && rejected.some((f) => matchesExpected(f, e)))
    .map((e) => e.id);
  return { caught: [...caught], missed, droppedInPass2, labels };
}

export type CaseOutcome = 'caught' | 'partial' | 'missed' | 'quiet' | 'nits only' | 'false alarm' | 'failed';

export function caseOutcome(expectedCount: number, score: CaseScore | null): CaseOutcome {
  if (!score) return 'failed';
  if (expectedCount > 0) {
    if (score.missed.length === 0) return 'caught';
    return score.caught.length > 0 ? 'partial' : 'missed';
  }
  if (score.labels.some((l) => l === 'false-alarm' || l === 'known-false-positive')) return 'false alarm';
  return score.labels.length > 0 ? 'nits only' : 'quiet';
}

export type Tokens = { input: number; cacheRead: number; cacheWrite: number; output: number };

export type CaseResult = {
  id: string;
  kind: string;
  expected: Expected[];
  findings: BenchFinding[];
  rejected: BenchFinding[];
  score: CaseScore | null;
  outcome: CaseOutcome;
  tokens: Tokens;
  /** Dollars actually billed (0 on the subscription; simulated by the fake engine). */
  billedUsd: number;
  /** The same tokens priced at Revo's API rates. */
  apiEquivalentUsd: number;
  /** Claude Code's own estimate (subscription engine), for cross-checking. */
  claudeCodeEstimateUsd: number | null;
  durationMs: number;
  filesReviewed: number;
  filesSkipped: number;
  notes: string[];
  error?: string;
};

export type BenchSummary = {
  cases: number;
  failed: number;
  bugCases: number;
  bugs: number;
  bugsCaught: number;
  /** bugsCaught / bugs, over every bug of the cases run (a failed case's bugs count as missed). */
  catchRate: number;
  bugCasesFullyCaught: number;
  /** Bugs pass 1 found and pass 2 rejected. */
  droppedInPass2: number;
  /** Unexpected findings on bug cases (not scored). */
  extraFindings: number;
  duplicateFindings: number;
  cleanCases: number;
  /** Clean cases with no false alarm (nits allowed). */
  cleanCasesQuiet: number;
  /** Blocker/major findings plus known false positives on clean cases. */
  falseAlarms: number;
  falseAlarmsPerCleanCase: number;
  nits: number;
  nitsPerCleanCase: number;
  /** Known false positives seen again, on any case. */
  knownFalsePositives: number;
  /** Averages over the cases that completed. */
  avgTokens: Tokens & { total: number };
  avgApiEquivalentUsd: number;
  totalApiEquivalentUsd: number;
  totalBilledUsd: number;
  avgDurationMs: number;
  maxDurationMs: number;
  totalDurationMs: number;
};

const count = (results: readonly CaseResult[], label: FindingLabel) =>
  results.reduce((n, r) => n + (r.score?.labels.filter((l) => l === label).length ?? 0), 0);

export function summarize(results: readonly CaseResult[]): BenchSummary {
  const done = results.filter((r) => !r.error);
  const bugCases = results.filter((r) => r.expected.length > 0);
  const cleanCases = results.filter((r) => r.expected.length === 0);
  const bugs = bugCases.reduce((n, r) => n + r.expected.length, 0);
  const bugsCaught = bugCases.reduce((n, r) => n + (r.score?.caught.length ?? 0), 0);
  const falseAlarms = count(cleanCases, 'false-alarm') + count(cleanCases, 'known-false-positive');
  const nits = count(cleanCases, 'nit');
  const n = done.length || 1;
  const avg = (pick: (r: CaseResult) => number) => done.reduce((s, r) => s + pick(r), 0) / n;
  const tokens: Tokens = {
    input: avg((r) => r.tokens.input),
    cacheRead: avg((r) => r.tokens.cacheRead),
    cacheWrite: avg((r) => r.tokens.cacheWrite),
    output: avg((r) => r.tokens.output),
  };
  const cleanCount = cleanCases.length || 1;
  return {
    cases: results.length,
    failed: results.length - done.length,
    bugCases: bugCases.length,
    bugs,
    bugsCaught,
    catchRate: bugs ? bugsCaught / bugs : 0,
    bugCasesFullyCaught: bugCases.filter((r) => r.outcome === 'caught').length,
    droppedInPass2: bugCases.reduce((s, r) => s + (r.score?.droppedInPass2.length ?? 0), 0),
    extraFindings: count(bugCases, 'extra'),
    duplicateFindings: count(results, 'duplicate'),
    cleanCases: cleanCases.length,
    cleanCasesQuiet: cleanCases.filter((r) => r.outcome === 'quiet' || r.outcome === 'nits only').length,
    falseAlarms,
    falseAlarmsPerCleanCase: falseAlarms / cleanCount,
    nits,
    nitsPerCleanCase: nits / cleanCount,
    knownFalsePositives: count(results, 'known-false-positive'),
    avgTokens: { ...tokens, total: tokens.input + tokens.cacheRead + tokens.cacheWrite + tokens.output },
    avgApiEquivalentUsd: avg((r) => r.apiEquivalentUsd),
    totalApiEquivalentUsd: results.reduce((s, r) => s + r.apiEquivalentUsd, 0),
    totalBilledUsd: results.reduce((s, r) => s + r.billedUsd, 0),
    avgDurationMs: avg((r) => r.durationMs),
    maxDurationMs: done.reduce((m, r) => Math.max(m, r.durationMs), 0),
    totalDurationMs: results.reduce((s, r) => s + r.durationMs, 0),
  };
}
