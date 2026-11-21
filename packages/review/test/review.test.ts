import { describe, expect, it } from 'vitest';
import { DEFAULT_REPO_SETTINGS, REVIEW_LIMITS, type Finding } from '@revo/shared';
import { ReviewEngineError } from '../src/errors';
import { addUsage, callCostUsd, usageCostUsd, ZERO_USAGE } from '../src/pricing';
import { contextBudgetTokens, reviewChanges } from '../src/review';
import type { ChangedFile, EngineContext, ReviewEngine } from '../src/types';

const settings = { ...DEFAULT_REPO_SETTINGS };

function changed(path: string, newContent: string): ChangedFile {
  const lines = newContent.split('\n');
  return {
    path,
    status: 'modified',
    patch: `@@ -1,1 +1,1 @@\n-old\n+${lines[0]}`,
    additions: 1,
    deletions: 1,
    newContent,
  };
}

/** Records the context it was given and reports one finding with an exact cost. */
function recordingEngine(findings: Finding[] = []) {
  const seen: EngineContext[] = [];
  const engine: ReviewEngine = {
    kind: 'claude',
    async find(ctx) {
      seen.push(ctx);
      return { findings, usage: { ...ZERO_USAGE, inputTokens: 10, costUsd: 0.05 } };
    },
    async verify(_ctx, list) {
      return {
        verifications: list.map((_, index) => ({ index, outcome: 'confirmed' as const, reason: 'Real.' })),
        usage: { ...ZERO_USAGE, cacheReadTokens: 10, costUsd: 0.01 },
      };
    },
  };
  return { engine, seen };
}

