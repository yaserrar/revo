import type { PrismaClient } from './generated/prisma/client';

/** Webhook log rows are kept this long (idempotency and debugging need days, not months). */
export const WEBHOOK_DELIVERY_RETENTION_DAYS = 30;

/** Deletes webhook log rows older than the retention period. Returns how many went. */
export async function pruneWebhookDeliveries(
  prisma: Pick<PrismaClient, 'webhookDelivery'>,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - WEBHOOK_DELIVERY_RETENTION_DAYS * 24 * 3600_000);
  const { count } = await prisma.webhookDelivery.deleteMany({ where: { receivedAt: { lt: cutoff } } });
  return count;
}
