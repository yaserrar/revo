import { AI_SOURCE_LABELS, type ReviewDto } from '@revo/shared';

/**
 * What paid for a run, for "Run details". Queued and skipped runs billed
 * nothing. A run with no payer recorded ran on Revo's key when it billed
 * something (rows saved before the payer was recorded); otherwise it failed
 * before an engine was chosen (e.g. an own key that could not be read) and
 * nobody paid.
 */
export function paidBy(
  review: Pick<ReviewDto, 'status' | 'aiSource' | 'costUsd' | 'inputTokens' | 'outputTokens'>,
): string {
  if (review.status === 'queued' || review.status === 'skipped') return '—';
  if (review.aiSource) return AI_SOURCE_LABELS[review.aiSource];
  const billed = review.costUsd > 0 || review.inputTokens + review.outputTokens > 0;
  return billed ? AI_SOURCE_LABELS.revo : '—';
}
