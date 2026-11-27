/**
 * pnpm bench [--engine claude-subscription|fake|claude] [--model claude-sonnet-5-5] [--effort high]
 *            [--only 01,15] [--label prompt-v2] [--source ../dropwave] [--work-dir bench/.work]
 *            [--allow-api-key]
 *
 * Reviews every case in bench/cases (changes to the dropwave repo with known
 * answers) with Revo's real pipeline, one case at a time, and scores the
 * findings: catch rate on planted bugs, false alarms on clean changes, tokens,
 * cost and time. Writes bench/results/<stamp>-<engine>-<model>[-label].{json,md}
 * after every case, so an interrupted run keeps what it measured.
 *
 * Default engine: the Claude subscription logged in on this machine (no API
 * key is used; see src/engine.ts). `--engine claude` bills ANTHROPIC_API_KEY
 * and needs --allow-api-key.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { isReviewEngineError, reviewChanges, type ClaudeEffort, type ReviewedFinding } from '@revo/review';
import { DEFAULT_REPO_SETTINGS, ModelIdSchema } from '@revo/shared';
import { loadCases, loadKnownFalsePositives, type BenchCase, type KnownFalsePositive } from './cases';
import {
  apiEquivalentUsd,
  createBenchEngine,
  emptyCallLog,
  ENGINE_CHOICES,
  type CallLog,
  type EngineChoice,
} from './engine';
import { renderMarkdown, summaryLines, type BenchRun } from './report';
import { caseOutcome, scoreCase, summarize, type BenchFinding, type CaseResult } from './score';
import { CaseSetupError, ensureClone, prepareChange } from './workspace';

const EFFORTS: readonly ClaudeEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
/** Engine errors after which the next cases would fail the same way. */
const FATAL_CODES = new Set(['auth', 'rate_limited']);

