/**
 * Who pays for Claude, per GitHub account (an App installation). The values
 * equal the Prisma enums `AiAccess` and `AiSource` (packages/db/src/enum-parity.ts).
 * Worker and web read the same environment variables with these defaults.
 */
import { modelName, type ModelId } from './models';

/**
 * - `free`: Revo's own key, within the free tier (owner accounts: no limits).
 * - `own_key`: the account's own Anthropic API key, stored encrypted. Every model, no Revo caps.
 * - `subscription`: the Claude subscription logged in on the machine running Revo
 *   (only when the server sets REVO_ALLOW_CLAUDE_SUBSCRIPTION=1).
 */
export const AI_ACCESS = ['free', 'own_key', 'subscription'] as const;
export type AiAccess = (typeof AI_ACCESS)[number];

export const AI_ACCESS_LABELS: Record<AiAccess, string> = {
  free: 'Free tier',
  own_key: 'Your Anthropic API key',
  subscription: 'Claude subscription',
};

/** What paid for one review run. Null on rows older than this field means `revo`. */
export const AI_SOURCES = ['revo', 'account', 'subscription'] as const;
export type AiSource = (typeof AI_SOURCES)[number];

export const AI_SOURCE_LABELS: Record<AiSource, string> = {
  revo: 'Free tier',
  account: 'Your key',
  subscription: 'Claude subscription',
};

/** Shown wherever the subscription option is offered. */
export const SUBSCRIPTION_TERMS_NOTE = "For your own use on your own machine (Anthropic's terms)";

/** Reviews per account per calendar month (UTC) on Revo's key (env FREE_REVIEWS_PER_MONTH). */
export const DEFAULT_FREE_REVIEWS_PER_MONTH = 20;
/** Revo's total free-tier spend per month across every account, in USD (env FREE_MONTHLY_CAP_USD). */
export const DEFAULT_FREE_MONTHLY_CAP_USD = 50;

/** Models the free tier runs. Opus needs the account's own key (or the subscription). */
export const FREE_TIER_MODELS: readonly ModelId[] = ['claude-haiku-5-5', 'claude-sonnet-5-5'];
/** What a free-tier repo set to a model outside FREE_TIER_MODELS runs on. */
export const FREE_TIER_FALLBACK_MODEL: ModelId = 'claude-sonnet-5-5';

export function isFreeTierModel(model: ModelId): boolean {
  return FREE_TIER_MODELS.includes(model);
}

/** The model a free-tier review runs, and the note shown when it differs from the repo's choice. */
export function freeTierModel(model: ModelId): { model: ModelId; note: string | null } {
  if (isFreeTierModel(model)) return { model, note: null };
  return {
    model: FREE_TIER_FALLBACK_MODEL,
    note: `Ran on ${modelName(FREE_TIER_FALLBACK_MODEL)}: ${shortModelName(model)} needs your own API key.`,
  };
}

function shortModelName(model: ModelId): string {
  return modelName(model)
    .replace(/^Claude\s+/, '')
    .replace(/\s+[\d.]+$/, '');
}

/**
 * REVO_OWNER_ACCOUNTS: comma-separated GitHub logins whose installations use
 * Revo's key without free-tier limits (the host's own repos). Lowercased,
 * since GitHub logins are case-insensitive.
 */
export function parseOwnerAccounts(value: string | undefined | null): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(',')
        .map((login) => login.trim().replace(/^@/, '').toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function isOwnerAccount(login: string, owners: readonly string[]): boolean {
  return owners.includes(login.toLowerCase());
}

/** First instant of the next UTC month: when the free reviews and the free cap reset. */
export function startOfNextUtcMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** "December 1, 2026" in UTC (same text on the server and in the browser). */
export function formatUtcDate(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** Check text when an account used its free reviews this month. */
export function freeLimitText(accountLogin: string, resetsAt: Date): string {
  return `Free reviews for ${accountLogin} are used up until ${formatUtcDate(resetsAt)}. Add your own Anthropic API key in Revo for unlimited reviews.`;
}

/** Check text when Revo's free-tier spend reached FREE_MONTHLY_CAP_USD this month. */
export const FREE_PAUSED_TEXT =
  "Revo's free reviews are paused until next month. Add your own Anthropic API key in Revo to keep reviewing.";

/** Run details of a free-tier review: "on Revo's free tier (3 of 20 reviews this month)". */
export function freeTierUsageText(used: number, limit: number): string {
  return `on Revo's free tier (${used} of ${limit} reviews this month)`;
}

/** Message of a review whose account key was refused or could not be read. */
export function accountKeyRefusedText(accountLogin: string): string {
  return `The Anthropic API key saved for ${accountLogin} was refused. Update it in Revo.`;
}

/**
 * How an account's reviews are paid for in practice, which can differ from
 * its saved choice: an own-key choice without a saved key, or the subscription
 * on a server that does not allow it, falls back to Revo's key (the worker
 * does the same). `owner` = Revo's key without free-tier limits.
 */
export type EffectiveAiAccess = 'free' | 'owner' | 'own_key' | 'subscription';

export function effectiveAiAccess(
  account: { accountLogin: string; aiAccess: AiAccess; hasKey: boolean },
  server: { ownerAccounts: readonly string[]; allowSubscription: boolean },
): EffectiveAiAccess {
  if (account.aiAccess === 'own_key' && account.hasKey) return 'own_key';
  if (account.aiAccess === 'subscription' && server.allowSubscription) return 'subscription';
  return isOwnerAccount(account.accountLogin, server.ownerAccounts) ? 'owner' : 'free';
}

/** Whether a repo of an account with this access may run `model` (Opus needs an own key or the subscription). */
export function modelAllowedFor(model: ModelId, access: EffectiveAiAccess): boolean {
  return access !== 'free' || isFreeTierModel(model);
}

/** "sk-ant-…abcd": how a saved key is shown. Only the last 4 characters are ever stored in clear. */
export function maskedKey(hint: string): string {
  return `sk-ant-…${hint}`;
}

export const EFFECTIVE_AI_ACCESS_LABELS: Record<EffectiveAiAccess, string> = {
  free: 'Free tier',
  owner: "Revo's key, no limits",
  own_key: 'Your Anthropic API key',
  subscription: 'Claude subscription',
};
