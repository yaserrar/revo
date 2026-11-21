import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env';

/** Checks the `x-signature` header of a payments webhook (hex HMAC-SHA256 of the raw body). */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', env.PAYMENTS_WEBHOOK_SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export type PaymentEvent = {
  type: 'payment.succeeded' | 'payment.failed';
  paymentId: string;
  orderId: string;
  amountCents: number;
};

async function paymentsApi<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${env.PAYMENTS_API_URL}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.PAYMENTS_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Payments API ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}

export async function createPaymentIntent(orderId: string, amountCents: number) {
  return paymentsApi<{ id: string; clientSecret: string }>('/v1/intents', { orderId, amountCents });
}
