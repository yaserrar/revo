import { randomBytes } from 'node:crypto';
import { Queue, Worker, type Job } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  REVIEW_JOB_NAME,
  REVIEW_QUEUE,
  reviewJobAddOptions,
  reviewJobId,
  type ReviewJobPayload,
} from '@revo/shared';
import { bullConnection } from '../src/redis';

// Real Redis (db 7 from REDIS_URL) under a throwaway prefix: never touches real jobs.
const REDIS_URL = process.env.REDIS_URL;
const prefix = `revo-test-${randomBytes(4).toString('hex')}`;
const DEBOUNCE_MS = 60_000;

const payload = (sha: string, pr = 7): ReviewJobPayload => ({
  installationGithubId: 1,
  repoGithubId: 42,
  repoFullName: 'acme/shop',
  prNumber: pr,
  headSha: sha,
  trigger: 'auto',
  enqueuedAt: new Date().toISOString(),
});

describe.runIf(Boolean(REDIS_URL))('review queue: debounce and re-queueing (spec 6)', () => {
  let queue: Queue;
  beforeAll(async () => {
    queue = new Queue(REVIEW_QUEUE, { connection: bullConnection(REDIS_URL!), prefix });
    await queue.waitUntilReady();
  });
  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  let nonces = 0;
  const add = (p: ReviewJobPayload, debounceMs = DEBOUNCE_MS, nonce = `n${++nonces}`) =>
    queue.add(REVIEW_JOB_NAME, p, reviewJobAddOptions(p, debounceMs, nonce));

  it('waits the debounce and keeps one waiting job per PR, the newest push', async () => {
    const a = payload('a'.repeat(40));
    const b = payload('b'.repeat(40));
    await add(a, DEBOUNCE_MS, 'a1');
    await add(a, DEBOUNCE_MS, 'a2');
    let delayed = await queue.getDelayed();
    expect(delayed.map((j) => j.id)).toEqual([reviewJobId(a, 'a2')]);
    expect(delayed[0]!.opts.delay).toBe(DEBOUNCE_MS);

    await add(b, DEBOUNCE_MS, 'b1');
    delayed = await queue.getDelayed();
    expect(delayed.map((j) => j.id)).toEqual([reviewJobId(b, 'b1')]);
    expect(await queue.getJob(reviewJobId(a, 'a2'))).toBeUndefined();
  });

  it('keeps PRs apart and runs a manual review at once under its own id', async () => {
    const other = payload('c'.repeat(40), 8);
    await add(other, DEBOUNCE_MS, 'c1');
    const manual = { ...payload('b'.repeat(40)), trigger: 'manual' as const };
    await add(manual, DEBOUNCE_MS, 'm1');
    const waiting = await queue.getWaiting();
    expect(waiting.map((j) => j.id)).toEqual([reviewJobId(manual, 'm1')]);
    const delayed = (await queue.getDelayed()).map((j) => j.id).sort();
    expect(delayed).toEqual([reviewJobId(payload('b'.repeat(40)), 'b1'), reviewJobId(other, 'c1')].sort());
    await queue.obliterate({ force: true });
  });

  it('queues a commit again after its earlier job finished (e.g. a PR reopened on the same SHA)', async () => {
    const processed: string[] = [];
    const worker = new Worker(
      REVIEW_QUEUE,
      async (job: Job<ReviewJobPayload>) => {
        processed.push(job.id!);
      },
      { connection: bullConnection(REDIS_URL!), prefix },
    );
    try {
      const p = payload('9'.repeat(40), 9);
      await add(p, 0, 'first');
      await waitFor(() => processed.length === 1);
      await add(p, 0, 'second');
      await waitFor(() => processed.length === 2);
      expect(processed).toEqual([reviewJobId(p, 'first'), reviewJobId(p, 'second')]);
    } finally {
      await worker.close();
      await queue.obliterate({ force: true });
    }
  });

  it('keeps the newest push made while a review of the PR runs, and runs it afterwards', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const processed: string[] = [];
    let started!: () => void;
    const firstStarted = new Promise<void>((resolve) => (started = resolve));
    const worker = new Worker(
      REVIEW_QUEUE,
      async (job: Job<ReviewJobPayload>) => {
        processed.push(job.data.headSha[0]!);
        if (processed.length === 1) {
          started();
          await gate;
        }
      },
      { connection: bullConnection(REDIS_URL!), prefix, concurrency: 2 },
    );
    try {
      await add(payload('d'.repeat(40)), 0);
      await firstStarted;
      // Two pushes while "d" is being reviewed: only the newest is kept, and it waits for "d".
      await add(payload('e'.repeat(40)), 0);
      await add(payload('f'.repeat(40)), 0);
      expect(processed).toEqual(['d']);
      release();
      await waitFor(() => processed.length === 2);
      await new Promise((r) => setTimeout(r, 300));
      expect(processed).toEqual(['d', 'f']);
    } finally {
      await worker.close();
    }
  });
});

async function waitFor(check: () => boolean, timeoutMs = 10_000) {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}
