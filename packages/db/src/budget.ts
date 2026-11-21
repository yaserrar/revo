import type { Prisma, PrismaClient } from './generated/prisma/client';
import { decimalToNumber, startOfUtcMonth } from './convert';

/**
 * USD spent on a repo's reviews since the start of the current UTC month
 * (spec 12). Counted from the ReviewCost ledger by when the money was spent,
 * so a re-run of an older commit, a failed attempt or a review that finishes
 * after midnight all land in the month they ran.
 */
export async function repoMonthSpendUsd(
  prisma: Pick<PrismaClient, 'reviewCost'>,
  repoId: string,
  now = new Date(),
): Promise<number> {
  const sum = await prisma.reviewCost.aggregate({
    where: { repoId, spentAt: { gte: startOfUtcMonth(now) } },
    _sum: { costUsd: true },
  });
  return decimalToNumber(sum._sum.costUsd);
}

/**
 * A ledger row for money just billed by a review run (nothing when the run
 * cost nothing). Use inside the transaction that adds it to Review.costUsd.
 */
export function reviewCostEntry(input: {
  repoId: string;
  reviewId: string;
  costUsd: number;
  spentAt?: Date;
}): Prisma.ReviewCostCreateManyInput[] {
  if (!(input.costUsd > 0)) return [];
  return [
    {
      repoId: input.repoId,
      reviewId: input.reviewId,
      costUsd: input.costUsd.toFixed(6),
      spentAt: input.spentAt ?? new Date(),
    },
  ];
}
