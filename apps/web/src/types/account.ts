import type { AiAccess, EffectiveAiAccess, InstallationDto } from '@revo/shared';

/** Free reviews of an account this UTC month (only for accounts on the free tier). */
export type FreeTierUsageDto = {
  used: number;
  limit: number;
  /** ISO date of the 1st of next month (UTC), when the count starts again. */
  resetsAt: string;
  /** Revo's free reviews are paused for every account until next month (global cap). */
  paused: boolean;
};

/**
 * Who pays for Claude on one GitHub account (an App installation). The saved
 * Anthropic key itself never leaves the server: only its last 4 characters.
 */
export type AccountAiAccessDto = {
  installation: InstallationDto;
  /** The saved choice. */
  aiAccess: AiAccess;
  /** What the worker actually uses (see effectiveAiAccess). */
  effective: EffectiveAiAccess;
  /** Last 4 characters of the saved key, or null when none is saved. */
  keyHint: string | null;
  freeTier: FreeTierUsageDto | null;
  /** When and by whom the AI access was last changed. */
  updatedAt: string | null;
  updatedBy: string | null;
  /** The user may change it: Admin on at least one of the account's repos. */
  canEdit: boolean;
};

export type AccountsDto = {
  items: AccountAiAccessDto[];
  /** The server offers the Claude subscription logged in on its machine (REVO_ALLOW_CLAUDE_SUBSCRIPTION). */
  subscriptionAllowed: boolean;
  /** FREE_REVIEWS_PER_MONTH, for the copy. */
  freeReviewsPerMonth: number;
};
