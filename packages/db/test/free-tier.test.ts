import { afterAll, describe, expect, it } from 'vitest';
import {
  accountFreeReviewsUsed,
  createPrismaClient,
  freeTierSpendUsd,
  freeTierUsage,
  freeTierUsageEntry,
  lockFreeTierAccount,
  pruneFreeTierUsage,
  reviewCostEntry,
  type AiSource,
  type Installation,
} from '../src';

const url = process.env.TEST_DATABASE_URL;

describe('reviewCostEntry', () => {
  it('records what paid only when told', () => {
    const at = new Date('2026-11-02T10:00:00Z');
    expect(
      reviewCostEntry({ repoId: 'r', reviewId: 'v', costUsd: 0.5, spentAt: at, aiSource: 'account' }),
    ).toEqual([{ repoId: 'r', reviewId: 'v', costUsd: '0.500000', spentAt: at, aiSource: 'account' }]);
  });
});

describe('freeTierUsageEntry', () => {
  const account = { accountGithubId: 7n, accountLogin: 'acme' };
  const at = new Date('2026-11-02T10:00:00Z');

  it('records only money Revo’s key paid', () => {
    expect(freeTierUsageEntry({ account, aiSource: 'revo', costUsd: 0.25, spentAt: at })).toEqual([
      { accountGithubId: 7n, accountLogin: 'acme', costUsd: '0.250000', spentAt: at },
    ]);
    for (const aiSource of ['account', 'subscription', undefined] as const)
      expect(freeTierUsageEntry({ account, aiSource, costUsd: 0.25 })).toEqual([]);
    expect(freeTierUsageEntry({ account, aiSource: 'revo', costUsd: 0 })).toEqual([]);
  });
});

// A month nobody else writes to, so the global sum sees only these rows.
const MONTH = (day: number, hour = 12) => new Date(Date.UTC(2031, 2, day, hour));
const NOW = MONTH(20);

