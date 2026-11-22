import { accountFreeReviewsUsed, freeTierSpendUsd, type PrismaClient } from '@revo/db';
import type { SkipDetail } from '@revo/github';
import type { ReviewEngine } from '@revo/review';
import {
  accountKeyRefusedText,
  freeTierModel,
  freeTierUsageText,
  isOwnerAccount,
  startOfNextUtcMonth,
  type AiAccess,
  type AiSource,
  type ModelId,
} from '@revo/shared';
import { createSecretBox, hasSecretKeyMaterial, type SecretBox } from '@revo/shared/secret-box';
import type { WorkerEnv } from '../env';
import type { Logger } from '../logger';

/** The worker's AI access settings (env), shared by every job. */
export type AiAccessConfig = {
  /** FREE_REVIEWS_PER_MONTH: reviews per account per UTC month on Revo's key. */
  freeReviewsPerMonth: number;
  /** FREE_MONTHLY_CAP_USD: Revo's free-tier spend per UTC month across every account. */
  freeMonthlyCapUsd: number;
  /** REVO_OWNER_ACCOUNTS, lowercased: Revo's key without free-tier limits. */
  ownerAccounts: readonly string[];
  /** REVO_ALLOW_CLAUDE_SUBSCRIPTION. */
  allowSubscription: boolean;
  /** Reads the accounts' saved API keys; null when the worker has no key material. */
  secrets: SecretBox | null;
};

export function aiAccessConfig(
  env: Pick<
    WorkerEnv,
    | 'FREE_REVIEWS_PER_MONTH'
    | 'FREE_MONTHLY_CAP_USD'
    | 'REVO_OWNER_ACCOUNTS'
    | 'REVO_ALLOW_CLAUDE_SUBSCRIPTION'
    | 'TOKEN_ENCRYPTION_KEY'
    | 'AUTH_SECRET'
  >,
): AiAccessConfig {
  const material = { encryptionKey: env.TOKEN_ENCRYPTION_KEY, authSecret: env.AUTH_SECRET };
  return {
    freeReviewsPerMonth: env.FREE_REVIEWS_PER_MONTH,
    freeMonthlyCapUsd: env.FREE_MONTHLY_CAP_USD,
    ownerAccounts: env.REVO_OWNER_ACCOUNTS,
    allowSubscription: env.REVO_ALLOW_CLAUDE_SUBSCRIPTION,
    secrets: hasSecretKeyMaterial(material) ? createSecretBox(material) : null,
  };
}

/** The account's saved key could not be used: the review fails at once, with no retry. */
export class AccountKeyError extends Error {
  constructor(accountLogin: string) {
    super(accountKeyRefusedText(accountLogin));
    this.name = 'AccountKeyError';
  }
}

export type EngineDeps = {
  /** The client, or the transaction that holds the account's free-tier lock. */
  prisma: Pick<PrismaClient, 'freeTierUsage' | 'review'>;
  /** Revo's own engine (REVO_ENGINE): the free tier and owner accounts. */
  engine: ReviewEngine;
  /** An engine for an account's own Anthropic key. */
  accountEngine: (apiKey: string) => ReviewEngine;
  /** The Claude subscription logged in on this machine; absent = not available here. */
  subscriptionEngine?: () => ReviewEngine;
  ai: AiAccessConfig;
  log: Logger;
};

export type AccountAccess = {
  id: string;
  /** installation.account.id: the free tier counts per GitHub account, across reinstalls. */
  accountGithubId: bigint | null;
  accountLogin: string;
  aiAccess: AiAccess;
  anthropicKeyEnc: string | null;
};

export type EngineChoice =
  | { kind: 'skip'; reason: 'free_limit' | 'free_paused'; detail: SkipDetail }
  | {
      kind: 'run';
      engine: ReviewEngine;
      aiSource: AiSource;
      /** The model to run (a free-tier repo set to Opus runs on Sonnet). */
      model: ModelId;
      /** Notes for the comment and the dashboard (the model clamp). */
      notes: string[];
      /** Footer text after the model, e.g. "on Revo's free tier (3 of 20 reviews this month)". */
      paidBy: string | null;
    };

