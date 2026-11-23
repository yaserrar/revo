import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLD } from '@revo/shared';
import { applyVerifications, reindent, usableReplacement } from '../src/postprocess';
import { computeScore } from '../src/score';
import {
  carriedReason,
  DISMISSED_REASON,
  flaggedLines,
  locateFinding,
  reconcileWithPrior,
  type LocatedPrior,
} from '../src/track';
import type { ReviewedFinding, ReviewOutcome } from '../src/types';

type DoneOutcome = Extract<ReviewOutcome, { status: 'done' }>;

const FILE = [
  'export function cartTotal(items: { price: number }[]) {', // 1
  '  let sum = 0;', // 2
  '  for (let i = 0; i <= items.length; i++) {', // 3
  '    sum += items[i].price;', // 4
  '  }', // 5
  '  return sum;', // 6
  '}', // 7
].join('\n');

const prior = (over: Partial<LocatedPrior> = {}): LocatedPrior => ({
  id: 'f1',
  category: 'bug',
  severity: 'major',
  originalSeverity: null,
  file: 'src/cart.ts',
  lineStart: 3,
  lineEnd: 3,
  title: 'Loop reads one element past the end',
  explanation: 'The last iteration reads undefined.',
  suggestion: 'Use `<`.',
  confidence: 0.83,
  snippet: FILE.split('\n').slice(0, 6).join('\n'),
  snippetStartLine: 1,
  githubCommentId: 501,
  openSince: 'aaaaaaa1111111',
  dismissed: false,
  located: { lineStart: 3, lineEnd: 3 },
  ...over,
});

const reviewed = (over: Partial<ReviewedFinding> = {}): ReviewedFinding => ({
  category: 'bug',
  severity: 'minor',
  file: 'src/other.ts',
  lineStart: 10,
  lineEnd: 10,
  title: 'Something else',
  explanation: 'x',
  suggestion: '',
  confidence: 0.7,
  index: 0,
  originalSeverity: null,
  reason: 'Shown on line 10.',
  snippet: '',
  snippetStartLine: 10,
  ...over,
});

function done(findings: ReviewedFinding[], rejected: ReviewedFinding[] = []): DoneOutcome {
  const score = computeScore(findings, DEFAULT_THRESHOLD);
  return {
    status: 'done',
    findings,
    rejected,
    score: score.score,
    label: score.label,
    passed: score.passed,
    counts: score.counts,
    breakdown: score.breakdown,
    usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
    model: 'claude-sonnet-5-5',
    engine: 'fake',
    filesReviewed: 1,
    filesSkipped: 0,
    skippedFiles: [],
    notes: [],
    durationMs: 1,
  };
}

describe('locating a prior finding at the new head', () => {
  it('cuts the flagged lines from the snippet', () => {
    expect(flaggedLines(prior())).toEqual(['  for (let i = 0; i <= items.length; i++) {']);
    expect(flaggedLines(prior({ snippet: '' }))).toBeNull();
    expect(flaggedLines(prior({ lineStart: 9, lineEnd: 9 }))).toBeNull();
  });

  it('follows lines that moved, ignoring indentation, and picks the match nearest the old place', () => {
    const moved = ['// header', '', FILE.replace(/^ {2}/gm, '    ')].join('\n');
    expect(locateFinding(prior(), moved)).toEqual({ lineStart: 5, lineEnd: 5 });
    const twice = [FILE, '', FILE].join('\n');
    expect(locateFinding(prior({ lineStart: 11, lineEnd: 11 }), twice)).toEqual({
      lineStart: 11,
      lineEnd: 11,
    });
  });

  it('is gone when the lines changed or the file was deleted', () => {
    expect(locateFinding(prior(), FILE.replace('<=', '<'))).toBeNull();
    expect(locateFinding(prior(), null)).toBeNull();
  });

  it('never calls a finding fixed without evidence (no snippet, or blank lines only)', () => {
    expect(locateFinding(prior({ snippet: '' }), 'anything')).toEqual({ lineStart: 3, lineEnd: 3 });
    expect(locateFinding(prior({ snippet: '\n\n\n', lineStart: 2, lineEnd: 2 }), 'x')).toEqual({
      lineStart: 2,
      lineEnd: 2,
    });
  });
});

