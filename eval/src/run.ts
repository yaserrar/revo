/**
 * pnpm eval [--engine claude|fake] [--model claude-sonnet-5-5[,claude-haiku-5-5]] [--only 001]
 *           [--effort high] [--concurrency 3] [--max-spend 3] [--label prompt-v2]
 *
 * Runs @revo/review on every case (pull requests against eval/demo-repo)
 * without GitHub and prints recall, precision, false alarms on clean PRs, and
 * average cost and time per PR, per model. Saves JSON and markdown in
 * eval/results/, and logs real spend in eval/results/spend.jsonl.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  createClaudeEngine,
  estimateTokens,
  fakeEngine,
  isReviewEngineError,
  reviewChanges,
  SYSTEM_PROMPT,
  type ClaudeEffort,
  type ReviewEngine,
  type ReviewedFinding,
} from '@revo/review';
import { DEFAULT_REPO_SETTINGS, ModelIdSchema, type ModelId } from '@revo/shared';
import { loadCases, type EvalCase } from './cases';
import { caseVerdict, summarize, type CaseResult, type ResultFinding } from './metrics';
import { renderMarkdown, summaryLines, type EvalRun, type ModelRun } from './report';

const EFFORTS: readonly ClaudeEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const { values } = parseArgs({
  options: {
    engine: { type: 'string' },
    model: { type: 'string', default: DEFAULT_REPO_SETTINGS.model },
    only: { type: 'string' },
    effort: { type: 'string', default: 'high' },
    concurrency: { type: 'string', default: '3' },
    'max-spend': { type: 'string', default: '3' },
    label: { type: 'string', default: '' },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const engineKind =
  values.engine ?? process.env.REVO_ENGINE ?? (process.env.ANTHROPIC_API_KEY ? 'claude' : 'fake');
if (engineKind !== 'claude' && engineKind !== 'fake')
  fail(`Unknown engine "${engineKind}". Use claude or fake.`);
if (engineKind === 'claude' && !process.env.ANTHROPIC_API_KEY) {
  fail('ANTHROPIC_API_KEY is not set (in .env). Run with --engine fake to test offline.');
}
const effort = EFFORTS.find((e) => e === values.effort) ?? fail(`Unknown effort "${values.effort}".`);
const models: ModelId[] = values.model.split(',').map((m) => {
  const parsed = ModelIdSchema.safeParse(m.trim());
  return parsed.success
    ? parsed.data
    : fail(`Unknown model "${m}". Use: ${ModelIdSchema.options.join(', ')}`);
});
const concurrency = Math.max(1, Number.parseInt(values.concurrency, 10) || 1);
const maxSpend = Number(values['max-spend']);
if (!Number.isFinite(maxSpend) || maxSpend < 0) fail('--max-spend must be a dollar amount.');

const root = join(import.meta.dirname, '..');
const cases = loadCases(join(root, 'cases'), join(root, 'demo-repo')).filter(
  (c) => !values.only || values.only.split(',').some((prefix) => c.id.startsWith(prefix)),
);
if (cases.length === 0) fail('No case matches --only.');

const SYSTEM_TOKENS = estimateTokens(SYSTEM_PROMPT);
let spent = 0;

const toResult = (f: ReviewedFinding): ResultFinding => ({
  file: f.file,
  lineStart: f.lineStart,
  lineEnd: f.lineEnd,
  category: f.category,
  severity: f.severity,
  title: f.title,
  confidence: f.confidence,
  reason: f.reason,
});

/** Reviews one case; records the context estimate and the real pass-1 prompt size. */
async function runCase(c: EvalCase, model: ModelId): Promise<CaseResult> {
  let estimatedTokens: number | undefined;
  let promptTokens: number | undefined;
  const inner: ReviewEngine =
    engineKind === 'fake'
      ? fakeEngine
      : createClaudeEngine({
          effort,
          onCall: (e) => {
            if (e.pass === 'find' && e.attempt === 1) {
              promptTokens = e.usage.inputTokens + e.usage.cacheReadTokens + e.usage.cacheWriteTokens;
            }
          },
        });
  const engine: ReviewEngine = {
    kind: inner.kind,
    find: (ctx) => {
      estimatedTokens = ctx.context.estimatedTokens + SYSTEM_TOKENS;
      return inner.find(ctx);
    },
    verify: (ctx, findings) => inner.verify(ctx, findings),
  };
  const started = Date.now();
  try {
    const outcome = await reviewChanges({
      pr: { title: c.title, body: c.body },
      files: c.files,
      related: [],
      settings: { ...DEFAULT_REPO_SETTINGS, model },
      engine,
      readFile: c.readFile,
    });
    const done = outcome.status === 'done' ? outcome : null;
    return {
      id: c.id,
      expected: c.expected,
      findings: done ? done.findings.map(toResult) : [],
      rejected: done ? done.rejected.map(toResult) : [],
      costUsd: done ? done.usage.costUsd : 0,
      durationMs: outcome.durationMs,
      ...(estimatedTokens !== undefined ? { estimatedTokens } : {}),
      ...(promptTokens !== undefined ? { promptTokens } : {}),
    };
  } catch (err) {
    if (!isReviewEngineError(err)) throw err;
    return {
      id: c.id,
      expected: c.expected,
      findings: [],
      costUsd: err.usage?.costUsd ?? 0,
      durationMs: Date.now() - started,
      error: `${err.code}: ${err.message}`,
    };
  }
}

