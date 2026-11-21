import 'server-only';
import { bigintToNumber, decimalToNumber, type Installation, type Repo, type RepoSettings } from '@revo/db';
import {
  CategorySchema,
  DEFAULT_REPO_SETTINGS,
  ModelIdSchema,
  splitFullName,
  type InstallationDto,
  type RepoDto,
  type RepoSettingsDto,
} from '@revo/shared';
import type { BudgetDto } from '~/types/repo';

export function repoUrl(fullName: string): string {
  return `https://github.com/${fullName}`;
}

export function presentRepo(r: Repo): RepoDto {
  const { owner, name } = splitFullName(r.fullName);
  return {
    id: r.id,
    githubId: bigintToNumber(r.githubId),
    fullName: r.fullName,
    owner,
    name,
    private: r.private,
    enabled: r.enabled,
    installationId: r.installationId,
    url: repoUrl(r.fullName),
  };
}

export function presentInstallation(i: Installation): InstallationDto {
  return {
    id: i.id,
    githubId: bigintToNumber(i.githubId),
    accountLogin: i.accountLogin,
    accountType: i.accountType,
    accountAvatarUrl: i.accountAvatarUrl,
    suspended: i.suspendedAt !== null,
  };
}

/**
 * Settings of a repo as the shared schema sees them. A missing row means the
 * defaults; stored values outside today's options fall back to the default.
 */
export function presentRepoSettings(repo: Repo, s: RepoSettings | null): RepoSettingsDto {
  const d = DEFAULT_REPO_SETTINGS;
  if (!s) return { ...d, enabled: repo.enabled, repoId: repo.id, updatedAt: repo.updatedAt.toISOString() };
  const model = ModelIdSchema.safeParse(s.model);
  const categories = s.categories.flatMap((c) => {
    const parsed = CategorySchema.safeParse(c);
    return parsed.success ? [parsed.data] : [];
  });
  return {
    repoId: repo.id,
    enabled: repo.enabled,
    model: model.success ? model.data : d.model,
    categories: categories.length > 0 ? categories : d.categories,
    ignoreGlobs: s.ignoreGlobs,
    threshold: s.threshold,
    maxFindings: s.maxFindings,
    reviewDrafts: s.reviewDrafts,
    reviewBots: s.reviewBots,
    inlineComments: s.inlineComments,
    instructions: s.instructions,
    monthlyBudgetUsd: decimalToNumber(s.monthlyBudgetUsd),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** Budget state from this month's spend; a budget of 0 is reached at once. */
export function presentBudget(
  repo: Pick<Repo, 'id' | 'fullName'>,
  spentUsd: number,
  budgetUsd: number,
): BudgetDto {
  return {
    repoId: repo.id,
    repoFullName: repo.fullName,
    spentUsd: Math.round(spentUsd * 1e6) / 1e6,
    budgetUsd,
    reached: spentUsd >= budgetUsd,
  };
}
