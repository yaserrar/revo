import type { Order, User } from '@prisma/client';
import { env } from './env';
import { formatCents } from './money';

export type Mail = { to: string; subject: string; text: string };

/** Delivery is done by the mail relay on the private network; it never needs credentials here. */
async function deliver(mail: Mail): Promise<void> {
  const res = await fetch('http://mail-relay.internal/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, ...mail }),
  });
  if (!res.ok) throw new Error(`Mail relay answered ${res.status}`);
}

export async function sendOrderConfirmation(user: Pick<User, 'email' | 'name'>, order: Order) {
  await deliver({
    to: user.email,
    subject: `Your Harbor Goods order ${order.id}`,
    text: `Thanks ${user.name}. We received your order for ${formatCents(order.totalCents)}.`,
  });
}