const { values } = parseArgs({
  options: {
    engine: { type: 'string', default: 'claude-subscription' },
    model: { type: 'string', default: DEFAULT_REPO_SETTINGS.model },
    effort: { type: 'string', default: 'high' },
    only: { type: 'string' },
    label: { type: 'string', default: '' },
    source: { type: 'string' },
    'work-dir': { type: 'string' },
    'allow-api-key': { type: 'boolean', default: false },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const engine =
  ENGINE_CHOICES.find((e) => e === values.engine) ??
  fail(`Unknown engine "${values.engine}". Use ${ENGINE_CHOICES.join(', ')}.`);
if (engine === 'claude') {
  if (!values['allow-api-key'])
    fail(
      '--engine claude bills ANTHROPIC_API_KEY. Add --allow-api-key to accept, or use the default claude-subscription.',
    );
  if (!process.env.ANTHROPIC_API_KEY) fail('ANTHROPIC_API_KEY is not set (in .env).');
}
const parsedModel = ModelIdSchema.safeParse(values.model);
const model = parsedModel.success
  ? parsedModel.data
  : fail(`Unknown model "${values.model}". Use: ${ModelIdSchema.options.join(', ')}`);
const effort = EFFORTS.find((e) => e === values.effort) ?? fail(`Unknown effort "${values.effort}".`);

const benchDir = join(import.meta.dirname, '..');
const revoRoot = join(benchDir, '..');
// pnpm runs scripts from the package folder; INIT_CWD is where the user typed the command.
const cwd = process.env.INIT_CWD ?? process.cwd();
const source = values.source
  ? /^[a-z]+:\/\//.test(values.source)
    ? values.source
    : resolve(cwd, values.source)
  : (process.env.REVO_BENCH_SOURCE ?? join(revoRoot, '..', 'dropwave'));
if (!/^[a-z]+:\/\//.test(source) && !existsSync(source))
  fail(`No repo at ${source}. Pass --source <path or URL of the dropwave repo>.`);
const workDir = values['work-dir'] ? resolve(cwd, values['work-dir']) : join(benchDir, '.work');

const known = loadKnownFalsePositives(join(benchDir, 'known-false-positives.json'));
const cases = loadCases(join(benchDir, 'cases')).filter(
  (c) => !values.only || values.only.split(',').some((prefix) => c.id.startsWith(prefix.trim())),
);
if (cases.length === 0) fail('No case matches --only.');

const toBench = (f: ReviewedFinding): BenchFinding => ({
  file: f.file,
  lineStart: f.lineStart,
  lineEnd: f.lineEnd,
  severity: f.severity,
  category: f.category,
  title: f.title,
  explanation: f.explanation,
  confidence: f.confidence,
  reason: f.reason,
});

let log: CallLog = emptyCallLog();
/** Every Claude Code credential source seen in this run (subscription engine). */
const keySources = new Set<string>();
const reviewEngine = createBenchEngine(engine as EngineChoice, effort, () => log);

async function runCase(
  c: BenchCase,
  clone: string,
  knownFps: readonly KnownFalsePositive[],
): Promise<CaseResult> {
  log = emptyCallLog();
  const started = Date.now();
  const base = { id: c.id, kind: c.kind, expected: c.expected, claudeCodeEstimateUsd: null };
  const priced = () => (engine === 'claude-subscription' ? apiEquivalentUsd(log.calls) : 0);
  const estimate = () => (engine === 'claude-subscription' ? log.claudeCodeEstimateUsd : null);
  try {
    const prepared = prepareChange(clone, c.base.sha, c.basePatchPath, c.diff);
    const outcome = await reviewChanges({
      pr: { title: c.title, body: c.body },
      files: prepared.files,
      related: [],
      settings: { ...DEFAULT_REPO_SETTINGS, model: model },
      engine: reviewEngine,
      readFile: prepared.readFile,
      searchUsages: prepared.searchUsages,
    });
    const u =
      outcome.status === 'done'
        ? outcome.usage
        : { inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0, costUsd: 0 };
    const findings = outcome.status === 'done' ? outcome.findings.map(toBench) : [];
    const rejected = outcome.status === 'done' ? outcome.rejected.map(toBench) : [];
    const score = scoreCase(c.expected, findings, rejected, knownFps);
    return {
      ...base,
      findings,
      rejected,
      score,
      outcome: caseOutcome(c.expected.length, score),
      tokens: {
        input: u.inputTokens,
        cacheRead: u.cachedTokens,
        cacheWrite: u.cacheWriteTokens,
        output: u.outputTokens,
      },
      billedUsd: u.costUsd,
      apiEquivalentUsd: engine === 'claude-subscription' ? priced() : u.costUsd,
      claudeCodeEstimateUsd: estimate(),
      durationMs: outcome.durationMs,
      filesReviewed: outcome.filesReviewed,
      filesSkipped: outcome.filesSkipped,
      notes:
        outcome.status === 'skipped' ? [`skipped: ${outcome.skipReason}`, ...outcome.notes] : outcome.notes,
    };
  } catch (err) {
    if (!isReviewEngineError(err) && !(err instanceof CaseSetupError)) throw err;
    const usage = isReviewEngineError(err) ? err.usage : undefined;
    return {
      ...base,
      findings: [],
      rejected: [],
      score: null,
      outcome: 'failed',
      tokens: {
        input: usage?.inputTokens ?? 0,
        cacheRead: usage?.cacheReadTokens ?? 0,
        cacheWrite: usage?.cacheWriteTokens ?? 0,
        output: usage?.outputTokens ?? 0,
      },
      billedUsd: engine === 'claude-subscription' ? 0 : (usage?.costUsd ?? 0),
      apiEquivalentUsd: engine === 'claude-subscription' ? priced() : (usage?.costUsd ?? 0),
      claudeCodeEstimateUsd: estimate(),
      durationMs: Date.now() - started,
      filesReviewed: 0,
      filesSkipped: 0,
      notes: [],
      error: isReviewEngineError(err) ? `${err.code}: ${err.message}` : `setup: ${err.message}`,
    };
  }
}

if (engine === 'claude-subscription') {
  console.warn(
    'Using the Claude subscription logged in on this machine (Claude Code), for your own use on your own machine ' +
      '(Anthropic’s terms). No API key is passed to Claude Code; a run that would use one stops the bench.',
  );
}

const clone = ensureClone(source, workDir, basename(source).replace(/\.git$/, '') || 'repo');
const resultsDir = join(benchDir, 'results');
mkdirSync(resultsDir, { recursive: true });
const startedAt = new Date().toISOString();
const name = [startedAt.replace(/[:.]/g, '-').slice(0, 19), engine, model, values.label]
  .filter(Boolean)
  .join('-');
const run: BenchRun = {
  startedAt,
  finishedAt: null,
  engine,
  model: model,
  effort,
  label: values.label,
  source: values.source ?? (process.env.REVO_BENCH_SOURCE ? source : '../dropwave'),
  summary: summarize([]),
  results: [],
};

function save() {
  run.summary = summarize(run.results);
  writeFileSync(join(resultsDir, `${name}.json`), JSON.stringify(run, null, 2) + '\n');
  writeFileSync(join(resultsDir, `${name}.md`), renderMarkdown(run, cases));
}

console.log(`\n── ${cases.length} cases · ${engine} · ${model} · effort ${effort} · one at a time`);
let stopped: string | null = null;
for (const c of cases) {
  const result = await runCase(c, clone, known);
  for (const source of log.apiKeySources) keySources.add(source);
  run.results.push(result);
  save();
  const findings = result.findings
    .map((f, i) => `${result.score?.labels[i]}: ${f.severity} ${f.title} (${f.file}:${f.lineStart})`)
    .join(' | ');
  console.log(
    `${c.id.padEnd(34)} ${result.outcome.padEnd(11)} ${(result.durationMs / 1000).toFixed(1).padStart(6)} s  ` +
      `$${result.apiEquivalentUsd.toFixed(4)}  ${result.error ?? (findings || 'no findings')}`,
  );
  if (log.guard) {
    stopped = log.guard.message;
    break;
  }
  const code = result.error?.split(':')[0];
  if (code && FATAL_CODES.has(code)) {
    stopped = `stopped after ${c.id}: ${result.error}`;
    break;
  }
}

if (!stopped) run.finishedAt = new Date().toISOString();
save();
console.log('');
for (const line of summaryLines(run)) console.log(line);
if (keySources.size > 0)
  console.log(`  credential     apiKeySource ${[...keySources].join(', ')} (none = the subscription login)`);
console.log(`\nsaved bench/results/${name}.json and .md`);
if (stopped) fail(`\n${stopped}`);