describe.runIf(Boolean(url))('free tier counters', () => {
  const prisma = createPrismaClient({ connectionString: url });
  const installations: string[] = [];
  const logins: string[] = [];
  afterAll(async () => {
    await prisma.installation.deleteMany({ where: { id: { in: installations } } });
    await prisma.freeTierUsage.deleteMany({ where: { accountLogin: { in: logins } } });
    await prisma.$disconnect();
  });

  const uniqueId = () => BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));

  /** Installs the App on an account (again, when `accountGithubId` is given) with one repo. */
  async function install(login: string, accountGithubId: bigint | null = uniqueId()) {
    logins.push(login);
    const githubId = uniqueId();
    const installation = await prisma.installation.create({
      data: { githubId, accountLogin: login, accountType: 'Organization', accountGithubId },
    });
    installations.push(installation.id);
    const repo = await addRepo(installation);
    return { installation, repo, pay: (...args: PayArgs) => pay(installation, repo.id, ...args) };
  }

  function addRepo(installation: Installation) {
    const githubId = uniqueId();
    return prisma.repo.create({
      data: {
        githubId,
        fullName: `${installation.accountLogin}/r${githubId}`,
        installationId: installation.id,
      },
    });
  }

  type PayArgs = [costUsd: number, spentAt: Date, aiSource?: AiSource | null];

  /** What the worker writes when a run bills: the ReviewCost row and, for Revo's key, the ledger row. */
  async function pay(
    installation: Installation,
    repoId: string,
    costUsd: number,
    spentAt: Date,
    aiSource: AiSource | null = 'revo',
  ) {
    await prisma.$transaction([
      prisma.reviewCost.create({ data: { repoId, costUsd: costUsd.toFixed(6), spentAt, aiSource } }),
      prisma.freeTierUsage.createMany({
        data: freeTierUsageEntry({
          account: installation,
          aiSource: aiSource ?? undefined,
          costUsd,
          spentAt,
        }),
      }),
    ]);
  }

  it('counts this month’s runs paid by Revo, not the account’s key or the subscription', async () => {
    const a = await install(`free-a-${Date.now()}`);
    await a.pay(0.1, MONTH(1, 0), 'revo');
    await a.pay(0.1, MONTH(6), 'revo');
    await a.pay(0.1, MONTH(7), 'account');
    await a.pay(0.1, MONTH(8), 'subscription');
    // Last month and next month do not count.
    await a.pay(0.1, new Date(Date.UTC(2031, 1, 28, 23, 59)), 'revo');
    await a.pay(0.1, new Date(Date.UTC(2031, 3, 1)), 'revo');

    expect(await accountFreeReviewsUsed(prisma, a.installation, NOW)).toBe(2);
    expect(await freeTierUsage(prisma, a.installation, 20, NOW)).toEqual({
      used: 2,
      limit: 20,
      resetsAt: new Date(Date.UTC(2031, 3, 1)),
    });
    // Another account starts at zero.
    const b = await install(`free-b-${Date.now()}`);
    expect(await accountFreeReviewsUsed(prisma, b.installation, NOW)).toBe(0);
  });

  it('keeps the count and the global spend when repos are removed, moved, or the App is reinstalled', async () => {
    const accountId = uniqueId();
    const login = `Keeper-${Date.now()}`;
    const first = await install(login, accountId);
    const second = await addRepo(first.installation);
    await first.pay(1, MONTH(2));
    await first.pay(1, MONTH(3));
    await pay(first.installation, second.id, 1, MONTH(4));
    const spent = await freeTierSpendUsd(prisma, [], NOW);
    expect(await accountFreeReviewsUsed(prisma, first.installation, NOW)).toBe(3);

    // The repo is unticked in the App's settings (its rows cascade away), then ticked again.
    await prisma.repo.delete({ where: { id: second.id } });
    await addRepo(first.installation);
    expect(await accountFreeReviewsUsed(prisma, first.installation, NOW)).toBe(3);

    // A repo moved to another account does not take its runs along.
    const other = await install(`other-${Date.now()}`);
    await prisma.repo.update({
      where: { id: first.repo.id },
      data: { installationId: other.installation.id },
    });
    expect(await accountFreeReviewsUsed(prisma, first.installation, NOW)).toBe(3);
    expect(await accountFreeReviewsUsed(prisma, other.installation, NOW)).toBe(0);

    // Uninstalled and installed again: a new installation of the same GitHub account.
    await prisma.installation.delete({ where: { id: first.installation.id } });
    const again = await install(login, accountId);
    expect(again.installation.id).not.toBe(first.installation.id);
    expect(await accountFreeReviewsUsed(prisma, again.installation, NOW)).toBe(3);
    // The host's spend this month did not drop either.
    expect(await freeTierSpendUsd(prisma, [], NOW)).toBeCloseTo(spent, 6);
  });

  it('matches rows saved before the account id was known by login', async () => {
    const login = `Legacy-${Date.now()}`;
    const old = await install(login, null);
    await old.pay(0.5, MONTH(2));
    expect(await accountFreeReviewsUsed(prisma, old.installation, NOW)).toBe(1);
    // Later webhooks record the account id: the old rows still count, in any case of the login.
    const known = await prisma.installation.update({
      where: { id: old.installation.id },
      data: { accountGithubId: uniqueId(), accountLogin: login.toLowerCase() },
    });
    await pay(known, old.repo.id, 0.5, MONTH(3));
    expect(await accountFreeReviewsUsed(prisma, known, NOW)).toBe(2);
  });

  it('counts free runs in flight, so parallel jobs cannot both take the last free review', async () => {
    const a = await install(`flight-${Date.now()}`);
    await a.pay(0.1, MONTH(2));
    const pr = await prisma.pullRequest.create({
      data: {
        repoId: a.repo.id,
        number: 1,
        title: 't',
        author: 'dev',
        baseRef: 'main',
        headRef: 'f',
        headSha: 'a1',
        url: 'https://github.com/x/y/pull/1',
        openedAt: MONTH(1),
      },
    });
    const review = (headSha: string, status: 'running' | 'queued', aiSource: AiSource) =>
      prisma.review.create({
        data: {
          pullRequestId: pr.id,
          repoId: a.repo.id,
          headSha,
          model: 'claude-sonnet-5-5',
          status,
          aiSource,
          startedAt: MONTH(10),
        },
      });
    const running = await review('a1', 'running', 'revo');
    await review('a2', 'running', 'account');
    await review('a3', 'queued', 'revo');

    expect(await accountFreeReviewsUsed(prisma, a.installation, NOW)).toBe(2);
    // The run being decided does not count itself (a stalled job picked up again).
    expect(await accountFreeReviewsUsed(prisma, a.installation, NOW, { excludeReviewId: running.id })).toBe(
      1,
    );
  });

  it('sums the global free-tier spend without the owner accounts', async () => {
    const before = await freeTierSpendUsd(prisma, [], NOW);
    const stranger = await install(`stranger-${Date.now()}`);
    const owner = await install(`Owner-${Date.now()}`);
    await stranger.pay(1.25, MONTH(3), 'revo');
    await stranger.pay(5, MONTH(3), 'account');
    await owner.pay(2, MONTH(3), 'revo');

    expect(await freeTierSpendUsd(prisma, [], NOW)).toBeCloseTo(before + 3.25, 6);
    // Owner logins are matched in any case.
    const owners = [owner.installation.accountLogin.toLowerCase()];
    expect(await freeTierSpendUsd(prisma, owners, NOW)).toBeCloseTo(before + 1.25, 6);
  });

  it('prunes ledger rows from before last month', async () => {
    const login = `prune-${Date.now()}`;
    logins.push(login);
    // Dates no other test writes (pruning is global).
    const rows = [
      new Date(Date.UTC(1999, 11, 31, 23)),
      new Date(Date.UTC(2000, 1, 1)),
      new Date(Date.UTC(2000, 2, 3)),
    ];
    await prisma.freeTierUsage.createMany({
      data: rows.map((spentAt) => ({ accountLogin: login, costUsd: '0.100000', spentAt })),
    });
    expect(await pruneFreeTierUsage(prisma, new Date(Date.UTC(2000, 2, 15)))).toBeGreaterThanOrEqual(1);
    const left = await prisma.freeTierUsage.findMany({
      where: { accountLogin: login },
      orderBy: { spentAt: 'asc' },
    });
    expect(left.map((r) => r.spentAt)).toEqual(rows.slice(1));
  });

  it('lets one transaction at a time decide for an account', async () => {
    const a = await install(`lock-${Date.now()}`);
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));

    const first = prisma.$transaction(async (tx) => {
      await lockFreeTierAccount(tx, a.installation.id);
      locked();
      order.push('first in');
      await held;
      order.push('first out');
    });
    await isLocked;
    const second = prisma.$transaction(async (tx) => {
      await lockFreeTierAccount(tx, a.installation.id);
      order.push('second in');
    });
    // Another account is not held up.
    await prisma.$transaction(async (tx) => {
      await lockFreeTierAccount(tx, `${a.installation.id}-other`);
      order.push('other account');
    });
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first in', 'other account', 'first out', 'second in']);
  });
});
