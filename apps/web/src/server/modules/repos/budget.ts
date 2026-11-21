import 'server-only';
import { decimalToNumber, startOfUtcMonth, type Repo, type RepoSettings } from '@revo/db';
import { DEFAULT_REPO_SETTINGS } from '@revo/shared';
import type { BudgetDto } from '~/types/repo';
import { prisma } from '../../config/prisma';
import { presentBudget } from '../../presenters/repo.presenter';

/**
 * Money spent on reviews this UTC month, per repo id: the ReviewCost ledger by
 * `spentAt`, the same rule as the worker's and the webhook's budget checks.
 */
export async function monthlySpend(
  repoIds: readonly string[],
  now = new Date(),
): Promise<Map<string, number>> {
  if (repoIds.length === 0) return new Map();
  const rows = await prisma.reviewCost.groupBy({
    by: ['repoId'],
    where: { repoId: { in: [...repoIds] }, spentAt: { gte: startOfUtcMonth(now) } },
    _sum: { costUsd: true },
  });
  return new Map(rows.map((r) => [r.repoId, decimalToNumber(r._sum.costUsd)]));
}

export function budgetLimit(settings: Pick<RepoSettings, 'monthlyBudgetUsd'> | null): number {
  return settings ? decimalToNumber(settings.monthlyBudgetUsd) : DEFAULT_REPO_SETTINGS.monthlyBudgetUsd;
}

/** Budget state of one repo this month. */
export async function budgetFor(
  repo: Pick<Repo, 'id' | 'fullName'> & { settings: Pick<RepoSettings, 'monthlyBudgetUsd'> | null },
  now = new Date(),
): Promise<BudgetDto> {
  const spend = await monthlySpend([repo.id], now);
  return presentBudget(repo, spend.get(repo.id) ?? 0, budgetLimit(repo.settings));
}
