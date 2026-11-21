import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPatch, collectRelatedFiles, filterFiles, parseGitDiff } from '@revo/review';
import { loadCases } from '../src/cases';
import { caseVerdict, hits, matches, summarize, type CaseResult } from '../src/metrics';
import { renderMarkdown, summaryLines } from '../src/report';

const root = join(import.meta.dirname, '..');
const bug = { file: 'a.ts', lineStart: 10, lineEnd: 12, category: 'bug' as const };
const f = (file: string, line: number, category: 'bug' | 'data' | 'security' = 'bug') => ({
  file,
  lineStart: line,
  lineEnd: line,
  category,
  severity: 'major' as const,
  title: 't',
  confidence: 0.9,
});

describe('matches', () => {
  it('matches the same file with overlapping lines, within 3 lines', () => {
    expect(matches(f('a.ts', 11), bug)).toBe(true);
    expect(matches(f('a.ts', 15), bug)).toBe(true);
    expect(matches(f('a.ts', 16), bug)).toBe(false);
    expect(matches(f('b.ts', 11), bug)).toBe(false);
  });

  it('needs the same category for a hit (bug and data count as one)', () => {
    expect(hits(f('a.ts', 11), bug)).toBe(true);
    expect(hits(f('a.ts', 11, 'data'), bug)).toBe(true);
    expect(hits(f('a.ts', 11, 'security'), bug)).toBe(false);
  });
});

describe('summarize', () => {
  const results: CaseResult[] = [
    {
      id: '1',
      expected: [bug],
      findings: [f('a.ts', 11, 'data'), f('a.ts', 12), f('a.ts', 40)],
      costUsd: 0.2,
      durationMs: 1000,
    },
    { id: '2', expected: [bug], findings: [f('a.ts', 11, 'security')], costUsd: 0.1, durationMs: 500 },
    { id: '3', expected: [], findings: [f('c.ts', 1)], costUsd: 0.3, durationMs: 1500 },
    { id: '4', expected: [], findings: [], costUsd: 0.05, durationMs: 100, error: 'unavailable: down' },
  ];

  it('computes recall, precision, false alarms, cost and targets', () => {
    expect(summarize(results)).toEqual({
      cases: 4,
      failed: 1,
      bugCases: 2,
      bugsFound: 1,
      recall: 0.5,
      findings: 5,
      correctFindings: 1,
      duplicateFindings: 1,
      precision: 1 / 5,
      locationOnlyMatches: 1,
      cleanCases: 2,
      falseAlarms: 1,
      totalCostUsd: expect.closeTo(0.65, 9),
      avgCostUsd: expect.closeTo(0.2, 9),
      avgDurationMs: 1000,
      meetsTargets: { recall: false, falseAlarms: false, cost: true, complete: false },
    });
    expect(results.map(caseVerdict)).toEqual(['found', 'missed', 'false-alarm', 'failed']);
  });

  it('renders the console summary and the markdown report', () => {
    const summary = summarize(results);
    expect(summaryLines('claude-sonnet-5-5', summary)[1]).toContain('1/2 bugs found');
    const md = renderMarkdown({
      startedAt: '2026-11-21T10:00:00.000Z',
      engine: 'fake',
      effort: 'high',
      label: 'test',
      runs: [{ model: 'claude-sonnet-5-5', summary, results }],
    });
    expect(md).toContain('| claude-sonnet-5-5 | 1/2 (50%) | 1/5 (20%) | 1 on 2 |');
    expect(md).toContain('incomplete: 1 case failed');
    expect(md).toContain('| 4 | failed | error: unavailable: down |');
  });
});

describe('eval cases', () => {
  const cases = loadCases(join(root, 'cases'), join(root, 'demo-repo'));

  it('has 10 bug PRs and 5 clean PRs whose patches apply to the demo repo', () => {
    expect(cases).toHaveLength(15);
    expect(cases.filter((c) => c.expected.length === 1 || c.expected.length === 2)).toHaveLength(10);
    expect(cases.filter((c) => c.expected.length === 0)).toHaveLength(5);
    for (const c of cases) {
      expect(c.title.length).toBeGreaterThan(0);
      for (const file of c.files) expect(file.newContent).toBeDefined();
    }
  });

  it('points every expected bug at added lines of a changed file', () => {
    for (const c of cases) {
      for (const e of c.expected) {
        const file = c.files.find((x) => x.path === e.file);
        expect(file, `${c.id}: ${e.file}`).toBeDefined();
        const lines = file!.newContent!.split('\n');
        expect(e.lineEnd).toBeLessThanOrEqual(lines.length);
        expect(e.lineStart).toBeLessThanOrEqual(e.lineEnd);
      }
    }
  });

  it('gives every case reviewable files and finds related files in the demo repo', async () => {
    const orders = cases.find((c) => c.id.startsWith('003'))!;
    expect(filterFiles(orders.files).reviewable.map((x) => x.path)).toEqual(['src/app/api/orders/route.ts']);
    const related = await collectRelatedFiles({ files: orders.files, readFile: orders.readFile });
    expect(related[0]!.path).toBe('prisma/schema.prisma');
    expect(related.map((r) => r.path)).toContain('src/lib/db.ts');
  });

  it('reads the demo repo as it is after the PR', async () => {
    const c = cases.find((x) => x.id.startsWith('008'))!;
    expect(await c.readFile('src/app/api/products/search/route.ts')).toContain('$queryRawUnsafe');
    expect(await c.readFile('../package.json')).toBeNull();
    const patch = parseGitDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n')[0]!.patch!;
    expect(applyPatch('a\n', patch)).toBe('b\n');
  });
});
