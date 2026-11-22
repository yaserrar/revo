import { isBotLogin, type SkipReason } from '@revo/shared';

export type GateInput = {
  repoEnabled: boolean;
  reviewDrafts: boolean;
  reviewBots: boolean;
  draft: boolean;
  authorLogin: string;
  /** GitHub account type of the author ("Bot" for apps). */
  authorType: string;
  monthSpentUsd: number;
  monthlyBudgetUsd: number;
};

/**
 * Why a PR must not be reviewed now, or null to review it (spec 6 and 11.6).
 * Order matters: the most permanent reason wins.
 */
export function skipReasonFor(input: GateInput): SkipReason | null {
  if (!input.repoEnabled) return 'disabled';
  if (input.draft && !input.reviewDrafts) return 'draft';
  if (!input.reviewBots && (input.authorType === 'Bot' || isBotLogin(input.authorLogin))) return 'bot';
  if (input.monthSpentUsd >= input.monthlyBudgetUsd) return 'budget';
  return null;
}

/**
 * Skip reasons that can stop applying to the same commit (a draft marked
 * ready, settings or budget changed, a new month or an own API key for the
 * free tier): a new event re-evaluates them. Other outcomes are final for a
 * commit (spec 6: one review per head SHA).
 */
export const REEVALUATED_SKIP_REASONS: readonly SkipReason[] = [
  'draft',
  'bot',
  'budget',
  'disabled',
  'free_limit',
  'free_paused',
];
