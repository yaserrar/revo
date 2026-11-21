import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_REPO_SETTINGS, type Finding } from '@revo/shared';
import { fakeEngine } from '../src/engines/fake';
import { filterFiles, riskTier, selectFiles } from '../src/files';
import { parseGitDiff } from '../src/git-diff';
import { applyVerifications, dedupeFindings } from '../src/postprocess';
import { reviewChanges } from '../src/review';
import { buildSnippet } from '../src/snippet';
import type { ChangedFile, ReviewEngine } from '../src/types';

const diff = readFileSync(resolve(import.meta.dirname, 'fixtures/checkout.patch'), 'utf8');
const settings = { ...DEFAULT_REPO_SETTINGS };

const finding = (over: Partial<Finding> = {}): Finding => ({
  category: 'bug',
  severity: 'major',
  file: 'src/a.ts',
  lineStart: 10,
  lineEnd: 12,
  title: 'Something wrong',
  explanation: 'Because.',
  suggestion: 'Fix it.',
  confidence: 0.8,
  ...over,
});

describe('parseGitDiff', () => {
  it('splits files with status, patch and counts', () => {
    const files = parseGitDiff(diff);
    expect(files.map((f) => [f.path, f.status])).toEqual([
      ['src/api/orders.ts', 'modified'],
      ['pnpm-lock.yaml', 'modified'],
      ['public/logo.png', 'added'],
      ['src/lib/old.ts', 'removed'],
    ]);
    expect(files[0]).toMatchObject({ additions: 13, deletions: 5 });
    expect(files[0]!.patch?.startsWith('@@ -1,12 +1,20 @@')).toBe(true);
    expect(files[2]!.patch).toBeUndefined();
  });
});

