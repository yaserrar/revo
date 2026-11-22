import { REVIEW_LIMITS } from '@revo/shared';
import { buildReviewContext } from './context';
import { filterFiles, isRecent, largePrNote, selectFiles } from './files';
import { applyVerifications, compareFindings, selectConfirmed, type JudgedFinding } from './postprocess';
import { isReviewEngineError, withEarlierUsage } from './errors';
import { addUsage, isPricedModel, roundUsd, usageCostUsd, ZERO_USAGE } from './pricing';
import { renderInstructions, SYSTEM_PROMPT } from './prompts';
import { collectRelatedFiles } from './related';
import { computeScore } from './score';
import { buildSnippet } from './snippet';
import { collectCallers } from './callers';
import { collectNameUsages } from './usages';
import { estimateTokens, PASS_RESERVE_TOKENS } from './tokens';
import type {
  ChangedFile,
  EngineContext,
  RelatedFile,
  ReviewedFinding,
  ReviewInput,
  ReviewOutcome,
  SkippedFile,
} from './types';

/** Tokens left for the context in each pass: the hard limit minus the system prompt and the reserve. */
export function contextBudgetTokens(instructions: string): number {
  const system = estimateTokens(SYSTEM_PROMPT) + estimateTokens(renderInstructions(instructions) ?? '');
  return REVIEW_LIMITS.maxInputTokensPerPass - system - PASS_RESERVE_TOKENS;
}

/**
 * Reviews a change without any GitHub code: filter files, apply size limits,
 * collect related files, build the context within the token budget, run
 * pass 1 (find) and pass 2 (verify) on the engine, keep confirmed findings,
 * compute the score and the cost.
 */
