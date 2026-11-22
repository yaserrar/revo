import { UnrecoverableError } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findingKey, REVIEWING_TITLE } from '@revo/github';
import {
  fakeEngine,
  recentNote,
  ReviewEngineError,
  usageNote,
  type EngineContext,
  type ReviewEngine,
} from '@revo/review';
import { SUMMARY_MARKER } from '@revo/shared';
import { runReviewJob } from '../src/review/job';
import { createWorld, ORDERS_V1, ORDERS_V2, TEST_DATABASE_URL, type World } from './world';

const FIRST = { attemptsMade: 0, attempts: 3 };

describe.runIf(Boolean(TEST_DATABASE_URL))('review job against the mock GitHub (fake engine)', () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(() => w?.close());

  it('reviews a PR: red check, summary comment, inline comments for blockers and majors only', async () => {
    const pull = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }]);
    const result = await runReviewJob(w.payload(pull), FIRST, w.deps());
    expect(result).toMatchObject({ outcome: 'done', passed: false });

    const { checkRuns, comments, reviewComments } = w.activity(pull);
    expect(checkRuns).toHaveLength(1);
    const check = checkRuns[0]!;
    expect(check).toMatchObject({ name: 'Revo', status: 'completed', conclusion: 'failure' });
    expect(check.title).toMatch(/^Score \d+\/100, changes needed$/);
    expect(check.history.map((h) => h.title)).toContain(REVIEWING_TITLE);

    expect(comments).toHaveLength(1);
    const body = comments[0]!.body;
    expect(body.startsWith(SUMMARY_MARKER)).toBe(true);
    expect(body).toMatch(/## 🔴 Revo · \d+\/100 · Changes needed/u);
    expect(body).not.toContain('Previous review');
    expect(body).toContain('❌ **Check failed**: 1 blocker found.');
    expect(body).toMatch(
      /\*\*Score:\*\* 100 − 30 \(1 blocker\) − 12 \(1 major\) − 8 \(2 minors\) = \*\*50\*\*/,
    );
    expect(body).toContain('🔴 Blocker · Security');
    expect(body).toContain('🟠 Major · Bug');
    expect(body).toContain('🟡 Minor · Error handling');
    // Lines link to the reviewed commit; reviewed files are listed.
    expect(body).toMatch(
      /\]\(https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[0-9a-f]+\/src\/api\/orders\.ts#L\d+/,
    );
    expect(body).toContain('<details><summary>Reviewed files (');
    expect(body).toContain('[Open in dashboard](https://revo.example.com/prs/');
    // Findings posted inline link to their thread; the offline engine is never credited to a model.
    expect(body).toMatch(/\[discussed inline\]\(https:\/\/github\.com\/[^)]+\/pull\/\d+#discussion_r\d+\)/);
    expect(body).toContain('Offline test engine (no AI)');
    expect(body).not.toContain('Claude Sonnet');
    expect(body).toContain('/settings)');

    // Blocker (SQL) and major (discount) inline, on their lines; the minor stays in the summary.
    expect(reviewComments.map((c) => [c.path, c.line]).sort()).toEqual([
      ['src/api/orders.ts', 5],
      ['src/api/orders.ts', 9],
    ]);

    const review = await w.prisma.review.findFirstOrThrow({
      where: { repoId: w.repo.id, headSha: w.app.head(pull).sha },
      include: { findings: true, pullRequest: true },
    });
    expect(review).toMatchObject({ status: 'done', passed: false });
    expect(review.score).toBe(result.outcome === 'done' ? result.score : -1);
    expect(review.filesReviewed).toBe(1);
    expect(Number(review.costUsd)).toBeGreaterThan(0);
    expect(review.checkRunId).toBe(BigInt(check.id));
    expect(review.pullRequest.summaryCommentId).toBe(BigInt(comments[0]!.id));
    const confirmed = review.findings.filter((f) => f.verified);
    expect(
      confirmed
        .filter((f) => f.posted)
        .map((f) => f.severity)
        .sort(),
    ).toEqual(['blocker', 'major']);
    expect(confirmed.find((f) => f.severity === 'major')?.githubCommentId).not.toBeNull();
  });

  it('a new push edits the same comment with the delta and adds no duplicate inline comment', async () => {
    const pull = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }]);
    const first = await runReviewJob(w.payload(pull), FIRST, w.deps());
    w.app.pushCommit(pull, [{ path: 'src/api/orders.ts', after: ORDERS_V2 }]);
    const second = await runReviewJob(w.payload(pull), FIRST, w.deps());
    if (first.outcome !== 'done' || second.outcome !== 'done') throw new Error('expected two done reviews');
    expect(second.score).toBeGreaterThan(first.score);

    const { checkRuns, comments, reviewComments } = w.activity(pull);
    expect(comments).toHaveLength(1);
    expect(comments[0]!.edits).toBe(1);
    expect(comments[0]!.body).toContain(`Previous review: ${first.score} → ${second.score}`);
    // The discount finding was already commented on the first commit: not posted again.
    expect(reviewComments).toHaveLength(2);
    expect(checkRuns.map((c) => c.headSha)).toEqual(pull.commits.map((c) => c.sha));

    const rows = await w.prisma.review.findMany({ where: { pullRequestId: await prId(w, pull.number) } });
    expect(rows.map((r) => r.status)).toEqual(['done', 'done']);
  });

  it('reviews files changed since the last review first and reads users of a removed name', async () => {
    w.app.setBaseFiles(w.repoGithubId, {
      'src/web/order-card.ts': 'export const label = (o: { orderTotalCents: number }) => o.orderTotalCents;\n',
    });
    const v1 = 'export function summary(o: { total: number }) {\n  return {\n    orderTotalCents: o.total,\n  };\n}\n';
    const pull = w.openPull([
      { path: 'src/api/summary.ts', before: null, after: v1 },
      { path: 'src/lib/util.ts', before: null, after: 'export const one = 1;\n' },
    ]);
    const seen: EngineContext[] = [];
    const spy: ReviewEngine = {
      kind: fakeEngine.kind,
      find: (ctx) => {
        seen.push(ctx);
        return fakeEngine.find(ctx);
      },
      verify: (ctx, findings) => fakeEngine.verify(ctx, findings),
    };
    await runReviewJob(w.payload(pull), FIRST, w.deps(spy));
    expect(seen[0]!.files.some((f) => f.sinceLastReview)).toBe(false);

    w.app.pushCommit(pull, [{ path: 'src/api/summary.ts', after: v1.replace('orderTotalCents', 'totalCents') }]);
    await runReviewJob(w.payload(pull), FIRST, w.deps(spy));
    const ctx = seen[1]!;
    const summary = ctx.files.find((f) => f.path === 'src/api/summary.ts')!;
    expect(summary.sinceLastReview?.patch).toContain('-    orderTotalCents: o.total,');
    expect(ctx.files.find((f) => f.path === 'src/lib/util.ts')!.sinceLastReview).toBeUndefined();
    expect(ctx.related.map((r) => r.path)).toContain('src/web/order-card.ts');
    expect(ctx.context.text).toContain(
      '`orderTotalCents` (object or type key renamed in src/api/summary.ts) is still used in: src/web/order-card.ts',
    );

    const row = await w.prisma.review.findFirstOrThrow({ where: { headSha: w.app.head(pull).sha } });
    expect(row.notes).toEqual([recentNote(1), usageNote(['src/web/order-card.ts'])]);
    expect(w.activity(pull).comments[0]!.body).toContain(usageNote(['src/web/order-card.ts']));
  });

  it('treats every file alike after a merge from the base branch', async () => {
    const pull = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }]);
    await runReviewJob(w.payload(pull), FIRST, w.deps());
    w.app.mergeCommits.add(w.app.pushCommit(pull, [{ path: 'src/api/orders.ts', after: ORDERS_V2 }]));
    await runReviewJob(w.payload(pull), FIRST, w.deps());
    const row = await w.prisma.review.findFirstOrThrow({ where: { headSha: w.app.head(pull).sha } });
    expect(row.notes).toEqual([]);
  });

  it('treats every file alike when the last reviewed commit is gone (force-push)', async () => {
    const pull = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }]);
    await runReviewJob(w.payload(pull), FIRST, w.deps());
    await w.prisma.review.updateMany({
      where: { headSha: w.app.head(pull).sha },
      data: { headSha: 'f'.repeat(40) },
    });
    w.app.pushCommit(pull, [{ path: 'src/api/orders.ts', after: ORDERS_V2 }]);
    const result = await runReviewJob(w.payload(pull), FIRST, w.deps());
    expect(result.outcome).toBe('done');
    const row = await w.prisma.review.findFirstOrThrow({ where: { headSha: w.app.head(pull).sha } });
    expect(row.notes).toEqual([]);
  });

  it('is idempotent per head SHA and reviews again on demand', async () => {
    const pull = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V2 }]);
    const first = await runReviewJob(w.payload(pull), FIRST, w.deps());
    expect(await runReviewJob(w.payload(pull), FIRST, w.deps())).toMatchObject({
      outcome: 'already-reviewed',
    });
    const again = await runReviewJob(w.payload(pull, { trigger: 'manual' }), FIRST, w.deps());
    expect(again).toMatchObject({ outcome: 'done' });
    const { comments } = w.activity(pull);
    expect(comments).toHaveLength(1);
    if (first.outcome === 'done')
      expect(comments[0]!.body).toContain(`Previous review: ${first.score} → ${first.score}`);
    const row = await w.prisma.review.findFirstOrThrow({ where: { headSha: w.app.head(pull).sha } });
    expect(row.trigger).toBe('manual');
    // The re-run got its own check run; the first one stays completed.
    const checks = w.activity(pull).checkRuns;
    expect(checks).toHaveLength(2);
    expect(checks.every((c) => c.status === 'completed')).toBe(true);
    expect(row.checkRunId).toBe(BigInt(checks[1]!.id));
  });

  it('reviews the live head and closes the checks of superseded commits', async () => {
    const pull = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V2 }]);
    const oldSha = w.app.head(pull).sha;
    const pullRequestId = await ensurePr(w, pull.number, oldSha);
    const oldCheck = w.app.nextObjectId();
    w.app.checkRuns.set(oldCheck, {
      id: oldCheck,
      repoId: w.repoGithubId,
      name: 'Revo',
      headSha: oldSha,
      status: 'in_progress',
      conclusion: null,
      title: REVIEWING_TITLE,
      summary: '',
      detailsUrl: null,
      history: [],
    });
    await w.prisma.review.create({
      data: {
        pullRequestId,
        repoId: w.repo.id,
        headSha: oldSha,
        model: 'claude-sonnet-5-5',
        checkRunId: BigInt(oldCheck),
      },
    });
    w.app.pushCommit(pull, [
      { path: 'src/api/orders.ts', after: `${ORDERS_V2}\nexport const VERSION = 2;\n` },
    ]);

    const result = await runReviewJob(w.payload(pull, { headSha: oldSha }), FIRST, w.deps());
    expect(result).toMatchObject({ outcome: 'done' });
    expect(w.app.checkRuns.get(oldCheck)).toMatchObject({ status: 'completed', conclusion: 'neutral' });
    const rows = await w.prisma.review.findMany({ where: { pullRequestId } });
    expect(rows.map((r) => r.headSha)).toEqual([w.app.head(pull).sha]);
  });

  it('skips drafts and spent budgets with a neutral check', async () => {
    const draft = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }], {
      draft: true,
    });
    expect(await runReviewJob(w.payload(draft), FIRST, w.deps())).toMatchObject({
      outcome: 'skipped',
      reason: 'draft',
    });
    expect(w.activity(draft).checkRuns[0]).toMatchObject({
      conclusion: 'neutral',
      title: 'Draft pull request',
    });

    await w.prisma.repoSettings.update({ where: { repoId: w.repo.id }, data: { monthlyBudgetUsd: 0 } });
    const pull = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }]);
    expect(await runReviewJob(w.payload(pull), FIRST, w.deps())).toMatchObject({
      outcome: 'skipped',
      reason: 'budget',
    });
    expect(w.activity(pull).checkRuns[0]).toMatchObject({
      conclusion: 'neutral',
      title: 'Monthly budget reached',
    });
    expect(w.activity(pull).comments).toHaveLength(0);
    await w.prisma.repoSettings.update({ where: { repoId: w.repo.id }, data: { monthlyBudgetUsd: 20 } });
  });

  it('skips a PR whose files are all ignored', async () => {
    const pull = w.openPull([{ path: 'pnpm-lock.yaml', before: null, after: 'lockfileVersion: 9\n' }]);
    expect(await runReviewJob(w.payload(pull), FIRST, w.deps())).toMatchObject({
      outcome: 'skipped',
      reason: 'no_reviewable_files',
    });
    expect(w.activity(pull).checkRuns[0]).toMatchObject({
      conclusion: 'neutral',
      title: 'No reviewable files',
    });
  });

  it('retries failed attempts, then marks the review failed with a neutral check', async () => {
    const broken: ReviewEngine = {
      kind: 'fake',
      find: () => Promise.reject(new Error('socket hang up')),
      verify: fakeEngine.verify,
    };
    const pull = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }]);
    const sha = w.app.head(pull).sha;

    await expect(runReviewJob(w.payload(pull), FIRST, w.deps(broken))).rejects.toThrow('socket hang up');
    let row = await w.prisma.review.findFirstOrThrow({ where: { headSha: sha } });
    expect(row).toMatchObject({ status: 'queued', error: 'Unexpected error while reviewing.' });
    expect(w.activity(pull).checkRuns[0]).toMatchObject({ status: 'in_progress' });

    await expect(
      runReviewJob(w.payload(pull), { attemptsMade: 2, attempts: 3 }, w.deps(broken)),
    ).rejects.toThrow();
    row = await w.prisma.review.findFirstOrThrow({ where: { headSha: sha } });
    expect(row.status).toBe('failed');
    expect(w.activity(pull).checkRuns[0]).toMatchObject({
      status: 'completed',
      conclusion: 'neutral',
      title: "Revo couldn't review this PR",
    });
  });

  it('does not retry errors that cannot succeed and bills the tokens already spent', async () => {
    const refusing: ReviewEngine = {
      kind: 'fake',
      find: () =>
        Promise.reject(
          new ReviewEngineError('refusal', 'find', 'declined', {
            usage: { inputTokens: 1000, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
          }),
        ),
      verify: fakeEngine.verify,
    };
    const pull = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }]);
    await expect(runReviewJob(w.payload(pull), FIRST, w.deps(refusing))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    const row = await w.prisma.review.findFirstOrThrow({ where: { headSha: w.app.head(pull).sha } });
    expect(row).toMatchObject({
      status: 'failed',
      error: 'Claude declined to review this change.',
      inputTokens: 1000,
    });
    expect(Number(row.costUsd)).toBeGreaterThan(0);
  });

  it('ignores Revo markers in comments written by anyone else', async () => {
    const pull = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }]);
    const forgedSummary = w.app.issueComments.size;
    w.app.addForeignComment(pull, { body: `${SUMMARY_MARKER}\nI am the summary now` });
    // A forged marker of the SQL finding must not stop its inline comment.
    const sqlKey = findingKey({
      file: 'src/api/orders.ts',
      category: 'security',
      title: 'SQL built from request input',
    });
    w.app.addForeignComment(pull, {
      body: `<!-- revo:finding ${sqlKey} -->`,
      path: 'src/api/orders.ts',
      line: 9,
    });
    expect(w.app.issueComments.size).toBe(forgedSummary + 1);

    const result = await runReviewJob(w.payload(pull), FIRST, w.deps());
    expect(result.outcome).toBe('done');
    const { comments, reviewComments } = w.activity(pull);
    const mine = comments.filter((c) => !c.author);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.body).toMatch(/## \S+ Revo · \d+\/100 · /u);
    expect(comments.find((c) => c.author)!.body).toContain('I am the summary now');
    expect(
      reviewComments
        .filter((c) => !c.author)
        .map((c) => c.line)
        .sort(),
    ).toEqual([5, 9]);
  });

  it('matches any stored ignore pattern quickly (no catastrophic backtracking)', async () => {
    const evil = '**/*' + '?*'.repeat(19) + 'Q';
    await w.prisma.repoSettings.update({
      where: { repoId: w.repo.id },
      data: { ignoreGlobs: [evil, '/bad'] },
    });
    try {
      const pull = w.openPull([
        { path: 'src/components/settings/repository-preferences-editor.tsx', before: null, after: ORDERS_V1 },
      ]);
      const started = Date.now();
      expect((await runReviewJob(w.payload(pull), FIRST, w.deps())).outcome).toBe('done');
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await w.prisma.repoSettings.update({ where: { repoId: w.repo.id }, data: { ignoreGlobs: [] } });
    }
  });

  it('reviews a PR whose lockfile is huge instead of skipping it as too large (spec 7.3)', async () => {
    const lock = Array.from({ length: 20_500 }, (_, i) => `  pkg-${i}: 1.0.${i}`).join('\n');
    const pull = w.openPull([
      { path: 'pnpm-lock.yaml', before: null, after: lock },
      { path: 'src/api/orders.ts', before: null, after: ORDERS_V1 },
    ]);
    const result = await runReviewJob(w.payload(pull), FIRST, w.deps());
    expect(result).toMatchObject({ outcome: 'done', passed: false });
    const review = await w.prisma.review.findFirstOrThrow({ where: { headSha: w.app.head(pull).sha } });
    expect(review.filesReviewed).toBe(1);
  });

  it('counts the engine’s cost when GitHub fails afterwards, and stores cache writes', async () => {
    const pull = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }]);
    const sha = w.app.head(pull).sha;
    w.app.failNext('POST', `/repos/${w.repo.fullName}/issues/${pull.number}/comments`, 502);
    await expect(runReviewJob(w.payload(pull), FIRST, w.deps())).rejects.toThrow();
    const row = await w.prisma.review.findFirstOrThrow({ where: { headSha: sha } });
    expect(row.status).toBe('queued');
    expect(Number(row.costUsd)).toBeGreaterThan(0);
    expect(row.cacheWriteTokens).toBeGreaterThan(0);
    const ledger = await w.prisma.reviewCost.findMany({ where: { reviewId: row.id } });
    expect(ledger).toHaveLength(1);
    expect(Number(ledger[0]!.costUsd)).toBeCloseTo(Number(row.costUsd), 6);

    // The retry succeeds and pays again: both runs are in the ledger and the total.
    await runReviewJob(w.payload(pull), { attemptsMade: 1, attempts: 3 }, w.deps());
    const done = await w.prisma.review.findFirstOrThrow({ where: { headSha: sha } });
    const runs = await w.prisma.reviewCost.findMany({ where: { reviewId: row.id } });
    expect(runs).toHaveLength(2);
    expect(Number(done.costUsd)).toBeCloseTo(
      runs.reduce((sum, r) => sum + Number(r.costUsd), 0),
      6,
    );
  });

  it('does not retry a GitHub 403 that is not a rate limit', async () => {
    const pull = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }]);
    w.app.failNext('POST', `/repos/${w.repo.fullName}/issues/${pull.number}/comments`, 403);
    await expect(runReviewJob(w.payload(pull), FIRST, w.deps())).rejects.toBeInstanceOf(UnrecoverableError);
    const row = await w.prisma.review.findFirstOrThrow({ where: { headSha: w.app.head(pull).sha } });
    expect(row).toMatchObject({ status: 'failed', error: 'GitHub answered 403 to a request.' });
  });

  it('fails the review and its check when GitHub breaks before the PR is synced', async () => {
    const pull = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }]);
    const sha = w.app.head(pull).sha;
    const pullRequestId = await ensurePr(w, pull.number, sha);
    const octokit = await w.deps().github.installation(Number(w.installation.githubId));
    const { data: check } = await octokit.request('POST /repos/{owner}/{repo}/check-runs', {
      owner: w.repo.fullName.split('/')[0]!,
      repo: w.repo.fullName.split('/')[1]!,
      name: 'Revo',
      head_sha: sha,
      status: 'in_progress',
    });
    await w.prisma.review.create({
      data: {
        pullRequestId,
        repoId: w.repo.id,
        headSha: sha,
        model: 'claude-sonnet-5-5',
        checkRunId: BigInt(check.id),
      },
    });
    for (let i = 0; i < 3; i++) w.app.failNext('GET', `/repos/${w.repo.fullName}/pulls/${pull.number}`, 503);

    await expect(runReviewJob(w.payload(pull), FIRST, w.deps())).rejects.toThrow();
    expect(await w.prisma.review.findFirstOrThrow({ where: { headSha: sha } })).toMatchObject({
      status: 'queued',
      error: 'GitHub answered 503 to a request.',
    });
    await expect(runReviewJob(w.payload(pull), { attemptsMade: 2, attempts: 3 }, w.deps())).rejects.toThrow();
    expect(await w.prisma.review.findFirstOrThrow({ where: { headSha: sha } })).toMatchObject({
      status: 'failed',
    });
    expect(w.activity(pull).checkRuns.find((c) => c.id === check.id)).toMatchObject({
      status: 'completed',
      conclusion: 'neutral',
      title: "Revo couldn't review this PR",
    });
  });

  it('marks a closed PR and drops its queued review', async () => {
    const pull = w.openPull([{ path: 'src/api/orders.ts', before: null, after: ORDERS_V1 }]);
    const pullRequestId = await ensurePr(w, pull.number, w.app.head(pull).sha);
    await w.prisma.review.create({
      data: { pullRequestId, repoId: w.repo.id, headSha: w.app.head(pull).sha, model: 'claude-sonnet-5-5' },
    });
    pull.state = 'closed';
    pull.merged = true;
    pull.mergedAt = new Date().toISOString();
    expect(await runReviewJob(w.payload(pull), FIRST, w.deps())).toEqual({ outcome: 'closed' });
    const pr = await w.prisma.pullRequest.findUniqueOrThrow({
      where: { id: pullRequestId },
      include: { reviews: true },
    });
    expect(pr.state).toBe('merged');
    expect(pr.reviews).toHaveLength(0);
  });
});

async function prId(w: World, number: number): Promise<string> {
  return (await w.prisma.pullRequest.findFirstOrThrow({ where: { repoId: w.repo.id, number } })).id;
}

async function ensurePr(w: World, number: number, headSha: string): Promise<string> {
  const pr = await w.prisma.pullRequest.create({
    data: {
      repoId: w.repo.id,
      number,
      title: 'Add order totals',
      author: 'maya-chen',
      baseRef: 'main',
      headRef: `feature/pr-${number}`,
      headSha,
      url: `https://github.com/x/y/pull/${number}`,
    },
  });
  return pr.id;
}