describe('filterFiles and selectFiles', () => {
  it('drops lockfiles, binaries and removed files', () => {
    const { reviewable, skipped } = filterFiles(parseGitDiff(diff));
    expect(reviewable.map((f) => f.path)).toEqual(['src/api/orders.ts']);
    expect(skipped).toEqual([
      { path: 'pnpm-lock.yaml', reason: 'ignored' },
      { path: 'public/logo.png', reason: 'ignored' },
      { path: 'src/lib/old.ts', reason: 'removed' },
    ]);
  });

  it('applies repo ignore globs and root build folders', () => {
    const files: ChangedFile[] = [
      { path: 'dist/index.js', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b', additions: 1, deletions: 1 },
      { path: 'docs/guide.md', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b', additions: 1, deletions: 1 },
    ];
    expect(filterFiles(files, ['docs/**']).reviewable).toEqual([]);
  });

  it('ranks files by risk', () => {
    expect(riskTier('src/app/api/orders/route.ts')).toBe(1);
    expect(riskTier('prisma/migrations/001/migration.sql')).toBe(1);
    expect(riskTier('src/components/button.tsx')).toBe(2);
    expect(riskTier('src/lib/pricing.test.ts')).toBe(3);
  });

  it('keeps the riskiest files first on large PRs and adds a note', () => {
    const file = (path: string, lines: number): ChangedFile => ({
      path,
      status: 'modified',
      additions: lines,
      deletions: 0,
      patch: `@@ -1,0 +1,${lines} @@\n` + Array.from({ length: lines }, (_, i) => `+line ${i}`).join('\n'),
    });
    const r = selectFiles(
      [
        file('src/ui/a.tsx', 600),
        file('src/lib/a.test.ts', 600),
        file('src/api/pay.ts', 600),
        file('src/ui/b.tsx', 200),
      ],
      { maxChangedLines: 1_500, maxFiles: 40 },
    );
    expect(r.selected.map((f) => f.path)).toEqual(['src/api/pay.ts', 'src/ui/a.tsx', 'src/ui/b.tsx']);
    expect(r.skipped).toEqual([{ path: 'src/lib/a.test.ts', reason: 'size_limit' }]);
    expect(r.note).toBe('Large PR: reviewed 3 of 4 files.');
  });
});

describe('postprocess', () => {
  it('applies verifications, lowers severity and rejects out-of-change files', () => {
    const judged = applyVerifications(
      [finding(), finding({ file: 'src/b.ts' }), finding({ title: 'other' }), finding({ category: 'data' })],
      [
        { index: 0, outcome: 'confirmed', reason: 'Real.', severity: 'minor' },
        { index: 1, outcome: 'confirmed', reason: 'Real.' },
        { index: 2, outcome: 'rejected', reason: 'Handled above.' },
        { index: 3, outcome: 'confirmed', reason: 'Real.' },
      ],
      { reviewedPaths: new Set(['src/a.ts']), categories: ['bug'] },
    );
    expect(judged[0]).toMatchObject({ confirmed: true, severity: 'minor', originalSeverity: 'major' });
    expect(judged[1]).toMatchObject({ confirmed: false, reason: 'The file is not part of this change.' });
    expect(judged[2]).toMatchObject({ confirmed: false, reason: 'Handled above.' });
    expect(judged[3]).toMatchObject({ confirmed: false });
  });

  it('ignores a severity raised by pass 2', () => {
    const [j] = applyVerifications(
      [finding({ severity: 'minor' })],
      [{ index: 0, outcome: 'confirmed', reason: 'r', severity: 'blocker' }],
      {
        reviewedPaths: new Set(['src/a.ts']),
        categories: ['bug'],
      },
    );
    expect(j).toMatchObject({ severity: 'minor', originalSeverity: null });
  });

  it('removes duplicates: same file, overlapping lines, same category', () => {
    const kept = dedupeFindings([
      finding({ severity: 'minor', lineStart: 11, lineEnd: 11 }),
      finding({ severity: 'major' }),
      finding({ category: 'security' }),
      finding({ lineStart: 30, lineEnd: 31 }),
    ]);
    expect(kept.map((f) => [f.category, f.severity, f.lineStart])).toEqual([
      ['bug', 'major', 10],
      ['security', 'major', 10],
      ['bug', 'major', 30],
    ]);
  });
});

describe('buildSnippet', () => {
  it('cuts lines around the range from the new file', () => {
    const file: ChangedFile = {
      path: 'a.ts',
      status: 'modified',
      additions: 0,
      deletions: 0,
      newContent: Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n'),
    };
    expect(buildSnippet(file, 10, 11)).toEqual({
      snippet: ['line 7', 'line 8', 'line 9', 'line 10', 'line 11', 'line 12', 'line 13', 'line 14'].join(
        '\n',
      ),
      snippetStartLine: 7,
    });
    expect(buildSnippet(file, 1, 60).snippet.split('\n')).toHaveLength(30);
  });

  it('falls back to the patch', () => {
    const [orders] = parseGitDiff(diff);
    const s = buildSnippet(orders, 19, 19);
    expect(s.snippetStartLine).toBe(16);
    expect(s.snippet).toContain('prisma.$queryRawUnsafe');
  });
});

describe('reviewChanges with the fake engine', () => {
  it('finds, verifies, scores and prices deterministically', async () => {
    const input = {
      pr: { title: 'Checkout', body: '' },
      files: parseGitDiff(diff),
      related: [],
      settings,
      engine: fakeEngine,
    };
    const a = await reviewChanges(input);
    const b = await reviewChanges(input);
    if (a.status !== 'done' || b.status !== 'done') throw new Error('expected a done review');

    expect(a.findings.map((f) => [f.severity, f.category, f.title])).toEqual([
      ['blocker', 'security', 'SQL built from request input'],
      ['major', 'bug', 'Discount applied after tax'],
      ['major', 'security', 'User id taken from the request body'],
      ['major', 'performance', 'Query inside a loop (N+1)'],
      ['minor', 'missing-test', 'No test for orderCount'],
    ]);
    expect(a.rejected.map((f) => f.title)).toEqual(['parseInt without a radix']);
    expect(a).toMatchObject({
      score: 30,
      label: 'changes_needed',
      passed: false,
      filesReviewed: 1,
      filesSkipped: 3,
    });
    expect(a.findings[0]).toMatchObject({ index: 0, file: 'src/api/orders.ts', lineStart: 19, lineEnd: 19 });
    expect(a.findings[0]!.snippet).toContain('$queryRawUnsafe');
    expect(a.usage.costUsd).toBeGreaterThan(0);
    expect({ ...a, durationMs: 0 }).toEqual({ ...b, durationMs: 0 });
  });

  it('respects maxFindings and the categories setting', async () => {
    const r = await reviewChanges({
      pr: { title: 'Checkout', body: '' },
      files: parseGitDiff(diff),
      related: [],
      settings: { ...settings, maxFindings: 2, categories: ['bug', 'performance'] },
      engine: fakeEngine,
    });
    if (r.status !== 'done') throw new Error('expected a done review');
    expect(r.findings.map((f) => f.category)).toEqual(['bug', 'performance']);
    expect(r.score).toBe(76);
  });

  it('skips when nothing is reviewable, without calling the engine', async () => {
    const engine: ReviewEngine = {
      kind: 'fake',
      find: () => Promise.reject(new Error('should not be called')),
      verify: () => Promise.reject(new Error('should not be called')),
    };
    const r = await reviewChanges({
      pr: { title: 'Bump deps', body: '' },
      files: parseGitDiff(diff).filter((f) => f.path === 'pnpm-lock.yaml'),
      related: [],
      settings,
      engine,
    });
    expect(r).toMatchObject({ status: 'skipped', skipReason: 'no_reviewable_files', filesSkipped: 1 });
  });

  it('gives 100 on a clean change', async () => {
    const clean = parseGitDiff(
      'diff --git a/src/lib/format.ts b/src/lib/format.ts\n--- a/src/lib/format.ts\n+++ b/src/lib/format.ts\n@@ -1,1 +1,2 @@\n export const a = 1;\n+export const b = 2;\n',
    );
    const r = await reviewChanges({
      pr: { title: 'Add b', body: '' },
      files: clean,
      related: [],
      settings,
      engine: fakeEngine,
    });
    expect(r).toMatchObject({
      status: 'done',
      score: 100,
      label: 'good_to_merge',
      passed: true,
      findings: [],
    });
  });
});
