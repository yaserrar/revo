import 'server-only';
import { accountFreeReviewsUsed, freeTierSpendUsd, type FreeTierAccount, type Installation } from '@revo/db';
import { effectiveAiAccess, startOfNextUtcMonth, type AiAccess, type EffectiveAiAccess } from '@revo/shared';
import { secretHint } from '@revo/shared/secret-box';
import type { AccountAiAccessDto, AccountsDto, FreeTierUsageDto } from '~/types/account';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { prisma } from '../../config/prisma';
import { encryptSecret } from '../../security/crypto';
import { forbidden, HttpError, notFound, unprocessable } from '../../http/errors';
import { presentInstallation } from '../../presenters/repo.presenter';
import { checkAnthropicKey } from './anthropic-key';

type AccountRow = Pick<Installation, 'accountLogin' | 'aiAccess' | 'anthropicKeyEnc'>;

/** How this account's reviews are paid for on this server (the worker decides the same way). */
export function accountAccess(account: AccountRow): EffectiveAiAccess {
  return effectiveAiAccess(
    {
      accountLogin: account.accountLogin,
      aiAccess: account.aiAccess,
      hasKey: Boolean(account.anthropicKeyEnc),
    },
    { ownerAccounts: env.REVO_OWNER_ACCOUNTS, allowSubscription: env.REVO_ALLOW_CLAUDE_SUBSCRIPTION },
  );
}

/** Revo's free-tier spend reached FREE_MONTHLY_CAP_USD this month: free reviews pause for everyone. */
export async function freeTierPaused(now = new Date()): Promise<boolean> {
  return (await freeTierSpendUsd(prisma, env.REVO_OWNER_ACCOUNTS, now)) >= env.FREE_MONTHLY_CAP_USD;
}

/** Free reviews used by an account this month, the limit, and whether free reviews are paused. */
export async function freeTierState(
  account: FreeTierAccount,
  now = new Date(),
  paused?: boolean,
): Promise<FreeTierUsageDto> {
  return {
    used: await accountFreeReviewsUsed(prisma, account, now),
    limit: env.FREE_REVIEWS_PER_MONTH,
    resetsAt: startOfNextUtcMonth(now).toISOString(),
    paused: paused ?? (await freeTierPaused(now)),
  };
}

/** Installations with at least one repo the user can see, by name. */
function visibleInstallations(repoIds: string[]) {
  return prisma.installation.findMany({
    where: { repos: { some: { id: { in: repoIds } } } },
    orderBy: { accountLogin: 'asc' },
  });
}

/** Installation ids where the user is Admin on at least one repo (GitHub role, from the access snapshot). */
async function adminInstallationIds(userId: string, installationIds: string[]): Promise<Set<string>> {
  const rows = await prisma.repoAccess.findMany({
    where: { userId, permission: 'admin', repo: { installationId: { in: installationIds } } },
    select: { repo: { select: { installationId: true } } },
  });
  return new Set(rows.map((r) => r.repo.installationId));
}

async function present(
  installations: Installation[],
  userId: string,
  now: Date,
): Promise<AccountAiAccessDto[]> {
  if (installations.length === 0) return [];
  const editable = await adminInstallationIds(
    userId,
    installations.map((i) => i.id),
  );
  const editorIds = [
    ...new Set(installations.flatMap((i) => (i.aiAccessUpdatedBy ? [i.aiAccessUpdatedBy] : []))),
  ];
  const editors = new Map(
    (await prisma.user.findMany({ where: { id: { in: editorIds } }, select: { id: true, login: true } })).map(
      (u) => [u.id, u.login],
    ),
  );
  const effective = installations.map(accountAccess);
  const paused = effective.includes('free') ? await freeTierPaused(now) : false;
  return Promise.all(
    installations.map(async (i, n) => ({
      installation: presentInstallation(i),
      aiAccess: i.aiAccess,
      effective: effective[n]!,
      keyHint: i.anthropicKeyEnc ? i.anthropicKeyHint : null,
      freeTier: effective[n] === 'free' ? await freeTierState(i, now, paused) : null,
      updatedAt: i.aiAccessUpdatedAt?.toISOString() ?? null,
      updatedBy: i.aiAccessUpdatedBy ? (editors.get(i.aiAccessUpdatedBy) ?? null) : null,
      canEdit: editable.has(i.id),
    })),
  );
}

