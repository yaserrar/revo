import { describe, expect, it } from 'vitest';
import { assertRateLimit, takeRateLimit } from './rate-limit';

describe('rate limit', () => {
  it('allows max hits per window, then reports the wait', () => {
    const t = 1_000_000;
    expect(takeRateLimit('k1', 2, 10_000, t)).toBe(0);
    expect(takeRateLimit('k1', 2, 10_000, t + 1)).toBe(0);
    expect(takeRateLimit('k1', 2, 10_000, t + 2_000)).toBe(8);
    expect(takeRateLimit('k1', 2, 10_000, t + 10_000)).toBe(0);
  });

  it('throws RATE_LIMITED with retryAfterSec', () => {
    assertRateLimit('k2', 1, 60_000);
    expect(() => assertRateLimit('k2', 1, 60_000)).toThrow(
      expect.objectContaining({ status: 429, code: 'RATE_LIMITED' }),
    );
  });
});
