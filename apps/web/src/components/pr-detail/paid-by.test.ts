import { describe, expect, it } from 'vitest';
import { AI_SOURCE_LABELS } from '@revo/shared';
import { paidBy } from './paid-by';

const run = { status: 'done', aiSource: null, costUsd: 0.12, inputTokens: 900, outputTokens: 120 } as const;

describe('paidBy', () => {
  it('names the recorded payer of a run', () => {
    expect(paidBy({ ...run, aiSource: 'account' })).toBe(AI_SOURCE_LABELS.account);
    expect(paidBy({ ...run, status: 'failed', aiSource: 'subscription' })).toBe(
      AI_SOURCE_LABELS.subscription,
    );
  });

  it('treats billed rows saved before the payer was recorded as Revo’s', () => {
    expect(paidBy(run)).toBe(AI_SOURCE_LABELS.revo);
    expect(paidBy({ ...run, status: 'failed' })).toBe(AI_SOURCE_LABELS.revo);
  });

  it('shows no payer for a run that failed before an engine was chosen', () => {
    expect(paidBy({ ...run, status: 'failed', costUsd: 0, inputTokens: 0, outputTokens: 0 })).toBe('—');
  });

  it('shows no payer for queued or skipped runs, whatever an earlier run recorded', () => {
    expect(paidBy({ ...run, status: 'skipped', aiSource: 'account' })).toBe('—');
    expect(paidBy({ ...run, status: 'queued', aiSource: 'revo' })).toBe('—');
  });
});
