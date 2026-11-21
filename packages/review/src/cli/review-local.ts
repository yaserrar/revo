/**
 * pnpm review:local --diff change.patch [--repo ./path] [--model claude-sonnet-5-5]
 *                   [--fake | --engine claude|fake] [--effort high] [--title "PR title"]
 *                   [--body "description"] [--instructions "repo rules"] [--json]
 *
 * Reviews a local diff without GitHub and prints the findings and the score.
 * With --repo, the checkout gives the new versions of the changed files and
 * the related files (imports, Prisma schema). The diff may be applied there
 * or not: when a file still matches the old side, the diff is applied in
 * memory.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  DEFAULT_REPO_SETTINGS,
  ModelIdSchema,
  modelName,
  SCORE_LABEL_TEXT,
  type Severity,
} from '@revo/shared';
import { createClaudeEngine, type ClaudeEffort } from '../engines/claude';
import { fakeEngine } from '../engines/fake';
import { isReviewEngineError } from '../errors';
import { parseGitDiff } from '../git-diff';
import { createDirectoryReader } from '../node';
import { applyPatch, isPatchApplied } from '../patch';
import { reviewChanges } from '../review';
import type { ChangedFile, ReviewEngine } from '../types';

const EFFORTS: readonly ClaudeEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const USAGE =
  'Usage: pnpm review:local --diff file.patch [--repo ./path] [--model id] [--fake | --engine claude|fake] ' +
  '[--effort low|medium|high|xhigh|max] [--title text] [--body text] [--instructions text] [--json]';

const { values } = parseArgs({
  options: {
    diff: { type: 'string' },
    repo: { type: 'string' },
    model: { type: 'string', default: DEFAULT_REPO_SETTINGS.model },
    engine: { type: 'string' },
    fake: { type: 'boolean', default: false },
    effort: { type: 'string', default: 'high' },
    title: { type: 'string', default: 'Local change' },
    body: { type: 'string', default: '' },
    instructions: { type: 'string', default: '' },
    json: { type: 'boolean', default: false },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!values.diff) fail(USAGE);
const model = ModelIdSchema.safeParse(values.model);
if (!model.success) fail(`Unknown model "${values.model}". Use one of: ${ModelIdSchema.options.join(', ')}`);
const effort = EFFORTS.find((e) => e === values.effort) ?? fail(`Unknown effort "${values.effort}".`);

const engineKind = values.fake
  ? 'fake'
  : (values.engine ?? process.env.REVO_ENGINE ?? (process.env.ANTHROPIC_API_KEY ? 'claude' : 'fake'));
let engine: ReviewEngine;
if (engineKind === 'fake') engine = fakeEngine;
else if (engineKind === 'claude') {
  if (!process.env.ANTHROPIC_API_KEY)
    fail('ANTHROPIC_API_KEY is not set (in .env). Use --fake to run offline.');
  engine = createClaudeEngine({ effort });
} else fail(`Engine "${engineKind}" is not available. Available: claude, fake`);

// pnpm runs scripts from the package folder; INIT_CWD is where the user typed the command.
const cwd = process.env.INIT_CWD ?? process.cwd();
const diffPath = resolve(cwd, values.diff);
if (!existsSync(diffPath)) fail(`No diff at ${diffPath}`);
const files = parseGitDiff(readFileSync(diffPath, 'utf8'));

/** Gives each changed file its new version from the checkout, applying the diff when needed. */
function loadNewVersions(repo: string, changed: ChangedFile[]): Map<string, string | null> {
  const overlay = new Map<string, string | null>();
  for (const file of changed) {
    if (file.status === 'removed') {
      overlay.set(file.path, null);
      continue;
    }
    const onDisk = resolve(repo, file.path);
    const oldOnDisk = resolve(repo, file.previousPath ?? file.path);
    const current = existsSync(onDisk) ? readFileSync(onDisk, 'utf8') : null;
    if (current !== null && file.patch && isPatchApplied(current, file.patch)) {
      file.newContent = current;
    } else if (file.patch) {
      const base = existsSync(oldOnDisk) ? readFileSync(oldOnDisk, 'utf8') : '';
      const applied = applyPatch(file.status === 'added' ? '' : base, file.patch);
      if (applied !== null) file.newContent = applied;
      else console.warn(`warning: ${file.path} matches neither side of the diff; reviewing the patch only`);
    } else if (current !== null) {
      file.newContent = current;
    }
    if (file.newContent !== undefined) overlay.set(file.path, file.newContent);
  }
  return overlay;
}

