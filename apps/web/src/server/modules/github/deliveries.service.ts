import 'server-only';
import { prisma } from '~/server/config/prisma';

/** A delivery still unfinished after this long is considered lost and may be processed again. */
const STALE_DELIVERY_MS = 5 * 60_000;

export type DeliveryInfo = {
  deliveryId: string;
  event: string;
  action: string | null;
  installationGithubId: number | null;
  repoGithubId: number | null;
};

/**
 * Records a webhook delivery by its X-GitHub-Delivery id (idempotency).
 * Returns false when this delivery was already processed or is being
 * processed now; a delivery that failed (or got lost) may be claimed again,
 * which is what GitHub's "Redeliver" does.
 */
export async function claimDelivery(info: DeliveryInfo): Promise<boolean> {
  // skipDuplicates (ON CONFLICT DO NOTHING): a repeated delivery is expected, not an error to log.
  const created = await prisma.webhookDelivery.createMany({
    data: {
      deliveryId: info.deliveryId,
      event: info.event,
      action: info.action,
      installationGithubId: info.installationGithubId === null ? null : BigInt(info.installationGithubId),
      repoGithubId: info.repoGithubId === null ? null : BigInt(info.repoGithubId),
    },
    skipDuplicates: true,
  });
  if (created.count === 1) return true;
  const retry = await prisma.webhookDelivery.updateMany({
    where: {
      deliveryId: info.deliveryId,
      processedAt: null,
      OR: [{ error: { not: null } }, { receivedAt: { lt: new Date(Date.now() - STALE_DELIVERY_MS) } }],
    },
    data: { error: null, receivedAt: new Date() },
  });
  return retry.count === 1;
}

/** Marks the delivery processed, or stores the error so a redelivery can retry it. */
export async function finishDelivery(deliveryId: string, error?: string): Promise<void> {
  await prisma.webhookDelivery.update({
    where: { deliveryId },
    data: error ? { error: error.slice(0, 1000) } : { processedAt: new Date(), error: null },
  });
}
