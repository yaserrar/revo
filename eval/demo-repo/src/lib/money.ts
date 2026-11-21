/** All amounts are integer cents. Never use floats for money outside this file. */

/** Sales tax: 8.25%, in basis points. */
export const TAX_RATE_BPS = 825;

/** Tax on an amount, rounded half up to the cent. */
export function taxOn(amountCents: number): number {
  return Math.round((amountCents * TAX_RATE_BPS) / 10_000);
}

/** `percent` of an amount, rounded down so a discount never exceeds the percentage. */
export function percentOf(amountCents: number, percent: number): number {
  return Math.floor((amountCents * percent) / 100);
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
