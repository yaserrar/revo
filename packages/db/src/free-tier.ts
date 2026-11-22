import { startOfNextUtcMonth } from '@revo/shared';
import type { Prisma, PrismaClient } from './generated/prisma/client';
import type { AiSource } from './generated/prisma/enums';
import { decimalToNumber, startOfUtcMonth } from './convert';

function thisMonth(now: Date) {
  return { gte: startOfUtcMonth(now), lt: startOfNextUtcMonth(now) };
}

/** The GitHub account behind an installation, as the free tier counts it. */
export type FreeTierAccount = {
  /** Installation.id: its in-flight runs, and the lock key. */
  id: string;
  /** installation.account.id; null on installations saved before it was recorded. */
  accountGithubId: bigint | null;
  accountLogin: string;
};

/**
 * Ledger rows of one GitHub account, whatever installation wrote them: by its
 * stable account id, plus rows written before that id was known (by login).
 */
function accountRows(account: Omit<FreeTierAccount, 'id'>): Prisma.FreeTierUsageWhereInput {
  const byLogin: Prisma.FreeTierUsageWhereInput = {
    accountLogin: { equals: account.accountLogin, mode: 'insensitive' },
  };
  if (account.accountGithubId === null) return byLogin;
  return { OR: [{ accountGithubId: account.accountGithubId }, { accountGithubId: null, ...byLogin }] };
}

/**
 * Free reviews an account used this UTC month: every run billed to Revo's key
 * (a "Review again" counts, and so does a failed attempt that was already
 * billed), plus its free runs still in flight, so two jobs started together
 * cannot both take the last free review. Counted from the FreeTierUsage
 * ledger, which uninstalling the App or removing a repo does not delete.
 * `excludeReviewId`: the run being decided (a stalled job picked up again).
 */
export async function accountFreeReviewsUsed(
  prisma: Pick<PrismaClient, 'freeTierUsage' | 'review'>,
  account: FreeTierAccount,
  now = new Date(),
  options: { excludeReviewId?: string } = {},
): Promise<number> {
  const billed = await prisma.freeTierUsage.count({
    where: { ...accountRows(account), spentAt: thisMonth(now) },
  });
  // A finished run leaves `running` in the same write that adds its ledger row: never counted twice.
  const inFlight = await prisma.review.count({
    where: {
      status: 'running',
      aiSource: 'revo',
      startedAt: thisMonth(now),
      repo: { installationId: account.id },
      ...(options.excludeReviewId ? { id: { not: options.excludeReviewId } } : {}),
    },
  });
  return billed + inFlight;
}

/**
 * Revo's free-tier spend this UTC month across every account, for the global
 * cap (FREE_MONTHLY_CAP_USD), from the same ledger. Owner accounts
 * (REVO_OWNER_ACCOUNTS, lowercase logins) are left out: their reviews are the
 * host's own, not the free tier. Runs still in flight are not in it yet, so
 * the cap can be passed by at most the cost of the runs in progress.
 */
export async function freeTierSpendUsd(
  prisma: Pick<PrismaClient, 'freeTierUsage'>,
  ownerLogins: readonly string[],
  now = new Date(),
): Promise<number> {
  const sum = await prisma.freeTierUsage.aggregate({
    where: {
      spentAt: thisMonth(now),
      ...(ownerLogins.length > 0
        ? { NOT: { accountLogin: { in: [...ownerLogins], mode: 'insensitive' } } }
        : {}),
    },
    _sum: { costUsd: true },
  });
  return decimalToNumber(sum._sum.costUsd);
}

/**
 * The free-tier ledger row for money a run just billed to Revo's key (nothing
 * for an account's own key, the subscription, or a run that cost nothing).
 * Write it in the transaction that writes the run's ReviewCost row.
 */
export function freeTierUsageEntry(input: {
  account: Omit<FreeTierAccount, 'id'>;
  aiSource: AiSource | undefined;
  costUsd: number;
  spentAt?: Date;
}): Prisma.FreeTierUsageCreateManyInput[] {
  if (input.aiSource !== 'revo' || !(input.costUsd > 0)) return [];
  return [
    {
      accountGithubId: input.account.accountGithubId,
      accountLogin: input.account.accountLogin,
      costUsd: input.costUsd.toFixed(6),
      spentAt: input.spentAt ?? new Date(),
    },
  ];
}

/**
 * Serialises the free-tier decision of one account until the transaction
 * ends: the count and the run's `running` mark happen as one step, so jobs
 * running in parallel for the same account see each other.
 */
export async function lockFreeTierAccount(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  installationId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`revo:free-tier:${installationId}`}))`;
}

/**
 * Deletes free-tier ledger rows from before last UTC month: the counters only
 * read this month, and the ledger holds billing counters, not history.
 * Returns how many went.
 */
export async function pruneFreeTierUsage(
  prisma: Pick<PrismaClient, 'freeTierUsage'>,
  now = new Date(),
): Promise<number> {
  const start = startOfUtcMonth(now);
  const cutoff = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
  const { count } = await prisma.freeTierUsage.deleteMany({ where: { spentAt: { lt: cutoff } } });
  return count;
}

export type FreeTierUsage = {
  /** Free reviews used this month. */
  used: number;
  /** FREE_REVIEWS_PER_MONTH. */
  limit: number;
  /** When the count starts again (1st of next month, UTC). */
  resetsAt: Date;
};

/** "7 of 20 free reviews used this month, resets on December 1". */
export async function freeTierUsage(
  prisma: Pick<PrismaClient, 'freeTierUsage' | 'review'>,
  account: FreeTierAccount,
  limit: number,
  now = new Date(),
): Promise<FreeTierUsage> {
  return {
    used: await accountFreeReviewsUsed(prisma, account, now),
    limit,
    resetsAt: startOfNextUtcMonth(now),
  };
}
