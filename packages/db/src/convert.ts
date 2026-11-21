import type { Prisma } from './generated/prisma/client';

/** Prisma Decimal (or null) → number of USD, for DTOs. */
export function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : value.toNumber();
}

/** BigInt GitHub id → number (GitHub ids fit in 2^53). */
export function bigintToNumber(value: bigint): number;
export function bigintToNumber(value: bigint | null | undefined): number | null;
export function bigintToNumber(value: bigint | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** First instant of the current UTC month: the window of monthly budgets. */
export function startOfUtcMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