async function runModel(model: ModelId): Promise<ModelRun> {
  const results: CaseResult[] = new Array(cases.length);
  let next = 0;
  let stopped = false;
  async function worker() {
    while (next < cases.length) {
      if (engineKind === 'claude' && spent >= maxSpend) {
        stopped = true;
        return;
      }
      const index = next++;
      const c = cases[index]!;
      const result = await runCase(c, model);
      spent += result.costUsd;
      results[index] = result;
      const titles = result.findings.map((f) => `${f.severity}: ${f.title}`).join(' | ');
      console.log(
        `${c.id.padEnd(28)} ${caseVerdict(result).padEnd(11)} $${result.costUsd.toFixed(4)}  ` +
          `${(result.durationMs / 1000).toFixed(1).padStart(5)} s  ${result.error ?? titles}`,
      );
    }
  }
  console.log(`\n── ${model} · ${engineKind} engine · effort ${effort} · ${cases.length} cases`);
  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, worker));
  if (stopped) console.warn(`Stopped early: spend reached the --max-spend limit of $${maxSpend}.`);
  const done = results.filter((r): r is CaseResult => r !== undefined);
  return { model, summary: summarize(done), results: done };
}

const run: EvalRun = {
  startedAt: new Date().toISOString(),
  engine: engineKind,
  effort,
  label: values.label,
  runs: [],
};
for (const model of models) run.runs.push(await runModel(model));

console.log('');
for (const { model, summary } of run.runs) for (const line of summaryLines(model, summary)) console.log(line);

const resultsDir = join(root, 'results');
mkdirSync(resultsDir, { recursive: true });
const stamp = run.startedAt.replace(/[:.]/g, '-').slice(0, 19);
const name = [stamp, engineKind, values.label].filter(Boolean).join('-');
writeFileSync(join(resultsDir, `${name}.json`), JSON.stringify(run, null, 2) + '\n');
writeFileSync(join(resultsDir, `${name}.md`), renderMarkdown(run));
if (engineKind === 'claude') {
  const entry = {
    at: run.startedAt,
    label: values.label,
    models,
    effort,
    cases: cases.length,
    costUsd: spent,
  };
  appendFileSync(join(resultsDir, 'spend.jsonl'), JSON.stringify(entry) + '\n');
}
const spendNote =
  engineKind === 'claude' ? `real spend this run $${spent.toFixed(4)}` : 'fake engine, costs simulated';
console.log(`\nsaved eval/results/${name}.json and .md · ${spendNote}`);
