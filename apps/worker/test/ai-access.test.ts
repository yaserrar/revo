import { UnrecoverableError } from 'bullmq';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountFreeReviewsUsed } from '@revo/db';
import { fakeEngine, ReviewEngineError, type EngineContext, type ReviewEngine } from '@revo/review';
import { createSecretBox } from '@revo/shared/secret-box';
import { createAccountEngines, createSubscriptionEngine } from '../src/engines';
import { aiAccessConfig, type AiAccessConfig } from '../src/review/ai-access';
import { describeFailure } from '../src/review/failure';
import { runReviewJob } from '../src/review/job';
import { createWorld, ORDERS_V1, TEST_DATABASE_URL, testSecrets, type World } from './world';

const FIRST = { attemptsMade: 0, attempts: 3 };
const OPUS = 'claude-opus-5-5';

/** The fake engine, recording the model and how many times pass 1 ran. */
function spyEngine() {
  const models: string[] = [];
  const engine: ReviewEngine = {
    kind: fakeEngine.kind,
    find: (ctx: EngineContext) => {
      models.push(ctx.model);
      return fakeEngine.find(ctx);
    },
    verify: (ctx, findings) => fakeEngine.verify(ctx, findings),
  };
  return { engine, models };
}

describe('account engines', () => {
  it('reuses one engine per key and follows the fake engine in offline runs', () => {
    const made: string[] = [];
    const engines = createAccountEngines({ REVO_ENGINE: 'claude' }, pino({ level: 'silent' }), (key) => {
      made.push(key);
      return { ...fakeEngine };
    });
    const a = engines('sk-ant-a');
    expect(engines('sk-ant-a')).toBe(a);
    expect(engines('sk-ant-b')).not.toBe(a);
    expect(made).toEqual(['sk-ant-a', 'sk-ant-b']);
    expect(createAccountEngines({ REVO_ENGINE: 'fake' }, pino({ level: 'silent' }))('sk-ant-a')).toBe(
      fakeEngine,
    );
  });

  it('reads the env knobs and the key material', () => {
    const ai = aiAccessConfig({
      FREE_REVIEWS_PER_MONTH: 20,
      FREE_MONTHLY_CAP_USD: 50,
      REVO_OWNER_ACCOUNTS: ['yaserrar'],
      REVO_ALLOW_CLAUDE_SUBSCRIPTION: false,
      TOKEN_ENCRYPTION_KEY: undefined,
      AUTH_SECRET: 'same-auth-secret-as-the-web-app-000000',
    });
    expect(ai).toMatchObject({ freeReviewsPerMonth: 20, freeMonthlyCapUsd: 50, ownerAccounts: ['yaserrar'] });
    const web = createSecretBox({ authSecret: 'same-auth-secret-as-the-web-app-000000' });
    expect(ai.secrets?.decrypt(web.encrypt('sk-ant-x'))).toBe('sk-ant-x');
    expect(
      aiAccessConfig({
        FREE_REVIEWS_PER_MONTH: 20,
        FREE_MONTHLY_CAP_USD: 50,
        REVO_OWNER_ACCOUNTS: [],
        REVO_ALLOW_CLAUDE_SUBSCRIPTION: false,
        TOKEN_ENCRYPTION_KEY: undefined,
        AUTH_SECRET: undefined,
      }).secrets,
    ).toBeNull();
  });

  it('names the account whose key was refused', () => {
    const err = new ReviewEngineError('auth', 'find', '401');
    expect(describeFailure(err, 'claude-sonnet-5-5', { accountKeyOf: 'acme' })).toMatchObject({
      message: 'The Anthropic API key saved for acme was refused. Update it in Revo.',
      retryable: false,
    });
    expect(describeFailure(err, 'claude-sonnet-5-5').message).toBe(
      'The Claude API key is missing or was rejected.',
    );
  });

  it('words subscription failures for Claude Code, not an API key', () => {
    const subscription = { subscription: true };
    const failure = (code: 'auth' | 'rate_limited' | 'refusal') =>
      describeFailure(new ReviewEngineError(code, 'find', 'x'), 'claude-sonnet-5-5', subscription);
    expect(failure('auth')).toMatchObject({
      message: 'Claude Code on the machine running Revo is not signed in to a Claude subscription.',
      retryable: false,
    });
    expect(failure('rate_limited')).toMatchObject({
      message: 'The Claude subscription’s usage limit is reached.',
      retryable: true,
      spent: null,
    });
    expect(failure('refusal').message).toBe('Claude declined to review this change.');
  });

  it('makes the subscription engine once, on first use, and the fake engine offline', () => {
    let made = 0;
    const engines = createSubscriptionEngine({ REVO_ENGINE: 'claude' }, pino({ level: 'silent' }), () => {
      made++;
      return { ...fakeEngine };
    });
    expect(made).toBe(0);
    const engine = engines();
    expect(engines()).toBe(engine);
    expect(made).toBe(1);
    expect(createSubscriptionEngine({ REVO_ENGINE: 'fake' }, pino({ level: 'silent' }))()).toBe(fakeEngine);
  });
});

