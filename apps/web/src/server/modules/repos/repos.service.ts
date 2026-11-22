import 'server-only';
import { Prisma, startOfUtcMonth } from '@revo/db';
import {
  BUILT_IN_IGNORE_GLOBS,
  FREE_TIER_MODELS,
  MODEL_IDS,
  MODELS,
  modelAllowedFor,
  modelName,
  type RepoSettingsDto,
} from '@revo/shared';
import { MODEL_PRICES } from '@revo/review';
import { windowStart } from '~/lib/time-buckets';
import type { RepoSettingsBody } from '~/schemas/repo-settings';
import type { ReposDto, RepoSettingsPageDto } from '~/types/repo';
import { prisma } from '../../config/prisma';
import { notFound, unprocessable } from '../../http/errors';
import {
  presentBudget,
  presentInstallation,
  presentRepo,
  presentRepoSettings,
} from '../../presenters/repo.presenter';
import { accountAccess } from '../accounts/accounts.service';
import { budgetFor, budgetLimit } from './budget';

type RepoStatsRow = {
  repo_id: string;
  prs: number;
  avg_score: number | null;
  last_at: Date | null;
  spent: number;
};

async function loadRepo(repoId: string) {
  const repo = await prisma.repo.findUnique({
    where: { id: repoId },
    include: { settings: true, installation: true },
  });
  if (!repo) throw notFound('Repo');
  return repo;
}

export const reposService = {
  /** The Repos table: every accessible repo with its review stats and budget. */
  async list(repoIds: string[], now = new Date()): Promise<ReposDto> {
    if (repoIds.length === 0) return { items: [], installations: [] };
    const [repos, stats] = await Promise.all([
      prisma.repo.findMany({
        where: { id: { in: repoIds } },
        include: { settings: true, installation: true },
        orderBy: { fullName: 'asc' },
      }),
      prisma.$queryRaw<RepoStatsRow[]>`
        SELECT r."repoId" AS repo_id,
          count(DISTINCT r."pullRequestId") FILTER (WHERE r.status = 'done')::int AS prs,
          avg(r.score) FILTER (WHERE r.status = 'done' AND r."createdAt" >= ${windowStart(30, now)})::float8 AS avg_score,
          max(r."createdAt") AS last_at,
          (SELECT coalesce(sum(c."costUsd"), 0) FROM "ReviewCost" c
            WHERE c."repoId" = r."repoId" AND c."spentAt" >= ${startOfUtcMonth(now)})::float8 AS spent
        FROM "Review" r
        WHERE r."repoId" = ANY(${repoIds}::text[])
        GROUP BY r."repoId"`,
    ]);
    const byRepo = new Map(stats.map((s) => [s.repo_id, s]));
    const installations = new Map(repos.map((r) => [r.installation.id, r.installation]));
    return {
      items: repos.map((repo) => {
        const s = byRepo.get(repo.id);
        return {
          ...presentRepo(repo),
          model: repo.settings?.model ?? MODEL_IDS[0],
          prsReviewed: s?.prs ?? 0,
          avgScore: s?.avg_score === null || s?.avg_score === undefined ? null : Math.round(s.avg_score),
          lastReviewAt: s?.last_at?.toISOString() ?? null,
          budget: presentBudget(repo, s?.spent ?? 0, budgetLimit(repo.settings)),
        };
      }),
      installations: [...installations.values()].map(presentInstallation),
    };
  },

  /** The settings page: the repo, its settings, this month's budget and the model options. */
  async settings(repoId: string, canEdit: boolean): Promise<RepoSettingsPageDto> {
    const repo = await loadRepo(repoId);
    return {
      repo: presentRepo(repo),
      settings: presentRepoSettings(repo, repo.settings),
      budget: await budgetFor(repo),
      models: MODEL_IDS.map((id) => ({
        id,
        name: MODELS[id].name,
        description: MODELS[id].description,
        inputPerMTok: MODEL_PRICES[id].input,
        outputPerMTok: MODEL_PRICES[id].output,
      })),
      builtInIgnoreGlobs: [...BUILT_IN_IGNORE_GLOBS],
      canEdit,
      aiAccess: {
        accountLogin: repo.installation.accountLogin,
        effective: accountAccess(repo.installation),
        freeTierModels: [...FREE_TIER_MODELS],
      },
    };
  },

  /** Partial update; `enabled` lives on Repo, the rest on RepoSettings (created on first save). */
  async updateSettings(repoId: string, body: RepoSettingsBody): Promise<RepoSettingsDto> {
    if (body.model) {
      // The free tier runs Haiku and Sonnet only; the form disables the others the same way.
      // A model saved earlier (e.g. while the account had its own key) may stay: the worker
      // runs it on Sonnet and says so in the review.
      const repo = await loadRepo(repoId);
      const unchanged = body.model === (repo.settings?.model ?? MODEL_IDS[0]);
      if (!unchanged && !modelAllowedFor(body.model, accountAccess(repo.installation)))
        throw unprocessable(
          `${modelName(body.model)} needs your own Anthropic API key. Add one for ${repo.installation.accountLogin} on the Repos page, or pick Haiku or Sonnet.`,
        );
    }
    const { enabled, monthlyBudgetUsd, ignoreGlobs, ...rest } = body;
    const data = {
      ...rest,
      ...(ignoreGlobs ? { ignoreGlobs: ignoreGlobs.map((g) => g.trim()) } : {}),
      ...(monthlyBudgetUsd === undefined ? {} : { monthlyBudgetUsd: new Prisma.Decimal(monthlyBudgetUsd) }),
    };
    const [repo] = await prisma.$transaction([
      prisma.repo.update({ where: { id: repoId }, data: enabled === undefined ? {} : { enabled } }),
      prisma.repoSettings.upsert({ where: { repoId }, create: { repoId, ...data }, update: data }),
    ]);
    const settings = await prisma.repoSettings.findUnique({ where: { repoId } });
    return presentRepoSettings(repo, settings);
  },
};