describe('reconciling a review with the previous one', () => {
  const contents = new Map([['src/cart.ts', FILE]]);
  const opts = { threshold: DEFAULT_THRESHOLD, contents };

  it('a problem found again keeps its thread and says since when it is open', () => {
    const again = reviewed({ ...prior(), severity: 'major', index: 0, reason: 'r' });
    const r = reconcileWithPrior(done([again]), [prior()], opts);
    expect(r.fixed).toEqual([]);
    expect(r.outcome.findings).toHaveLength(1);
    expect(r.outcome.findings[0]!.openSince).toBe('aaaaaaa1111111');
    expect(r.commentIds.get(0)).toBe(501);
  });

  it('matches the same problem on overlapping lines even under another title', () => {
    const again = reviewed({
      file: 'src/cart.ts',
      category: 'bug',
      lineStart: 3,
      lineEnd: 4,
      title: 'Off by one',
    });
    const r = reconcileWithPrior(done([again]), [prior()], opts);
    expect(r.outcome.findings).toHaveLength(1);
    expect(r.commentIds.get(0)).toBe(501);
  });

  it('a problem still in the code but not reported is carried over, scored and sorted by severity', () => {
    const minor = reviewed();
    const r = reconcileWithPrior(done([minor]), [prior({ located: { lineStart: 5, lineEnd: 5 } })], opts);
    expect(r.outcome.findings.map((f) => [f.title, f.index])).toEqual([
      ['Loop reads one element past the end', 0],
      ['Something else', 1],
    ]);
    const carried = r.outcome.findings[0]!;
    expect(carried).toMatchObject({ lineStart: 5, lineEnd: 5, openSince: 'aaaaaaa1111111' });
    expect(carried.reason).toBe(carriedReason('aaaaaaa1111111'));
    expect(carried.snippetStartLine).toBe(2);
    expect(r.commentIds).toEqual(new Map([[0, 501]]));
    expect(r.outcome.score).toBe(100 - 12 - 4);
  });

  it('lets go of problems the repo no longer checks (category off, file ignored)', () => {
    const p = prior({ located: null });
    expect(reconcileWithPrior(done([]), [p], { ...opts, categories: ['security'] }).fixed).toEqual([]);
    expect(reconcileWithPrior(done([]), [p], { ...opts, ignoreGlobs: ['src/**'] }).fixed).toEqual([]);
    const carried = reconcileWithPrior(done([]), [prior()], { ...opts, ignoreGlobs: ['src/**'] });
    expect(carried.outcome.findings).toEqual([]);
  });

  it('a problem whose lines are gone is fixed', () => {
    const r = reconcileWithPrior(done([]), [prior({ located: null })], opts);
    expect(r.fixed.map((f) => f.id)).toEqual(['f1']);
    expect(r.outcome.findings).toEqual([]);
    expect(r.outcome.score).toBe(100);
  });

  it('a dismissed problem found again is rejected, and never carried or called fixed', () => {
    const again = reviewed({ ...prior(), severity: 'major', reason: 'r' });
    const r = reconcileWithPrior(done([again]), [prior({ dismissed: true })], opts);
    expect(r.outcome.findings).toEqual([]);
    expect(r.outcome.rejected.map((f) => f.reason)).toEqual([DISMISSED_REASON]);
    expect(r.outcome.score).toBe(100);

    const quiet = reconcileWithPrior(done([]), [prior({ dismissed: true, located: null })], opts);
    expect(quiet.fixed).toEqual([]);
    expect(quiet.outcome.findings).toEqual([]);
  });
});

describe('one-click fixes', () => {
  const f = { lineStart: 3, lineEnd: 3, replacement: '  for (let i = 0; i < items.length; i++) {' };

  it('keeps a replacement only for lines that exist and really change', () => {
    expect(usableReplacement(f, FILE)).toBe(f.replacement);
    expect(
      usableReplacement({ ...f, replacement: '  for (let i = 0; i <= items.length; i++) {' }, FILE),
    ).toBeUndefined();
    expect(usableReplacement({ ...f, lineStart: 8, lineEnd: 8 }, FILE)).toBeUndefined();
    expect(usableReplacement(f, undefined)).toBeUndefined();
    expect(usableReplacement({ ...f, lineStart: 1, lineEnd: 30 }, FILE + '\n'.repeat(40))).toBeUndefined();
  });

  it('gives the replacement the indentation of the lines it replaces', () => {
    const deeper = { ...f, replacement: '    for (let i = 0; i < items.length; i++) {' };
    expect(usableReplacement(deeper, FILE)).toBe(f.replacement);
    const flat = {
      lineStart: 3,
      lineEnd: 4,
      replacement: 'for (const item of items) {\n  sum += item.price;',
    };
    expect(usableReplacement(flat, FILE)).toBe('  for (const item of items) {\n    sum += item.price;');
    expect(reindent('\tx\n\ty', ['  a'])).toBeUndefined();
    expect(reindent('    a\n  }', ['  a', '}'])).toBe('  a\n}');
    expect(reindent('    a\n }', ['  a', '}'])).toBeUndefined();
    expect(reindent('', ['  a'])).toBe('');
  });

  it('drops a replacement pass 2 did not vouch for', () => {
    const finding = {
      category: 'bug' as const,
      severity: 'major' as const,
      file: 'src/cart.ts',
      lineStart: 3,
      lineEnd: 3,
      title: 't',
      explanation: 'e',
      suggestion: 's',
      confidence: 0.9,
      replacement: f.replacement,
    };
    const judged = (replacementSafe?: boolean) =>
      applyVerifications(
        [finding],
        [
          {
            index: 0,
            outcome: 'confirmed',
            reason: 'r',
            ...(replacementSafe === undefined ? {} : { replacementSafe }),
          },
        ],
        { reviewedPaths: new Set(['src/cart.ts']), categories: ['bug'] },
      )[0]!;
    expect(judged(true).replacement).toBe(f.replacement);
    expect(judged(false).replacement).toBeUndefined();
    expect(judged().replacement).toBeUndefined();
    expect(judged(false).confirmed).toBe(true);
  });
});
