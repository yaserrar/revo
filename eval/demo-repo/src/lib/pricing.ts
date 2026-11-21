import { percentOf, taxOn } from './money';

export type CartLine = { unitPriceCents: number; quantity: number };
export type CouponTerms = { percentOff: number };

export type Totals = {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
};

/**
 * Prices a cart. Discounts reduce the taxable amount: tax is computed after
 * every discount, on what the customer actually pays for the goods.
 */
export function priceCart(lines: readonly CartLine[], coupon?: CouponTerms | null): Totals {
  const subtotalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
  const discountCents = coupon ? percentOf(subtotalCents, coupon.percentOff) : 0;
  const taxable = subtotalCents - discountCents;
  const taxCents = taxOn(taxable);
  return { subtotalCents, discountCents, taxCents, totalCents: taxable + taxCents };
}
