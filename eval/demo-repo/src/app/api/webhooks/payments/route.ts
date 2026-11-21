import { db } from '@/lib/db';
import { handle, HttpError, json } from '@/lib/http';
import { verifyWebhookSignature, type PaymentEvent } from '@/lib/payments';

/** Payment provider callbacks. The body is verified before it is parsed or trusted. */
export const POST = handle(async (req) => {
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get('x-signature'))) throw new HttpError(401, 'Bad signature');
  const event = JSON.parse(raw) as PaymentEvent;

  if (event.type === 'payment.succeeded') {
    // Idempotent: a retried delivery finds the order already paid and changes nothing.
    await db.order.updateMany({
      where: { id: event.orderId, paymentId: event.paymentId, status: 'PENDING', totalCents: event.amountCents },
      data: { status: 'PAID', paidAt: new Date() },
    });
  }
  return json({ received: true });
});
