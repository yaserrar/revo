import { describe, expect, it } from 'vitest';
import { priceCart } from '../src/lib/pricing';

describe('priceCart', () => {
  it('adds tax on the subtotal', () => {
    expect(priceCart([{ unitPriceCents: 1000, quantity: 2 }])).toEqual({
      subtotalCents: 2000,
      discountCents: 0,
      taxCents: 165,
      totalCents: 2165,
    });
  });

  it('applies a percentage coupon before tax', () => {
    expect(priceCart([{ unitPriceCents: 1000, quantity: 2 }], { percentOff: 10 })).toEqual({
      subtotalCents: 2000,
      discountCents: 200,
      taxCents: 149,
      totalCents: 1949,
    });
  });
});
