import type { Prisma } from '@prisma/client';
import { HttpError } from './http';

/**
 * Takes `quantity` units of a product out of stock inside the order
 * transaction. The check and the decrement are one statement, so two
 * checkouts can never sell the same last unit.
 */
export async function reserveStock(tx: Prisma.TransactionClient, productId: string, quantity: number) {
  const { count } = await tx.product.updateMany({
    where: { id: productId, active: true, stock: { gte: quantity } },
    data: { stock: { decrement: quantity } },
  });
  if (count === 0) throw new HttpError(409, 'Not enough stock');
}
