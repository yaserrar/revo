import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseGitDiff } from '@revo/review';
import { loadCases, loadKnownFalsePositives, type Expected } from '../src/cases';
import { benchEnv } from '../src/engine';
import { renderMarkdown, type BenchRun } from '../src/report';
import {
  atLocation,
  caseOutcome,
  isKnownFalsePositive,
  scoreCase,
  summarize,
  type BenchFinding,
  type CaseResult,
} from '../src/score';

const root = join(import.meta.dirname, '..');

const bug = (id: string, file: string, lineStart: number, lineEnd = lineStart): Expected => ({
  id,
  file,
  lineStart,
  lineEnd,
  severity: 'major',
  description: id,
  alsoAt: [],
});
const finding = (file: string, line: number, over: Partial<BenchFinding> = {}): BenchFinding => ({
  file,
  lineStart: line,
  lineEnd: line,
  severity: 'major',
  category: 'bug',
  title: 't',
  explanation: 'e',
  confidence: 0.9,
  reason: 'r',
  ...over,
});
const zipFp = {
  id: 'zip',
  file: 'svc.ts',
  keywords: ['content-type'],
  description: 'd',
  why: 'w',
};

describe('atLocation', () => {
  it('matches the same file with lines within 5 of the bug', () => {
    const loc = { file: 'a.ts', lineStart: 20, lineEnd: 24 };
    expect(atLocation(finding('a.ts', 22), loc)).toBe(true);
    expect(atLocation(finding('a.ts', 29), loc)).toBe(true);
    expect(atLocation(finding('a.ts', 30), loc)).toBe(false);
    expect(atLocation(finding('a.ts', 15), loc)).toBe(true);
    expect(atLocation(finding('a.ts', 14), loc)).toBe(false);
    expect(atLocation(finding('b.ts', 22), loc)).toBe(false);
  });
});

describe('scoreCase', () => {
  it('credits each bug once and labels repeats as duplicates', () => {
    const s = scoreCase([bug('x', 'a.ts', 10)], [finding('a.ts', 10), finding('a.ts', 11)], [], []);
    expect(s.caught).toEqual(['x']);
    expect(s.labels).toEqual(['hit', 'duplicate']);
  });

  it('accepts a bug at one of its other locations', () => {
    const e = { ...bug('x', 'a.ts', 10), alsoAt: [{ file: 'test.ts', lineStart: 300, lineEnd: 300 }] };
    expect(scoreCase([e], [finding('test.ts', 302)], [], []).caught).toEqual(['x']);
  });

  it('reports a missed bug that pass 2 rejected', () => {
    const s = scoreCase(
      [bug('x', 'a.ts', 10), bug('y', 'b.ts', 5)],
      [finding('a.ts', 10)],
      [finding('b.ts', 6)],
      [],
    );
    expect(s.missed).toEqual(['y']);
    expect(s.droppedInPass2).toEqual(['y']);
  });

  it('labels clean-case findings by severity, and known false positives anywhere', () => {
    const s = scoreCase(
      [],
      [
        finding('a.ts', 1, { severity: 'minor' }),
        finding('a.ts', 2, { severity: 'blocker' }),
        finding('svc.ts', 410, { title: 'Error keeps Content-Type: application/zip' }),
      ],
      [],
      [zipFp],
    );
    expect(s.labels).toEqual(['nit', 'false-alarm', 'known-false-positive']);
    const onBugCase = scoreCase(
      [bug('x', 'a.ts', 100)],
      [finding('svc.ts', 410, { explanation: 'content-type' })],
      [],
      [zipFp],
    );
    expect(onBugCase.labels).toEqual(['known-false-positive']);
    expect(scoreCase([bug('x', 'a.ts', 100)], [finding('c.ts', 1)], [], []).labels).toEqual(['extra']);
  });

  it('matches known false positives by file and keyword, ignoring case', () => {
    expect(isKnownFalsePositive({ file: 'svc.ts', title: 'CONTENT-TYPE kept', explanation: '' }, zipFp)).toBe(
      true,
    );
    expect(isKnownFalsePositive({ file: 'other.ts', title: 'content-type', explanation: '' }, zipFp)).toBe(
      false,
    );
  });
});

