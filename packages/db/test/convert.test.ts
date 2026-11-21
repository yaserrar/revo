import { describe, expect, it } from 'vitest';
import { bigintToNumber, decimalToNumber, Prisma, startOfUtcMonth } from '../src';

describe('convert helpers', () => {
  it('turns Decimals and BigInts into numbers', () => {
    expect(decimalToNumber(new Prisma.Decimal('0.183456'))).toBe(0.183456);
    expect(decimalToNumber(null)).toBe(0);
    expect(bigintToNumber(51000001n)).toBe(51000001);
    expect(bigintToNumber(null)).toBeNull();
  });

  it('finds the start of the UTC month', () => {
    expect(startOfUtcMonth(new Date('2026-11-21T03:00:00Z')).toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });
});
