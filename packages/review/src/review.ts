import { REVIEW_LIMITS } from '@revo/shared';
import { buildReviewContext } from './context';
import { filterFiles, largePrNote, selectFiles } from './files';
import { applyVerifications, compareFindings, selectConfirmed, type JudgedFinding } from './postprocess';
import { isReviewEngineError, withEarlierUsage } from './errors';
import { addUsage, isPricedModel, roundUsd, usageCostUsd, ZERO_USAGE } from './pricing';
import { renderInstructions, SYSTEM_PROMPT } from './prompts';
import { collectRelatedFiles } from './related';
import { computeScore } from './score';
import { buildSnippet } from './snippet';
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
  const related = mergeRelated(input.related, collected);

  const budget = contextBudgetTokens(settings.instructions);
  const context = buildReviewContext({ pr: input.pr, files: sized.selected, related, budgetTokens: budget });
  const droppedByBudget: SkippedFile[] = context.droppedFiles.map((path) => ({ path, reason: 'size_limit' }));
  const reviewedPaths = new Set(context.files.map((f) => f.path));
  const reviewed = sized.selected.filter((f) => reviewedPaths.has(f.path));

  const skippedFiles = [...filtered.skipped, ...sized.skipped, ...droppedByBudget];
  const total = filtered.reviewable.length;
  const notes = reviewed.length < total && reviewed.length > 0 ? [largePrNote(reviewed.length, total)] : [];
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

  const found = await engine.find(ctx);
  const verified =
    found.findings.length > 0
      ? await engine.verify(ctx, found.findings).catch((err: unknown) => {
          // Pass 1 is already billed: the failure must carry its cost too (budget, eval spend).
          throw isReviewEngineError(err) ? withEarlierUsage(err, found.usage, settings.model) : err;
        })
      : { verifications: [], usage: ZERO_USAGE };

  const judged = applyVerifications(found.findings, verified.verifications, {
    reviewedPaths,
    categories: settings.categories,
  });
  const confirmed = selectConfirmed(judged, settings.maxFindings);
  const rejected = judged.filter((f) => !f.confirmed).sort(compareFindings);

  const filesByPath = new Map(reviewed.map((f) => [f.path, f]));
  const finish = (list: JudgedFinding[]) => list.map((f, index) => toReviewed(f, index, filesByPath));

  const score = computeScore(confirmed, settings.threshold);
  const usage = addUsage(found.usage, verified.usage);
  const costUsd = usageCostUsd(settings.model, found.usage) + usageCostUsd(settings.model, verified.usage);

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

/** Given related files first, then collected ones, without duplicates. */
function mergeRelated(given: readonly RelatedFile[], collected: readonly RelatedFile[]): RelatedFile[] {
  const seen = new Set<string>();
  const out: RelatedFile[] = [];
  for (const file of [...given, ...collected]) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    out.push(file);
  }
  return out.slice(0, Math.max(given.length, REVIEW_LIMITS.maxRelatedFiles));
}

function toReviewed(f: JudgedFinding, index: number, files: Map<string, ChangedFile>): ReviewedFinding {
  const { confirmed: _confirmed, ...finding } = f;
  return { ...finding, index, ...buildSnippet(files.get(f.file), f.lineStart, f.lineEnd) };
}
