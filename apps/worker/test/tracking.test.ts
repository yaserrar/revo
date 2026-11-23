import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { repoRef } from '@revo/github';
import { mockUserId, type MockPull } from '@revo/mock-github';
import { DISMISSED_REASON } from '@revo/review';
import { syncPullRequestFeedback } from '../src/review/feedback';
import { runReviewJob } from '../src/review/job';
import { sweepFeedback } from '../src/review/track';
import { createWorld, TEST_DATABASE_URL, type World } from './world';

const FIRST = { attemptsMade: 0, attempts: 3 };

/** A loop that reads one element past the end (a major the fake engine fixes in one line). */
const CART_V1 = [
  'export function cartTotal(items: { price: number }[]): number {',
  '  let sum = 0;',
  '  for (let i = 0; i <= items.length; i++) {',
  '    sum += items[i].price;',
  '  }',
  '  return sum;',
  '}',
  '',
].join('\n');
const FIXED_LINE = '  for (let i = 0; i < items.length; i++) {';
const CART_FIXED = CART_V1.replace('  for (let i = 0; i <= items.length; i++) {', FIXED_LINE);

describe.runIf(Boolean(TEST_DATABASE_URL))('one-click fixes, GitHub feedback and fixes across pushes', () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(() => w?.close());

  const prRow = (pull: MockPull) =>
    w.prisma.pullRequest.findFirstOrThrow({ where: { repoId: w.repo.id, number: pull.number } });
  const findingsOf = async (pull: MockPull, sha: string) =>
    w.prisma.finding.findMany({
      where: { review: { pullRequestId: (await prRow(pull)).id, headSha: sha } },
      orderBy: { index: 'asc' },
    });
  const open = async () => {
    const pull = w.openPull([{ path: 'src/cart.ts', before: null, after: CART_V1 }], { title: 'Cart total' });
    const result = await runReviewJob(w.payload(pull), FIRST, w.deps());
    expect(result.outcome).toBe('done');
    const [comment] = w.activity(pull).reviewComments;
    if (!comment) throw new Error('expected an inline comment');
    return { pull, comment, sha: w.app.head(pull).sha };
  };

  it('posts the fix as a GitHub suggested change on the flagged line', async () => {
    const { pull, comment, sha } = await open();
    expect(comment.line).toBe(3);
    expect(comment.startLine).toBeNull();
    expect(comment.body).toContain(`\`\`\`suggestion\n${FIXED_LINE}\n\`\`\``);

    const [finding] = await findingsOf(pull, sha);
    expect(finding).toMatchObject({ replacement: FIXED_LINE, openSince: null, resolution: null });

    const summary = w.activity(pull).comments[0]!.body;
    expect(summary).toContain('**Suggested change.**');
    expect(summary).toContain(
      `\`\`\`diff\n-  for (let i = 0; i <= items.length; i++) {\n+${FIXED_LINE}\n\`\`\``,
    );
  });

  it('a push that fixes the lines resolves the thread, lists the fix and counts it as useful', async () => {
    const { pull, comment, sha: firstSha } = await open();
    const [before] = await findingsOf(pull, firstSha);
    w.app.pushCommit(pull, [{ path: 'src/cart.ts', after: CART_FIXED }]);
    const second = await runReviewJob(w.payload(pull), FIRST, w.deps());
    expect(second).toMatchObject({ outcome: 'done', score: 100, passed: true });

    // Revo resolved its own thread; no new inline comment.
    expect(w.app.resolvedThreads.get(comment.id)).toBe(w.app.bot.login);
    expect(w.activity(pull).reviewComments).toHaveLength(1);

    const summary = w.activity(pull).comments[0]!.body;
    expect(summary).toContain('### Fixed since the last review (1)');
    expect(summary).toContain('✅ Major · Loop reads one element past the end');
    expect(summary).toContain(`#discussion_r${comment.id})`);

    const after = await w.prisma.finding.findUniqueOrThrow({
      where: { id: before!.id },
      include: { feedbacks: true },
    });
    expect(after).toMatchObject({ resolution: 'fixed', resolvedSha: w.app.head(pull).sha });
    expect(after.feedbacks.map((f) => [f.source, f.outcome])).toEqual([['fixed', 'useful']]);
  });

  it('a push that leaves the problem keeps the same thread and says since when it is open', async () => {
    const { pull, sha: firstSha } = await open();
    w.app.pushCommit(pull, [{ path: 'src/util.ts', after: 'export const one = 1;\n' }]);
    await runReviewJob(w.payload(pull), FIRST, w.deps());

    const { reviewComments, comments } = w.activity(pull);
    expect(reviewComments).toHaveLength(1);
    expect(w.app.resolvedThreads.size === 0 || !w.app.resolvedThreads.has(reviewComments[0]!.id)).toBe(true);
    const [still] = await findingsOf(pull, w.app.head(pull).sha);
    expect(still).toMatchObject({ openSince: firstSha, githubCommentId: BigInt(reviewComments[0]!.id) });
    expect(comments[0]!.body).toContain('_(still open)_');
    expect(comments[0]!.body).toContain(`open since [\`${firstSha.slice(0, 7)}\`]`);
  });

  it('reads 👍/👎 on the inline comment as feedback, one per person, and follows changes', async () => {
    const { pull, comment, sha } = await open();
    const hook = (content: string, login: string, remove = false) => {
      const c = content === '+1' ? 'THUMBS_UP' : content === '-1' ? 'THUMBS_DOWN' : 'HEART';
      if (remove) w.app.unreact(comment.id, c, login);
      else w.app.react(comment.id, c, login);
    };
    hook('+1', 'jonas-weber');
    hook('-1', 'mallory');
    hook('+1', 'eve');
    hook('-1', 'eve'); // both: no clear answer
    hook('heart', 'sam'); // says nothing about the finding

    // A Revo user who already answered in the dashboard is not counted twice.
    const login = `revo-user-${w.repo.id.slice(-6)}`;
    const user = await w.prisma.user.create({ data: { githubId: BigInt(mockUserId(login)), login } });
    try {
      const [finding] = await findingsOf(pull, sha);
      await w.prisma.feedback.create({
        data: { findingId: finding!.id, userId: user.id, outcome: 'useful' },
      });
      hook('-1', login);

      const octokit = await w.deps().github.installation(Number(w.installation.githubId));
      const pr = await prRow(pull);
      const sync = await syncPullRequestFeedback(w.prisma, octokit, repoRef(w.repo.fullName), pr);
      expect(sync.saved).toBe(2);
      const rows = await w.prisma.feedback.findMany({
        where: { findingId: finding!.id, source: 'github' },
        orderBy: { githubLogin: 'asc' },
      });
      expect(rows.map((r) => [r.githubLogin, r.outcome, Number(r.githubUserId)])).toEqual([
        ['jonas-weber', 'useful', mockUserId('jonas-weber')],
        ['mallory', 'wrong', mockUserId('mallory')],
      ]);
      expect((await prRow(pull)).feedbackSyncedAt).not.toBeNull();

      // Mallory takes the 👎 back; a second sync without changes writes nothing.
      hook('-1', 'mallory', true);
      const again = await syncPullRequestFeedback(w.prisma, octokit, repoRef(w.repo.fullName), pr);
      expect(again).toMatchObject({ saved: 0, removed: 1 });

      // After a new push the reaction moves to the newest finding of the thread, keeping its date.
      const created = rows[0]!.createdAt;
      w.app.pushCommit(pull, [{ path: 'src/util.ts', after: 'export const two = 2;\n' }]);
      await runReviewJob(w.payload(pull), FIRST, w.deps());
      await syncPullRequestFeedback(w.prisma, octokit, repoRef(w.repo.fullName), pr);
      const [latest] = await findingsOf(pull, w.app.head(pull).sha);
      const moved = await w.prisma.feedback.findMany({
        where: { source: 'github', githubLogin: 'jonas-weber' },
      });
      expect(moved.filter((m) => m.findingId === latest!.id).map((m) => m.createdAt)).toEqual([created]);
    } finally {
      await w.prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('a thread a person resolved unfixed is dismissed: found again, it is not posted or scored', async () => {
    const { pull, comment, sha: firstSha } = await open();
    w.app.resolvedThreads.set(comment.id, 'maya-chen');
    w.app.pushCommit(pull, [{ path: 'src/util.ts', after: 'export const three = 3;\n' }]);
    const second = await runReviewJob(w.payload(pull), FIRST, w.deps());
    expect(second).toMatchObject({ outcome: 'done', score: 100 });

    const [first] = await findingsOf(pull, firstSha);
    expect(first!.resolution).toBe('dismissed');
    const now = await findingsOf(pull, w.app.head(pull).sha);
    expect(now.filter((f) => f.verified)).toHaveLength(0);
    expect(now.find((f) => !f.verified)?.rejectReason).toBe(DISMISSED_REASON);
    expect(w.activity(pull).reviewComments).toHaveLength(1);
    // Not called fixed: the code did not change.
    expect(w.activity(pull).comments[0]!.body).not.toContain('Fixed since the last review');

    // The dismissal holds for every later review of the PR, not only the next one.
    w.app.pushCommit(pull, [{ path: 'src/util.ts', after: 'export const four = 4;\n' }]);
    expect(await runReviewJob(w.payload(pull), FIRST, w.deps())).toMatchObject({ score: 100 });
  });

  it('a finding most people marked wrong is dismissed too', async () => {
    const { pull, comment } = await open();
    w.app.react(comment.id, 'THUMBS_DOWN', 'jonas-weber');
    w.app.react(comment.id, 'THUMBS_DOWN', 'mallory');
    w.app.react(comment.id, 'THUMBS_UP', 'eve');
    w.app.pushCommit(pull, [{ path: 'src/util.ts', after: 'export const five = 5;\n' }]);
    expect(await runReviewJob(w.payload(pull), FIRST, w.deps())).toMatchObject({ score: 100 });
  });

  it('the periodic sweep reads feedback of recently reviewed PRs with inline comments', async () => {
    const { pull, comment } = await open();
    w.app.react(comment.id, 'THUMBS_UP', 'jonas-weber');
    // The review just read the PR's feedback; ten minutes later it is due again.
    await w.prisma.pullRequest.update({
      where: { id: (await prRow(pull)).id },
      data: { feedbackSyncedAt: null },
    });
    const result = await sweepFeedback({
      prisma: w.prisma,
      github: w.deps().github,
      log: pino({ level: 'silent' }),
    });
    expect(result.due).toBeGreaterThan(0);
    const pr = await prRow(pull);
    expect(pr.feedbackSyncedAt).not.toBeNull();
    expect(
      await w.prisma.feedback.count({
        where: { source: 'github', finding: { review: { pullRequestId: pr.id } } },
      }),
    ).toBe(1);
  });
});