const repo = values.repo ? resolve(cwd, values.repo) : null;
if (repo && !existsSync(repo)) fail(`No folder at ${repo}`);
const readFile = repo ? createDirectoryReader(repo, loadNewVersions(repo, files)) : undefined;

const color = process.stdout.isTTY && !values.json;
const paint = (code: number, text: string) => (color ? `\u001b[${code}m${text}\u001b[0m` : text);
const bold = (t: string) => paint(1, t);
const dim = (t: string) => paint(2, t);
const SEVERITY_COLOR: Record<Severity, number> = { blocker: 31, major: 33, minor: 36 };

try {
  const outcome = await reviewChanges({
    pr: { title: values.title, body: values.body },
    files,
    related: [],
    settings: { ...DEFAULT_REPO_SETTINGS, model: model.data, instructions: values.instructions },
    engine,
    ...(readFile ? { readFile } : {}),
  });

  if (values.json) {
    console.log(JSON.stringify(outcome, null, 2));
  } else if (outcome.status === 'skipped') {
    const why =
      outcome.skipReason === 'too_large' ? 'the change is too large to review' : 'no reviewable files';
    console.log(`Skipped: ${why} (${outcome.filesSkipped} file(s) skipped).`);
  } else {
    const label = SCORE_LABEL_TEXT[outcome.label].toLowerCase();
    const scoreColor = outcome.label === 'good_to_merge' ? 32 : outcome.label === 'needs_a_look' ? 33 : 31;
    console.log(
      `\n${bold('Revo')}  ${paint(scoreColor, bold(`${outcome.score} / 100`))}, ${label}  ` +
        dim(outcome.passed ? '(check: pass)' : '(check: fail)'),
    );
    const lost = outcome.breakdown.filter((row) => row.count > 0);
    if (lost.length > 0) {
      console.log(dim(lost.map((row) => `${row.count} ${row.severity} ${row.points}`).join(' · ')));
    }
    for (const note of outcome.notes) console.log(note);
    if (outcome.findings.length === 0) console.log('\nNo problems found.');
    outcome.findings.forEach((f, i) => {
      const lines = f.lineStart === f.lineEnd ? `${f.lineStart}` : `${f.lineStart}-${f.lineEnd}`;
      const lowered = f.originalSeverity ? dim(` (was ${f.originalSeverity})`) : '';
      console.log(
        `\n${i + 1}. ${paint(SEVERITY_COLOR[f.severity], f.severity.toUpperCase())}${lowered} · ${f.category}  ` +
          `${bold(`${f.file}:${lines}`)}  ${dim(`confidence ${f.confidence.toFixed(2)}`)}`,
      );
      console.log(`   ${bold(f.title)}`);
      console.log(`   ${f.explanation}`);
      console.log(`   ${dim('Fix:')} ${f.suggestion}`);
      if (f.snippet) {
        const width = String(f.snippetStartLine + f.snippet.split('\n').length).length;
        f.snippet.split('\n').forEach((code, k) => {
          const n = f.snippetStartLine + k;
          const mark = n >= f.lineStart && n <= f.lineEnd ? '>' : ' ';
          console.log(dim(`   ${mark} ${String(n).padStart(width)} │ `) + code);
        });
      }
    });
    if (outcome.rejected.length > 0) {
      console.log(dim(`\nRejected by verification: ${outcome.rejected.length}`));
      for (const f of outcome.rejected) {
        console.log(dim(`   - ${f.title} (${f.file}:${f.lineStart}): ${f.reason}`));
      }
    }
    const u = outcome.usage;
    console.log(
      dim(
        `\nReviewed ${outcome.filesReviewed} file(s), skipped ${outcome.filesSkipped} · ${modelName(outcome.model)} · ` +
          `${outcome.engine} engine · ${u.inputTokens} in + ${u.cachedTokens} cached + ${u.cacheWriteTokens} cache-write / ` +
          `${u.outputTokens} out · $${u.costUsd.toFixed(4)} · ${(outcome.durationMs / 1000).toFixed(1)} s`,
      ),
    );
  }
} catch (err) {
  if (isReviewEngineError(err))
    fail(`Review failed [${err.code}${err.retryable ? ', retryable' : ''}]: ${err.message}`);
  throw err;
}