/**
 * The installation for a change by this user: 404 when they cannot see any of
 * its repos (never 403, to avoid leaking that it exists), 403 when they are
 * not Admin on at least one of them.
 */
async function editableInstallation(userId: string, installationId: string, repoIds: string[]) {
  const installation = await prisma.installation.findFirst({
    where: { id: installationId, repos: { some: { id: { in: repoIds } } } },
  });
  if (!installation) throw notFound('Account');
  const admin = await adminInstallationIds(userId, [installation.id]);
  if (!admin.has(installation.id))
    throw forbidden(
      `Changing how reviews are paid for needs the Admin role on one of ${installation.accountLogin}'s repos on GitHub.`,
    );
  return installation;
}

async function presentOne(installationId: string, userId: string, now = new Date()) {
  const installation = await prisma.installation.findUniqueOrThrow({ where: { id: installationId } });
  const [dto] = await present([installation], userId, now);
  return dto!;
}

export const accountsService = {
  /** Every account the user can see, with its AI access. */
  async list(userId: string, repoIds: string[], now = new Date()): Promise<AccountsDto> {
    const installations = repoIds.length === 0 ? [] : await visibleInstallations(repoIds);
    return {
      items: await present(installations, userId, now),
      subscriptionAllowed: env.REVO_ALLOW_CLAUDE_SUBSCRIPTION,
      freeReviewsPerMonth: env.FREE_REVIEWS_PER_MONTH,
    };
  },

  /**
   * Checks the key with Anthropic, then stores it encrypted and makes it the
   * account's AI access. A refused key, or no answer from Anthropic, changes
   * nothing. The key is never logged nor returned.
   */
  async saveKey(
    userId: string,
    installationId: string,
    repoIds: string[],
    apiKey: string,
  ): Promise<AccountAiAccessDto> {
    const installation = await editableInstallation(userId, installationId, repoIds);
    const check = await checkAnthropicKey(apiKey);
    if (check === 'refused')
      throw unprocessable('Anthropic did not accept this key. Check that it is active and try again.');
    if (check === 'unavailable')
      throw new HttpError(
        503,
        'INTERNAL',
        'Anthropic could not be reached to check the key. Nothing was saved; try again in a moment.',
      );
    await prisma.installation.update({
      where: { id: installation.id },
      data: {
        aiAccess: 'own_key',
        anthropicKeyEnc: encryptSecret(apiKey),
        anthropicKeyHint: secretHint(apiKey),
        aiAccessUpdatedAt: new Date(),
        aiAccessUpdatedBy: userId,
      },
    });
    logger.info({ installationId: installation.id, userId }, 'anthropic key saved');
    return presentOne(installation.id, userId);
  },

  /** Deletes the saved key; an account that used it goes back to the free tier. */
  async removeKey(userId: string, installationId: string, repoIds: string[]): Promise<AccountAiAccessDto> {
    const installation = await editableInstallation(userId, installationId, repoIds);
    await prisma.installation.update({
      where: { id: installation.id },
      data: {
        anthropicKeyEnc: null,
        anthropicKeyHint: null,
        ...(installation.aiAccess === 'own_key' ? { aiAccess: 'free' as const } : {}),
        aiAccessUpdatedAt: new Date(),
        aiAccessUpdatedBy: userId,
      },
    });
    logger.info({ installationId: installation.id, userId }, 'anthropic key removed');
    return presentOne(installation.id, userId);
  },

  /**
   * Picks who pays: the free tier, the saved key (one must be saved), or the
   * Claude subscription (only where the server allows it).
   */
  async setAccess(
    userId: string,
    installationId: string,
    repoIds: string[],
    aiAccess: AiAccess,
  ): Promise<AccountAiAccessDto> {
    const installation = await editableInstallation(userId, installationId, repoIds);
    if (aiAccess === 'own_key' && !installation.anthropicKeyEnc)
      throw unprocessable('Save an Anthropic API key first.');
    if (aiAccess === 'subscription' && !env.REVO_ALLOW_CLAUDE_SUBSCRIPTION)
      throw unprocessable('This server does not offer the Claude subscription.');
    await prisma.installation.update({
      where: { id: installation.id },
      data: { aiAccess, aiAccessUpdatedAt: new Date(), aiAccessUpdatedBy: userId },
    });
    return presentOne(installation.id, userId);
  },
};