describe('caseOutcome and summarize', () => {
  const result = (
    id: string,
    expected: Expected[],
    findings: BenchFinding[],
    over: Partial<CaseResult> = {},
  ) => {
    const score = scoreCase(expected, findings, [], [zipFp]);
    return {
      id,
      kind: expected.length ? 'planted' : 'clean',
      expected,
      findings,
      rejected: [],
      score,
      outcome: caseOutcome(expected.length, score),
      tokens: { input: 100, cacheRead: 1000, cacheWrite: 200, output: 50 },
      billedUsd: 0,
      apiEquivalentUsd: 0.1,
      claudeCodeEstimateUsd: null,
      durationMs: 1000,
      filesReviewed: 1,
      filesSkipped: 0,
      notes: [],
      ...over,
    } satisfies CaseResult;
  };

  it('computes catch rate, false alarms per clean case, and averages over completed cases', () => {
    const results: CaseResult[] = [
      result('b1', [bug('x', 'a.ts', 10), bug('y', 'b.ts', 10)], [finding('a.ts', 10)]),
      result('b2', [bug('z', 'a.ts', 10)], [finding('a.ts', 10)]),
      result('c1', [], []),
      result('c2', [], [finding('a.ts', 1, { severity: 'minor' })]),
      result('c3', [], [finding('a.ts', 1), finding('svc.ts', 1, { title: 'content-type' })]),
      {
        ...result('c4', [], []),
        score: null,
        outcome: 'failed',
        error: 'unavailable: down',
        apiEquivalentUsd: 0.02,
        durationMs: 50,
      },
    ];
    expect(results.map((r) => r.outcome)).toEqual([
      'partial',
      'caught',
      'quiet',
      'nits only',
      'false alarm',
      'failed',
    ]);
    const s = summarize(results);
    expect(s).toMatchObject({
      bugs: 3,
      bugsCaught: 2,
      bugCasesFullyCaught: 1,
      cleanCases: 4,
      cleanCasesQuiet: 2,
      falseAlarms: 2,
      falseAlarmsPerCleanCase: 0.5,
      nits: 1,
      knownFalsePositives: 1,
      failed: 1,
      avgDurationMs: 1000,
      maxDurationMs: 1000,
    });
    expect(s.catchRate).toBeCloseTo(2 / 3);
    expect(s.avgTokens.total).toBe(1350);
    expect(s.totalApiEquivalentUsd).toBeCloseTo(0.52);
  });

  it('renders a report with totals, cases and the labels to confirm', () => {
    const cases = loadCases(join(root, 'cases'));
    const results = [
      result('01-planted-any-types', cases[0]!.expected, [finding('apps/api/src/lib/format.ts', 4)]),
    ];
    const run: BenchRun = {
      startedAt: '2026-11-27T10:00:00.000Z',
      finishedAt: '2026-11-27T10:01:00.000Z',
      engine: 'fake',
      model: 'claude-sonnet-5-5',
      effort: 'high',
      label: '',
      source: '../dropwave',
      summary: summarize(results),
      results,
    };
    const md = renderMarkdown(run, cases);
    expect(md).toContain('| Catch rate (planted + synthetic bugs) | **1/1 (100%)**');
    expect(md).toContain('HIT: major "t" @ apps/api/src/lib/format.ts:4');
    expect(md).toContain('## Labels to confirm');
  });
});

describe('cases', () => {
  it('loads every case with a parseable diff, and the known false positives', () => {
    const cases = loadCases(join(root, 'cases'));
    expect(cases.length).toBeGreaterThanOrEqual(12);
    for (const c of cases) {
      const files = parseGitDiff(c.diff);
      expect(files.length, c.id).toBeGreaterThan(0);
      for (const e of c.expected) {
        expect(
          files.some((f) => f.path === e.file),
          `${c.id}: ${e.file} is not changed by the diff`,
        ).toBe(true);
      }
    }
    expect(cases.filter((c) => c.kind === 'clean').length).toBeGreaterThanOrEqual(5);
    expect(loadKnownFalsePositives(join(root, 'known-false-positives.json')).length).toBeGreaterThan(0);
  });
});

describe('benchEnv', () => {
  it('drops API credentials and Claude Code session variables, keeps the OAuth token and the rest', () => {
    const env = benchEnv({
      ANTHROPIC_API_KEY: 'k',
      ANTHROPIC_BASE_URL: 'u',
      CLAUDECODE: '1',
      CLAUDE_CODE_SESSION_ID: 's',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_OAUTH_TOKEN: 'o',
      PATH: '/bin',
      HOME: '/h',
    });
    expect(env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'o', PATH: '/bin', HOME: '/h' });
  });
});
