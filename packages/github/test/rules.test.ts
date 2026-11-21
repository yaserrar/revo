import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { skipReasonFor, type GateInput } from '../src/rules';
import { createWebhookVerifier, deliveryIds, isReviewAction, PullRequestEventSchema } from '../src/webhooks';

const gate: GateInput = {
  repoEnabled: true,
  reviewDrafts: false,
  reviewBots: false,
  draft: false,
  authorLogin: 'maya-chen',
  authorType: 'User',
  monthSpentUsd: 3,
  monthlyBudgetUsd: 20,
};

describe('skipReasonFor (spec 6, 11.6)', () => {
  it('reviews a normal PR', () => {
    expect(skipReasonFor(gate)).toBeNull();
  });

  it('skips disabled repos, drafts, bots and spent budgets, in that order', () => {
    expect(skipReasonFor({ ...gate, repoEnabled: false, draft: true })).toBe('disabled');
    expect(skipReasonFor({ ...gate, draft: true })).toBe('draft');
    expect(skipReasonFor({ ...gate, authorLogin: 'dependabot[bot]', authorType: 'Bot' })).toBe('bot');
    expect(skipReasonFor({ ...gate, authorLogin: 'renovate' })).toBe('bot');
    expect(skipReasonFor({ ...gate, monthSpentUsd: 20 })).toBe('budget');
    expect(skipReasonFor({ ...gate, monthlyBudgetUsd: 0, monthSpentUsd: 0 })).toBe('budget');
  });

  it('honours the draft and bot settings', () => {
    expect(skipReasonFor({ ...gate, draft: true, reviewDrafts: true })).toBeNull();
    expect(skipReasonFor({ ...gate, authorLogin: 'renovate[bot]', reviewBots: true })).toBeNull();
  });
});

describe('webhooks', () => {
  it('verifies the X-Hub-Signature-256 of the raw body', async () => {
    const verify = createWebhookVerifier('s3cret');
    const body = JSON.stringify({ zen: 'Keep it simple.' });
    const sig = `sha256=${createHmac('sha256', 's3cret').update(body).digest('hex')}`;
    expect(await verify(body, sig)).toBe(true);
    expect(await verify(`${body} `, sig)).toBe(false);
    expect(await verify(body, 'sha256=deadbeef')).toBe(false);
    expect(await verify(body, null)).toBe(false);
  });

  it('knows which actions start a review and reads delivery ids', () => {
    expect(isReviewAction('synchronize')).toBe(true);
    expect(isReviewAction('closed')).toBe(false);
    expect(deliveryIds({ installation: { id: 4 }, repository: { id: 9 } })).toEqual({
      installationGithubId: 4,
      repoGithubId: 9,
    });
    expect(deliveryIds('x')).toEqual({ installationGithubId: null, repoGithubId: null });
  });

  it('rejects a pull_request payload without a head SHA', () => {
    expect(PullRequestEventSchema.safeParse({ action: 'opened' }).success).toBe(false);
  });
});