export async function reviewChanges(input: ReviewInput): Promise<ReviewOutcome> {
  const started = Date.now();
  const { settings, engine } = input;
  if (!isPricedModel(settings.model)) throw new Error(`Unknown model "${settings.model}"`);

  const filtered = filterFiles(input.files, settings.ignoreGlobs);
  const sized = selectFiles(filtered.reviewable);

  const collected = input.readFile
    ? await collectRelatedFiles({
        files: sized.selected,
        readFile: input.readFile,
        ignoreGlobs: settings.ignoreGlobs,
      })
    : [];
  const names = await collectNameUsages({
    files: sized.selected,
    changedPaths: new Set(input.files.map((f) => f.path)),
    related: [...input.related, ...collected],
    readFile: input.readFile,
    search: input.searchUsages,
    ignoreGlobs: settings.ignoreGlobs,
  });
  const callers = await collectCallers({
    files: sized.selected,
    taken: new Set([
      ...input.files.map((f) => f.path),
      ...input.related.map((r) => r.path),
      ...collected.map((r) => r.path),
      ...names.extra.map((r) => r.path),
    ]),
    readFile: input.readFile,
    search: input.searchUsages,
    ignoreGlobs: settings.ignoreGlobs,
  });
  // Users of a removed name and callers of changed code first: under budget pressure,
  // related files are dropped from the end.
  const extra = [...names.extra, ...callers];
  const related = mergeRelated(input.related, [...extra, ...collected], extra.length);

  const budget = contextBudgetTokens(settings.instructions);
  const context = buildReviewContext({
    pr: input.pr,
    files: sized.selected,
    related,
    budgetTokens: budget,
    usages: names.usages,
  });
  const droppedByBudget: SkippedFile[] = context.droppedFiles.map((path) => ({
    path,
    reason: 'token_budget',
  }));
  const reviewedPaths = new Set(context.files.map((f) => f.path));
  const reviewed = sized.selected.filter((f) => reviewedPaths.has(f.path));

  const skippedFiles = [...filtered.skipped, ...sized.skipped, ...droppedByBudget];
  const total = filtered.reviewable.length;
  const notes = reviewed.length < total && reviewed.length > 0 ? [largePrNote(reviewed.length, total)] : [];
  const recent = reviewed.filter(isRecent).length;
  if (recent > 0) notes.push(recentNote(recent));
  const outside = context.related.filter((p) => names.extra.some((f) => f.path === p));
  if (outside.length > 0) notes.push(usageNote(outside));
  const calling = context.related.filter((p) => callers.some((f) => f.path === p));
  if (calling.length > 0) notes.push(callerNote(calling));
  const base = {
    model: settings.model,
    engine: engine.kind,
    filesReviewed: reviewed.length,
    filesSkipped: skippedFiles.length,
    skippedFiles,
    notes,
  };

  if (reviewed.length === 0) {
    return {
      ...base,
      status: 'skipped',
      skipReason: 'no_reviewable_files',
      durationMs: Date.now() - started,
    };
  }
  if (context.estimatedTokens > budget) {
    return {
      ...base,
      filesReviewed: 0,
      status: 'skipped',
      skipReason: 'too_large',
      durationMs: Date.now() - started,
    };
  }

  const ctx: EngineContext = {
    pr: input.pr,
    files: reviewed,
    related: related.filter((r) => context.related.includes(r.path)),
    settings,
    model: settings.model,
    context,
  };

  const pass1 = await engine.find(ctx);
  const verified =
    pass1.findings.length > 0
      ? await engine.verify(ctx, pass1.findings).catch((err: unknown) => {
          // Pass 1 is already billed: the failure must carry its cost too (budget, eval spend).
          throw isReviewEngineError(err) ? withEarlierUsage(err, pass1.usage, settings.model) : err;
        })
      : { verifications: [], usage: ZERO_USAGE };

  const judged = applyVerifications(pass1.findings, verified.verifications, {
    reviewedPaths,
    categories: settings.categories,
  });
  const confirmed = selectConfirmed(judged, settings.maxFindings);
  const rejected = judged.filter((f) => !f.confirmed).sort(compareFindings);

  const filesByPath = new Map(reviewed.map((f) => [f.path, f]));
  const finish = (list: JudgedFinding[]) => list.map((f, index) => toReviewed(f, index, filesByPath));

  const score = computeScore(confirmed, settings.threshold);
  const usage = addUsage(pass1.usage, verified.usage);
  const costUsd = usageCostUsd(settings.model, pass1.usage) + usageCostUsd(settings.model, verified.usage);

  return {
    ...base,
    status: 'done',
    findings: finish(confirmed),
    rejected: finish(rejected),
    score: score.score,
    label: score.label,
    passed: score.passed,
    counts: score.counts,
    breakdown: score.breakdown,
    usage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      costUsd: roundUsd(costUsd),
    },
    durationMs: Date.now() - started,
  };
}

/** Note shown in the comment and dashboard when a push changed files after the last review. */
export function recentNote(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'} changed since the last review: reviewed first, with the diff of the new commits.`;
}

/** Note naming the files outside the PR read because they use a name the change removes or renames. */
export function usageNote(paths: readonly string[]): string {
  return `Also read ${paths.length === 1 ? 'a file' : `${paths.length} files`} outside this PR that still ${paths.length === 1 ? 'uses' : 'use'} a name the change removes or renames: ${paths.join(', ')}.`;
}

/** Note naming the files outside the PR read because they call code the change modifies. */
export function callerNote(paths: readonly string[]): string {
  return `Also read ${paths.length === 1 ? 'a file' : `${paths.length} files`} outside this PR that ${paths.length === 1 ? 'calls' : 'call'} code it changes: ${paths.join(', ')}.`;
}

/** Given related files first, then collected ones, without duplicates. */
function mergeRelated(
  given: readonly RelatedFile[],
  collected: readonly RelatedFile[],
  extraSlots = 0,
): RelatedFile[] {
  const seen = new Set<string>();
  const out: RelatedFile[] = [];
  for (const file of [...given, ...collected]) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    out.push(file);
  }
  return out.slice(0, Math.max(given.length, REVIEW_LIMITS.maxRelatedFiles + extraSlots));
}

function toReviewed(f: JudgedFinding, index: number, files: Map<string, ChangedFile>): ReviewedFinding {
  const { confirmed: _confirmed, ...finding } = f;
  return { ...finding, index, ...buildSnippet(files.get(f.file), f.lineStart, f.lineEnd) };
}
