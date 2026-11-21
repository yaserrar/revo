import 'server-only';
import { accountType, type InstallationEvent, type InstallationRepositoriesEvent } from '@revo/github';
import { prisma } from '~/server/config/prisma';
import { logger } from '~/server/config/logger';
import { purgeRepoJobs } from '~/server/queue/review-queue';

type InstallationInput = InstallationEvent['installation'];
type RepoInput = { id: number; full_name: string; private?: boolean };

/** Creates or updates an Installation row from a payload. */
export async function upsertInstallation(installation: InstallationInput) {
  const data = {
    accountLogin: installation.account.login,
    accountType: accountType(installation.account.type),
    accountAvatarUrl: installation.account.avatar_url ?? null,
    suspendedAt: installation.suspended_at ? new Date(installation.suspended_at) : null,
  };
  return prisma.installation.upsert({
    where: { githubId: BigInt(installation.id) },
    create: { githubId: BigInt(installation.id), ...data },
    update: data,
  });
}

/**
 * Creates or updates repos, each enabled with default settings (spec 3.1).
 * A repo moved between installations follows its installation.
 */
export async function upsertRepos(installationId: string, repos: RepoInput[]) {
  return Promise.all(
    repos.map((r) =>
      prisma.repo.upsert({
        where: { githubId: BigInt(r.id) },
        create: {
          githubId: BigInt(r.id),
          fullName: r.full_name,
          private: r.private ?? true,
          installationId,
          settings: { create: {} },
        },
        update: {
          fullName: r.full_name,
          ...(r.private === undefined ? {} : { private: r.private }),
          installationId,
          settings: { upsert: { create: {}, update: {} } },
        },
      }),
    ),
  );
}

/**
 * Repo access snapshots are per user and refreshed hourly; after the set of
 * repos changes, mark every snapshot stale so the next dashboard request
 * re-checks it on GitHub (spec 11).
 */
async function invalidateRepoAccess() {
  await prisma.user.updateMany({
    where: { accessCheckedAt: { not: null } },
    data: { accessCheckedAt: null },
  });
}

/**
 * Spec 14: what Revo kept about removed repos goes too. The rows cascade with
 * the database delete; this drops their queue jobs (repo names, SHAs, errors)
 * and their webhook log rows. Best effort: Redis being down must not fail the
 * uninstall (finished jobs expire on their own).
 */
async function forgetRepos(
  repoGithubIds: number[],
  currentDeliveryId: string,
  installationGithubId?: number,
) {
  await prisma.webhookDelivery.deleteMany({
    where: {
      // The delivery being handled stays (idempotency); the 30-day prune removes it.
      deliveryId: { not: currentDeliveryId },
      OR: [
        { repoGithubId: { in: repoGithubIds.map(BigInt) } },
        ...(installationGithubId === undefined
          ? []
          : [{ installationGithubId: BigInt(installationGithubId) }]),
      ],
    },
  });
  try {
    const removed = await purgeRepoJobs(repoGithubIds);
    logger.info({ repos: repoGithubIds.length, jobs: removed }, 'queue jobs of removed repos purged');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'could not purge queue jobs');
  }
}

/** `installation` events: created, deleted, suspend, unsuspend, new_permissions_accepted. */
export async function handleInstallationEvent(event: InstallationEvent, deliveryId: string): Promise<string> {
  const githubId = BigInt(event.installation.id);
  if (event.action === 'deleted') {
    // Spec 14: deleting the installation deletes its repos, PRs, reviews, findings and feedback (cascade).
    const repos = await prisma.repo.findMany({
      where: { installation: { githubId } },
      select: { githubId: true },
    });
    const deleted = await prisma.installation.deleteMany({ where: { githubId } });
    await forgetRepos(
      repos.map((r) => Number(r.githubId)),
      deliveryId,
      event.installation.id,
    );
    logger.info({ installation: event.installation.id, deleted: deleted.count }, 'installation deleted');
    return deleted.count ? 'deleted' : 'unknown';
  }
  const installation = await upsertInstallation({
    ...event.installation,
    suspended_at: event.action === 'unsuspend' ? null : event.installation.suspended_at,
  });
  if (event.action === 'created' && event.repositories) {
    await upsertRepos(installation.id, event.repositories);
    await invalidateRepoAccess();
  }
  logger.info({ installation: event.installation.id, action: event.action }, 'installation synced');
  return event.action;
}

/** `installation_repositories` events: repos added to or removed from the installation. */
export async function handleInstallationRepositoriesEvent(
  event: InstallationRepositoriesEvent,
  deliveryId: string,
): Promise<string> {
  const installation = await upsertInstallation(event.installation);
  await upsertRepos(installation.id, event.repositories_added);
  if (event.repositories_removed.length) {
    await prisma.repo.deleteMany({
      where: {
        installationId: installation.id,
        githubId: { in: event.repositories_removed.map((r) => BigInt(r.id)) },
      },
    });
    await forgetRepos(
      event.repositories_removed.map((r) => r.id),
      deliveryId,
    );
  }
  await invalidateRepoAccess();
  logger.info(
    {
      installation: event.installation.id,
      added: event.repositories_added.length,
      removed: event.repositories_removed.length,
    },
    'installation repositories synced',
  );
  return event.action;
}
