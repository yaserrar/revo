import 'server-only';
import { decimalToNumber, type Review } from '@revo/db';
import type { ReviewDto } from '@revo/shared';

export function presentReview(r: Review): ReviewDto {
  return {
    id: r.id,
    pullRequestId: r.pullRequestId,
    headSha: r.headSha,
    status: r.status,
    skipReason: r.skipReason,
    trigger: r.trigger,
    score: r.score,
    label: r.label,
    passed: r.passed,
    model: r.model,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cachedTokens: r.cachedTokens,
    cacheWriteTokens: r.cacheWriteTokens,
    costUsd: decimalToNumber(r.costUsd),
    durationMs: r.durationMs,
    filesReviewed: r.filesReviewed,
    filesSkipped: r.filesSkipped,
    skippedFiles: r.skippedFiles,
    notes: r.notes,
    error: r.error,
    aiSource: r.aiSource,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}