describe.runIf(Boolean(TEST_DATABASE_URL))('AI access per account (mock GitHub, fake engine)', () => {
  let w: World;
  let login: string;
  beforeAll(async () => {
    w = await createWorld();
    login = w.installation.accountLogin;
  });
  afterAll(() => w?.close());

  beforeEach(async () => {
    await w.prisma.installation.update({
      where: { id: w.installation.id },
      data: { aiAccess: 'free', anthropicKeyEnc: null, anthropicKeyHint: null },
    });
    await w.prisma.repoSettings.update({
      where: { repoId: w.repo.id },
      data: { model: 'claude-sonnet-5-5' },
    });
  });

  /** World config with free-tier limits counted from the reviews this account already used. */
  async function ai(extra: Partial<AiAccessConfig> & { freeLeft?: number } = {}): Promise<AiAccessConfig> {
    const { freeLeft = 10, ...rest } = extra;
    const used = await accountFreeReviewsUsed(w.prisma, w.installation);
    return {
      freeReviewsPerMonth: used + freeLeft,
      freeMonthlyCapUsd: 1_000_000,
      ownerAccounts: [],
      allowSubscription: false,
      secrets: testSecrets,
      ...rest,
    };
  }

  const reviewOf = (sha: string) =>
    w.prisma.review.findFirstOrThrow({ where: { headSha: sha }, include: { costs: true } });

  it('free tier: runs Opus on Sonnet, says so, and records Revo as the payer', async () => {
    await w.prisma.repoSettings.update({ where: { repoId: w.repo.id }, data: { model: OPUS } });
    const spy = spyEngine();
    const config = await ai({ freeLeft: 5 });
    const pull = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }]);
    expect(await runReviewJob(w.payload(pull), FIRST, w.deps(spy.engine, { ai: config }))).toMatchObject({
      outcome: 'done',
    });
    expect(spy.models).toEqual(['claude-sonnet-5-5']);

    const row = await reviewOf(w.app.head(pull).sha);
    expect(row).toMatchObject({ model: 'claude-sonnet-5-5', aiSource: 'revo' });
    expect(row.notes[0]).toBe('Ran on Claude Sonnet 5.5: Opus needs your own API key.');
    expect(row.costs.map((c) => c.aiSource)).toEqual(['revo']);
    // The free-tier ledger row is keyed by the GitHub account, not the installation or the repo.
    const ledger = await w.prisma.freeTierUsage.findMany({
      where: { accountLogin: login, spentAt: { gte: row.startedAt! } },
    });
    expect(ledger.map((l) => [l.accountGithubId, Number(l.costUsd)])).toEqual([
      [w.installation.accountGithubId, Number(row.costUsd)],
    ]);
    const body = w.activity(pull).comments[0]!.body;
    expect(body).toContain('Ran on Claude Sonnet 5.5: Opus needs your own API key.');
    const used = config.freeReviewsPerMonth - 5 + 1;
    expect(body).toContain(
      `on Revo's free tier (${used} of ${config.freeReviewsPerMonth} reviews this month)`,
    );
  });

  it('free tier: a used-up account is skipped with a neutral check, "Review again" too', async () => {
    const spy = spyEngine();
    const pull = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }]);
    // The last free review of the month runs.
    let config = await ai({ freeLeft: 1 });
    expect(await runReviewJob(w.payload(pull), FIRST, w.deps(spy.engine, { ai: config }))).toMatchObject({
      outcome: 'done',
    });
    // Now none are left: a manual re-run is refused the same way.
    config = await ai({ freeLeft: 0 });
    const again = await runReviewJob(
      w.payload(pull, { trigger: 'manual' }),
      FIRST,
      w.deps(spy.engine, { ai: config }),
    );
    expect(again).toMatchObject({ outcome: 'skipped', reason: 'free_limit' });
    expect(spy.models).toHaveLength(1);

    const row = await reviewOf(w.app.head(pull).sha);
    // Nothing paid for the skipped run: the earlier run's payer is not shown for it.
    expect(row).toMatchObject({ status: 'skipped', skipReason: 'free_limit', aiSource: null });
    const check = w.activity(pull).checkRuns.at(-1)!;
    expect(check).toMatchObject({ conclusion: 'neutral', title: 'Free reviews used up this month' });
    expect(check.summary).toMatch(
      new RegExp(
        `^Free reviews for ${login} are used up until \\w+ 1, \\d{4}\\. Add your own Anthropic API key in Revo for unlimited reviews\\.$`,
      ),
    );
  });

  it('free tier: two jobs started together cannot both take the last free review', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const inFind = new Promise<void>((resolve) => (entered = resolve));
    const models: string[] = [];
    // The first job is still running (pass 1 waits) while the second one decides.
    const slow: ReviewEngine = {
      kind: fakeEngine.kind,
      find: async (ctx: EngineContext) => {
        models.push(ctx.model);
        entered();
        await gate;
        return fakeEngine.find(ctx);
      },
      verify: (ctx, findings) => fakeEngine.verify(ctx, findings),
    };
    const config = await ai({ freeLeft: 1 });
    const first = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }]);
    const second = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }]);
    const running = runReviewJob(w.payload(first), FIRST, w.deps(slow, { ai: config }));
    await inFind;
    expect(await accountFreeReviewsUsed(w.prisma, w.installation)).toBe(config.freeReviewsPerMonth);
    const other = await runReviewJob(w.payload(second), FIRST, w.deps(slow, { ai: config }));
    release();
    expect(other).toMatchObject({ outcome: 'skipped', reason: 'free_limit' });
    expect(await running).toMatchObject({ outcome: 'done' });
    expect(models).toHaveLength(1);
    expect(await accountFreeReviewsUsed(w.prisma, w.installation)).toBe(config.freeReviewsPerMonth);
  });

  it('free tier: pauses every free account when the global cap is reached', async () => {
    const spy = spyEngine();
    const pull = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }]);
    const result = await runReviewJob(
      w.payload(pull),
      FIRST,
      w.deps(spy.engine, { ai: await ai({ freeMonthlyCapUsd: 0 }) }),
    );
    expect(result).toMatchObject({ outcome: 'skipped', reason: 'free_paused' });
    expect(spy.models).toHaveLength(0);
    expect(w.activity(pull).checkRuns.at(-1)!.summary).toBe(
      "Revo's free reviews are paused until next month. Add your own Anthropic API key in Revo to keep reviewing.",
    );
  });

  it('owner accounts use Revo’s key with no free limits and every model', async () => {
    await w.prisma.repoSettings.update({ where: { repoId: w.repo.id }, data: { model: OPUS } });
    const spy = spyEngine();
    const pull = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }]);
    // REVO_OWNER_ACCOUNTS is lowercased when parsed; the account's login may use any case.
    const config = await ai({ freeLeft: 0, freeMonthlyCapUsd: 0, ownerAccounts: [login.toLowerCase()] });
    expect(await runReviewJob(w.payload(pull), FIRST, w.deps(spy.engine, { ai: config }))).toMatchObject({
      outcome: 'done',
    });
    expect(spy.models).toEqual([OPUS]);
    const row = await reviewOf(w.app.head(pull).sha);
    expect(row).toMatchObject({ model: OPUS, aiSource: 'revo' });
    expect(row.notes.some((n) => n.startsWith('Ran on'))).toBe(false);
    expect(w.activity(pull).comments[0]!.body).not.toContain("Revo's free tier");
  });

  it('own key: decrypts the saved key, runs any model with no Revo limits, and records the account as payer', async () => {
    await w.prisma.repoSettings.update({ where: { repoId: w.repo.id }, data: { model: OPUS } });
    await w.prisma.installation.update({
      where: { id: w.installation.id },
      data: {
        aiAccess: 'own_key',
        anthropicKeyEnc: testSecrets.encrypt('sk-ant-own-key-wxyz'),
        anthropicKeyHint: 'wxyz',
      },
    });
    const host = spyEngine();
    const own = spyEngine();
    const keys: string[] = [];
    const usedBefore = await accountFreeReviewsUsed(w.prisma, w.installation);
    const pull = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }]);
    const result = await runReviewJob(
      w.payload(pull),
      FIRST,
      w.deps(host.engine, {
        ai: await ai({ freeLeft: 0, freeMonthlyCapUsd: 0 }),
        accountEngine: (key) => {
          keys.push(key);
          return own.engine;
        },
      }),
    );
    expect(result).toMatchObject({ outcome: 'done' });
    expect(keys).toEqual(['sk-ant-own-key-wxyz']);
    expect(host.models).toHaveLength(0);
    expect(own.models).toEqual([OPUS]);

    const row = await reviewOf(w.app.head(pull).sha);
    expect(row).toMatchObject({ aiSource: 'account', model: OPUS });
    expect(row.costs.map((c) => c.aiSource)).toEqual(['account']);
    // The account's own spend never uses up its free reviews.
    expect(await accountFreeReviewsUsed(w.prisma, w.installation)).toBe(usedBefore);
  });

  it('own key: a key that cannot be decrypted fails at once with a clear message', async () => {
    const other = createSecretBox({ encryptionKey: 'not-the-key-the-worker-has-0000000000' });
    await w.prisma.installation.update({
      where: { id: w.installation.id },
      data: { aiAccess: 'own_key', anthropicKeyEnc: other.encrypt('sk-ant-x'), anthropicKeyHint: '-x' },
    });
    const spy = spyEngine();
    const pull = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }]);
    await expect(
      runReviewJob(w.payload(pull), FIRST, w.deps(spy.engine, { accountEngine: () => spy.engine })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(spy.models).toHaveLength(0);
    const row = await reviewOf(w.app.head(pull).sha);
    expect(row).toMatchObject({
      status: 'failed',
      error: `The Anthropic API key saved for ${login} was refused. Update it in Revo.`,
    });
    expect(w.activity(pull).checkRuns.at(-1)).toMatchObject({ conclusion: 'neutral' });
  });

  it('own key: a key Anthropic refuses (401) fails without retry and names the account', async () => {
    await w.prisma.installation.update({
      where: { id: w.installation.id },
      data: {
        aiAccess: 'own_key',
        anthropicKeyEnc: testSecrets.encrypt('sk-ant-revoked'),
        anthropicKeyHint: 'oked',
      },
    });
    const refused: ReviewEngine = {
      kind: 'claude',
      find: () => Promise.reject(new ReviewEngineError('auth', 'find', '401 invalid x-api-key')),
      verify: fakeEngine.verify,
    };
    const pull = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }]);
    await expect(
      runReviewJob(w.payload(pull), FIRST, w.deps(fakeEngine, { accountEngine: () => refused })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    const row = await reviewOf(w.app.head(pull).sha);
    expect(row).toMatchObject({
      status: 'failed',
      aiSource: 'account',
      error: `The Anthropic API key saved for ${login} was refused. Update it in Revo.`,
    });
  });

  it('subscription: used only when the server allows it and has the engine, else the free tier', async () => {
    await w.prisma.installation.update({
      where: { id: w.installation.id },
      data: { aiAccess: 'subscription' },
    });
    const host = spyEngine();
    const sub = spyEngine();
    const run = async (config: AiAccessConfig, subscriptionEngine?: () => ReviewEngine) => {
      const pull = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }]);
      await runReviewJob(
        w.payload(pull),
        FIRST,
        w.deps(host.engine, { ai: config, ...(subscriptionEngine ? { subscriptionEngine } : {}) }),
      );
      return reviewOf(w.app.head(pull).sha);
    };

    // Not allowed on this server: the free tier, even with an engine at hand.
    expect(await run(await ai(), () => sub.engine)).toMatchObject({ aiSource: 'revo' });
    // Allowed, but this worker has no subscription engine: the free tier.
    expect(await run(await ai({ allowSubscription: true }))).toMatchObject({ aiSource: 'revo' });
    expect(sub.models).toHaveLength(0);
    // Allowed and available: no free limits apply.
    const row = await run(await ai({ allowSubscription: true, freeLeft: 0 }), () => sub.engine);
    expect(row).toMatchObject({ status: 'done', aiSource: 'subscription' });
    expect(sub.models).toHaveLength(1);
    expect(host.models).toHaveLength(2);
  });
});