/**
 * Who pays for this review (spec "AI access"): the account's own key, the
 * local Claude subscription (only where the server allows it), or Revo's key
 * on the free tier, which is limited per account and globally and runs only
 * the free-tier models. Owner accounts use Revo's key without free limits;
 * an explicit own key or subscription choice still wins for them.
 */
export async function chooseEngine(
  account: AccountAccess,
  repoModel: ModelId,
  deps: EngineDeps,
  options: { now?: Date; /** The run being decided (not counted as in flight). */ reviewId?: string } = {},
): Promise<EngineChoice> {
  const now = options.now ?? new Date();
  const { ai, log } = deps;

  if (account.aiAccess === 'own_key') {
    if (account.anthropicKeyEnc) {
      return {
        kind: 'run',
        engine: deps.accountEngine(accountKey(account.accountLogin, account.anthropicKeyEnc, deps)),
        aiSource: 'account',
        model: repoModel,
        notes: [],
        paidBy: null,
      };
    }
    log.warn({ account: account.accountLogin }, 'own key selected but none saved; using the free tier');
  }

  if (account.aiAccess === 'subscription') {
    if (ai.allowSubscription && deps.subscriptionEngine) {
      return {
        kind: 'run',
        engine: deps.subscriptionEngine(),
        aiSource: 'subscription',
        model: repoModel,
        notes: [],
        paidBy: 'on a Claude subscription',
      };
    }
    log.warn(
      { account: account.accountLogin, allowed: ai.allowSubscription },
      'Claude subscription not available on this server; using the free tier',
    );
  }

  if (isOwnerAccount(account.accountLogin, ai.ownerAccounts)) {
    return { kind: 'run', engine: deps.engine, aiSource: 'revo', model: repoModel, notes: [], paidBy: null };
  }

  const used = await accountFreeReviewsUsed(deps.prisma, account, now, {
    ...(options.reviewId ? { excludeReviewId: options.reviewId } : {}),
  });
  if (used >= ai.freeReviewsPerMonth) {
    return {
      kind: 'skip',
      reason: 'free_limit',
      detail: { accountLogin: account.accountLogin, resetsAt: startOfNextUtcMonth(now) },
    };
  }
  if ((await freeTierSpendUsd(deps.prisma, ai.ownerAccounts, now)) >= ai.freeMonthlyCapUsd) {
    return { kind: 'skip', reason: 'free_paused', detail: { resetsAt: startOfNextUtcMonth(now) } };
  }
  const clamp = freeTierModel(repoModel);
  return {
    kind: 'run',
    engine: deps.engine,
    aiSource: 'revo',
    model: clamp.model,
    notes: clamp.note ? [clamp.note] : [],
    paidBy: freeTierUsageText(used + 1, ai.freeReviewsPerMonth),
  };
}

/** The account's decrypted key. Never logged; a key that cannot be read fails the review. */
function accountKey(accountLogin: string, keyEnc: string, deps: EngineDeps): string {
  if (!deps.ai.secrets) {
    deps.log.error(
      { account: accountLogin },
      'cannot read saved API keys: set the same TOKEN_ENCRYPTION_KEY (or AUTH_SECRET) as the web app',
    );
    throw new AccountKeyError(accountLogin);
  }
  let key: string;
  try {
    key = deps.ai.secrets.decrypt(keyEnc).trim();
  } catch {
    deps.log.error(
      { account: accountLogin },
      'saved API key could not be decrypted (TOKEN_ENCRYPTION_KEY differs from the web app?)',
    );
    throw new AccountKeyError(accountLogin);
  }
  // An empty key would make the SDK fall back to Revo's own ANTHROPIC_API_KEY.
  if (!key) throw new AccountKeyError(accountLogin);
  return key;
}