describe('reviewChanges', () => {
  it('collects related files through readFile and puts them in the context', async () => {
    const { engine, seen } = recordingEngine();
    const repo: Record<string, string> = {
      'src/lib/money.ts': 'export const cents = 1;',
      'prisma/schema.prisma': 'model Order { id String @id }',
    };
    const outcome = await reviewChanges({
      pr: { title: 'Totals', body: '' },
      files: [
        changed('src/api/orders.ts', "import { cents } from '../lib/money';\nawait db.order.findMany();"),
      ],
      related: [],
      settings,
      engine,
      readFile: async (path) => repo[path] ?? null,
    });
    expect(outcome.status).toBe('done');
    const ctx = seen[0]!;
    expect(ctx.related.map((r) => r.path)).toEqual(['prisma/schema.prisma', 'src/lib/money.ts']);
    expect(ctx.context.text).toContain('<related_files count="2">');
    expect(ctx.context.text).toContain('model Order');
  });

  it('uses the engine’s exact cost when it gives one', async () => {
    const finding: Finding = {
      category: 'bug',
      severity: 'major',
      file: 'src/a.ts',
      lineStart: 1,
      lineEnd: 1,
      title: 'Wrong',
      explanation: 'Because.',
      suggestion: 'Fix.',
      confidence: 0.9,
    };
    const { engine } = recordingEngine([finding]);
    const outcome = await reviewChanges({
      pr: { title: 't', body: '' },
      files: [changed('src/a.ts', 'const a = 1;')],
      related: [],
      settings,
      engine,
    });
    expect(outcome.status === 'done' && outcome.usage).toMatchObject({
      costUsd: 0.06,
      inputTokens: 10,
      cachedTokens: 10,
    });
    expect(outcome.status === 'done' && outcome.score).toBe(88);
  });

  it('keeps the cost of pass 1 on the error when pass 2 fails', async () => {
    const finding: Finding = {
      category: 'bug',
      severity: 'major',
      file: 'src/a.ts',
      lineStart: 1,
      lineEnd: 1,
      title: 'Wrong',
      explanation: 'Because.',
      suggestion: 'Fix.',
      confidence: 0.9,
    };
    const engine: ReviewEngine = {
      kind: 'claude',
      async find() {
        return { findings: [finding], usage: { ...ZERO_USAGE, cacheWriteTokens: 60_000, costUsd: 0.18 } };
      },
      async verify() {
        throw new ReviewEngineError('refusal', 'verify', 'declined', {
          usage: { ...ZERO_USAGE, cacheReadTokens: 60_000, costUsd: 0.0071 },
        });
      },
    };
    const err = await reviewChanges({
      pr: { title: 't', body: '' },
      files: [changed('src/a.ts', 'const a = 1;')],
      related: [],
      settings,
      engine,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReviewEngineError);
    const failure = err as ReviewEngineError;
    expect(failure.code).toBe('refusal');
    expect(failure.pass).toBe('verify');
    expect(failure.usage).toMatchObject({
      cacheWriteTokens: 60_000,
      cacheReadTokens: 60_000,
      costUsd: 0.1871,
    });
  });

  it('drops the lowest-priority files over the token budget and says so', async () => {
    const body = (i: number) =>
      // 100 long (not minified) lines per file: under the 1,500 changed-line limit, over the token budget.
      Array.from({ length: 100 }, (_, n) => `export const value${i}_${n} = '${'text '.repeat(290)}';`).join(
        '\n',
      );
    const added = (path: string, content: string): ChangedFile => ({
      path,
      status: 'added',
      patch: `@@ -0,0 +1,100 @@\n${content
        .split('\n')
        .map((l) => `+${l}`)
        .join('\n')}`,
      additions: 100,
      deletions: 0,
      newContent: content,
    });
    const files = Array.from({ length: 12 }, (_, i) =>
      added(i === 0 ? 'src/api/pay.ts' : `src/f${i}.ts`, body(i)),
    );
    const { engine, seen } = recordingEngine();
    const outcome = await reviewChanges({
      pr: { title: 't', body: '' },
      files,
      related: [],
      settings,
      engine,
    });
    expect(outcome.status).toBe('done');
    expect(outcome.filesReviewed).toBeLessThan(12);
    expect(outcome.notes).toEqual([`Large PR: reviewed ${outcome.filesReviewed} of 12 files.`]);
    expect(outcome.skippedFiles.every((s) => s.reason === 'size_limit')).toBe(true);
    expect(seen[0]!.files[0]!.path).toBe('src/api/pay.ts');
    expect(seen[0]!.context.estimatedTokens).toBeLessThanOrEqual(contextBudgetTokens(''));
  });

  it('skips as too_large when one file alone cannot fit', async () => {
    const huge: ChangedFile = {
      path: 'src/huge.ts',
      status: 'modified',
      additions: 1,
      deletions: 0,
      patch: `@@ -1,1 +1,30000 @@\n-a\n${Array.from({ length: 30_000 }, (_, n) => `+const line${n} = 'some text that is long enough';`).join('\n')}`,
    };
    const { engine, seen } = recordingEngine();
    const outcome = await reviewChanges({
      pr: { title: 't', body: '' },
      files: [huge],
      related: [],
      settings,
      engine,
    });
    expect(outcome).toMatchObject({ status: 'skipped', skipReason: 'too_large', filesReviewed: 0 });
    expect(seen).toHaveLength(0);
  });

  it('leaves room for the system prompt and repo instructions in the budget', () => {
    expect(contextBudgetTokens('')).toBeLessThan(REVIEW_LIMITS.maxInputTokensPerPass - 8_000);
    expect(contextBudgetTokens('x'.repeat(2_800))).toBeLessThan(contextBudgetTokens(''));
  });
});

describe('pricing with exact costs', () => {
  it('keeps an exact cost through addUsage only when both sides have one', () => {
    const a = { ...ZERO_USAGE, inputTokens: 1, costUsd: 0.1 };
    const b = { ...ZERO_USAGE, outputTokens: 1, costUsd: 0.2 };
    expect(addUsage(a, b).costUsd).toBeCloseTo(0.3);
    expect(
      addUsage(a, { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }).costUsd,
    ).toBeUndefined();
  });

  it('falls back to token pricing, including fallback models', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(usageCostUsd('claude-sonnet-5-5', usage)).toBe(2);
    expect(usageCostUsd('claude-sonnet-5-5', { ...usage, costUsd: 0.5 })).toBe(0.5);
    expect(callCostUsd('claude-opus-4-8', usage)).toBe(5);
    expect(() => callCostUsd('gpt-x', usage)).toThrow(/No price/);
  });
});
