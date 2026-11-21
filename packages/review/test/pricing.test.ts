import { describe, expect, it } from 'vitest';
import { addUsage, callCostUsd, ZERO_USAGE } from '../src/pricing';

const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadTokens: cacheRead,
  cacheWriteTokens: cacheWrite,
});

describe('callCostUsd', () => {
  it('prices Sonnet 5.5 at $2 in / $10 out per million', () => {
    expect(callCostUsd('claude-sonnet-5-5', usage(1_000_000, 0))).toBe(2);
    expect(callCostUsd('claude-sonnet-5-5', usage(0, 1_000_000))).toBe(10);
    expect(callCostUsd('claude-sonnet-5-5', usage(50_000, 2_000))).toBeCloseTo(0.12, 6);
  });

  it('prices cache reads and writes', () => {
    expect(callCostUsd('claude-sonnet-5-5', usage(0, 0, 1_000_000))).toBe(0.1);
    expect(callCostUsd('claude-sonnet-5-5', usage(0, 0, 0, 1_000_000))).toBe(2.5);
  });

  it('prices Opus 5.5 at $4 / $20', () => {
    expect(callCostUsd('claude-opus-5-5', usage(1_000_000, 1_000_000))).toBe(24);
  });

  it('applies Haiku 5.5 long-context rates above 100k prompt tokens', () => {
    expect(callCostUsd('claude-haiku-5-5', usage(100_000, 1_000))).toBeCloseTo(0.0105, 6);
    expect(callCostUsd('claude-haiku-5-5', usage(90_000, 1_000, 20_000))).toBeCloseTo(0.048, 6);
  });

  it('rejects unknown models', () => {
    expect(() => callCostUsd('gpt-x', ZERO_USAGE)).toThrow(/No price/);
  });
});

describe('addUsage', () => {
  it('adds every field', () => {
    expect(addUsage(usage(1, 2, 3, 4), usage(10, 20, 30, 40))).toEqual(usage(11, 22, 33, 44));
  });
});
